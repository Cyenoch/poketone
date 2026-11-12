"""Render GLB candidates from the run camera and a turnaround, for side-by-side judgement.

    blender --background --factory-startup --python render-compare.py -- <out-dir> label=path.glb ...

Each model is normalised to 1 unit tall. Views: game (pitch atan(12.5/11.5), fov 42, slight 3/4,
matching createRunView.ts), front, left, back, right, top. Tripo exports face +X.
Afterwards build the contact sheet:

    python3 -c "from PIL import Image,ImageDraw;import sys;R=sys.argv[2:];C='game front left back right top'.split();S=300;\
m=Image.new('RGB',(S*6+90,S*len(R)+30),'white');d=ImageDraw.Draw(m);[d.text((90+j*S+S//2-20,8),c,fill='black') for j,c in enumerate(C)];\
[(d.text((8,30+i*S+S//2),r,fill='black'),[m.paste(Image.open(f'{sys.argv[1]}/{r}-{c}.png').resize((S,S)),(90+j*S,30+i*S)) for j,c in enumerate(C)]) for i,r in enumerate(R)];\
m.save(f'{sys.argv[1]}/compare.png')" <out-dir> label1 label2 ...
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
out_dir = Path(argv[0])
out_dir.mkdir(parents=True, exist_ok=True)
models = [a.split("=", 1) for a in argv[1:]]

GAME_PITCH = math.atan2(12.5, 11.5)
# camera yaw 90° sits on +X, looking at the face
VIEWS = {
    "game": (GAME_PITCH, math.radians(90 + 25)),
    "front": (0.0, math.radians(90)),
    "left": (0.0, math.radians(180)),
    "back": (0.0, math.radians(270)),
    "right": (0.0, 0.0),
    "top": (math.radians(65), math.radians(90)),
}


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.9, 0.9, 0.9, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.angle_y = math.radians(42)
    cam.data.sensor_fit = "VERTICAL"
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def load(path):
    bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.context.scene.objects:
        if o.animation_data:
            o.animation_data_clear()
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    deps = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        ev = o.evaluated_get(deps)
        pts += [ev.matrix_world @ v.co for v in ev.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    height = hi.z - lo.z
    centre = (lo + hi) / 2
    for r in [o for o in bpy.context.scene.objects if o.parent is None]:
        r.location -= Vector((centre.x, centre.y, lo.z))
        r.scale /= height
    bpy.context.view_layer.update()
    return sum(len(o.data.polygons) for o in meshes)


def aim(cam, pitch, yaw, dist=2.6):
    target = Vector((0, 0, 0.5))
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


for label, path in models:
    cam = setup_scene()
    faces = load(path)
    for view, (pitch, yaw) in VIEWS.items():
        aim(cam, pitch, yaw)
        bpy.context.scene.render.filepath = str(out_dir / f"{label}-{view}.png")
        bpy.ops.render.render(write_still=True)
    print(f"RENDERED {label} faces={faces}")
