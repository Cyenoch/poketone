"""Slice an evenly gridded icon sheet into transparent square WebP icons.

Usage: python3 assets/icons/slice-sheet.py <sheet.png> <cols> <rows> <out-dir> <name> [<name> ...]

The background is removed by flood-filling from each cell's border (not by colour keying), so light
highlights inside the navy outline survive. Each icon is trimmed, centred and resized to 128 px.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 128
TOLERANCE = 38


def cut(cell: Image.Image) -> Image.Image:
    rgba = cell.convert("RGBA")
    marker = (255, 0, 255, 0)
    w, h = rgba.size
    seeds = [(x, 0) for x in range(0, w, 8)] + [(x, h - 1) for x in range(0, w, 8)]
    seeds += [(0, y) for y in range(0, h, 8)] + [(w - 1, y) for y in range(0, h, 8)]
    for seed in seeds:
        if rgba.getpixel(seed) != marker:
            ImageDraw.floodfill(rgba, seed, marker, thresh=TOLERANCE)
    data = [(0, 0, 0, 0) if p == marker else p for p in rgba.getdata()]
    rgba.putdata(data)
    box = rgba.getbbox()
    if box is None:
        raise SystemExit("empty cell")
    icon = rgba.crop(box)
    side = int(max(icon.size) * 1.08)
    square = Image.new("RGBA", (side, side))
    square.paste(icon, ((side - icon.width) // 2, (side - icon.height) // 2))
    return square.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    sheet_path, cols, rows, out_dir, *names = sys.argv[1:]
    cols, rows = int(cols), int(rows)
    sheet = Image.open(sheet_path)
    if len(names) > cols * rows:
        raise SystemExit(f"{len(names)} names for {cols * rows} cells")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    cw, ch = sheet.width / cols, sheet.height / rows
    inset = 0.03
    for index, name in enumerate(names):
        col, row = index % cols, index // cols
        box = (
            int((col + inset) * cw),
            int((row + inset) * ch),
            int((col + 1 - inset) * cw),
            int((row + 1 - inset) * ch),
        )
        cut(sheet.crop(box)).save(out / f"{name}.webp", quality=88)
        print(name)


main()
