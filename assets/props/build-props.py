"""Hand-built low-poly sources for the round tree, the bush and the coconut palm (Blender 5.2).

Run: blender --background --factory-startup --python assets/props/build-props.py
Then: bun run assets:game tree bush palm

The Tripo exports for these two were open, self-intersecting shard shells (kept beside this script as
the archive); leafy round canopies are where smart_low_poly fails. These are closed icosphere clumps
with a few vertex-colour bands, one mesh and one material, so the shipping pipeline treats them like
any other source GLB. Seeded, so reruns are identical.
"""
import bmesh
import bpy
import math
import random
from mathutils import Vector
from pathlib import Path

PROPS = Path(__file__).resolve().parent


def srgb(hex_srgb):
    """Colour as written to the byte colour layer, which Blender stores as sRGB and the glTF
    exporter converts to linear itself; converting here as well would apply the gamma twice."""
    return [int(hex_srgb[i:i + 2], 16) / 255 for i in (0, 2, 4)]


def clump(bm, rng, center, radius, squash, lumpy, detail=2):
    """Closed icosphere, lightly jittered so instanced copies don't read as perfect balls."""
    ball = bmesh.new()
    bmesh.ops.create_icosphere(ball, subdivisions=detail, radius=1.0)
    made = {}
    for v in ball.verts:
        n = v.co.normalized()
        r = radius * (1 + rng.uniform(-lumpy, lumpy))
        made[v] = bm.verts.new((center[0] + n.x * r, center[1] + n.y * r, center[2] + n.z * r * squash))
    for face in ball.faces:
        bm.faces.new([made[v] for v in face.verts])
    ball.free()
    return Clump(list(made.values()), Vector(center), radius, squash, rng.uniform(-1, 1))


class Clump:
    """One leaf mass: its vertices plus what painting needs (centre, size, a per-clump tint roll)."""

    def __init__(self, verts, center, radius, squash, tint):
        self.verts, self.center, self.radius, self.squash, self.tint = verts, center, radius, squash, tint

    def depth(self, co):
        """< 1 inside this clump (ellipsoid distance), 1 on its surface."""
        d = co - self.center
        return Vector((d.x, d.y, d.z / self.squash)).length / self.radius


