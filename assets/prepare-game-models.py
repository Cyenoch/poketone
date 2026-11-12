"""Build shipping GLBs for the forest run from preserved Tripo exports (Blender 5.2).

Run: blender --background --factory-startup --python assets/prepare-game-models.py -- [name ...]

Keeps base colour only (drops Tripo's normal/ORM maps: the game uses flat cartoon lighting),
downsizes textures, decimates swarm enemies, and writes self-contained uncompressed GLBs that
src/game/models/loadGlb.ts accepts. Raw exports stay untouched beside each asset.
"""
import bmesh
import bpy
import json
import math
import os
import runpy
import numpy as np
import sys
from mathutils import Matrix, Quaternion, Vector, kdtree
from pathlib import Path

ASSETS = Path(__file__).resolve().parent
# A staged regeneration: GAME_MODELS_SOURCE replaces assets/ as the sources' root and GAME_MODELS_OUT public/models;
# the build log is only written for the shipped models.
STAGED = "GAME_MODELS_OUT" in os.environ
SOURCES = Path(os.environ.get("GAME_MODELS_SOURCE", ASSETS))
PUBLIC = Path(os.environ.get("GAME_MODELS_OUT", ASSETS.parent / "public/models"))
pin_idle_feet = runpy.run_path(str(ASSETS / "characters/idle-bipeds.py"))["pin_idle_feet"]

