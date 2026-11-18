"""Turn the map-pass Tripo sources into one-mesh prop sources (Blender 5.3).

blender -b --factory-startup --python-exit-code 1 -P assets/props/compose-tripo-props.py -- [source ...]
Then bun run assets:game <names from tripo-props.json>.

Sets (rocks, tombs, shrubs, mushrooms, beach finds; a single prop is a set of one) are one Tripo image-to-model each: the loose parts are grouped
by the gaps along the image row and each group becomes its own prop. Rocks are widened or narrowed to
the solid-prop footprint the sim already uses (PROP_HEIGHT.rock 1.5, FOOTPRINT.rock 0.72), so collision
never changes. Landmarks are turned to face the camera (+Tripo X -> glTF +Z), set at the rear of a low
plinth whose UVs sample the monument's own base colour, and keep one mesh and one material.
"""
import bmesh
import bpy
import hashlib
import json
import math
import sys
from mathutils import Matrix, Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SITES = ROOT.parent / "field-sites"
# Collision radius per unit scale / (render height × 0.85): the visible base the sim's circle sits inside.
ROCK_BASE = 0.72 / (1.5 * 0.85)
TREE_BASE = 0.3 / (3.1 * 0.85)
BUSH_BASE = 0.5 / (1.2 * 0.85)

# source: (kind, outputs, options). Outputs follow the image's left-to-right order.
# Tripo paints sandstone as flat saturated orange: regrade it by brightness onto crevice → stone → sunlit top.
SANDSTONE = (0x4d3d2e, 0xa58b6b, 0xe4d3b0)

# Tripo's forest rock lichen is near-neon yellow: repaint those texels as deep moss, shade kept.
MOSS = (0x2f4a1f, 0x6f8a3c)
# Tripo leaves come out lime: the forest pines' darker, cooler greens.
LEAF = (0x264a2c, 0x7d9c55)
SPRING_WATER = (0x1f7f8c, 0x8fe6e0)

