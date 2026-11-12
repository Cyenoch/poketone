"""Hand-keyed run clips on the Tripo biped rigs of the short-legged forms (Blender 5.2), 0 credits.

Run: blender --background --factory-startup --python assets/characters/run-bipeds.py -- [name ...]
Then: bun run assets:game charmander pikachu raichu squirtle wartortle

Tripo's run clips step in place with a stride a fraction of these forms' ground speed, so under the cadence cap
(`MAX_CADENCE`, 3.4 cycles/s) their feet slid. This keeps each form's Tripo rig, skin and `idle` clip and replaces
`run` with one gait cycle keyed here: the body (Hip) crouches, bobs, leans and rolls; each leg solves a two-bone IK
(Thigh, Calf, knee in front) to a scripted foot. Planted feet slide straight back at a constant speed, the heel
peeling up about the foot's tip before toe-off, which reaches far behind these short legs; lifted feet arc
forward. The arms keep Tripo's run swing (scaled, phase-matched to the legs), the spine and head counter the lean. Writes `<name>/blender/model.glb` with Tripo's other clips
and the new `run`.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Quaternion, Vector
from pathlib import Path

# CHARACTERS_ROOT stages a regeneration in its own folder (same <name>/... layout) before it replaces the sources.
CHARACTERS = Path(os.environ.get("CHARACTERS_ROOT", Path(__file__).resolve().parent))
FPS = 24  # Tripo's clips import at Blender's default rate; keep it so `idle` keeps its timing.

# Per form, in the Tripo mesh's units (about 1 tall; Blender axes: +X forward, +Y left, +Z up):
#   legs: phase of the L and R foot in the cycle (0 / 0.5: a run; nearly equal: a two-footed hop)
#   frames: one gait cycle at timeScale 1; duty: planted fraction of it; stride: tip travel while planted
#   reach: where the planted stretch is centred, ahead of the rest foot tip; roll: heel peel at toe-off (rad),
#   from `peel` of the stance on; lift: tip height mid-swing
#   crouch: steady hip drop; bob: hip rise and fall around it (low at mid-stance); surge: hip drift back and
#   forth (moving back fastest at mid-stance); lean: forward pitch (rad);
#   roll_body / sway: side-to-side roll (rad) and shift toward the planted foot; twist: hip yaw (rad);
#   chest: how much the chest turns back against the hip's twist and lean (0 keeps it rigid with the hip)
#   arms: share of Tripo's arm swing kept (prepare-game-models.py then turns the shoulders half-way back to the
#   T-pose in every clip, `open_arms`, so the hands clear the belly)
#   rehome: (from, to, where) moves the vertices whose dominant bone is `from` and whose rest position `where` accepts
#   (the tail) wholly onto `to`
# The planted speed is stride / (duty * frames / FPS); the game plays the clip at speed / that (capped at
# 3.4 cycles/s), so stride / duty >= the form's speed (model units/s) / 3.1 keeps the feet on the ground up to
# full speed with some headroom for speed items.
FORMS = {
    # Scampers in quick two-footed hops with a long flight. Its feet are twice as long as its legs, so they barely
    # peel (a peeled heel would lift the ankle above the hip); the body drifts back with them on the ground instead.
    "pikachu": dict(
        legs=(0.0, 0.06), frames=20, duty=0.19, stride=0.2, reach=0.02, roll=0.1, peel=0.35, lift=0.035,
        crouch=0.0, bob=0.022, surge=0.07, lean=0.22, roll_body=0.0, sway=0.0, twist=0.05, chest=1.0, arms=1.0,
        # Tripo skinned the upper tail blade to the head, which sits well forward of it.
        rehome=("Head", "Pelvis", lambda co: co.x < -0.15),
    ),
    "raichu": dict(
        legs=(0.0, 0.06), frames=20, duty=0.22, stride=0.22, reach=-0.035, roll=0.6, peel=0.35, lift=0.03,
        crouch=0.008, bob=0.015, surge=0.06, lean=0.3, roll_body=0.0, sway=0.0, twist=0.05, chest=1.0, arms=0.3,
    ),
    # A springy jog: knees bent, a bounce in every step, a brief flight between them.
    "charmander": dict(
        legs=(0.0, 0.5), frames=20, duty=0.3, stride=0.32, reach=-0.06, roll=0.8, peel=0.4, lift=0.05,
        crouch=0.03, bob=0.012, surge=0.015, lean=0.16, roll_body=0.05, sway=0.0, twist=0.12, chest=1.0, arms=0.5,
    ),
    # A waddling jog: body rocks over each planted foot; the shell stays rigid (a turning chest splits the plastron).
    "squirtle": dict(
        legs=(0.0, 0.5), frames=20, duty=0.3, stride=0.32, reach=-0.02, roll=0.8, peel=0.4, lift=0.045,
        crouch=0.03, bob=0.01, surge=0.015, lean=0.12, roll_body=0.1, sway=0.015, twist=0.1, chest=0.0, arms=0.5,
    ),
    "wartortle": dict(
        legs=(0.0, 0.5), frames=20, duty=0.3, stride=0.26, reach=-0.015, roll=0.8, peel=0.4, lift=0.045,
        crouch=0.025, bob=0.01, surge=0.025, lean=0.12, roll_body=0.08, sway=0.012, twist=0.1, chest=0.0, arms=0.5,
    ),
}

SIDES = ("L", "R")
ARM = ("Clavicle", "Upperarm", "Forearm", "Hand", "Thumb", "Index", "Mid", "Ring", "Pinky")


def source_for(name):
    matches = sorted((CHARACTERS / name / "animations").glob("**/model.glb"))
    if len(matches) != 1:
        raise RuntimeError(f"{name}: expected one Tripo animation model.glb, found {len(matches)}")
    return matches[0]


def smooth(u):
    u = min(1.0, max(0.0, u))
    return u * u * (3 - 2 * u)


def pitch(angle):
    """Rotation about +Y (lateral): positive tips +X down, so it leans the body forward and peels a heel up."""
    return Matrix.Rotation(angle, 3, "Y")


def channels(action):
    """{bone: {path: {index: fcurve}}} of a layered action."""
    out = {}
    for bag in (bag for layer in action.layers for strip in layer.strips for bag in strip.channelbags):
        for curve in bag.fcurves:
            bone = curve.data_path.split('"')[1]
            out.setdefault(bone, {}).setdefault(curve.data_path.rsplit(".", 1)[1], {})[curve.array_index] = curve
    return out


class TripoArms:
    """The arm bones' local rotations from Tripo's run, sampled by gait phase and pulled toward their mean."""

    def __init__(self, rig, action, keep):
        curves = channels(action)
        self.keep = keep
        self.start, end = action.frame_range
        # Tripo's in-place run loop holds two gait cycles.
        self.cycle = (end - self.start) / 2
        self.bones = {name: c["rotation_quaternion"] for name, c in curves.items()
                      if any(part in name for part in ARM) and "rotation_quaternion" in c}
        self.mean = {}
        for name in self.bones:
            samples = [self.sample(name, self.start + self.cycle * 2 * k / 48) for k in range(48)]
            mean = Quaternion((0, 0, 0, 0))
            for q in samples:
                mean += q if q.dot(samples[0]) >= 0 else -q
            mean.normalize()
            self.mean[name] = mean
        # Phase 0 here is the left foot's touchdown: where Tripo's left ankle is farthest forward in its first cycle.
        foot = rig.pose.bones["L_Foot"]
        rig.animation_data.action = action
        best = None
        for k in range(48):
            frame = self.start + self.cycle * k / 48
            bpy.context.scene.frame_set(int(frame), subframe=frame % 1)
            if best is None or foot.head.x > best[0]:
                best = (foot.head.x, frame)
        self.touchdown = best[1]
        rig.animation_data.action = None

    def sample(self, name, frame):
        return Quaternion([self.bones[name][i].evaluate(frame) for i in range(4)]).normalized()

    def pose(self, rig, phase, together):
        """`together` swings both arms as one (a hop): the right side reads the clip half a cycle on. Tripo's two
        cycles differ, so each pose averages them: phase 1 then lands on phase 0's pose and the loop has no seam."""
        for name in self.bones:
            shift = 0.5 if together and name.startswith("R_") else 0.0
            frames = [self.start + ((self.touchdown - self.start + (phase + shift + k) * self.cycle) % (2 * self.cycle))
                      for k in (0, 1)]
            a, b = (self.sample(name, frame) for frame in frames)
            swing = a.slerp(b if a.dot(b) >= 0 else -b, 0.5)
            rig.pose.bones[name].rotation_mode = "QUATERNION"
            rig.pose.bones[name].rotation_quaternion = self.mean[name].slerp(swing, self.keep)