# name: (source glob relative to assets/, output relative to public/models, target triangles or None, texture px)
MODELS = {
    # The Bulbasaur line's Tripo quadruped rigs misread the bodies; characters/rig-quadrupeds.py rigs and animates
    # their unrigged meshes in Blender instead.
    "bulbasaur": ("characters/bulbasaur/blender/model.glb", "bulbasaur.glb", None, 1024),
    # The short-legged bipeds keep Tripo's rig and idle; characters/run-bipeds.py keys a longer-striding run.
    "charmander": ("characters/charmander/blender/model.glb", "charmander.glb", None, 1024),
    "squirtle": ("characters/squirtle/blender/model.glb", "squirtle.glb", None, 1024),
    "pikachu": ("characters/pikachu/blender/model.glb", "pikachu.glb", None, 1024),
    "ivysaur": ("characters/ivysaur/blender/model.glb", "ivysaur.glb", None, 1024),
    "venusaur": ("characters/venusaur/blender/model.glb", "venusaur.glb", None, 1024),
    "charmeleon": ("characters/charmeleon/animations/**/model.glb", "charmeleon.glb", None, 1024),
    "charizard": ("characters/charizard/animations/**/model.glb", "charizard.glb", None, 1024),
    "wartortle": ("characters/wartortle/blender/model.glb", "wartortle.glb", None, 1024),
    "blastoise": ("characters/blastoise/animations/**/model.glb", "blastoise.glb", None, 1024),
    "raichu": ("characters/raichu/blender/model.glb", "raichu.glb", None, 1024),
    "caterpie": ("enemies/caterpie/retexture/**/model.glb", "enemies/caterpie.glb", 900, 512),
    "weedle": ("enemies/weedle/generation/model.glb", "enemies/weedle.glb", 900, 512),
    "rattata": ("enemies/rattata/generation/**/model.glb", "enemies/rattata.glb", 900, 512),
    "pidgey": ("enemies/pidgey/generation/**/model.glb", "enemies/pidgey.glb", 900, 512),
    "oddish": ("enemies/oddish/generation/**/model.glb", "enemies/oddish.glb", 900, 512),
    "scyther": ("enemies/scyther/generation/**/model.glb", "enemies/scyther.glb", None, 1024),
    "spearow": ("enemies/spearow/generation/**/model.glb", "enemies/spearow.glb", 900, 512),
    "zubat": ("enemies/zubat/generation/**/model.glb", "enemies/zubat.glb", 900, 512),
    "ekans": ("enemies/ekans/generation/**/model.glb", "enemies/ekans.glb", 900, 512),
    "paras": ("enemies/paras/generation/**/model.glb", "enemies/paras.glb", 900, 512),
    "geodude": ("enemies/geodude/generation/**/model.glb", "enemies/geodude.glb", 900, 512),
    "venonat": ("enemies/venonat/generation/**/model.glb", "enemies/venonat.glb", 900, 512),
    "metapod": ("enemies/metapod/generation/**/model.glb", "enemies/metapod.glb", 900, 512),
    "kakuna": ("enemies/kakuna/generation/**/model.glb", "enemies/kakuna.glb", 900, 512),
    "nidoran-f": ("enemies/nidoran-f/generation/**/model.glb", "enemies/nidoran-f.glb", 900, 512),
    "nidoran-m": ("enemies/nidoran-m/generation/**/model.glb", "enemies/nidoran-m.glb", 900, 512),
    "voltorb": ("enemies/voltorb/generation/**/model.glb", "enemies/voltorb.glb", 900, 512),
    "vulpix": ("enemies/vulpix/generation/**/model.glb", "enemies/vulpix.glb", 900, 512),
    "growlithe": ("enemies/growlithe/generation/**/model.glb", "enemies/growlithe.glb", 900, 512),
    "butterfree": ("enemies/butterfree/generation/**/model.glb", "enemies/butterfree.glb", 900, 512),
    "beedrill": ("enemies/beedrill/generation/**/model.glb", "enemies/beedrill.glb", 900, 512),
    "raticate": ("enemies/raticate/generation/**/model.glb", "enemies/raticate.glb", 900, 512),
    "pidgeotto": ("enemies/pidgeotto/generation/**/model.glb", "enemies/pidgeotto.glb", 900, 512),
    "gloom": ("enemies/gloom/generation/**/model.glb", "enemies/gloom.glb", 900, 512),
    "arbok": ("enemies/arbok/generation/**/model.glb", "enemies/arbok.glb", 900, 512),
    "parasect": ("enemies/parasect/generation/**/model.glb", "enemies/parasect.glb", 900, 512),
    "venomoth": ("enemies/venomoth/generation/**/model.glb", "enemies/venomoth.glb", 900, 512),
    "fearow": ("enemies/fearow/generation/**/model.glb", "enemies/fearow.glb", 900, 512),
    "vileplume": ("enemies/vileplume/generation/**/model.glb", "enemies/vileplume.glb", 900, 512),
    "graveler": ("enemies/graveler/generation/**/model.glb", "enemies/graveler.glb", 900, 512),
    "electrode": ("enemies/electrode/generation/**/model.glb", "enemies/electrode.glb", 900, 512),
    "golem": ("enemies/golem/generation/**/model.glb", "enemies/golem.glb", 900, 512),
    # Zone content P1, models 1–10: multiview Tripo meshes.
    "nidorina": ("enemies/nidorina/generation/**/model.glb", "enemies/nidorina.glb", 900, 512),
    "poliwag": ("enemies/poliwag/generation/**/model.glb", "enemies/poliwag.glb", 900, 512),
    "diglett": ("enemies/diglett/generation/**/model.glb", "enemies/diglett.glb", 900, 512),
    "mankey": ("enemies/mankey/generation/**/model.glb", "enemies/mankey.glb", 900, 512),
    "sandshrew": ("enemies/sandshrew/generation/**/model.glb", "enemies/sandshrew.glb", 900, 512),
    "psyduck": ("enemies/psyduck/generation/**/model.glb", "enemies/psyduck.glb", 900, 512),
    "nidorino": ("enemies/nidorino/generation/**/model.glb", "enemies/nidorino.glb", 900, 512),
    "magnemite": ("enemies/magnemite/generation/**/model.glb", "enemies/magnemite.glb", 900, 512),
    "poliwhirl": ("enemies/poliwhirl/generation/**/model.glb", "enemies/poliwhirl.glb", 900, 512),
    "exeggcute": ("enemies/exeggcute/generation/**/model.glb", "enemies/exeggcute.glb", 900, 512),
    # Zone content P1, models 11–20; Pinsir and Nidoking guard forest zones 2 and 3, undecimated like Scyther.
    # Tangela's vines and Weezing's craters tear their UV seams into white flecks at 900 triangles.
    "primeape": ("enemies/primeape/generation/**/model.glb", "enemies/primeape.glb", 900, 512),
    "pinsir": ("enemies/pinsir/generation/**/model.glb", "enemies/pinsir.glb", None, 1024),
    "gastly": ("enemies/gastly/generation/**/model.glb", "enemies/gastly.glb", 900, 512),
    "koffing": ("enemies/koffing/generation/**/model.glb", "enemies/koffing.glb", 900, 512),
    "clefairy": ("enemies/clefairy/generation/**/model.glb", "enemies/clefairy.glb", 900, 512),
    "tangela": ("enemies/tangela/generation/**/model.glb", "enemies/tangela.glb", 1300, 512),
    "haunter": ("enemies/haunter/generation/**/model.glb", "enemies/haunter.glb", 900, 512),
    "weezing": ("enemies/weezing/generation/**/model.glb", "enemies/weezing.glb", 1300, 512),
    "exeggutor": ("enemies/exeggutor/generation/**/model.glb", "enemies/exeggutor.glb", 900, 512),
    "nidoking": ("enemies/nidoking/generation/**/model.glb", "enemies/nidoking.glb", None, 1024),
    # Zone content P2, models 21–29; Sandslash guards desert zone 1, undecimated like Scyther.
    # Cubone, Machop and Rhyhorn tear UV seams into white flecks at 900; any decimation cuts Tauros's thin tail
    # stalks and leaves the tufts floating, so it ships undecimated (charge beats only, a few on screen).
    "doduo": ("enemies/doduo/generation/**/model.glb", "enemies/doduo.glb", 900, 512),
    "meowth": ("enemies/meowth/generation/**/model.glb", "enemies/meowth.glb", 900, 512),
    "ponyta": ("enemies/ponyta/generation/**/model.glb", "enemies/ponyta.glb", 900, 512),
    "cubone": ("enemies/cubone/generation/**/model.glb", "enemies/cubone.glb", 1300, 512),
    "tauros": ("enemies/tauros/generation/**/model.glb", "enemies/tauros.glb", None, 512),
    "sandslash": ("enemies/sandslash/generation/**/model.glb", "enemies/sandslash.glb", None, 1024),
    "machop": ("enemies/machop/generation/**/model.glb", "enemies/machop.glb", 1300, 512),
    "hitmonlee": ("enemies/hitmonlee/generation/**/model.glb", "enemies/hitmonlee.glb", 900, 512),
    "rhyhorn": ("enemies/rhyhorn/generation/**/model.glb", "enemies/rhyhorn.glb", 1300, 512),
    # Zone content P2, models 30–37; Marowak and Aerodactyl guard desert zones 2 and 3, undecimated like Scyther.
    # Marowak's multiview mesh came back with a blank grey texture; it ships Tripo's retexture of the same mesh.
    "dodrio": ("enemies/dodrio/generation/**/model.glb", "enemies/dodrio.glb", 1300, 512),
    "onix": ("enemies/onix/generation/**/model.glb", "enemies/onix.glb", 900, 512),
    "marowak": ("enemies/marowak/generation/retexture/**/model.glb", "enemies/marowak.glb", None, 1024),
    "rapidash": ("enemies/rapidash/generation/**/model.glb", "enemies/rapidash.glb", 1300, 512),
    "kabutops": ("enemies/kabutops/generation/**/model.glb", "enemies/kabutops.glb", 1300, 512),
    "omastar": ("enemies/omastar/generation/**/model.glb", "enemies/omastar.glb", 900, 512),
    "rhydon": ("enemies/rhydon/generation/**/model.glb", "enemies/rhydon.glb", 1300, 512),
    "aerodactyl": ("enemies/aerodactyl/generation/**/model.glb", "enemies/aerodactyl.glb", None, 1024),
    # Zone content P3, models 38–46; Kingler guards coast zone 1, undecimated like Scyther.
    # Krabby's legs, Omanyte's shell, Kabuto's dome and Magneton's magnets tear UV seams into white flecks at 900.
    "krabby": ("enemies/krabby/generation/**/model.glb", "enemies/krabby.glb", 1300, 512),
    "tentacool": ("enemies/tentacool/generation/**/model.glb", "enemies/tentacool.glb", 900, 512),
    "omanyte": ("enemies/omanyte/generation/**/model.glb", "enemies/omanyte.glb", 1300, 512),
    "kabuto": ("enemies/kabuto/generation/**/model.glb", "enemies/kabuto.glb", 1300, 512),
    "golduck": ("enemies/golduck/generation/**/model.glb", "enemies/golduck.glb", 900, 512),
    "kingler": ("enemies/kingler/generation/**/model.glb", "enemies/kingler.glb", None, 1024),
    "seadra": ("enemies/seadra/generation/**/model.glb", "enemies/seadra.glb", 900, 512),
    "chansey": ("enemies/chansey/generation/**/model.glb", "enemies/chansey.glb", 900, 512),
    "magneton": ("enemies/magneton/generation/**/model.glb", "enemies/magneton.glb", 1300, 512),
    # Zone content P3, models 47–55; Gyarados and Starmie guard coast zones 2 and 3, undecimated like Scyther.
    # Lickitung, Poliwrath and Electabuzz tear their UV seams into white flecks at 900 triangles.
    "lickitung": ("enemies/lickitung/generation/**/model.glb", "enemies/lickitung.glb", 1300, 512),
    "seaking": ("enemies/seaking/generation/**/model.glb", "enemies/seaking.glb", 900, 512),
    "poliwrath": ("enemies/poliwrath/generation/**/model.glb", "enemies/poliwrath.glb", 1300, 512),
    "gyarados": ("enemies/gyarados/generation/**/model.glb", "enemies/gyarados.glb", None, 1024),
    "staryu": ("enemies/staryu/generation/**/model.glb", "enemies/staryu.glb", 900, 512),
    "jolteon": ("enemies/jolteon/generation/**/model.glb", "enemies/jolteon.glb", 900, 512),
    "electabuzz": ("enemies/electabuzz/generation/**/model.glb", "enemies/electabuzz.glb", 1300, 512),
    "dragonair": ("enemies/dragonair/generation/**/model.glb", "enemies/dragonair.glb", 900, 512),
    "starmie": ("enemies/starmie/generation/**/model.glb", "enemies/starmie.glb", None, 1024),
    # Zone content P4 (Lavender Tower), models 56–65; Muk, Mr. Mime, Golbat, Alakazam and Gengar guard tower floors.
    # These folded surfaces and thin limbs lose texture seams at 900 triangles.
    "grimer": ("enemies/grimer/generation/**/model.glb", "enemies/grimer.glb", 1300, 512),
    "jigglypuff": ("enemies/jigglypuff/generation/**/model.glb", "enemies/jigglypuff.glb", 900, 512),
    # Even 1300 tears Kadabra's fingers, limbs and facial markings; preserve its source mesh minus the extra spoon.
    "kadabra": ("enemies/kadabra/generation/**/model.glb", "enemies/kadabra.glb", None, 512),
    "wigglytuff": ("enemies/wigglytuff/generation/**/model.glb", "enemies/wigglytuff.glb", 900, 512),
    "jynx": ("enemies/jynx/generation/**/model.glb", "enemies/jynx.glb", 1300, 512),
    "muk": ("enemies/muk/generation/**/model.glb", "enemies/muk.glb", None, 1024),
    "mr-mime": ("enemies/mr-mime/generation/**/model.glb", "enemies/mr-mime.glb", None, 1024),
    "golbat": ("enemies/golbat/generation/**/model.glb", "enemies/golbat.glb", None, 1024),
    "alakazam": ("enemies/alakazam/generation/**/model.glb", "enemies/alakazam.glb", None, 1024),
    "gengar": ("enemies/gengar/generation/**/model.glb", "enemies/gengar.glb", None, 1024),
    # Zone content P5 (Sky Glacier), models 66–74; Dewgong, Cloyster and Lapras guard glacier zones 1–3, undecimated like Scyther.
    "seel": ("enemies/seel/generation/**/model.glb", "enemies/seel.glb", 1300, 512),
    "shellder": ("enemies/shellder/generation/**/model.glb", "enemies/shellder.glb", 1300, 512),
    "slowpoke": ("enemies/slowpoke/generation/**/model.glb", "enemies/slowpoke.glb", 1300, 512),
    "vaporeon": ("enemies/vaporeon/generation/**/model.glb", "enemies/vaporeon.glb", 1300, 512),
    "dratini": ("enemies/dratini/generation/**/model.glb", "enemies/dratini.glb", 900, 512),
    "snorlax": ("enemies/snorlax/generation/**/model.glb", "enemies/snorlax.glb", 900, 512),
    "dewgong": ("enemies/dewgong/generation/**/model.glb", "enemies/dewgong.glb", None, 1024),
    "cloyster": ("enemies/cloyster/generation/**/model.glb", "enemies/cloyster.glb", None, 1024),
    "lapras": ("enemies/lapras/generation/**/model.glb", "enemies/lapras.glb", None, 1024),
    # Zone content P6, models 75–81; Magmar, Arcanine and Dragonite guard volcano zones 1–3, undecimated like Scyther.
    # Dugtrio's faces, Ninetales's tails and Flareon's face tear UV seams into white flecks at 900 triangles.
    "dugtrio": ("enemies/dugtrio/generation/**/model.glb", "enemies/dugtrio.glb", 1300, 512),
    "ninetales": ("enemies/ninetales/generation/**/model.glb", "enemies/ninetales.glb", 1300, 512),
    "hitmonchan": ("enemies/hitmonchan/generation/**/model.glb", "enemies/hitmonchan.glb", 900, 512),
    "flareon": ("enemies/flareon/generation/**/model.glb", "enemies/flareon.glb", 1300, 512),
    "magmar": ("enemies/magmar/generation/**/model.glb", "enemies/magmar.glb", None, 1024),
    "arcanine": ("enemies/arcanine/generation/**/model.glb", "enemies/arcanine.glb", None, 1024),
    "dragonite": ("enemies/dragonite/generation/**/model.glb", "enemies/dragonite.glb", None, 1024),
    "tree": ("props/tree/blender/model.glb", "props/tree.glb", 650, 512),
    "pine": ("props/pine/generation/**/model.glb", "props/pine.glb", 600, 512),
    "rock": ("props/rock/generation/**/model.glb", "props/rock.glb", 500, 512),
    "bush": ("props/bush/blender/model.glb", "props/bush.glb", 500, 512),
    "palm": ("props/palm/blender/model.glb", "props/palm.glb", 1000, 512),
    # Stations on the map's building pads (Hypno forgets moves, Bill's machine fuses them).
    "hypno": ("props/hypno/generation/**/model.glb", "props/hypno.glb", 1200, 512),
    "bill-machine": ("props/bill-machine/generation/**/model.glb", "props/bill-machine.glb", 1200, 512),
}


