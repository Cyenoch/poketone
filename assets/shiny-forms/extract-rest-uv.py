import sys
from pathlib import Path

import bpy
import numpy as np


def extract(model, destination):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if bpy.ops.import_scene.gltf(filepath=str(model)) != {"FINISHED"}:
        raise RuntimeError(f"{model}: glTF import failed")

    scene = bpy.context.scene
    mesh, = [obj for obj in scene.objects if obj.type == "MESH" and obj.data.materials]
    for armature in scene.objects:
        if armature.type == "ARMATURE":
            armature.data.pose_position = "REST"
    bpy.context.view_layer.update()

    obj = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    geometry = obj.data
    geometry.calc_loop_triangles()
    uv_layer, = geometry.uv_layers
    points = np.array([obj.matrix_world @ vertex.co for vertex in geometry.vertices])
    triangles = np.array([tri.vertices[:] for tri in geometry.loop_triangles])
    uv = np.array([
        [uv_layer.uv[index].vector[:] for index in tri.loops]
        for tri in geometry.loop_triangles
    ])

    material, = mesh.data.materials
    shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    sampler = shader.inputs["Base Color"].links[0].from_node
    if sampler.type != "TEX_IMAGE" or not sampler.image or not sampler.image.packed_file:
        raise ValueError(f"{model}: expected an embedded baseColor image")
    image = np.frombuffer(sampler.image.packed_file.data, dtype=np.uint8)
    np.savez(destination, xyz=points[triangles], uv=uv, image=image)


def main():
    destination, *models = map(Path, sys.argv[sys.argv.index("--") + 1:])
    for model in models:
        print(f"Extracting {model}", flush=True)
        extract(model, destination / f"{model.stem}.npz")


if __name__ == "__main__":
    main()