def rehome(mesh_obj, source, target, where):
    groups = mesh_obj.vertex_groups
    moved = [v.index for v in mesh_obj.data.vertices if where(v.co) and v.groups
             and groups[max(v.groups, key=lambda g: g.weight).group].name == source]
    if not moved:
        raise RuntimeError(f"{mesh_obj.name}: no {source} vertices in the rehome region")
    for group in groups:
        group.remove(moved)
    groups[target].add(moved, 1.0, "REPLACE")
    return len(moved)


def set_absolute(pose_bone, head, rotation):
    """Pose a bone in armature space: its head at `head`, its rest orientation turned by `rotation`."""
    pose_bone.matrix = Matrix.Translation(head) @ (rotation @ pose_bone.bone.matrix_local.to_3x3()).to_4x4()
    bpy.context.view_layer.update()


class Leg:
    def __init__(self, rig, mesh_obj, side):
        bones = rig.data.bones
        self.thigh, self.calf, self.foot, self.toe = (rig.pose.bones[f"{side}_{part}"]
                                                       for part in ("Thigh", "Calf", "Foot", "ToeBase"))
        self.rest_hip = bones[f"{side}_Thigh"].head_local.copy()
        self.rest_knee = bones[f"{side}_Calf"].head_local.copy()
        self.rest_ankle = bones[f"{side}_Foot"].head_local.copy()
        self.rest_toe = bones[f"{side}_ToeBase"].head_local.copy()
        # The foot peels about its tip, the frontmost sole vertex on the ground: claws ahead of the toe joint are
        # weighted to Foot, so peeling about the joint would push them into the ground.
        groups = mesh_obj.vertex_groups
        sole = [v.co.x for v in mesh_obj.data.vertices if v.co.z < 0.04 and v.groups and groups[
            max(v.groups, key=lambda g: g.weight).group].name in (f"{side}_Foot", f"{side}_ToeBase")]
        self.rest_tip = Vector((max(sole), self.rest_toe.y, 0))
        self.l1 = (self.rest_knee - self.rest_hip).length
        self.l2 = (self.rest_ankle - self.rest_knee).length
        self.stretch = 0.0

    def solve(self, tip, heel):
        """Foot tip at `tip` (armature space), the foot peeled `heel` rad about it."""
        ankle = tip + pitch(heel) @ (self.rest_ankle - self.rest_tip)
        hip = self.thigh.head.copy()
        reach = ankle - hip
        d = reach.length
        self.stretch = max(self.stretch, d / (self.l1 + self.l2))
        if d > (self.l1 + self.l2) * 0.995:
            raise RuntimeError(f"{self.thigh.name} can't reach its ankle ({d:.3f} > {self.l1 + self.l2:.3f})")
        axis = reach.normalized()
        # The knee sits on the front of the hip-ankle line: the line turned a quarter forward in the side view, so
        # it drops below a leg trailing far back at toe-off instead of flipping up.
        bend = Vector((-axis.z, 0, axis.x))
        bend = (bend - axis * axis.dot(bend)).normalized()
        along = (d * d + self.l1 * self.l1 - self.l2 * self.l2) / (2 * d)
        knee = hip + axis * along + bend * math.sqrt(max(0.0, self.l1 ** 2 - along ** 2))
        set_absolute(self.thigh, hip, (self.rest_knee - self.rest_hip).rotation_difference(knee - hip).to_matrix())
        set_absolute(self.calf, knee, (self.rest_ankle - self.rest_knee).rotation_difference(ankle - knee).to_matrix())
        set_absolute(self.foot, ankle, pitch(heel))
        set_absolute(self.toe, self.foot.tail.copy(), pitch(heel))