# Reviewed same-budget seam repairs. Others retain their existing topology after candidate comparison.
# New assets must be reviewed before joining this set.
SEAM_REPAIRS = {
    "arbok", "bill-machine", "butterfree", "caterpie", "chansey", "clefairy",
    "cubone", "diglett", "dodrio", "doduo", "dugtrio", "electabuzz",
    "exeggcute", "exeggutor", "gastly", "gloom", "golduck", "golem",
    "graveler", "growlithe", "hitmonchan", "hitmonlee", "jigglypuff", "kabutops",
    "koffing", "krabby", "lickitung", "machop", "mankey", "meowth",
    "nidoking", "nidoran-f", "nidoran-m", "nidorina", "nidorino", "ninetales",
    "omanyte", "omastar", "onix", "paras", "parasect", "pine",
    "poliwag", "poliwhirl", "poliwrath", "ponyta", "primeape", "psyduck",
    "rapidash", "rattata", "rhydon", "rhyhorn", "sandshrew", "seadra",
    "seaking", "seel", "snorlax", "tangela", "tauros", "tentacool",
    "venonat", "vileplume", "weezing",
}


# Scripted S5–S7 families share the same publishing/colour pipeline.
for prop in json.loads((ASSETS / "props/map-props.json").read_text()):
    MODELS[prop] = (f"props/{prop}/blender/model.glb", f"props/{prop}.glb", None, 256)


def source_for(pattern):
    matches = sorted(SOURCES.glob(pattern))
    if len(matches) != 1:
        raise RuntimeError(f"{pattern}: expected exactly one source, found {len(matches)}")
    return matches[0]