SOURCES = {
    # The middle rock came out a smooth loaf: the layered one stands in for it, turned and reshaped.
    "desert-rocks": ("set", ["desert-rock-1", None, "desert-rock-3"], {"fit": ROCK_BASE, "weather": SANDSTONE, "also": {"desert-rock-2": ("desert-rock-1", (1.05, 0.9, 1.1), 2.4)}}),
    "forest-rocks": ("set", ["forest-rock-1", "forest-rock-2", "forest-rock-3"], {"fit": ROCK_BASE, "repaint": {"lichen": MOSS}}),
    "coast-rocks": ("set", ["coast-rock-1", "coast-rock-2", "coast-rock-3"], {"fit": ROCK_BASE}),
    "glacier-rocks": ("set", ["glacier-rock-1", "glacier-rock-2", "glacier-rock-3"], {"fit": ROCK_BASE}),
    "volcano-rocks": ("set", ["volcano-rock-1", "volcano-rock-2", "volcano-rock-3"], {"fit": ROCK_BASE}),
    "tower-tombs": ("set", ["tower-tomb-1", "tower-tomb-2", "tower-tomb-3"], {}),
    "shrubs": ("set", ["forest-bush", "coast-shrub-1"], {"fit": {"forest-bush": BUSH_BASE}, "also": {"coast-shrub-2": ("coast-shrub-1", (1.25, 0.85, 0.8), 0.6)}, "repaint": {"leaf": LEAF}}),
    "tree": ("tree", ["tree"], {"repaint": {"leaf": LEAF}}),
    "desert-skull": ("set", ["desert-skull"], {}),
    # Tripo painted the ribs orange: bleached bone like the skull.
    "desert-ribs": ("set", ["desert-ribs"], {"weather": (0x6e5e4a, 0xc8b898, 0xf2ead8)}),
    "tower-rocks": ("set", ["tower-rock-1", "tower-rock-2", "tower-rock-3"], {}),
    "forest-mushrooms": ("set", ["forest-mushroom-1", "forest-mushroom-2", "forest-mushroom-3"], {}),
    "coast-beach": ("set", ["coast-driftwood", "coast-shell", "coast-conch"], {}),
    # Field sites: grounded, centred and facing the camera; published through prepare-field-models.py.
    "spring": ("site", ["spring"], {"repaint": {"water": SPRING_WATER}}),
    # The mossy well, re-stoned per map; the water keeps its turquoise. Stone keeps green at or below red:
    # springWater.ts ripples texels whose blue and green both clear red.
    "spring-sand": ("site", ["spring-sand"], {"source": "spring", "weather": SANDSTONE, "repaint": {"water": SPRING_WATER}}),
    "spring-frost": ("site", ["spring-frost"], {"source": "spring", "weather": (0x565868, 0xa8aaba, 0xf0f1f7), "repaint": {"water": SPRING_WATER}}),
    "spring-basalt": ("site", ["spring-basalt"], {"source": "spring", "weather": (0x1e1a1c, 0x4a4246, 0x8a7c78), "repaint": {"water": SPRING_WATER}}),
    "spring-tower": ("site", ["spring-tower"], {"source": "spring", "weather": (0x2c2838, 0x6a6480, 0xb4aec4), "repaint": {"water": SPRING_WATER}}),
    "raid-den": ("site", ["raid-den"], {}),
    "fishing": ("site", ["fishing"], {}),
    "fossil": ("site", ["fossil"], {}),
    "honey-tree": ("site", ["honey-tree"], {}),
    "palm-honey-tree": ("site", ["palm-honey-tree"], {"repaint": {"leaf": LEAF}}),
    # Tripo fused the egg into its nest: split so the nest stays put while the egg shakes or rides.
    "egg": ("nest", ["egg", "egg-nest"], {}),
    # Game metres: monument height, plinth (radius, height), monument front edge, and the monument heights
    # (fractions) whose front-facing texel paints the plinth top and side, or the source shades nearest to
    # the top and side colours ("tone") when the monument has no calm shade at a usable height.
    "desert-landmark": ("landmark", ["desert-landmark"], {"height": 2.7, "plinth": (1.15, 0.14), "front": 0.35, "tone": (0xc9b89c, 0x7e6957), "weather": SANDSTONE}),
    "coast-landmark": ("landmark", ["coast-landmark"], {"height": 3.3, "plinth": (1.35, 0.14), "front": 0.35, "paint": (0.35, 0.05)}),
    "glacier-landmark": ("landmark", ["glacier-landmark"], {"height": 2.8, "plinth": (1.35, 0.14), "front": 0.35, "paint": (0.2, 0.05)}),
    "tower-landmark": ("landmark", ["tower-landmark"], {"height": 2.1, "plinth": None, "front": -0.9}),
}


def source_glb(name):
    name = SOURCES[name][2].get("source", name)
    base = SITES / name / "generation" if SOURCES[name][0] in ("site", "nest") else ROOT / ("tree/generation-tripo" if name == "tree" else f"{name}/generation")
    found = sorted(base.glob("tripo-out/**/model.glb"))
    if len(found) != 1:
        raise RuntimeError(f"{name}: expected one Tripo model under {base}, found {found}")
    return found[0]


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(meshes) != 1 or len(meshes[0].data.materials) != 1:
        raise RuntimeError(f"{path}: expected one single-material mesh")
    obj = meshes[0]
    # Bake the node transform, then Tripo's +X front to -Y (glTF +Z, toward the run camera).
    obj.data.transform(Matrix.Rotation(-math.pi / 2, 4, "Z") @ obj.matrix_world)
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    for other in [o for o in bpy.context.scene.objects if o is not obj]:
        bpy.data.objects.remove(other, do_unlink=True)
    return obj


