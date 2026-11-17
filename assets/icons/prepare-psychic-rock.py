"""Rebuild the psychic/rock batch from preserved Magpie sheets; no generation calls."""
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/icons/source"
slice_path = ROOT / "assets/icons/slice-sheet.py"
slice_sheet = {}
exec(compile(slice_path.read_text().rsplit("\nmain()", 1)[0], str(slice_path), "exec"), slice_sheet)
cut = slice_sheet["cut"]


def sheet(filename, cols, rows, names, destination, size=128, quality=88):
    image = Image.open(SOURCE / filename).convert("RGBA")
    flat = Image.new("RGBA", image.size, "#f5f1e8" if size == 128 else "white")
    flat.alpha_composite(image)
    if filename == "ultimates-psychic-rock.png":
        # This RGB sheet has enclosed beige background pockets between the pillars and rocks.
        background = (244, 239, 229)
        flat.putdata([(0, 0, 0, 0) if sum(abs(a - b) for a, b in zip(p[:3], background)) < 30
                      else p for p in flat.getdata()])
    # Same flood fill, trim and 8% padding as slice-sheet.py; retain the full cell
    # because generated subjects may extend into its standard 3% slicing inset.
    slice_sheet["cut"].__globals__["SIZE"] = size
    for index, name in enumerate(names):
        x, y = index % cols, index // cols
        box = (round(x * image.width / cols), round(y * image.height / rows),
               round((x + 1) * image.width / cols), round((y + 1) * image.height / rows))
        out = ROOT / "public/art" / destination / f"{name}.webp"
        out.parent.mkdir(parents=True, exist_ok=True)
        cut(flat.crop(box)).save(out, quality=quality)


sheet("moves-sheet-psychic.png", 4, 2,
      ["confusion", "hypnosis", "psybeam", "psychic", "future-sight", "psyshock"], "icons/moves")
sheet("moves-sheet-rock-ground.png", 4, 2,
      ["rock-throw", "rollout", "magnitude", "rock-slide", "earthquake", "stone-edge", "tectonic-rage"], "icons/moves")
sheet("moves-sheet-psystrike-redo.png", 2, 2, ["psystrike"], "icons/moves")
sheet("ultimates-psychic-rock.png", 2, 2, ["abra", "geodude"], "icons/ultimates")
sheet("crests-psychic-rock-ground.png", 2, 2, ["psychic", "rock", "ground"], "icons/crests")


def geodude_portrait(source):
    # Raised fists give this very wide model sheet a readable face at 28–48px.
    source = source.convert("RGBA")
    ImageDraw.floodfill(source, (0, 0), (0, 0, 0, 0), thresh=38)
    left = source.crop((0, 205, 190, 305)).rotate(-45, Image.Resampling.BICUBIC, expand=True)
    right = source.crop((340, 205, 529, 305)).rotate(45, Image.Resampling.BICUBIC, expand=True)
    mask = Image.new("L", source.size)
    ImageDraw.Draw(mask).polygon([
        (212, 202), (251, 188), (284, 192), (300, 199), (325, 205), (338, 228),
        (339, 247), (342, 263), (337, 278), (339, 296), (325, 316), (296, 330),
        (274, 339), (238, 334), (216, 323), (198, 314), (199, 296), (196, 282),
        (194, 263), (189, 241), (196, 222),
    ], fill=255)
    body = source.copy()
    body.putalpha(ImageChops.multiply(source.getchannel("A"), mask))
    body = body.crop((180, 187, 350, 340)).resize((255, 230), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (500, 440))
    canvas.alpha_composite(left, (15, 120))
    canvas.alpha_composite(right, (275, 120))
    canvas.alpha_composite(body, (122, 175))
    return canvas


for name in ["abra", "kadabra", "alakazam", "geodude", "graveler", "golem"]:
    # Reuse the preserved multiview front drawings; unify the outline at 3x release size.
    slice_sheet["SIZE"] = 960
    source = Image.open(SOURCE / "portraits-psychic-rock" / f"{name}.png")
    portrait = cut(geodude_portrait(source) if name == "geodude" else source)
    navy = Image.new("RGBA", portrait.size, "#142f50")
    navy.putalpha(portrait.getchannel("A").filter(ImageFilter.MaxFilter(13)))
    # Cover the source's white matte fringe with the navy outline, including enclosed edges.
    portrait.putalpha(portrait.getchannel("A").filter(ImageFilter.MinFilter(7)))
    pixels = [(20, 47, 80, a) if max(r, g, b) < 75 else (r, g, b, a)
              for r, g, b, a in portrait.getdata()]
    portrait.putdata(pixels)
    navy.alpha_composite(portrait)
    navy.resize((320, 320), Image.Resampling.LANCZOS).save(
        ROOT / "public/art/portraits" / f"{name}.webp", quality=90)


def luminance(rgb):
    channels = [v / 255 for v in rgb]
    channels = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in channels]
    return sum(a * b for a, b in zip(channels, (0.2126, 0.7152, 0.0722)))


ink = luminance((20, 47, 80))
card_processing = {}
for name, color in [("psychic", "#fde0ea"), ("rock", "#f2ebcf"), ("ground", "#f8e6d4")]:
    image = Image.open(SOURCE / f"card-{name}.png").convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)
    base = Image.new("RGB", image.size, color)
    target = ROOT / "public/art/cards" / f"{name}.webp"
    # Include encoding effects in the contrast check.
    for percent in range(100, -1, -5):
        blended = Image.blend(base, image, percent / 100)
        blended.save(target, quality=86)
        contrast = min((luminance(pixel) + 0.05) / (ink + 0.05) for pixel in set(Image.open(target).getdata()))
        if contrast >= 4.8:
            break
    else:
        raise ValueError(f"{target}: cannot reach 4.8:1 contrast against #142f50")
    card_processing[name] = {"artShare": percent / 100, "minimumEncodedContrast": round(contrast, 4)}
print(json.dumps(card_processing, indent=2))