def triangles(obj):
    return sum(len(poly.vertices) - 2 for poly in obj.data.polygons)


def weld_decimation_seams(obj):
    """Reconnect split glTF borders before collapsing edges; UVs remain on face corners.

    Only coincident open-border vertices participate, never a skinned mesh or closed nearby parts.
    The source's flat shading and UV discontinuities are exported as split vertices again.
    """
    if any(m.type == "ARMATURE" for m in obj.modifiers):
        raise RuntimeError(f"{obj.name}: refusing to weld a skinned mesh")
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=[v for v in bm.verts if v.is_boundary], dist=1e-6)
    merged = before - len(bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    return merged


def flatten_materials(size):
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        tree = mat.node_tree
        bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        for socket in ("Normal", "Metallic", "Roughness"):
            for link in list(bsdf.inputs[socket].links):
                tree.links.remove(link)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.9
        base = bsdf.inputs["Base Color"]
        for node in list(tree.nodes):
            if node.type == "TEX_IMAGE" and not any(l.to_socket == base for l in node.outputs[0].links):
                tree.nodes.remove(node)
    for image in list(bpy.data.images):
        if image.users == 0:
            bpy.data.images.remove(image)
        elif image.size[0] > size:
            image.scale(size, size)


def open_arms(share):
    """Tripo's biped idle and run lower the arms like a slim human's, which buries the hands in these round
    bellies. Turn every key of the shoulder and upper arm `share` of the way back toward the rest (T-pose), which
    stands the arms off the body; elbows, hands and the swing about the new pose stay Tripo's."""
    for action in bpy.data.actions:
        for bag in (bag for layer in action.layers for strip in layer.strips for bag in strip.channelbags):
            bones = {}
            for curve in bag.fcurves:
                bone = curve.data_path.split('"')[1]
                if curve.data_path.endswith("rotation_quaternion") and bone in OPENED_ARM_BONES:
                    bones.setdefault(bone, [None] * 4)[curve.array_index] = curve
            for curves in bones.values():
                for i in range(len(curves[0].keyframe_points)):
                    pose = Quaternion([c.keyframe_points[i].co[1] for c in curves])
                    for c, value in zip(curves, Quaternion().slerp(pose, 1 - share)):
                        key = c.keyframe_points[i]
                        key.co[1] = key.handle_left[1] = key.handle_right[1] = value


OPENED_ARM_BONES = {f"{side}_{bone}" for side in "LR" for bone in ("Clavicle", "Upperarm")}


MIRROR = Matrix.Diagonal((1, -1, 1))  # Blender's lateral axis is Y (+X forward, +Z up)
LIMBS = ("Upperarm", "Forearm", "Thigh", "Calf")


def partner_name(name):
    for a, b in (("L_", "R_"), ("R_", "L_")):
        if name.startswith(a):
            return b + name[len(a):]
    return name


def best_side(rig, mesh):
    """The side whose limb bones run through the vertices they move: Tripo's biped rigger sometimes places one arm's
    chain well inside the body (multiview Squirtle: 0.1 of its height) while the other fits."""
    names = {g.index: g.name for g in mesh.vertex_groups}
    owned = {}
    for v in mesh.data.vertices:
        if v.groups:
            owned.setdefault(names[max(v.groups, key=lambda g: g.weight).group], []).append(v.co)
    cost = {}
    for side in "LR":
        cost[side] = 0.0
        for limb in LIMBS:
            bone = rig.data.bones[f"{side}_{limb}"]
            pts = owned.get(bone.name)
            if not pts:
                cost[side] += 0.2
                continue
            centre = sum(pts, Vector()) / len(pts)
            along = (centre - bone.head_local).dot(bone.vector) / bone.vector.length_squared
            cost[side] += (bone.head_local + bone.vector * min(1, max(0, along)) - centre).length
    return min(cost, key=cost.get), cost


def close_run_loop(turns, roots):
    """Bridge the Tripo seam over three frames either side with matching endpoint velocity.

    The imported last pose is not the first. A periodic Hermite bridge changes
    only the seam neighbourhood; the two interior strides keep their authored keys.
    Quaternion signs are aligned before interpolation and normalized afterwards.
    """
    n, width = len(turns) - 1, 3
    def bridge(values, quaternion=False):
        a, b = values[n-width].copy(), values[width].copy()
        prev, nxt = values[n-width-1].copy(), values[width+1].copy()
        if quaternion:
            for q in (b, prev, nxt):
                if a.dot(q) < 0: q.negate()
        out = {}
        for step in range(-width+1, width):
            t = (step + width) / (2*width)
            h00, h10 = 2*t**3-3*t*t+1, t**3-2*t*t+t
            h01, h11 = -2*t**3+3*t*t, t**3-t*t
            v = [h00*a[k]+h10*(a[k]-prev[k])*2*width+
                 h01*b[k]+h11*(nxt[k]-b[k])*2*width for k in range(len(a))]
            out[step % n] = Quaternion(v).normalized() if quaternion else Vector(v)
        out[n] = out[0].copy()
        return out
    for name in turns[0]:
        for i, q in bridge([v[name].to_quaternion() for v in turns], True).items():
            turns[i][name] = q.to_matrix()
        for i, v in bridge([v[name] for v in roots]).items():
            roots[i][name] = v


def symmetrise(run_shift, tolerance=0.06):
    """Make a Tripo biped's two sides one: the better-fitting side's rest bones, skin weights and clip keys are
    mirrored onto the other side, and the centre bones lose their sideways lean and twist. The idle mirrors in place;
    the run mirrors `run_shift` of the clip later (half a gait cycle), so its stride still alternates. Vertices
    with no surface within `tolerance` of their mirrored spot (a one-sided tail) keep their weights. Tripo's preset idle rolls the
    spine and lowers one arm, and its rigger fits the two arms differently, so a symmetric mesh still stands lopsided
    from the front without this."""
    scene = bpy.context.scene
    rig = next(o for o in scene.objects if o.type == "ARMATURE")
    mesh = next(o for o in scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere"))
    side, cost = best_side(rig, mesh)
    print(f"symmetrise: mirroring {side} (limb misfit L {cost['L']:.3f}, R {cost['R']:.3f})")
    y0 = next(b for b in rig.data.bones if b.parent is None).head_local.y
    flip = Matrix.Translation((0, y0, 0)) @ MIRROR.to_4x4() @ Matrix.Translation((0, -y0, 0))
    good = lambda name: name.startswith(side + "_")

    # Weights first, by vertex position (the mesh's rest shape is unaffected by bone edits).
    groups = mesh.vertex_groups
    names = {g.index: g.name for g in groups}
    verts = mesh.data.vertices
    tree = kdtree.KDTree(len(verts))
    for v in verts:
        tree.insert(v.co, v.index)
    tree.balance()
    sign = 1 if side == "L" else -1
    copies = []
    for v in verts:
        if (v.co.y - y0) * sign >= -tolerance / 2:
            continue
        # Multiview meshes are symmetric in shape, not vertex for vertex: blend the nearest vertices around the
        # mirrored spot by inverse distance.
        near = [(index, dist) for _, index, dist in tree.find_n(flip @ v.co, 4) if dist <= tolerance]
        if not near:
            continue
        blend = {}
        for index, dist in near:
            for g in verts[index].groups:
                name = partner_name(names[g.group])
                blend[name] = blend.get(name, 0.0) + g.weight / (dist + 1e-4)
        strongest = sorted(blend.items(), key=lambda item: -item[1])[:4]
        total = sum(w for _, w in strongest)
        copies.append((v.index, [(name, w / total) for name, w in strongest]))
    print(f"symmetrise: {len(copies)} of {sum(1 for v in verts if (v.co.y - y0) * sign < -tolerance / 2)} vertices took their mirror's weights")
    for vi, weights in copies:
        for g in list(verts[vi].groups):
            groups[g.group].remove([vi])
        for name, weight in weights:
            (groups.get(name) or groups.new(name=name)).add([vi], weight, "REPLACE")

    # Sample both clips' armature-space turns on the old rest pose, before the bones move.
    rest = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}
    ad = rig.animation_data
    muted = [t.mute for t in ad.nla_tracks]
    for t in ad.nla_tracks:
        t.mute = True
    sampled = {}
    for clip, shift in (("idle", 0.0), ("run", run_shift)):
        action = bpy.data.actions[clip]
        ad.action = action
        start, end = math.floor(action.frame_range[0]), math.ceil(action.frame_range[1])
        turns, roots = [], []
        scene.frame_set(start + 1)  # frame_set on the current frame doesn't re-evaluate a newly assigned action
        for f in range(start, end + 1):
            scene.frame_set(f)
            turns.append({pb.name: pb.matrix.to_3x3() @ rest[pb.name].inverted() for pb in rig.pose.bones})
            roots.append({pb.name: pb.matrix_basis.to_translation() for pb in rig.pose.bones})
        if clip == "run" and run_shift == 0.25:
            close_run_loop(turns, roots)
        sampled[clip] = (action, start, turns, roots, round(shift * (end - start)))
    ad.action = None

    # Rest bones: the good side mirrored onto the other, centre bones onto the mid-plane.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    edit = rig.data.edit_bones
    for bone in edit:
        if good(bone.name):
            other = edit[partner_name(bone.name)]
            other.head, other.tail = flip @ bone.head, flip @ bone.tail
            other.align_roll((flip.to_3x3() @ bone.z_axis))
        elif partner_name(bone.name) == bone.name:
            bone.head.y = bone.tail.y = y0
    bpy.ops.object.mode_set(mode="OBJECT")
    rest = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}

    # Clips: each bone's turn from its partner on the good side, mirrored (shifted for the run); centre bones average
    # their own turn with its mirror.
    for action, start, turns, roots, shift in sampled.values():
        # Tripo keys fall between whole frames (0.8, 1.6, ...): drop them so none survives between the new keys.
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        if curve.data_path.endswith(("location", "rotation_quaternion")):
                            curve.keyframe_points.clear()
        n = len(turns) - 1  # the last frame repeats the first in a loop
        for i in range(len(turns)):
            here, there = turns[i], turns[(i + shift) % n]
            target = {}
            for pb in rig.pose.bones:
                name, mate = pb.name, partner_name(pb.name)
                if mate == name:
                    a, b = here[name].to_quaternion(), (MIRROR @ there[name] @ MIRROR).to_quaternion()
                    if a.dot(b) < 0:
                        b.negate()
                    turn = a.slerp(b, 0.5).to_matrix()
                elif good(name):
                    turn = here[name]
                else:
                    turn = MIRROR @ there[mate] @ MIRROR
                target[name] = turn @ rest[name]
            ad.action = action
            for pb in rig.pose.bones:
                loc = roots[i][pb.name]
                if not pb.parent:  # the root's drift loses its sideways part
                    drift = rest[pb.name] @ loc
                    drift.y = 0
                    loc = rest[pb.name].inverted() @ drift
                if pb.parent:
                    local = rest[pb.parent.name].inverted() @ rest[pb.name]
                    rot = local.inverted() @ target[pb.parent.name].inverted() @ target[pb.name]
                else:
                    rot = rest[pb.name].inverted() @ target[pb.name]
                pb.rotation_mode = "QUATERNION"
                pb.location, pb.rotation_quaternion = loc, rot.to_quaternion()
                pb.keyframe_insert("location", frame=start + i, group=pb.name)
                pb.keyframe_insert("rotation_quaternion", frame=start + i, group=pb.name)
        ad.action = None
    for t, m in zip(ad.nla_tracks, muted):
        t.mute = m