def islands(bm):
    """Faces connected through shared vertex positions: Tripo splits its mesh at every UV seam."""
    parent = list(range(len(bm.faces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner = {}
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        for v in f.verts:
            key = tuple(round(c, 4) for c in v.co)
            if key in owner:
                parent[find(f.index)] = find(owner[key])
            else:
                owner[key] = f.index
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def split_row(obj, count):
    """Group loose parts into `count` props: the most overlapping, then the nearest, groups merge until
    `count` remain, ordered along the image row (now Blender +X)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    clusters = []
    for group in islands(bm):
        co = [v.co for f in group for v in f.verts]
        box = [min(c.x for c in co), min(c.y for c in co), max(c.x for c in co), max(c.y for c in co)]
        clusters.append([box, list(group)])

    def gap(p, q):
        return max(p[0] - q[2], q[0] - p[2], p[1] - q[3], q[1] - p[3])

    while True:
        pairs = [(gap(clusters[i][0], clusters[j][0]), i, j)
                 for i in range(len(clusters)) for j in range(i + 1, len(clusters))]
        if not pairs:
            break
        d, i, j = min(pairs)
        # Touching is not belonging (the cracked boulder overlaps), and footprints that overlap stop
        # merging once `count` groups remain (a scattered heap reaches under the broken pillar's base).
        if len(clusters) <= count:
            break
        p, q = clusters[i][0], clusters[j][0]
        clusters[i] = [[min(p[0], q[0]), min(p[1], q[1]), max(p[2], q[2]), max(p[3], q[3])], clusters[i][1] + clusters[j][1]]
        del clusters[j]
    if len(clusters) != count:
        raise RuntimeError(f"{obj.name}: {len(clusters)} separate groups for {count} props")
    clusters.sort(key=lambda c: c[0][0] + c[0][2])
    groups = [c[1] for c in clusters]
    keep_sets = [{f.index for f in g} for g in groups]
    bm.free()
    pieces = []
    for keep in keep_sets:
        piece = obj.copy()
        piece.data = obj.data.copy()
        bpy.context.collection.objects.link(piece)
        pbm = bmesh.new()
        pbm.from_mesh(piece.data)
        pbm.faces.ensure_lookup_table()
        bmesh.ops.delete(pbm, geom=[f for f in pbm.faces if f.index not in keep], context="FACES")
        bmesh.ops.delete(pbm, geom=[v for v in pbm.verts if not v.link_faces], context="VERTS")
        pbm.to_mesh(piece.data)
        pbm.free()
        pieces.append(piece)
    bpy.data.objects.remove(obj, do_unlink=True)
    return pieces


def bounds(obj):
    co = [v.co for v in obj.data.vertices]
    lo = Vector([min(c[i] for c in co) for i in range(3)])
    hi = Vector([max(c[i] for c in co) for i in range(3)])
    return lo, hi


def ground(obj):
    """Base on z = 0, bounding-box centre on the axis (the view centres instances the same way)."""
    lo, hi = bounds(obj)
    obj.data.transform(Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))


def base_spread(obj):
    """85th-percentile horizontal distance of the bottom-quarter vertices, per unit height (props.ts)."""
    lo, hi = bounds(obj)
    height = hi.z - lo.z
    d = sorted(Vector((v.co.x, v.co.y)).length for v in obj.data.vertices if v.co.z < lo.z + height / 4)
    return d[int(0.85 * (len(d) - 1))] / height


def fit_base(obj, target):
    spread = base_spread(obj)
    k = target / spread
    obj.data.transform(Matrix.Diagonal((k, k, 1, 1)))
    return spread, k


def uv_at(obj, pick):
    """UV centroid of the face `pick` scores highest: a flat colour from the source's own texture."""
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    face = max(mesh.polygons, key=pick)
    return Vector(sum((uv[i].uv for i in face.loop_indices), Vector((0, 0))) / len(face.loop_indices))


def texels(obj):
    import numpy as np

    image = next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE")
    return image, np.array(image.pixels[:], dtype=np.float32).reshape(-1, 4)


def pick(obj, mask):
    """The texels `mask` picks in the source's own colours, before any regrade moves them."""
    import numpy as np

    rgb = texels(obj)[1][:, :3]
    hi, lo = rgb.max(1), rgb.min(1)
    return MASKS[mask](rgb, np.where(hi > 0, (hi - lo) / np.maximum(hi, 1e-6), 0))


def weather(obj, ramp, spare=(), keep=0.18):
    """Regrade the base-colour texture by brightness onto `ramp`, keeping a trace of the source hue.
    Texels in the `spare` picks (water a later repaint recolours) stay as they are."""
    import numpy as np

    image, px = texels(obj)
    rgb = px[:, :3]
    stone = ~np.logical_or.reduce([*spare, np.zeros(len(px), bool)])
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    lo, hi = np.percentile(lum[stone], (4, 96))
    t = np.clip((lum - lo) / (hi - lo), 0, 1)[:, None]
    stops = [np.array([((c >> s) & 255) / 255 for s in (16, 8, 0)], dtype=np.float32) for c in ramp]
    grey = np.where(t < 0.5, stops[0] + (stops[1] - stops[0]) * t * 2, stops[1] + (stops[2] - stops[1]) * (t * 2 - 1))
    px[stone, :3] = (grey * (1 - keep) + px[:, :3] * keep)[stone]
    image.pixels[:] = px.ravel()
    image.pack()


# Texel masks for `repaint`, on sRGB colour rows and their brightness.
MASKS = {
    # Tripo's forest rock lichen: red and green both well above blue.
    "lichen": lambda rgb, sat: (sat > 0.35) & (rgb[:, 1] > rgb[:, 2] + 0.15) & (rgb[:, 0] > rgb[:, 2] + 0.1),
    # The spring's water: blue-green, red well below both.
    "water": lambda rgb, sat: (rgb[:, 2] > rgb[:, 0] + 0.08) & (rgb[:, 1] > rgb[:, 0] + 0.08),
    # Foliage: green clearly above red and blue.
    "leaf": lambda rgb, sat: (sat > 0.25) & (rgb[:, 1] > rgb[:, 0] + 0.04) & (rgb[:, 1] > rgb[:, 2] + 0.08),
}


def repaint(obj, picked, ramp):
    """Repaint the `picked` texels along a two-colour ramp by their brightness (the source's shading)."""
    import numpy as np

    image, px = texels(obj)
    rgb = px[:, :3]
    value = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    v0, v1 = np.percentile(value[picked], (5, 95))
    t = np.clip((value - v0) / max(v1 - v0, 1e-3), 0, 1)[:, None]
    stops = [np.array([((c >> s) & 255) / 255 for s in (16, 8, 0)], dtype=np.float32) for c in ramp]
    rgb[picked] = (stops[0] + (stops[1] - stops[0]) * t)[picked]
    px[:, :3] = rgb
    image.pixels[:] = px.ravel()
    image.pack()


def uv_near(obj, rgb):
    """UV centroid of the face whose texel is closest to `rgb`: the source's own nearest shade."""
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    image = next(n.image for n in mesh.materials[0].node_tree.nodes if n.type == "TEX_IMAGE")
    w, h = image.size
    pixels = image.pixels[:]
    want = [((rgb >> s) & 255) / 255 for s in (16, 8, 0)]

    def miss(face):
        c = sum((uv[i].uv for i in face.loop_indices), Vector((0, 0))) / len(face.loop_indices)
        at = (min(int(c.y % 1 * h), h - 1) * w + min(int(c.x % 1 * w), w - 1)) * 4
        return sum((pixels[at + k] - want[k]) ** 2 for k in range(3))

    face = min(mesh.polygons, key=miss)
    return Vector(sum((uv[i].uv for i in face.loop_indices), Vector((0, 0))) / len(face.loop_indices))


def add_plinth(obj, radius, height, top_uv, side_uv, sides=14):
    """A chamfered disc in the same mesh and material, every corner on one sampled texel."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    layer = bm.loops.layers.uv.active
    profile = [(radius, 0.0), (radius, height * 0.55), (radius - height * 0.45, height), (0.0, height)]
    rings = []
    for r, z in profile:
        if r == 0:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z))
                          for a in (i * math.tau / sides + math.pi / sides for i in range(sides))])
    faces = [bm.faces.new(list(reversed(rings[0])))]
    for lower, upper in zip(rings, rings[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            if len(upper) == 1:
                faces.append(bm.faces.new((lower[i], lower[j], upper[0])))
            else:
                faces.append(bm.faces.new((lower[i], lower[j], upper[j], upper[i])))
    for f in faces:
        target = top_uv if f.normal.z > 0.5 or f.calc_center_median().z > height * 0.9 else side_uv
        for loop in f.loops:
            loop[layer].uv = target
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    bm.to_mesh(obj.data)
    bm.free()


def split_egg(obj, crease=35):
    """Egg and nest from one fused mesh: grow from the egg's crown across smooth edges; the sharp crease
    where the shell meets the twigs stops it. Edges match by position (Tripo splits at UV seams)."""
    import numpy as np

    faces = obj.data.polygons
    verts = obj.data.vertices
    key = lambda i: tuple(round(c, 4) for c in verts[i].co)
    by_edge = {}
    for f in faces:
        ring = [key(i) for i in f.vertices]
        for e in zip(ring, ring[1:] + ring[:1]):
            by_edge.setdefault(frozenset(e), []).append(f.index)
    limit = math.cos(math.radians(crease))
    is_egg = np.zeros(len(faces), bool)
    start = max(faces, key=lambda f: f.center.z - 4 * Vector((f.center.x, f.center.y)).length).index
    is_egg[start] = True
    todo = [start]
    while todo:
        f = faces[todo.pop()]
        ring = [key(i) for i in f.vertices]
        for e in zip(ring, ring[1:] + ring[:1]):
            for other in by_edge[frozenset(e)]:
                if not is_egg[other] and faces[other].normal.dot(f.normal) > limit:
                    is_egg[other] = True
                    todo.append(other)
    # The spots sit on the shell behind their own creases: take every face inside the shell's profile.
    centre = np.array([tuple(f.center) for f in faces])
    radial = np.hypot(centre[:, 0], centre[:, 1])
    floor = centre[is_egg, 2].min()
    bins = np.linspace(floor, centre[:, 2].max(), 13)
    level = np.clip(np.digitize(centre[:, 2], bins) - 1, 0, 11)
    reach = np.array([radial[is_egg & (level == i)].max(initial=0) for i in range(12)])
    # Above the shell's lowest band: the nest floor under it lies inside the same profile.
    is_egg |= (centre[:, 2] >= bins[1]) & (radial <= reach[level] * 1.04)
    pieces = []
    for keep in (is_egg, ~is_egg):
        piece = obj.copy()
        piece.data = obj.data.copy()
        bpy.context.collection.objects.link(piece)
        bm = bmesh.new()
        bm.from_mesh(piece.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep[f.index]], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        if keep is is_egg:
            # Close the shell where it sat in the twigs, painted with the shell's own cream.
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            filled = bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=0)["faces"]
            bmesh.ops.triangulate(bm, faces=filled)
        bm.to_mesh(piece.data)
        bm.free()
        pieces.append(piece)
    cap = uv_near(pieces[0], 0xeee3cc)
    layer = pieces[0].data.uv_layers.active.data
    for poly in pieces[0].data.polygons:
        if all(layer[i].uv.length == 0 for i in poly.loop_indices):
            for i in poly.loop_indices:
                layer[i].uv = cap
    bpy.data.objects.remove(obj, do_unlink=True)
    print("EGG", {"faces": int(is_egg.sum()), "of": len(is_egg)})
    return pieces


def scale_to(obj, height):
    lo, hi = bounds(obj)
    k = height / (hi.z - lo.z)
    obj.data.transform(Matrix.Scale(k, 4))


def lean_over_trunk(obj, steps=4):
    """Shear the crown so the trunk foot sits on the bounding-box centre (the collider)."""
    lo, hi = bounds(obj)
    height = hi.z - lo.z
    foot = [v.co for v in obj.data.vertices if v.co.z < lo.z + height * 0.08]
    fx = sum(c.x for c in foot) / len(foot)
    fy = sum(c.y for c in foot) / len(foot)
    for v in obj.data.vertices:
        v.co.x -= fx
        v.co.y -= fy
    for _ in range(steps):
        lo, hi = bounds(obj)
        mx, my = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
        for v in obj.data.vertices:
            t = min(max((v.co.z - lo.z) / height, 0.0), 1.0)
            v.co.x -= mx * t
            v.co.y -= my * t


def export(obj, name, source, record, root=ROOT):
    for o in bpy.context.scene.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active = obj
    obj.name = obj.data.name = name
    out = root / name / "blender/model.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True, export_image_format="AUTO")
    lo, hi = bounds(obj)
    task = json.loads((source.parents[3] / "result.json").read_text())
    record.update({
        "generator": "assets/props/compose-tripo-props.py",
        "tripoSource": str(source.relative_to(ROOT.parent)),
        "tripoSourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "tripoTask": task["task_id"],
        "tripoType": task["type"],
        "tripoCredits": task["credits_consumed"],
        "tripoSettings": {"model": "tripo-v3.1", "smart_low_poly": True, "face_limit": json.loads((source.parent / "task.json").read_text()).get("input", {}).get("face_limit")},
        "triangles": sum(len(p.vertices) - 2 for p in obj.data.polygons),
        "dimensions": [round(hi[i] - lo[i], 4) for i in range(3)],
        "units": "model units; the view scales to its theme height",
        "forward": "glTF +Z (Tripo +X turned in this script); facingYaw 0",
        "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
    })
    print("PROP", name, json.dumps(record))
    return record


def compose(name):
    kind, outputs, opt = SOURCES[name]
    source = source_glb(name)
    obj = load(source)
    made = {}
    # Repaint picks are taken first: a regrade can move stone into a mask's colours (cold stone reads as water).
    picks = {mask: pick(obj, mask) for mask in opt.get("repaint", {})}
    if "weather" in opt:
        weather(obj, opt["weather"], spare=list(picks.values()))
    for mask, ramp in opt.get("repaint", {}).items():
        repaint(obj, picks[mask], ramp)
    if kind == "set":
        pieces = split_row(obj, len(outputs))
        for out, piece in zip(outputs, pieces):
            if out is None:
                continue
            ground(piece)
            record = {"set": name}
            fit = opt.get("fit")
            target = fit.get(out) if isinstance(fit, dict) else fit
            if target:
                spread, k = fit_base(piece, target)
                ground(piece)
                record["footprint"] = {"baseSpreadBefore": round(spread, 4), "target": round(target, 4), "xyScale": round(k, 4)}
            made[out] = (piece, record)
        for out, (base, scale, yaw) in opt.get("also", {}).items():
            twin = made[base][0].copy()
            twin.data = made[base][0].data.copy()
            bpy.context.collection.objects.link(twin)
            twin.data.transform(Matrix.Rotation(yaw, 4, "Z") @ Matrix.Diagonal((*scale, 1)))
            ground(twin)
            made[out] = (twin, {"set": name, "variantOf": base, "scale": scale, "yaw": yaw})
    elif kind == "site":
        ground(obj)
        lo, hi = bounds(obj)
        obj.data.transform(Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, 0)))
        made[outputs[0]] = (obj, {})
    elif kind == "nest":
        ground(obj)
        lo, hi = bounds(obj)
        obj.data.transform(Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, 0)))
        egg, nest = split_egg(obj)
        lo, hi = bounds(nest)
        elo, ehi = bounds(egg)
        # The view grounds and scales each file alone; these ratios put the egg back in its nest.
        seat = {"eggHeightPerNest": round((ehi.z - elo.z) / hi.z, 4), "eggLiftPerNest": round(elo.z / hi.z, 4)}
        made[outputs[0]] = (egg, dict(seat))
        made[outputs[1]] = (nest, dict(seat))
    elif kind == "tree":
        lean_over_trunk(obj)
        ground(obj)
        made[outputs[0]] = (obj, {"baseSpread": round(base_spread(obj), 4), "colliderTarget": round(TREE_BASE, 4)})
    else:
        ground(obj)
        scale_to(obj, opt["height"])
        lo, hi = bounds(obj)
        depth = hi.y - lo.y
        obj.data.transform(Matrix.Translation((0, opt["front"] + depth / 2, 0)))
        if opt["plinth"]:
            if "tone" in opt:
                top, side = (uv_near(obj, rgb) for rgb in opt["tone"])
            else:
                top, side = (uv_at(obj, lambda p, z=f * opt["height"]: -p.normal.y - abs(p.center.z - z) * 4 - abs(p.center.x))
                             for f in opt["paint"])
            add_plinth(obj, *opt["plinth"], top, side)
        made[outputs[0]] = (obj, {})
    records = {}
    for out, (piece, record) in made.items():
        if "weather" in opt:
            record["regrade"] = [f"#{c:06x}" for c in opt["weather"]]
        if "repaint" in opt:
            record["repaint"] = {mask: [f"#{c:06x}" for c in ramp] for mask, ramp in opt["repaint"].items()}
        root = SITES if kind in ("site", "nest") else ROOT
        records[out] = export(piece, out, source, record, root)
        (root / out / "provenance.json").write_text(json.dumps(records[out], indent=2) + "\n")
    # Sites register in field-models.provenance.json; only props join the prop manifest.
    return {} if kind in ("site", "nest") else records


def main():
    names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else list(SOURCES)
    manifest_path = ROOT / "tripo-props.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for name in names:
        manifest.update(compose(name))
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=2) + "\n")


main()
