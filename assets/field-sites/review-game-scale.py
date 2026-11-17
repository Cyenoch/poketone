"""Blender size/readability diagnostic at the current run camera, not an App capture.

blender -b --factory-startup --python-exit-code 1 -P assets/field-sites/review-game-scale.py -- OUT NAME=FILE ...
One 1.6-unit character per image at 1280x800, FOV 42, camera (0,16,13), look-at height .6.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    args=sys.argv[sys.argv.index("--")+1:]
    out=Path(args[0]).resolve()
    out.mkdir(parents=True,exist_ok=True)
    for entry in args[1:]:
        name,path=entry.split("=",1)
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(Path(path).resolve()))
        bpy.context.view_layer.update()
        meshes=[o for o in bpy.context.scene.objects if o.type=="MESH" and not o.hide_render and not o.name.startswith("Icosphere")]
        points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
        low=Vector(tuple(min(p[i] for p in points) for i in range(3)))
        high=Vector(tuple(max(p[i] for p in points) for i in range(3)))
        scale=1.6/(high.z-low.z)
        offset=Vector(((low.x+high.x)/2,(low.y+high.y)/2,low.z))
        for root in [o for o in bpy.context.scene.objects if o.parent is None]:
            root.location=(root.location-offset)*scale
            root.scale*=scale
        scene=bpy.context.scene
        scene.render.engine="BLENDER_EEVEE"
        scene.render.resolution_x=1280
        scene.render.resolution_y=800
        scene.render.resolution_percentage=100
        scene.view_settings.view_transform="Standard"
        scene.world=bpy.data.worlds.new("world")
        scene.world.use_nodes=True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.18,.23,.20,1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value=.7
        sun=bpy.data.objects.new("sun",bpy.data.lights.new("sun","SUN"))
        sun.data.energy=2
        sun.rotation_euler=(.45,-.6,-.5)
        scene.collection.objects.link(sun)
        camera=bpy.data.objects.new("camera",bpy.data.cameras.new("camera"))
        camera.data.sensor_fit="VERTICAL"
        camera.data.angle_y=math.radians(42)
        camera.location=(13,0,16)
        camera.rotation_euler=(Vector((0,0,.6))-camera.location).to_track_quat("-Z","Y").to_euler()
        scene.collection.objects.link(camera)
        scene.camera=camera
        scene.render.filepath=str(out/f"{name}-scale.png")
        bpy.ops.render.render(write_still=True)


if __name__=="__main__":
    main()