def merged_islands(mesh):
    """Connected pieces of a mesh, joining vertices that share a position (Tripo splits them along UV seams)."""
    key = lambda co: (round(co.x, 4), round(co.y, 4), round(co.z, 4))
    parent = {}

    def find(a):
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    verts = mesh.vertices
    for edge in mesh.edges:
        a, b = (find(key(verts[i].co)) for i in edge.vertices)
        parent[a] = b
    pieces = {}
    for v in verts:
        pieces.setdefault(find(key(v.co)), []).append(v.index)
    return sorted(pieces.values(), key=len, reverse=True)


def drop_islands(behind):
    """Delete loose pieces lying wholly behind x = `behind` (the body's back): Tripo's multiview Raichu builds its
    tail's bolt as a sheet floating behind the head, with no tail joining it."""
    mesh_obj = next(o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere"))
    mesh = mesh_obj.data
    doomed = [i for piece in merged_islands(mesh)[1:] if all(mesh.vertices[i].co.x < behind for i in piece) for i in piece]
    if not doomed:
        raise RuntimeError(f"{mesh_obj.name}: no loose piece behind x = {behind}")
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in doomed], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    print(f"drop_islands: removed {len(doomed)} vertices")


def drop_kadabra_spoon():
    """The recovered sheet gave Kadabra two spoons; keep only the one in its right hand."""
    mesh_obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    mesh = mesh_obj.data
    pieces = [p for p in merged_islands(mesh) if all(mesh.vertices[i].co.x > 0.39 and mesh.vertices[i].co.y > 0.37 for i in p)]
    if len(pieces) != 1:
        raise RuntimeError(f"kadabra: expected one extra spoon, found {len(pieces)}")
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in pieces[0]], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()