def trunk(bm, rings):
    """Six-sided tapered column through (height, radius) rings, base capped."""
    sides = 6
    loops = []
    for z, r in rings:
        loops.append([
            bm.verts.new((r * math.cos(a), r * math.sin(a), z))
            for a in (2 * math.pi * i / sides + math.pi / sides for i in range(sides))
        ])
    for lower, upper in zip(loops, loops[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    return [v for loop in loops for v in loop]


def mix(a, b, t):
    return [x + (y - x) * t for x, y in zip(a, b)]


# Leaf ramp (albedo as it renders, before lighting): blue-green shade, olive mid, warm sunlit top.
LEAF_SHADE, LEAF_MID, LEAF_LIT = srgb("2a4a3c"), srgb("6a8f52"), srgb("bccf96")


def leaf_color(co, own, clumps, z0, z1):
    """Each clump lit on top and dark underneath, the whole canopy darker low down, and creases
    darker where one clump tucks into another (baked occlusion between leaf masses)."""
    canopy = min(max((co.z - z0) / (z1 - z0), 0.0), 1.0)
    up = (co - own.center).normalized().z * 0.5 + 0.5
    t = 0.2 + 0.3 * canopy + 0.5 * up
    crease = max((max(0.0, 1.0 - (c.depth(co) - 1.0) / 0.35) for c in clumps if c is not own), default=0.0)
    t *= 1.0 - 0.5 * min(crease, 1.0)
    c = mix(LEAF_SHADE, LEAF_MID, t / 0.55) if t < 0.55 else mix(LEAF_MID, LEAF_LIT, (t - 0.55) / 0.45)
    # Neighbouring clumps differ slightly: some warmer and yellower, some cooler.
    return mix(c, [c[0] * 1.12, c[1] * 1.04, c[2] * 0.85] if own.tint > 0 else [c[0] * 0.9, c[1], c[2] * 1.08], abs(own.tint) * 0.5)


def paint(bm, clumps, z0, z1, bark=(), bark_ramp=None):
    """Vertex colours: bark is a plain low-to-high ramp, leaves go through `leaf_color`."""
    layer = bm.loops.layers.color.new("Col")
    owner = {v: c for c in clumps for v in c.verts}
    bark = set(bark)
    for face in bm.faces:
        for loop in face.loops:
            v = loop.vert
            if v in bark:
                low, high, b0, b1 = bark_ramp
                rgb = mix(low, high, min(max((v.co.z - b0) / (b1 - b0), 0.0), 1.0))
            else:
                rgb = leaf_color(v.co, owner[v], clumps, z0, z1)
            loop[layer] = (*rgb, 1.0)


def finish(bm, name):
    bmesh.ops.triangulate(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    # Smooth so vertices stay shared; the game shades these two flat (createRunView) for faceted leaves.
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True  # closed meshes: single-sided
    tree = mat.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    attr = tree.nodes.new("ShaderNodeVertexColor")
    attr.layer_name = "Col"
    tree.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    mesh.materials.append(mat)
    out = PROPS / name / "blender" / "model.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_vertex_color="MATERIAL")
    print(f"{name}: {len(mesh.polygons)} triangles -> {out.relative_to(PROPS.parent)}")


def ring(bm, rng, count, reach, z, radius, squash, lumpy):
    """Clumps spaced around the canopy's middle, each nudged so the ring isn't regular."""
    start = rng.uniform(0, 2 * math.pi)
    out = []
    for i in range(count):
        a = start + 2 * math.pi * i / count + rng.uniform(-0.25, 0.25)
        r = reach * rng.uniform(0.9, 1.1)
        out.append(clump(bm, rng, (r * math.cos(a), r * math.sin(a), z + rng.uniform(-0.05, 0.05)),
                         radius * rng.uniform(0.88, 1.1), squash, lumpy))
    return out


def build_tree():
    """Chunky trunk under six big rounded leaf lobes (a core, a crown and a ring of four), a
    cauliflower canopy; only the trunk is in the bottom quarter (collision). Top stays at ~1.13 so the
    trunk keeps its in-game width."""
    rng = random.Random(7)
    bm = bmesh.new()
    bark = trunk(bm, [(0.0, 0.125), (0.1, 0.105), (0.55, 0.075), (0.85, 0.055)])
    clumps = [
        clump(bm, rng, (0.0, 0.0, 0.8), 0.27, 0.9, 0.07),
        clump(bm, rng, (0.02, -0.01, 0.958), 0.2, 0.9, 0.07),
        *ring(bm, rng, 4, 0.27, 0.66, 0.21, 0.88, 0.07),
    ]
    leaves = [v for c in clumps for v in c.verts]
    # The game centres props on their bounding box, so centre the canopy over the trunk.
    for axis in (0, 1):
        mid = (min(v.co[axis] for v in leaves) + max(v.co[axis] for v in leaves)) / 2
        for v in leaves:
            v.co[axis] -= mid
        for c in clumps:
            c.center[axis] -= mid
    paint(bm, clumps, 0.45, 1.12, bark, (srgb("3a2416"), srgb("6b4a30"), 0.0, 0.6))
    finish(bm, "tree")


def build_bush():
    """Low mound of overlapping clumps, no stem or flowers (a red dot read as a pickup)."""
    rng = random.Random(11)
    bm = bmesh.new()
    clumps = [
        clump(bm, rng, (0.0, 0.0, 0.38), 0.32, 0.95, 0.08),
        *ring(bm, rng, 4, 0.22, 0.24, 0.2, 0.9, 0.09),
    ]
    paint(bm, clumps, 0.05, 0.72)
    finish(bm, "bush")


def frond(bm, rng, z0, angle, length, lift, droop, width):
    """One drooping leaf: a midrib arcing up and over, leaflets as a zig-zag edge either side, folded
    down from the rib (an inverted V) and given an underside so the single-sided mesh reads from below.
    Returns (top vertices, underside vertices, vertex -> 0..1 along the leaf)."""
    segments = 12
    direction = Vector((math.cos(angle), math.sin(angle), 0.0))
    side = Vector((-direction.y, direction.x, 0.0))
    twist = rng.uniform(-0.25, 0.25)
    rows, along = [], {}
    for i in range(segments + 1):
        t = i / segments
        centre = direction * (length * t) + Vector((0.0, 0.0, z0 + lift * math.sin(math.pi * t * 0.75) - droop * t * t))
        # Leaflets: alternate rows reach out and tuck in, tapering to the tip.
        reach = width * math.sin(math.pi * min(t * 1.15, 1.0)) ** 0.7 * (1.0 if i % 2 else 0.6)
        fall = 0.45 * reach + 0.05 * t
        tilt = side * math.cos(twist) + Vector((0.0, 0.0, math.sin(twist)))
        rows.append([
            centre + tilt * reach - Vector((0.0, 0.0, fall)),
            centre + Vector((0.0, 0.0, 0.012 * (1.0 - t))),
            centre - tilt * reach - Vector((0.0, 0.0, fall)),
        ])
    top, under = [], []
    for layer, offset, out in ((0, 0.0, top), (1, -0.008, under)):
        made = []
        for i, row in enumerate(rows):
            verts = [bm.verts.new(co + Vector((0.0, 0.0, offset))) for co in row]
            for v in verts:
                along[v] = i / segments
            made.append(verts)
            out.extend(verts)
        for lower, upper in zip(made, made[1:]):
            for a, b in ((0, 1), (1, 2)):
                quad = (lower[a], lower[b], upper[b], upper[a])
                bm.faces.new(quad if layer == 0 else tuple(reversed(quad)))
    return top, under, along


def build_palm():
    """Coconut palm: a slender bowed trunk with ring scars on a flared foot, a crown of eight drooping
    fronds and a cluster of coconuts. Only the trunk foot is in the bottom quarter (collision, like the
    round tree); the crown is sheared back over the foot so the game's bounding-box centring keeps the
    trunk on its collider."""
    rng = random.Random(23)
    bm = bmesh.new()
    sides = 6
    ring_count = 11
    top_z = 0.82
    rings = []
    for k in range(ring_count):
        t = k / (ring_count - 1)
        z = top_z * t
        r = 0.04 + 0.055 * (1.0 - t) ** 6 + 0.012 * (1.0 - t)
        bow = 0.09 * math.sin(math.pi * t * 0.9)
        rings.append((z, r, bow))
    loops, ring_of = [], {}
    for k, (z, r, bow) in enumerate(rings):
        loop = [bm.verts.new((bow + r * math.cos(a), r * math.sin(a), z))
                for a in (2 * math.pi * i / sides + math.pi / sides for i in range(sides))]
        for v in loop:
            ring_of[v] = k
        loops.append(loop)
    for lower, upper in zip(loops, loops[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((lower[i], lower[j], upper[j], upper[i]))
    bm.faces.new(list(reversed(loops[0])))
    bm.faces.new(loops[-1])
    bark = [v for loop in loops for v in loop]
    crown_x = rings[-1][2]

    fronds = []
    count = 8
    start = rng.uniform(0, 2 * math.pi)
    for i in range(count):
        angle = start + 2 * math.pi * i / count + rng.uniform(-0.2, 0.2)
        upper = i % 2 == 0
        top, under, along = frond(
            bm, rng, top_z + (0.02 if upper else -0.01), angle,
            length=rng.uniform(0.42, 0.5), lift=0.1 if upper else 0.05,
            droop=rng.uniform(0.26, 0.34), width=0.085,
        )
        for v in top + under:
            v.co.x += crown_x
        fronds.append((top, under, along))
    nuts = []
    for i in range(3):
        a = start + 2 * math.pi * i / 3 + 0.5
        c = clump(bm, rng, (crown_x + 0.045 * math.cos(a), 0.045 * math.sin(a), top_z - 0.035), 0.032, 1.0, 0.04, detail=1)
        nuts.extend(c.verts)
    bud = clump(bm, rng, (crown_x, 0.0, top_z + 0.005), 0.045, 0.8, 0.05, detail=1)

    everything = list(bm.verts)
    for _ in range(4):
        mid = [(min(v.co[a] for v in everything) + max(v.co[a] for v in everything)) / 2 for a in (0, 1)]
        for v in everything:
            lean = min(max(v.co.z / top_z, 0.0), 1.0)
            v.co.x -= mid[0] * lean
            v.co.y -= mid[1] * lean

    layer = bm.loops.layers.color.new("Col")
    leaf_base, leaf_mid, leaf_tip = srgb("2c5a30"), srgb("4f8f3c"), srgb("a9c862")
    under_shade = srgb("24452a")
    bark_low, bark_high = srgb("5b4834"), srgb("9a8462")
    nut_color, bud_color = srgb("5e4a26"), srgb("6f7d3a")
    owner = {}
    for top, under, along in fronds:
        for v in top:
            owner[v] = ("top", along[v])
        for v in under:
            owner[v] = ("under", along[v])
    nut_set, bud_set, bark_set = set(nuts), set(bud.verts), set(bark)
    for face in bm.faces:
        for loop in face.loops:
            v = loop.vert
            if v in bark_set:
                k = ring_of[v]
                rgb = mix(bark_low, bark_high, k / (ring_count - 1))
                # Ring scars: every other ring darker.
                rgb = [c * (0.78 if k % 2 else 1.0) for c in rgb]
            elif v in nut_set:
                rgb = nut_color
            elif v in bud_set:
                rgb = bud_color
            else:
                kind, t = owner[v]
                rgb = mix(leaf_base, leaf_mid, t / 0.5) if t < 0.5 else mix(leaf_mid, leaf_tip, (t - 0.5) / 0.5)
                if kind == "under":
                    rgb = mix(under_shade, rgb, 0.35)
            loop[layer] = (*rgb, 1.0)
    finish(bm, "palm")


bpy.ops.wm.read_factory_settings(use_empty=True)
build_tree()
bpy.ops.wm.read_factory_settings(use_empty=True)
build_bush()
bpy.ops.wm.read_factory_settings(use_empty=True)
build_palm()
