"""Render both Mega rest rigs and a simple limb stress pose before buying animation."""
import importlib.util
import json
from pathlib import Path

import bpy

ASSETS=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("review",ASSETS/"field-sites/review-models.py")
review=importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def stress():
    rig=next(o for o in bpy.context.scene.objects if o.type=="ARMATURE")
    assert rig.data.bones["Head"].head_local.z > rig.data.bones["Hip"].head_local.z
    for side,angle in [("L",.45),("R",-.45)]:
        assert rig.data.bones[f"{side}_Thigh"].head_local.z > rig.data.bones[f"{side}_Foot"].head_local.z
        for part,value in [("Thigh",angle),("Calf",.25),("Upperarm",-angle*.6)]:
            bone=rig.pose.bones[f"{side}_{part}"]
            bone.rotation_mode="XYZ"
            bone.rotation_euler.x=value
    bpy.context.view_layer.update()


out=ASSETS/"field-sites/review-mega-rigs"
out.mkdir(exist_ok=True)
for name in ["charizard-x","charizard-y"]:
    source=json.loads((ASSETS/f"characters/{name}/rig/result.json").read_text())["model_file"]
    review.review(name,source,out)
    review.review(name+"-pose",source,out,stress)
