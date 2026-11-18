"""Rebuild the Mega Charizard portraits from the preserved multiview front drawings; no generation calls.
Same outline treatment as assets/icons/prepare-psychic-rock.py."""
from pathlib import Path

from PIL import Image, ImageFilter
from PIL import ImageDraw
import numpy as np

ROOT = Path(__file__).resolve().parents[4]
slice_path = ROOT / "assets/icons/slice-sheet.py"
slice_sheet = {}
exec(compile(slice_path.read_text().rsplit("\nmain()", 1)[0], str(slice_path), "exec"), slice_sheet)
cut = slice_sheet["cut"]
slice_sheet["SIZE"] = 960

# (row, column) of small enclosed background pockets that the size rule below would miss.
SMALL_POCKETS = {"charizard-x": [(253, 415)]}

for name in ["charizard-x", "charizard-y"]:
    source = Image.open(Path(__file__).parent / f"{name}.png").convert("RGBA")
    # Background pockets enclosed by the tail and wings are unreachable for the border flood fill:
    # clear large near-white regions (claws and eye highlights are far smaller).
    pixels = np.array(source)
    todo = pixels[..., :3].min(axis=2) >= 236
    for y0, x0 in np.argwhere(todo):
        if not todo[y0, x0]:
            continue
        region, stack = [], [(y0, x0)]
        todo[y0, x0] = False
        while stack:
            y, x = stack.pop()
            region.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < todo.shape[0] and 0 <= nx < todo.shape[1] and todo[ny, nx]:
                    todo[ny, nx] = False
                    stack.append((ny, nx))
        if len(region) > 600 or any(seed in region for seed in SMALL_POCKETS.get(name, [])):
            for y, x in region:
                pixels[y, x] = (255, 255, 255, 0)
    source = Image.fromarray(pixels)
    portrait = cut(source)
    navy = Image.new("RGBA", portrait.size, "#142f50")
    navy.putalpha(portrait.getchannel("A").filter(ImageFilter.MaxFilter(13)))
    portrait.putalpha(portrait.getchannel("A").filter(ImageFilter.MinFilter(7)))
    portrait.putdata([(20, 47, 80, a) if max(r, g, b) < 75 else (r, g, b, a)
                      for r, g, b, a in portrait.getdata()])
    navy.alpha_composite(portrait)
    navy.resize((320, 320), Image.Resampling.LANCZOS).save(
        ROOT / "public/art/portraits" / f"{name}.webp", quality=90)