def foot_path(phase, cfg):
    """(forward, up, heel) of a foot tip from its rest spot. Planted: straight back at constant speed, the heel
    peeling up over the stance's last part; lifted: an arc forward, the foot flattening for the landing."""
    duty, stride, reach, roll = cfg["duty"], cfg["stride"], cfg["reach"], cfg["roll"]
    front, back = reach + stride / 2, reach - stride / 2
    if phase < duty:
        u = phase / duty
        return front - stride * u, 0.0, roll * smooth((u - cfg["peel"]) / (1 - cfg["peel"])) ** 1.5
    u = (phase - duty) / (1 - duty)
    return back + stride * smooth(u), cfg["lift"] * math.sin(math.pi * u), roll * (1 - smooth(u / 0.6))


def run_pose(rig, cfg, legs, arms):
    pb = rig.pose.bones
    hop = abs(cfg["legs"][1] - cfg["legs"][0]) < 0.25
    steps = 1 if hop else 2
    mid_stance = (cfg["legs"][0] + cfg["legs"][1]) / 2 + cfg["duty"] / 2 if hop else cfg["duty"] / 2
    hip_rest = pb["Hip"].bone.matrix_local

    def pose(t):
        for bone in pb:
            bone.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        # Low at mid-stance, high in the flight.
        settle = math.cos(2 * math.pi * steps * (t - mid_stance))
        # +1 at the left foot's mid-stance, -1 at the right's.
        side = math.cos(2 * math.pi * (t - cfg["duty"] / 2))
        # The hip on the reaching leg's side swings forward.
        yaw = -cfg["twist"] * math.cos(2 * math.pi * t)
        # Drifts back with the planted feet and catches up in the flight: slower on the ground, faster in the air.
        surge = -cfg["surge"] * math.sin(2 * math.pi * steps * (t - mid_stance))
        rise = Vector((surge, cfg["sway"] * side, -cfg["crouch"] - cfg["bob"] * settle))
        lean = cfg["lean"] + 0.02 * settle
        turn = (Matrix.Rotation(yaw, 3, "Z")
                @ Matrix.Rotation(-cfg["roll_body"] * side, 3, "X") @ pitch(lean))
        pb["Hip"].matrix = Matrix.Translation(hip_rest.translation + rise) @ (turn @ hip_rest.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
        # The spine takes back part of the lean and twist, the head the rest: it stays level and faces ahead.
        counter = Matrix.Rotation(-1.5 * cfg["chest"] * yaw, 3, "Z") @ pitch(-0.4 * cfg["chest"] * lean)
        set_absolute(pb["Spine02"], pb["Spine02"].head.copy(), counter @ pb["Spine02"].matrix.to_3x3()
                     @ pb["Spine02"].bone.matrix_local.to_3x3().inverted())
        set_absolute(pb["Head"], pb["Head"].head.copy(), pitch(-0.04 * settle))
        arms.pose(rig, t, hop)
        for leg, offset in zip(legs, cfg["legs"]):
            fwd, up, heel = foot_path((t - offset) % 1, cfg)
            leg.solve(leg.rest_tip + Vector((fwd, 0, up)), heel)

    return pose


def key_all(rig, frame):
    for pb in rig.pose.bones:
        basis = pb.matrix_basis.copy()
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = basis
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def build(name):
    cfg = FORMS[name]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=str(source_for(name)))
    for obj in [o for o in scene.objects if o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(obj)
    rig = next(o for o in scene.objects if o.type == "ARMATURE")
    mesh_obj = next(o for o in scene.objects if o.type == "MESH")
    if "rehome" in cfg:
        print(f"{name}: rehomed {rehome(mesh_obj, *cfg['rehome'])} vertices to {cfg['rehome'][1]}")
    tripo_run = bpy.data.actions["run"]
    tripo_run.name = "tripo-run"
    tracks = rig.animation_data.nla_tracks
    for track in list(tracks):
        if track.name == "run":
            tracks.remove(track)
        else:
            track.mute = True  # so only the action being sampled or keyed drives the pose
    rig.animation_data.action = None
    arms = TripoArms(rig, tripo_run, cfg["arms"])
    legs = [Leg(rig, mesh_obj, side) for side in SIDES]

    action = bpy.data.actions.new("run")
    action.use_fake_user = True
    rig.animation_data.action = action
    pose = run_pose(rig, cfg, legs, arms)
    frames = cfg["frames"]
    for frame in range(frames + 1):
        pose(frame / frames)
        key_all(rig, frame)
    rig.animation_data.action = None
    for track in tracks:
        track.mute = False
    track = tracks.new()
    track.name = "run"
    track.strips.new("run", 0, action)
    bpy.data.actions.remove(tripo_run)

    out = CHARACTERS / name / "blender" / "model.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out), export_format="GLB", export_animations=True, export_animation_mode="NLA_TRACKS",
        export_draco_mesh_compression_enable=False,
    )
    planted = cfg["stride"] / (cfg["duty"] * frames / FPS)
    print(json.dumps({"name": name, "plantedSpeed": round(planted, 3), "stretch": round(max(l.stretch for l in legs), 3),
                      "output": str(out.relative_to(CHARACTERS.parent))}))


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for form in argv or list(FORMS):
    build(form)
