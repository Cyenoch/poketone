"""Hand-built rigs and run/idle clips for the Bulbasaur line (Blender 5.2), 0 credits.

Run: blender --background --factory-startup --python assets/characters/rig-quadrupeds.py -- [name ...]
Then: bun run assets:game bulbasaur ivysaur venusaur

Tripo's quadruped rigs misread these bodies (bulb as head, legs on spiked tiptoes, body on unnamed bones), so each
form's unrigged Tripo mesh (`<name>/generation`) gets its own armature here: Hip (body, bulb, tail), Chest, Head, and
per leg Upper/Lower/Foot, weighted by region. The feet are found from the lowest vertices; the rest of the layout is
per form below. Each frame solves a two-bone leg in the leg's own vertical plane (knee forward) for a scripted foot
path: planted feet slide straight back at a constant speed and stay flat, lifted feet arc forward. Writes
`<name>/blender/model.glb` with the clips `run` and `idle`.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Vector
from pathlib import Path

# CHARACTERS_ROOT stages a regeneration in its own folder (same <name>/... layout) before it replaces the sources.
CHARACTERS = Path(os.environ.get("CHARACTERS_ROOT", Path(__file__).resolve().parent))
FPS = 30
IDLE_FRAMES = 72
ANKLE = 0.035
FOOT_LENGTH = 0.08

# Per form, in the source mesh's units after its feet are put on z = 0 (Blender axes: +X forward, +Y left, +Z up):
#   legs: (name, phase) per foot, matched to the lowest-vertex clusters by quadrant (F/B front/back, L/R side)
#   yaw: optional turn (radians, about +Z) applied first when the mesh doesn't face +X
#   joint: shoulder/hip joint height; knee: forward offset of the rest-pose knee, the slack that lets the leg reach
#   the ends of the stride (it sets the bend plane too: feet tuck back as they lift); chest_x: where Hip hands over to Chest; neck/head: Head bone ends
#   paw: height the Foot bone owns outright; shin: Lower -> Upper blend, as fractions of the joint height
#   thigh: fraction of the joint height where the leg starts handing over to the body
#   frames: one gait cycle at timeScale 1; duty: planted fraction of it; stride: foot travel while planted
#   lift: swing apex; bob: body rise in the flight phase; roll: side-to-side body roll (radians)
# The game plays the clip at speed / runClipSpeed (capped at MAX_CADENCE = 3.4 cycles/s), so a short duty and a long stride let the planted
# feet keep up with the sim's ~3.5–4 units/s on these stubby legs: a scampering trot with a brief flight phase.
FORMS = {
    "bulbasaur": dict(
        legs=[("FL", 0.0), ("BR", 0.0), ("FR", 0.5), ("BL", 0.5)],
        joint=0.3, knee=0.075, paw=ANKLE, shin=(0.25, 0.75), thigh=0.55,
        chest_x=0.0, neck=(0.12, 0.42), head=(0.46, 0.5),
        frames=20, duty=0.32, stride=0.24, lift=0.06, bob=0.018, roll=0.04,
    ),
    "ivysaur": dict(
        legs=[("FL", 0.0), ("BR", 0.0), ("FR", 0.5), ("BL", 0.5)],
        joint=0.24, knee=0.065, paw=ANKLE, shin=(0.25, 0.75), thigh=0.55,
        chest_x=0.0, neck=(0.2, 0.36), head=(0.48, 0.4),
        frames=20, duty=0.32, stride=0.2, lift=0.05, bob=0.015, roll=0.035,
    ),
    "venusaur": dict(
        legs=[("FL", 0.0), ("BR", 0.0), ("FR", 0.5), ("BL", 0.5)],
        joint=0.26, knee=0.065, paw=0.05, shin=(0.25, 0.75), thigh=0.55,
        chest_x=-0.1, neck=(0.1, 0.38), head=(0.48, 0.42),
        frames=20, duty=0.32, stride=0.2, lift=0.05, bob=0.016, roll=0.035,
    ),
}


def source_for(name):
    matches = sorted((CHARACTERS / name / "generation").glob("**/model.glb"))
    if len(matches) != 1:
        raise RuntimeError(f"{name}: expected one generation model.glb, found {len(matches)}")
    return matches[0]


def find_feet(mesh, labels):
    """Centres and radii of the lowest 3.5% of vertices (Ivysaur's belly starts just above), clustered by k-means
    seeded at the labelled quadrants."""
    top = max(v.co.z for v in mesh.vertices)
    low = [v.co for v in mesh.vertices if v.co.z < 0.035 * top]
    sign = {"F": 1, "B": -1, "L": 1, "R": -1}
    # Quadrants around the feet's centroid, not the origin: Venusaur's feet sit well behind its bounding-box centre.
    centre = sum(low, Vector()) / len(low)
    seeds = [Vector((centre.x + 0.15 * sign[l[0]], 0.2 * sign[l[1]], 0)) for l in labels]
    for _ in range(20):
        groups = [[] for _ in seeds]
        for co in low:
            groups[min(range(len(seeds)), key=lambda i: (co.xy - seeds[i].xy).length)].append(co)
        if not all(groups):
            raise RuntimeError(f"{mesh.name}: a foot cluster came up empty")
        seeds = [sum(g, Vector()) / len(g) for g in groups]
    return {label: (Vector((s.x, s.y, 0)), max((co.xy - s.xy).length for co in g))
            for label, s, g in zip(labels, seeds, groups)}


def build_armature(cfg, feet):
    xs = [f.x for f, _ in feet.values()]
    centre_x = (min(xs) + max(xs)) / 2
    joint = cfg["joint"]
    rig = bpy.data.objects.new("Rig", bpy.data.armatures.new("Rig"))
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = rig.data.edit_bones

    def bone(name, head, tail, parent=None, connect=False):
        b = eb.new(name)
        b.head, b.tail, b.parent, b.use_connect = head, tail, parent, connect
        return b

    # The view centres the model on Hip's head (`hipAnchor` in view/assets.ts): keep it over the middle of the feet.
    hip = bone("Hip", (centre_x, 0, joint + 0.08), (centre_x - 0.15, 0, joint + 0.08))
    chest = bone("Chest", hip.head, (cfg["neck"][0], 0, cfg["neck"][1]), hip)
    bone("Head", chest.tail, (cfg["head"][0], 0, cfg["head"][1]), chest, True)
    for label, (foot, _) in feet.items():
        ankle = Vector((foot.x - 0.02, foot.y, ANKLE))
        knee = Vector((foot.x + cfg["knee"], foot.y * 0.95, joint / 2))
        upper = bone(f"Upper{label}", Vector((foot.x - 0.01, foot.y * 0.9, joint)), knee, chest if label[0] == "F" else hip)
        lower = bone(f"Lower{label}", knee, ankle, upper, True)
        bone(f"Foot{label}", ankle, ankle + Vector((FOOT_LENGTH, 0, 0)), lower, True)
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def smoothstep(lo, hi, x):
    u = min(1.0, max(0.0, (x - lo) / (hi - lo)))
    return u * u * (3 - 2 * u)


def bind(mesh_obj, rig, feet, cfg):
    """Region weights instead of bone heat, which fails on Tripo's open, seam-split, self-intersecting shells. Each
    leg owns a column around its foot below the joint (Foot for the sole, then Lower, then Upper); the rest of the
    body blends Hip -> Chest -> Head along +X, so the bulb and leaves ride the body and never a leg."""
    joint, groups, mesh = cfg["joint"], {}, mesh_obj.data
    for bone in rig.data.bones:
        groups[bone.name] = mesh_obj.vertex_groups.new(name=bone.name)
    # Belly faces that span the midline between the legs stay with the body;
    # weighted to the legs, their two edges would follow opposite legs and stretch into a spike.
    belly = set()
    for face in mesh.polygons:
        ys = [mesh.vertices[i].co.y for i in face.vertices]
        if min(ys) < -0.04 and max(ys) > 0.04 and face.center.z < joint:
            belly.update(face.vertices)
    for v in mesh.vertices:
        co, weights, legs = v.co, {}, 0.0
        for label, (foot, radius) in feet.items() if v.index not in belly else ():
            leg = (1 - smoothstep(radius, radius * 1.6, (co.xy - foot.xy).length)) * (
                1 - smoothstep(joint * cfg["thigh"], joint * 0.95, co.z))
            if leg <= 0:
                continue
            legs += leg
            sole = 1 - smoothstep(cfg["paw"], cfg["paw"] + 0.04, co.z)
            shin = (1 - sole) * (1 - smoothstep(joint * cfg["shin"][0], joint * cfg["shin"][1], co.z))
            weights[f"Foot{label}"] = leg * sole
            weights[f"Lower{label}"] = leg * shin
            weights[f"Upper{label}"] = leg * (1 - sole - shin)
        if legs > 1:
            weights = {k: w / legs for k, w in weights.items()}
            legs = 1.0
        head = smoothstep(cfg["neck"][0] - 0.04, cfg["neck"][0] + 0.06, co.x)
        chest = smoothstep(cfg["chest_x"] - 0.1, cfg["chest_x"] + 0.1, co.x)
        weights["Head"] = (1 - legs) * head
        weights["Chest"] = (1 - legs) * (1 - head) * chest
        weights["Hip"] = (1 - legs) * (1 - head) * (1 - chest)
        for name, w in weights.items():
            if w > 1e-4:
                groups[name].add([v.index], w, "REPLACE")
    modifier = mesh_obj.modifiers.new("Rig", "ARMATURE")
    modifier.object = rig
    mesh_obj.parent = rig


def aim(pose_bone, head, direction):
    """Pose a bone (armature space) so its rest axis points along `direction` with the least twist."""
    rest = pose_bone.bone.matrix_local.to_3x3()
    swing = (rest @ Vector((0, 1, 0))).rotation_difference(direction).to_matrix()
    pose_bone.matrix = Matrix.Translation(head) @ (swing @ rest).to_4x4()
    bpy.context.view_layer.update()


def solve_leg(rig, label, ankle):
    """Two-bone IK in the plane through the hip joint and ankle that holds the forward direction (knee forward)."""
    upper, lower, foot = (rig.pose.bones[f"{part}{label}"] for part in ("Upper", "Lower", "Foot"))
    l1, l2 = upper.bone.length, lower.bone.length
    hip = upper.head.copy()
    reach = ankle - hip
    if reach.length > (l1 + l2) * 0.999:
        raise RuntimeError(f"Leg {label} can't reach its foot ({reach.length:.3f} > {l1 + l2:.3f}): raise joint or cut stride")
    d = reach.length
    axis = reach.normalized()
    forward = Vector((1, 0, 0))
    bend = (forward - axis * axis.dot(forward)).normalized()
    along = (d * d + l1 * l1 - l2 * l2) / (2 * d)
    knee = hip + axis * along + bend * math.sqrt(max(0.0, l1 * l1 - along * along))
    aim(upper, hip, knee - hip)
    aim(lower, knee, hip + axis * d - knee)
    # Flat in world (rest orientation), so the sole lands and leaves level.
    aim(foot, foot.head.copy(), Vector((1, 0, 0)))


def smooth(u):
    return u * u * (3 - 2 * u)


def foot_offset(phase, cfg):
    """(forward, up) of a foot from its rest spot. Planted: straight back at constant speed; lifted: an arc."""
    duty, stride, lift = cfg["duty"], cfg["stride"], cfg["lift"]
    if phase < duty:
        return stride / 2 - stride * phase / duty, 0.0
    u = (phase - duty) / (1 - duty)
    return -stride / 2 + stride * smooth(u), lift * math.sin(math.pi * u)


def body(rig, bob, roll, yaw, chest_pitch, nod):
    pb = rig.pose.bones
    for b in pb:
        b.matrix_basis = Matrix.Identity(4)
    hip = pb["Hip"]
    rest = hip.bone.matrix_local
    turn = Matrix.Rotation(yaw, 3, "Z") @ Matrix.Rotation(roll, 3, "X")
    hip.matrix = Matrix.Translation(rest.translation + Vector((0, 0, bob))) @ (turn @ rest.to_3x3()).to_4x4()
    bpy.context.view_layer.update()
    pb["Chest"].rotation_mode = pb["Head"].rotation_mode = "XYZ"
    # Chest and Head point forward (+X), so their local X is the lateral axis: pitch and nod.
    pb["Chest"].rotation_euler = (chest_pitch, 0, 0)
    pb["Head"].rotation_euler = (nod, 0, -yaw)
    bpy.context.view_layer.update()


def key_all(rig, frame):
    for pb in rig.pose.bones:
        basis = pb.matrix_basis.copy()
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = basis
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)


def clip(rig, name, frames, pose_at):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    for frame in range(frames + 1):
        pose_at(frame / frames)
        key_all(rig, frame)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    rig.animation_data.action = None


def run_pose(rig, cfg, rest_ankles):
    def pose(t):
        # Lowest at mid-stance of each diagonal pair, highest in the flight between them.
        settle = math.cos(4 * math.pi * (t - cfg["duty"] / 2))
        roll = cfg["roll"] * math.sin(2 * math.pi * t)
        body(rig, -cfg["bob"] * settle, roll, 0.5 * roll, 0.03 * settle, -0.05 * settle)
        for label, offset in cfg["legs"]:
            fwd, up = foot_offset((t + offset) % 1, cfg)
            solve_leg(rig, label, rest_ankles[label] + Vector((fwd, 0, up)))

    return pose


def idle_pose(rig, cfg, rest_ankles):
    def pose(t):
        breath = math.sin(2 * math.pi * t)
        body(rig, 0.006 * breath, 0, 0, -0.02 * breath, 0.03 * math.sin(2 * math.pi * t - 0.8))
        for label, _ in cfg["legs"]:
            solve_leg(rig, label, rest_ankles[label])

    return pose


def build(name):
    cfg = FORMS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=str(source_for(name)))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if len(meshes) != 1:
        raise RuntimeError(f"{name}: expected one mesh, found {len(meshes)}")
    mesh_obj = meshes[0]
    bpy.context.view_layer.objects.active = mesh_obj
    mesh_obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if "yaw" in cfg:
        mesh_obj.data.transform(Matrix.Rotation(cfg["yaw"], 4, "Z"))
    low = min(v.co.z for v in mesh_obj.data.vertices)
    for v in mesh_obj.data.vertices:
        v.co.z -= low
    feet = find_feet(mesh_obj.data, [label for label, _ in cfg["legs"]])
    rig = build_armature(cfg, feet)
    bind(mesh_obj, rig, feet, cfg)
    rest_ankles = {label: rig.data.bones[f"Foot{label}"].head_local.copy() for label in feet}
    rig.animation_data_create()
    clip(rig, "run", cfg["frames"], run_pose(rig, cfg, rest_ankles))
    clip(rig, "idle", IDLE_FRAMES, idle_pose(rig, cfg, rest_ankles))
    out = CHARACTERS / name / "blender" / "model.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", export_animations=True, export_animation_mode="NLA_TRACKS",
        export_draco_mesh_compression_enable=False,
    )
    print(json.dumps({"name": name, "feet": {k: [round(c, 3) for c in f.xy] for k, (f, _) in feet.items()},
                      "output": str(out.relative_to(CHARACTERS.parent))}))


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for form in argv or list(FORMS):
    build(form)
