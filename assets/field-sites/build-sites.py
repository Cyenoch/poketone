"""Seven static field-site sources: metres, grounded pivot, one mesh/material.

blender -b --factory-startup --python-exit-code 1 -P assets/field-sites/build-sites.py -- NAME ...
Geometry and colour are authored here; no generation service or runtime randomness.
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

    def branch(self, start, end, radius, color, top=0.7, sides=6):
        a, b = Vector(start), Vector(end)
        verts = self.part("cone", (0, 0, 0), (radius, radius, (b-a).length / 2), color, sides, top)
        rotation = Vector((0, 0, 1)).rotation_difference((b-a).normalized())
        for v in verts:
            v.co = rotation @ v.co + (a+b) / 2

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


def honey_tree(m):
    m.part("cone", (0,0,.8), (.24,.24,.8), "6b4a30", top=.65)
    for a in (0, 2.1, 4.2):
        m.branch((0,0,.08), (.38*math.cos(a),.38*math.sin(a),.03), .11, "6b4a30", .15)
        m.branch((0,0,1), (.65*math.cos(a),.65*math.sin(a),1.75), .12, "795335", .35)
    for x,y,z,r,c in [(0,0,2.15,.8,"a2b861"),(-.58,0,1.8,.62,"7d9c48"),(.52,.15,1.84,.64,"879f4b"),(0,.5,1.86,.64,"90aa52"),(0,-.45,1.78,.61,"95ad50")]:
        m.part("ball", (x,y,z), (r,r,r*.8), c, detail=2)
    # Honey on the exposed front of the trunk, attached droplets rather than floating pickups.
    m.part("ball", (.19,-.02,.94), (.085,.19,.32), "e4a235", detail=2)
    for y,z in [(-.10,.65),(.03,.58),(.13,.75)]:
        m.part("ball", (.20,y,z), (.055,.05,.12), "f3bb49", detail=1)


def item_ball(m):
    m.part("ball", (0,0,.26), (.26,.26,.26), "eee7d9", detail=3)
    for f in m.bm.faces:
        self_z = f.calc_center_median().z
        m.paint(f, "d84e48" if self_z > .28 else "343d48" if self_z > .24 else "eee7d9")
    m.ring(.262,.014,.26,.018,"343d48", sides=32)
    m.part("ball", (.255,0,.26), (.028,.065,.065), "303945", detail=2)
    m.part("ball", (.279,0,.26), (.018,.043,.043), "f6efdd", detail=2)


def fishing(m):
    m.part("cone", (0,0,.55), (.18,.18,.55), "876543", sides=7, top=.86)
    m.part("cone", (0,0,1.103), (.17,.17,.021), "c2a075", sides=7)
    for z in (.77,.84,.91):
        m.ring(.195,.045,z,.018,"c9b48c", sides=10)
    m.branch((0,0,.8), (.15,.1,1.72), .036,"9f8056", .6)
    m.branch((.15,.1,1.72), (.48,.12,1.93), .022,"a98d63", .45)
    m.branch((.48,.12,1.93), (.63,.12,.29), .008,"e5dfbd", 1, sides=4)
    m.part("ball", (.63,.12,.2), (.09,.09,.14), "eee8d4", detail=2)
    m.part("ball", (.63,.12,.28), (.07,.07,.06), "c6594c", detail=1)
    m.part("ball", (.05,.03,.08), (.4,.31,.08), "8c9388", detail=2)


def fossil(m):
    for z,r,h,c in [(.13,.95,.13,"947252"),(.31,.82,.15,"b49570"),(.48,.72,.1,"cbb087")]:
        m.part("cone", (0,0,z), (r,r*.76,h), c, sides=9, top=.88)
    # Raised ammonite ribs stay readable with base colour only.
    previous = None
    for i in range(29):
        angle = i*.31
        radius = .045+i*.013
        point = (radius*math.cos(angle),radius*math.sin(angle),.585)
        if previous is not None:
            m.branch(previous,point,.032,"eee0b8",1)
        previous = point
    for x,y,s in [(-.69,.1,.22),(.64,-.28,.26),(.2,.52,.18)]:
        m.part("ball", (x,y,.15), (s,s*.75,s*.6), "9e805d", detail=1)


def raid_den(m):
    m.part("cone", (0,0,.1), (1.7,1.7,.1), "5d5866", sides=12, top=.95)
    m.part("cone", (0,0,.22), (.95,.95,.02), "272d40", sides=12)
    m.ring(1.1,.13,.23,.035,"b75b83", sides=12)
    for i in range(9):
        a = i*math.tau/9
        x,y = 1.27*math.cos(a),1.27*math.sin(a)
        m.part("ball", (x,y,.32), (.48,.43,.34), "716878" if i%2 else "817383", detail=1)
        if i%2 == 0:
            h = .58+.1*(i%3)
            m.part("cone", (x,y,.4+h*.35), (.21,.21,h*.35), "ad648c", sides=5, top=.8)
            m.part("cone", (x,y,.4+h*.81), (.175,.175,h*.15), "d18fa6", sides=5, top=0)


def spring(m):
    m.part("cone", (0,0,.08), (1.3,1.3,.08), "718877", sides=14)
    m.part("cone", (0,0,.18), (1.02,1.02,.10), "74b9ba", sides=20)
    m.ring(.7,.035,.282,.008,"b6e0d2", sides=20)
    for i in range(10):
        a=i*math.tau/10
        m.part("ball", (1.09*math.cos(a),1.09*math.sin(a),.23), (.32,.3,.22), "9aab9d" if i%2 else "7f9586", detail=1)
    m.part("ball", (0,.72,.48), (.43,.3,.38), "809b8c", detail=2)
    m.branch((0,.56,.57),(0,.32,.25),.08,"b0dfd4",1,sides=6)


def egg(m):
    verts = m.part("ball", (0,0,.34), (.26,.26,.34), "f0e4c3", detail=3)
    for v in verts:
        t=(v.co.z-.34)/.34
        v.co.x *= 1-.19*t
        v.co.y *= 1-.19*t
    spots=[Vector(p) for p in [(.20,0,.42),(-.18,.14,.3),(0,-.23,.24),(-.08,-.14,.59),(.08,.20,.52)]]
    for f in m.bm.faces:
        if any((f.calc_center_median()-p).length < .10 for p in spots):
            m.paint(f,"799c63")


BUILDERS = {"honey-tree":honey_tree,"item-ball":item_ball,"fishing":fishing,"fossil":fossil,"raid-den":raid_den,"spring":spring,"egg":egg}


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
