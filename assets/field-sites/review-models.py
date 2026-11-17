"""Round-trip diagnostics and saved turnaround renders for named field GLBs.

blender -b --factory-startup --python-exit-code 1 -P assets/field-sites/review-models.py -- OUT NAME=FILE ...
The elevated view uses the run's pitch atan2(16-.6,13), but fits the object for diagnosis.
It is not an official App or device acceptance capture.
"""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

SKILLS = Path(__file__).resolve().parents[2] / ".agents/skills"
sys.path.insert(0, str(SKILLS / "scenario-blender-expert/scripts"))
import bx_audit


def review(name, path, out, pose=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(Path(path).resolve()))
    widgets = {bone.custom_shape for rig in bpy.context.scene.objects if rig.type == "ARMATURE" for bone in rig.pose.bones if bone.custom_shape}
    for obj in list(bpy.context.scene.objects):
        if obj in widgets or obj.hide_render:
            bpy.data.objects.remove(obj, do_unlink=True)
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert objects, path
    if pose:
        pose()
    gate = bx_audit.deliverable(objects, profile="game")
    bpy.context.view_layer.update()
    points = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    bounds = list(high-low)
    report = {"path":path,"meshes":len(objects),"materials":len({s.material for o in objects for s in o.material_slots}),
              "triangles":sum(len(p.vertices)-2 for o in objects for p in o.data.polygons),
              "boundsBlender":bounds,"minBlender":list(low),"maxBlender":list(high),
              "clips":[a.name for a in bpy.data.actions],"audit":gate}
    (out/f"{name}.json").write_text(json.dumps(report,indent=2))
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    scene.world = bpy.data.worlds.new("review-world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.26,.29,.34,1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .6
    light = bpy.data.objects.new("key",bpy.data.lights.new("key","SUN"))
    light.data.energy = 2.0
    light.rotation_euler = (.45,-.6,-.5)
    scene.collection.objects.link(light)
    camera = bpy.data.objects.new("camera",bpy.data.cameras.new("camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(bounds)*1.25
    center=(low+high)/2
    views={"front":(1,0,0),"left":(0,1,0),"back":(-1,0,0),"right":(0,-1,0),"elevated":(1,.45,math.hypot(1,.45)*(16-.6)/13)}
    for label, direction in views.items():
        delta=Vector(direction).normalized()*max(bounds)*3
        camera.location=center+delta
        camera.rotation_euler=(-delta).to_track_quat("-Z","Y").to_euler()
        scene.render.filepath=str(out/f"{name}-{label}.png")
        bpy.ops.render.render(write_still=True)
    print("REVIEW",json.dumps({k:v for k,v in report.items() if k!='audit'}),"auditPass",gate["pass"])


def main():
    args=sys.argv[sys.argv.index("--")+1:]
    out=Path(args[0]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    for entry in args[1:]:
        name,path=entry.split("=",1)
        review(name,path,out)


if __name__ == "__main__":
    main()
