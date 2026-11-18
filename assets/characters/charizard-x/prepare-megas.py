"""Prepare both Mega biped sources with the existing symmetry/contact solvers.

blender -b --factory-startup --python-exit-code 1 -P assets/characters/charizard-x/prepare-megas.py
Preserves +X forward, Pelvis tail weights, and the two idle/run clips; never decimates skin.
Publish these prepared sources through assets/prepare-field-models.py.
"""
import importlib.util
import json
import sys
from pathlib import Path

import bpy

ASSETS=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("game_models",ASSETS/"prepare-game-models.py")
pipeline=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)


def main():
    names=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else ["charizard-x","charizard-y"]
    assert names and all(name in ("charizard-x","charizard-y") for name in names)
    for name in names:
        root=ASSETS/"characters"/name
        result=json.loads((root/"animations/result.json").read_text())
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(ASSETS.parent/result["model_file"]))
        assert set(a.name for a in bpy.data.actions)=={"idle","run"}, name
        rig=next(o for o in bpy.context.scene.objects if o.type=="ARMATURE")
        widgets={b.custom_shape for b in rig.pose.bones if b.custom_shape}
        for obj in list(bpy.context.scene.objects):
            if obj in widgets or obj.hide_render:
                bpy.data.objects.remove(obj,do_unlink=True)
        pipeline.symmetrise(.25)
        # Snapshot group IDs: Blender's live group entries shift when weights are removed.
        # Pin contact against the same four influences the exporter/runtime will use.
        mesh=next(o for o in bpy.context.scene.objects if o.type=="MESH")
        for v in mesh.data.vertices:
            weights=sorted([(g.group,g.weight) for g in v.groups],key=lambda p:-p[1])[:4]
            total=sum(w for _,w in weights)
            assert total>0, f"{name}: unweighted vertex {v.index}"
            for group in [g.group for g in v.groups]:
                mesh.vertex_groups[group].remove([v.index])
            for group,weight in weights:
                mesh.vertex_groups[group].add([v.index],weight/total,"REPLACE")
        assert all(len(v.groups)<=4 for v in mesh.data.vertices),name
        pipeline.open_arms(.5)
        contact=pipeline.pin_idle_feet()
        out=root/"blender/model.glb"
        out.parent.mkdir(exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(out),export_format="GLB",export_animations=True,export_draco_mesh_compression_enable=False)
        print("PREPARED",name,json.dumps(contact),out)


if __name__=="__main__":
    main()