def rejoin_muk_hand():
    """The recovered mesh's detached hand sits 0.11 units ahead of its wrist."""
    mesh = next(o.data for o in bpy.context.scene.objects if o.type == "MESH")
    pieces = merged_islands(mesh)
    if len(pieces) != 2:
        raise RuntimeError(f"muk: expected body and detached hand, found {len(pieces)} pieces")
    for i in pieces[1]:
        mesh.vertices[i].co += Vector((-0.13, -0.02, -0.01))


def repair_source_parts(name):
    """Local repairs to inspected Tripo source defects, before any simplification.

    Coordinates are in the preserved sources' Blender space (+X forward, Z up).
    Keep UVs attached to their vertices; never move the whole creature to hide a gap.
    """
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    mesh = obj.data
    parts = merged_islands(mesh)
    expected = {"rapidash": 3, "seaking": 5, "electabuzz": 3, "rattata": 4, "nidoking": 3}
    if len(parts) != expected[name]:
        raise RuntimeError(f"{name}: source parts changed ({len(parts)}); re-inspect the repair")
    if name in ("rattata", "nidoking"):
        # The tiny pieces below Rattata's belly / inside Nidoking's torso are source debris.
        keep = 2 if name == "rattata" else 1
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for p in parts[keep:] for i in p], context="VERTS")
        bm.to_mesh(mesh)
        bm.free()
    elif name == "rapidash":
        # Extend each severed upper foreleg into its shoulder, keeping knees/hooves in place.
        for part in parts[1:]:
            for i in part:
                v = mesh.vertices[i]
                share = max(0, min(1, (v.co.z + 0.34) / 0.0983))
                v.co += Vector((-0.015, 0, 0.115)) * share
    elif name == "seaking":
        # The two small pectoral fins float beside the cheek; retain their angle and pattern.
        for part in parts:
            if min(mesh.vertices[i].co.x for i in part) > 0.28:
                side = 1 if mesh.vertices[part[0]].co.y > 0 else -1
                for i in part:
                    mesh.vertices[i].co += Vector((-0.06, -side * 0.08, 0.14))
    elif name == "electabuzz":
        for part in parts[1:]:
            for i in part:
                mesh.vertices[i].co += Vector((0.026, 0, 0.008))


def repair_tauros_tail():
    """Restore the missing central tail stalk using the existing dark tail atlas texel."""
    obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    # Close the short breaks in the two outer tail strands, without moving the tufts.
    pieces = merged_islands(obj.data)
    if len(pieces) != 6:
        raise RuntimeError(f"tauros: expected six source pieces, found {len(pieces)}")
    for piece in pieces:
        verts = [obj.data.vertices[i] for i in piece]
        if all(v.co.x < -0.28 for v in verts) and max(v.co.z for v in verts) < 0.11:
            centre = sum((v.co for v in verts), Vector()) / len(verts)
            for v in verts:
                for axis in (0, 2):
                    v.co[axis] = centre[axis] + (v.co[axis] - centre[axis]) * 1.14
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv = bm.loops.layers.uv.active
    # From rump through the surviving central stem to the isolated upper tuft.
    path = [(-0.265, 0, 0.08), (-0.30, 0, 0.22), (-0.365, 0, 0.30), (-0.445, 0, 0.345)]
    anchor = min(bm.verts, key=lambda v: (v.co - Vector((-0.275, -0.04, 0.242))).length)
    texel = anchor.link_loops[0][uv].uv.copy()
    rings = []
    for i, p in enumerate(path):
        tangent = Vector(path[min(i+1, len(path)-1)]) - Vector(path[max(i-1, 0)])
        a = tangent.normalized().cross(Vector((0, 1, 0))).normalized() * 0.009
        b = tangent.normalized().cross(a)
        rings.append([bm.verts.new(Vector(p) + a*math.cos(k*math.tau/5) + b*math.sin(k*math.tau/5)) for k in range(5)])
    faces = []
    for left, right in zip(rings, rings[1:]):
        for k in range(5):
            faces.append(bm.faces.new((left[k], left[(k+1)%5], right[(k+1)%5], right[k])))
    faces += [bm.faces.new(list(reversed(rings[0]))), bm.faces.new(rings[-1])]
    for f in faces:
        for loop in f.loops:
            loop[uv].uv = texel
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    bmesh.ops.triangulate(bm, faces=faces)
    bm.to_mesh(obj.data)
    bm.free()


def drop_gloom_speck():
    """Remove the inspected isolated triangle above Gloom's face after simplification."""
    mesh = next(o.data for o in bpy.context.scene.objects if o.type == "MESH")
    pieces = merged_islands(mesh)
    specks = [p for p in pieces if len(p) == 3 and all(0 < mesh.vertices[i].co.x < 0.08
              and 0 < mesh.vertices[i].co.y < 0.05 and 0.17 < mesh.vertices[i].co.z < 0.20 for i in p)]
    if len(specks) != 1:
        raise RuntimeError("gloom: inspected face speck changed; review source")
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in specks[0]], context="VERTS")
    bm.to_mesh(mesh)
    bm.free()


def repair_omanyte_eye():
    """Paint out the generated third eye between the two side eyes, using its own body atlas."""
    mesh = next(o.data for o in bpy.context.scene.objects if o.type == "MESH")
    uv = mesh.uv_layers.active
    body = min(mesh.polygons, key=lambda p: (p.center - Vector((0.40, 0, -0.35))).length)
    colour = uv.data[body.loop_indices[0]].uv.copy()
    for poly in mesh.polygons:
        c = poly.center
        if ((c.x > 0.38 and -0.05 < c.y < 0.10 and -0.30 < c.z < -0.16)
                or (c.x > 0.37 and -0.055 < c.y < 0.085 and -0.18 < c.z < -0.12)):
            for i in poly.loop_indices:
                uv.data[i].uv = colour


