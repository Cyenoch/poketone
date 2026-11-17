"""Reviewed source repairs; preserve the raw Tripo outputs.

blender -b --factory-startup --python-exit-code 1 -P assets/field-sites/repair-species.py
Weld only coincident open UV seams before enemy decimation. Restore Magikarp's missing
pupils in its existing base-colour UV atlas and reverse its single miswound tail face.
"""
import importlib.util
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ASSETS = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("game_models", ASSETS / "prepare-game-models.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


def pupils(obj):
    mesh = obj.data
    bsdf = mesh.materials[0].node_tree.nodes["Principled BSDF"]
    image = bsdf.inputs["Base Color"].links[0].from_node.image
    w,h = image.size
    rgba = np.array(image.pixels[:], dtype=np.float32).reshape(h,w,4)
    uv = mesh.uv_layers.active.data
    painted = 0
    mesh.calc_loop_triangles()
    for tri in mesh.loop_triangles:
        pos = np.array([obj.matrix_world @ mesh.vertices[v].co for v in tri.vertices])
        if pos[:,0].max() < .24 or pos[:,0].min() > .30 or pos[:,2].max() < .045 or pos[:,2].min() > .105:
            continue
        tex = np.array([uv[i].uv[:] for i in tri.loops])*[w-1,h-1]
        lo = np.maximum(0,np.floor(tex.min(axis=0)).astype(int))
        hi = np.minimum([w-1,h-1],np.ceil(tex.max(axis=0)).astype(int))
        xs,ys = np.meshgrid(np.arange(lo[0],hi[0]+1),np.arange(lo[1],hi[1]+1))
        pts=np.stack([xs.ravel(),ys.ravel()],axis=1)
        matrix=np.stack([tex[1]-tex[0],tex[2]-tex[0]],axis=1)
        if abs(np.linalg.det(matrix)) < 1e-8:
            continue
        weights=(pts-tex[0]) @ np.linalg.inv(matrix).T
        bary=np.column_stack([1-weights.sum(axis=1),weights])
        coords=bary@pos
        mask=(bary.min(axis=1)>=-.001)&(((coords[:,0]-.27)/.017)**2+((coords[:,2]-.075)/.019)**2<1)&(np.abs(coords[:,1])>.09)
        selected=pts[mask]
        rgba[selected[:,1],selected[:,0],:3]=(.009,.012,.018)
        painted+=len(selected)
    assert painted>20, f"No pupil texels found: {painted}"
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    print("PUPILS",painted)


def main():
    for name in ("heracross","munchlax","magikarp"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(ASSETS/f"enemies/{name}/generation/tripo-out/model.glb"))
        bpy.context.view_layer.update()
        obj=next(o for o in bpy.context.scene.objects if o.type=="MESH")
        pipeline.weld_decimation_seams(obj)
        if name=="magikarp":
            bm=bmesh.new()
            bm.from_mesh(obj.data)
            target=Vector((-.2352,-.0219,-.1608))
            face=min(bm.faces,key=lambda f:(obj.matrix_world@f.calc_center_median()-target).length)
            assert (obj.matrix_world@face.calc_center_median()-target).length<.001
            bmesh.ops.reverse_faces(bm,faces=[face])
            bm.to_mesh(obj.data)
            bm.free()
            pupils(obj)
        out=ASSETS/f"enemies/{name}/blender/model.glb"
        out.parent.mkdir(parents=True,exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(out),export_format="GLB")
        print("REPAIRED",name,out)


if __name__=="__main__":
    main()
