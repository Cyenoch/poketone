"""Inspect published Mega idle/run surfaces and render sampled side/elevated poses.

blender -b --factory-startup --python-exit-code 1 -P assets/characters/charizard-x/review-motion.py
Outputs diagnostics under assets/field-sites/review-mega-motion; these are not App captures.
"""
import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/"assets/field-sites/review-mega-motion"
MODELS=Path(os.environ.get("GAME_MODELS_OUT",ROOT/"public/models"))


def positions(mesh):
    ev=mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    surface=ev.to_mesh()
    try:
        return [ev.matrix_world@v.co for v in surface.vertices]
    finally:
        ev.to_mesh_clear()


def main():
    OUT.mkdir(exist_ok=True)
    for name in ("charizard-x","charizard-y"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str((MODELS/f"{name}.glb").resolve()))
        rig=next(o for o in bpy.context.scene.objects if o.type=="ARMATURE")
        widgets={b.custom_shape for b in rig.pose.bones if b.custom_shape}
        for obj in list(bpy.context.scene.objects):
            if obj in widgets or obj.hide_render:
                bpy.data.objects.remove(obj,do_unlink=True)
        mesh=next(o for o in bpy.context.scene.objects if o.type=="MESH")
        assert all(0<len(v.groups)<=4 for v in mesh.data.vertices)
        assert all(abs(sum(g.weight for g in v.groups)-1)<1e-4 for v in mesh.data.vertices)
        ad=rig.animation_data
        ad.use_nla=False
        ad.action=None
        for bone in rig.pose.bones:
            bone.matrix_basis=Matrix.Identity(4)
        bpy.context.view_layer.update()
        rest=positions(mesh)
        low=Vector(tuple(min(p[i] for p in rest) for i in range(3)))
        high=Vector(tuple(max(p[i] for p in rest) for i in range(3)))
        sole=[v.index for v in mesh.data.vertices if rest[v.index].z<low.z+(high.z-low.z)*.03 and any(k in mesh.vertex_groups[max(v.groups,key=lambda g:g.weight).group].name for k in ("Foot","Toe"))]
        assert len(sole)>5,name
        scene=bpy.context.scene
        scene.render.engine="BLENDER_EEVEE"
        scene.render.resolution_x=scene.render.resolution_y=320
        scene.render.resolution_percentage=100
        scene.view_settings.view_transform="Standard"
        scene.world=bpy.data.worlds.new("world")
        scene.world.use_nodes=True
        scene.world.node_tree.nodes["Background"].inputs[0].default_value=(.26,.29,.34,1)
        scene.world.node_tree.nodes["Background"].inputs[1].default_value=.6
        sun=bpy.data.objects.new("sun",bpy.data.lights.new("sun","SUN"))
        sun.data.energy=2
        sun.rotation_euler=(.45,-.6,-.5)
        scene.collection.objects.link(sun)
        camera=bpy.data.objects.new("camera",bpy.data.cameras.new("camera"))
        camera.data.type="ORTHO"
        camera.data.ortho_scale=max(high-low)*1.9
        scene.collection.objects.link(camera)
        scene.camera=camera
        center=(low+high)/2
        report={"soleVertices":len(sole),"clips":{}}
        for clip in ("idle","run"):
            action=bpy.data.actions[clip]
            ad.action=action
            ad.action_slot=action.slots[0]
            start,end=action.frame_range
            floors=[]
            frames=[]
            for i in range(65):
                f=start+(end-start)*i/64
                scene.frame_set(math.floor(f),subframe=f%1)
                points=positions(mesh)
                floors.append(min(points[j].z for j in sole))
                if i in (0,64):frames.append(points)
            report["clips"][clip]={"seconds":(end-start)/(scene.render.fps/scene.render.fps_base),"soleFloorMin":min(floors),"soleFloorMax":max(floors),"surfaceLoopGapMax":max((a-b).length for a,b in zip(*frames))}
            for i,t in enumerate((0,.125,.25,.375,.5,.625,.75,.875,1) if clip=="run" else (0,.25,.5,.75,1)):
                f=start+(end-start)*t
                scene.frame_set(math.floor(f),subframe=f%1)
                for view,delta in [("side",Vector((0,3,0))),("elevated",Vector((2,.8,2.5)))]:
                    camera.location=center+delta
                    camera.rotation_euler=(-delta).to_track_quat("-Z","Y").to_euler()
                    scene.render.filepath=str(OUT/f"{name}-{clip}-{view}-{i}.png")
                    bpy.ops.render.render(write_still=True)
        print("MOTION",name,json.dumps(report))
        (OUT/f"{name}.json").write_text(json.dumps(report,indent=2)+"\n")


if __name__=="__main__":
    main()