def drop_sheets(min_area, above):
    """Delete single faces larger than `min_area` whose centre is above z = `above`: Tripo's multiview Exeggutor
    spans its palm crown with a few huge flat triangles that hide the heads from the run camera; the fronds under
    them are separate, thinner faces and stay."""
    mesh_obj = next(o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere"))
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    doomed = [f for f in bm.faces if f.calc_area() > min_area and f.calc_center_median().z > above]
    if not doomed:
        raise RuntimeError(f"{mesh_obj.name}: no face over {min_area} above z = {above}")
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(mesh_obj.data)
    bm.free()
    print(f"drop_sheets: removed {len(doomed)} faces")


def drop_lobe(*cuts):
    """Delete a stray limb down to where it joins the body and fill the hole with one texel of the limb's own colour.
    Each cut is (tip, point, normal) in Blender axes: every vertex joined to the one nearest `tip` without crossing the
    plane through `point` facing `normal` (out along the limb) is the limb's; a bent limb takes one cut per bend."""
    mesh_obj = next(o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere"))
    bm = bmesh.new()
    bm.from_mesh(mesh_obj.data)
    uv = bm.loops.layers.uv.active
    key = lambda v: (round(v.co.x, 4), round(v.co.y, 4), round(v.co.z, 4))
    twins = {}
    for v in bm.verts:
        twins.setdefault(key(v), []).append(v)
    limb = set()
    for tip, point, normal in cuts:
        tip, point, normal = Vector(tip), Vector(point), Vector(normal)
        start = min(bm.verts, key=lambda v: (v.co - tip).length)
        if (start.co - tip).length > 0.01:
            raise RuntimeError(f"{mesh_obj.name}: no vertex at the limb's tip {tuple(tip)}")
        part, stack = {start}, [start]
        while stack:
            v = stack.pop()
            for w in [e.other_vert(v) for e in v.link_edges] + twins[key(v)]:
                if w not in part and (w.co - point).dot(normal) > 0:
                    part.add(w)
                    stack.append(w)
        limb |= part
    rim = {e.other_vert(v) for v in limb for e in v.link_edges} - limb
    root = sum((v.co for v in rim), Vector()) / len(rim)
    colour = min((l for v in limb for l in v.link_loops), key=lambda l: (l.vert.co - root).length)[uv].uv.copy()
    bmesh.ops.delete(bm, geom=list(limb), context="VERTS")
    # Tripo splits vertices along UV seams, and the hole can run along one: close the seams around it first.
    near = {v for v in bm.verts if any((v.co - r.co).length < 0.03 for r in rim)}
    bmesh.ops.remove_doubles(bm, verts=list(near), dist=1e-5)
    edges = [e for e in bm.edges if e.is_boundary and all(v in near for v in e.verts)]
    ends = [v for v in {v for e in edges for v in e.verts} if sum(e in edges for e in v.link_edges) == 1]
    if len(ends) == 2:  # the hole runs along an edge that a third face still holds (Tripo leaves a few)
        edges += [e for e in ends[0].link_edges if e.other_vert(ends[0]) is ends[1]]
    hole = bmesh.ops.contextual_create(bm, geom=edges)["faces"]
    if len(hole) != 1 or len(hole[0].verts) != len(edges):
        raise RuntimeError(f"{mesh_obj.name}: the hole the limb left is not one closed loop ({len(edges)} edges)")
    cap = bmesh.ops.triangulate(bm, faces=hole, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"]
    for f in cap:
        for loop in f.loops:
            loop[uv].uv = colour
    bm.to_mesh(mesh_obj.data)
    bm.free()
    print(f"drop_lobe: removed {len(limb)} vertices, filled the hole with {len(cap)} triangles")


def empty_texels(image, uv_layer, mesh, cells=64):
    """Centres (uv) of two atlas cells no face's UV bounding box touches, for flat colours painted into them."""
    used = np.zeros((cells, cells), dtype=bool)
    for poly in mesh.polygons:
        uvs = [uv_layer.data[i].uv for i in poly.loop_indices]
        u0, u1 = (int(f(u.x for u in uvs) * cells) for f in (min, max))
        v0, v1 = (int(f(u.y for u in uvs) * cells) for f in (min, max))
        used[max(0, v0 - 1):v1 + 2, max(0, u0 - 1):u1 + 2] = True
    free = np.argwhere(~used)
    if len(free) < 2:
        raise RuntimeError(f"{image.name}: no free atlas cells for the tail's colours")
    return [((u + 0.5) / cells, (v + 0.5) / cells) for v, u in free[:2]]


def paint_cell(image, uv, rgb, cells=64):
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    cw, ch = w // cells, h // cells
    x, y = int(uv[0] * cells) * cw, int(uv[1] * cells) * ch
    px[y:y + ch, x:x + cw, :3] = rgb
    image.pixels.foreach_set(px.ravel())
    image.update()


def catmull_rom(points, steps):
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1:i + 3]
        for k in range(steps):
            t = k / steps
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t))
    out.append(points[-1])
    return out


def add_tail(path, radius, bolt, bolt_thickness, tail_rgb, bolt_rgb):
    """Build a tail in the skinned mesh: a tube along `path` (Blender axes, z above the feet), tapering from `radius`
    to two thirds of it, and a flat bolt standing on its end (`bolt`: outline in (outward, up) units, outward = -Y,
    extruded `bolt_thickness` along X). Its vertices are skinned to Pelvis wholly, for the view's procedural tail
    chain; its colours are painted into two empty atlas cells, because the chain needs one mesh with one material."""
    mesh_obj = next(o for o in bpy.context.scene.objects if o.type == "MESH" and not o.name.startswith("Icosphere"))
    mesh = mesh_obj.data
    ground = min(v.co.z for v in mesh.vertices)
    image = next(i for i in bpy.data.images if i.name.startswith("Color"))
    uv_layer = mesh.uv_layers.active
    tail_uv, bolt_uv = empty_texels(image, uv_layer, mesh)
    paint_cell(image, tail_uv, tail_rgb)
    paint_cell(image, bolt_uv, bolt_rgb)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv.active
    deform = bm.verts.layers.deform.verify()
    pelvis = (mesh_obj.vertex_groups.get("Pelvis") or mesh_obj.vertex_groups.new(name="Pelvis")).index
    added = []

    def vert(co):
        v = bm.verts.new(co)
        v[deform][pelvis] = 1.0
        added.append(v)
        return v

    def face(verts, at):
        f = bm.faces.new(verts)
        for loop in f.loops:
            loop[uv].uv = at
        return f

    spine = [Vector((x, y, ground + z)) for x, y, z in path]
    centre = catmull_rom(spine, 6)
    sides = 8
    rings = []
    for i, c in enumerate(centre):
        ahead = (centre[min(i + 1, len(centre) - 1)] - centre[max(i - 1, 0)]).normalized()
        side = ahead.cross(Vector((0, 0, 1)))
        side = side.normalized() if side.length > 1e-4 else Vector((0, 1, 0))
        up = side.cross(ahead).normalized()
        r = radius * (1 - i / (len(centre) - 1) / 3)
        rings.append([vert(c + (side * math.cos(a) + up * math.sin(a)) * r)
                      for a in (2 * math.pi * k / sides for k in range(sides))])
    for a, b in zip(rings, rings[1:]):
        for k in range(sides):
            face([a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]], tail_uv)
    face(list(reversed(rings[0])), tail_uv)
    face(rings[-1], tail_uv)
    base = centre[-1]
    half = bolt_thickness / 2
    front = [vert(base + Vector((half, -u, v))) for u, v in bolt]
    back = [vert(base + Vector((-half, -u, v))) for u, v in bolt]
    faces = [face(front, bolt_uv), face(list(reversed(back)), bolt_uv)]
    n = len(bolt)
    for k in range(n):
        faces.append(face([front[k], back[k], back[(k + 1) % n], front[(k + 1) % n]], bolt_uv))
    bmesh.ops.triangulate(bm, faces=faces[:2])
    bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if any(v in added for v in f.verts)])
    bm.to_mesh(mesh)
    bm.free()
    print(f"add_tail: {len(added)} vertices")


