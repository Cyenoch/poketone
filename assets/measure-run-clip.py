"""Ground speed and gait cycles of a shipping GLB's in-place run clip and the lift of its run/idle clips (Blender 5.2),
for `formModels[*].runClipSpeed`, `formModels[*].runCycles` and `formModels[*].lift`.

Run: blender -b --python assets/measure-run-clip.py -- public/models/<form>.glb <height>

Takes each foot's sole (the lowest 3% of the rest pose among vertices whose dominant bone is a Foot/Toe bone, so
tails and shells lying on the ground don't count), follows each bone's sole centroid through the clip, and averages
its backward speed (glTF +X is forward, as every player form faces) over the frames it moves back, with the rest
pose scaled to <height>. Cycles: half the times each sole reverses its fore-aft direction over the loop (Tripo's
1.25 s run clips hold two cycles, not one). Per bone, not per side: a trotting quadruped's front and back feet on one side move in
antiphase, so a per-side centroid would barely move.

Lift: how far each clip must rise for its lowest point over the clip to meet the rest pose's ground, which is where
the view puts the model. Tripo's in-place clips lower the hips without pinning the feet, so their soles sink.
"""
import bpy
import sys
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
glb, height = argv[0], float(argv[1])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene
# The glTF importer adds an Icosphere as the bone display shape.
meshes = [o for o in scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere")]
armature = next(o for o in scene.objects if o.type == "ARMATURE")


def positions():
    graph = bpy.context.evaluated_depsgraph_get()
    out = []
    for obj in meshes:
        evaluated = obj.evaluated_get(graph)
        mesh = evaluated.to_mesh()
        out += [evaluated.matrix_world @ v.co for v in mesh.vertices]
        evaluated.to_mesh_clear()
    return out


foot = {}
base = 0
for obj in meshes:
    groups = {g.index: g.name for g in obj.vertex_groups}
    for v in obj.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        name = groups.get(best.group, "") if best else ""
        if any(k in name for k in ("Foot", "Toe")):
            foot[base + v.index] = name
    base += len(obj.data.vertices)

armature.animation_data_create()
armature.animation_data.action = None
for bone in armature.pose.bones:
    bone.matrix_basis = Matrix.Identity(4)
scene.frame_set(0)
rest = positions()
low = min(v.z for v in rest)
scale = height / (max(v.z for v in rest) - low)
soles = [i for i in foot if rest[i].z < low + 0.03 * (height / scale)]
if not soles:
    raise RuntimeError(f"{glb}: no Foot/Toe-weighted vertices near the ground")
names = sorted({foot[i] for i in soles})
feet = [[i for i in soles if foot[i] == name] for name in names]

clip = next(a for a in bpy.data.actions if "run" in a.name.lower())
armature.animation_data.action = clip
fps = scene.render.fps / scene.render.fps_base
first, last = int(clip.frame_range[0]), int(clip.frame_range[1])
# Tenth-frame steps: the Bulbasaur line plants each foot for only ~5 frames.
STEPS = 10
tracks = [[] for _ in feet]
for step in range(first * STEPS, last * STEPS + 1):
    scene.frame_set(step // STEPS, subframe=(step % STEPS) / STEPS)
    now = positions()
    for track, ids in zip(tracks, feet):
        track.append(sum(now[i].x for i in ids) / len(ids))
speeds = []
cycles = []
for track in tracks:
    step = [(b - a) * fps * STEPS * scale for a, b in zip(track, track[1:])]
    back = sorted(-v for v in step if v < 0)
    speeds.append(back[len(back) // 2])
    # Ignore near-still samples so jitter at the turning points doesn't count as a reversal; the loop wraps.
    moving = [v > 0 for v in step if abs(v) > 0.05]
    cycles.append(sum(a != b for a, b in zip(moving, moving[1:] + moving[:1])) / 2)
each = ", ".join(f"{name} {speed:.3f}" for name, speed in zip(names, speeds))
print(f"{glb}: {each}; mean {sum(speeds) / len(speeds):.3f} units/s at height {height}")
print(f"cycles per loop: {sorted(cycles)[len(cycles) // 2]:g} (per bone {', '.join(f'{c:g}' for c in cycles)})")


def lift(name):
    action = next(a for a in bpy.data.actions if name in a.name.lower())
    armature.animation_data.action = action
    lowest = min(
        min(v.z for v in (scene.frame_set(f), positions())[1])
        for f in range(int(action.frame_range[0]), int(action.frame_range[1]) + 1)
    )
    return (low - lowest) * scale


print(f"lift: run {lift('run'):.3f}, idle {lift('idle'):.3f}")
