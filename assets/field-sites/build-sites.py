"""Scripted static field-site source (the item ball): metres, grounded pivot, one mesh/material.

blender -b --factory-startup --python-exit-code 1 -P assets/field-sites/build-sites.py -- NAME ...
Geometry and colour are authored here; the other sites are Tripo models composed by assets/props/compose-tripo-props.py.
Publish selected sources with assets/prepare-field-models.py.
"""
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent


class Model:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.color = self.bm.loops.layers.color.new("Col")

    def paint(self, face, color):
        rgb = tuple(int(color[i:i + 2], 16) / 255 for i in (0, 2, 4))
        for loop in face.loops:
            loop[self.color] = (*rgb, 1)

    def part(self, kind, center, size, color, sides=8, top=1, detail=1):
        bm = bmesh.new()
        if kind == "ball":
            bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1)
        elif kind == "box":
            bmesh.ops.create_cube(bm, size=2)
        else:
            bmesh.ops.create_cone(bm, cap_ends=True, segments=sides, radius1=1, radius2=top, depth=2)
        verts = {v: self.bm.verts.new(Vector(center) + Vector(tuple(v.co[i] * size[i] for i in range(3)))) for v in bm.verts}
        for f in bm.faces:
            self.paint(self.bm.faces.new([verts[v] for v in f.verts]), color)
        bm.free()
        return list(verts.values())

    def ring(self, radius, width, z, depth, color, sides=16):
        loops = [[self.bm.verts.new((r*math.cos(i*math.tau/sides), r*math.sin(i*math.tau/sides), h))
                  for i in range(sides)] for r, h in [(radius-width,z-depth),(radius,z-depth),(radius,z+depth),(radius-width,z+depth)]]
        for j in range(4):
            for i in range(sides):
                self.paint(self.bm.faces.new((loops[j][i], loops[j][(i+1)%sides], loops[(j+1)%4][(i+1)%sides], loops[(j+1)%4][i])), color)

    def finish(self):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bmesh.ops.triangulate(bm, faces=list(bm.faces))
        floor = min(v.co.z for v in bm.verts)
        for v in bm.verts:
            v.co.z -= floor
        assert all(f.calc_area() > 1e-10 for f in bm.faces), self.name
        assert all(e.is_manifold for e in bm.edges), self.name
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        mat = bpy.data.materials.new(self.name)
        mat.use_nodes = True
        mat.use_backface_culling = True
        tree = mat.node_tree
        attr = tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        tree.links.new(attr.outputs["Color"], tree.nodes["Principled BSDF"].inputs["Base Color"])
        mesh.materials.append(mat)
        out = ROOT / self.name / "blender/model.glb"
        out.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_vertex_color="MATERIAL")
        print(f"SOURCE {self.name}: {len(mesh.polygons)} triangles -> {out}")


def item_ball(m):
    m.part("ball", (0,0,.26), (.26,.26,.26), "eee7d9", detail=4)
    for f in m.bm.faces:
        self_z = f.calc_center_median().z
        m.paint(f, "d84e48" if self_z > .28 else "343d48" if self_z > .24 else "eee7d9")
    m.ring(.262,.014,.26,.018,"343d48", sides=48)
    m.part("ball", (.255,0,.26), (.028,.065,.065), "303945", detail=3)
    m.part("ball", (.279,0,.26), (.018,.043,.043), "f6efdd", detail=2)


BUILDERS = {"item-ball":item_ball}


def main():
    names=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else list(BUILDERS)
    if any(name not in BUILDERS for name in names):
        raise ValueError(f"Unknown site; choose from {list(BUILDERS)}")
    for name in names:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        model=Model(name)
        BUILDERS[name](model)
        model.finish()


if __name__ == "__main__":
    main()