def recolour(hue_lo, hue_hi, min_saturation, rgb, max_saturation=1.0, min_value=0.0):
    """Repaint base-colour texels whose hue lies in [hue_lo, hue_hi) degrees (wrapping past 360 when hue_lo > hue_hi)
    with `rgb`, keeping each texel's brightness relative to the band's median, so baked shading survives. The
    saturation and value limits keep a pale tint apart from a strong or dark colour of the same hue. For colours
    Tripo's own reference image got wrong, where a re-texture would repeat the mistake."""
    target = np.array(rgb, dtype=np.float32)
    for image in bpy.data.images:
        px = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        c = px[:, :3]
        high, low = c.max(1), c.min(1)
        span = high - low + 1e-6
        r, g, b = c.T
        hue = np.where(high == r, ((g - b) / span) % 6, np.where(high == g, (b - r) / span + 2, (r - g) / span + 4)) * 60
        in_hue = (hue >= hue_lo) & (hue < hue_hi) if hue_lo < hue_hi else (hue >= hue_lo) | (hue < hue_hi)
        saturation = span / (high + 1e-6)
        band = in_hue & (saturation > min_saturation) & (saturation < max_saturation) & (high > min_value)
        if not band.any():
            raise RuntimeError(f"{image.name}: no texels in hue band {hue_lo}–{hue_hi}")
        shade = high[band] / np.median(high[band])
        c[band] = np.clip(target[None, :] * shade[:, None], 0, 1)
        image.pixels.foreach_set(px.ravel())
        image.update()


# Half-way to the T-pose: Tripo bipeds' hands clear the belly in idle and run (the short-armed Squirtle and Pikachu
# need 0.75).
ARMS_OPEN = 0.5

# Raichu's tail (Blender axes, metres above its feet in a body about 1 tall): out of the lower back, down behind the
# body and round its right side on the ground; the bolt stands on its end, as in the official artwork. Multiview
# rounds kept losing the thin tail, so it is built here (`add_tail`) on the regenerated body.
RAICHU_TAIL = [(-0.02, 0, 0.3), (-0.14, 0, 0.27), (-0.26, -0.04, 0.17), (-0.32, -0.12, 0.06), (-0.3, -0.24, 0.025),
               (-0.2, -0.32, 0.025)]
RAICHU_BOLT = [(0, 0), (0.13, 0.16), (0.06, 0.16), (0.17, 0.36), (-0.04, 0.13), (0.03, 0.13)]

# Squirtle's tail curls out on its left (official artwork, sheet front view), but the multiview mesh also has one
# curling out on its right from a root that hangs below the shell's centre: `drop_lobe` cuts for the curl and the root.
SQUIRTLE_RIGHT_TAIL = (
    ((-0.424, -0.3, 0.245), (-0.13, -0.045, 0.165), (-0.74, -0.64, 0.2)),
    ((-0.089, -0.009, 0.078), (-0.089, -0.009, 0.13), (0, 0, -1)),
)

# name: fixes for Tripo faults, applied in order after the materials are flattened, before export. `symmetrise`'s
# argument is half a gait cycle of the run clip (Tripo's runs hold two cycles, run-bipeds.py's one; 0 for a hop).
FIXES = {
    "charmander": (lambda: symmetrise(0.5), lambda: open_arms(ARMS_OPEN)),
    "charmeleon": (lambda: symmetrise(0.25), lambda: open_arms(ARMS_OPEN)),
    "squirtle": (
        lambda: drop_lobe(*SQUIRTLE_RIGHT_TAIL),
        lambda: symmetrise(0.5),
        lambda: open_arms(0.75),
    ),
    "blastoise": (lambda: symmetrise(0.25), lambda: open_arms(ARMS_OPEN)),
    "wartortle": (lambda: symmetrise(0.5), lambda: open_arms(ARMS_OPEN)),
    "pikachu": (lambda: symmetrise(0.0), lambda: open_arms(0.75)),
    "charizard": (lambda: symmetrise(0.25), lambda: open_arms(ARMS_OPEN)),
    "raichu": (
        lambda: drop_islands(-0.12),
        lambda: symmetrise(0.0),
        lambda: open_arms(0.75),
        lambda: add_tail(RAICHU_TAIL, 0.022, RAICHU_BOLT, 0.025, (0.07, 0.06, 0.06), (0.98, 0.80, 0.16)),
    ),
    "exeggutor": (lambda: drop_sheets(0.01, 0.1),),
    "tangela": (lambda: drop_sheets(0.01, 0.15),),
    "omanyte": (repair_omanyte_eye,),
    "gloom": (drop_gloom_speck,),
    "muk": (rejoin_muk_hand,),
}


def build(name):
    pattern, output, target, size = MODELS[name]
    source = source_for(pattern)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    # glTF's bone display widget is not part of the asset or its triangle budget.
    for obj in [o for o in bpy.context.scene.objects if o.type == "MESH" and o.hide_render]:
        bpy.data.objects.remove(obj, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    before = sum(triangles(o) for o in meshes)
    if name == "kadabra":
        # Remove the isolated duplicate before decimation splits its UV seams.
        drop_kadabra_spoon()
    if name in ("rapidash", "seaking", "electabuzz", "rattata", "nidoking"):
        repair_source_parts(name)
    if name == "tauros":
        repair_tauros_tail()
    if target is not None and before > target:
        for obj in meshes:
            if any(m.type == "ARMATURE" for m in obj.modifiers):
                raise RuntimeError(f"{name}: refusing to decimate a skinned mesh")
            if name in SEAM_REPAIRS:
                weld_decimation_seams(obj)
            mod = obj.modifiers.new("decimate", "DECIMATE")
            mod.ratio = target / before
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
    flatten_materials(size)
    for fix in FIXES.get(name, ()):
        fix()
    if name in ("charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise", "pikachu", "raichu"):
        print("idle-contact:", json.dumps(pin_idle_feet()))
    after = sum(triangles(o) for o in meshes)
    out = PUBLIC / output
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_animations=True,
        export_draco_mesh_compression_enable=False,
    )
    clips = [action.name for action in bpy.data.actions]
    return {
        "name": name,
        "source": str(source.relative_to(SOURCES)),
        "output": f"public/models/{output}",
        "trianglesBefore": before,
        "trianglesAfter": after,
        "texture": size,
        "clips": clips,
        "bytes": out.stat().st_size,
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = argv or list(MODELS)
    report = [build(name) for name in names]
    if not STAGED:
        log = ASSETS / "game-models.build.json"
        previous = json.loads(log.read_text()) if log.exists() else {}
        previous.update({entry["name"]: entry for entry in report})
        log.write_text(json.dumps(previous, indent=2, ensure_ascii=False) + "\n")
    for entry in report:
        print(json.dumps(entry, ensure_ascii=False))


if __name__ == "__main__":
    main()
