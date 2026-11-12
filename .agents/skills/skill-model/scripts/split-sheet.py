"""Split a 2×2 turnaround sheet into Tripo multiview inputs.

    python3 split-sheet.py <sheet.(png|jpg)> <out-dir>

Cells: top-left front, top-right back, bottom-left right side, bottom-right left side.
Writes v-front/left/back/right.png (square, white, same scale) and preview.png.
Exits 1 when the sheet has no clean white gap between cells: regenerate it, do not cut by hand.
"""
import sys
from pathlib import Path

from PIL import Image

DARK = 200  # a pixel below this grey is content; JPEG noise stays above it
MIN_RUN = 50  # a content run narrower than this is noise
PAD = 20


def runs(length, is_content):
    out, start = [], None
    for i in range(length + 1):
        on = i < length and is_content(i)
        if on and start is None:
            start = i
        if not on and start is not None:
            out.append((start, i - 1))
            start = None
    return [r for r in out if r[1] - r[0] > MIN_RUN]


def main(sheet, out_dir):
    im = Image.open(sheet).convert("RGB")
    g = im.convert("L").load()
    w, h = im.size
    cols = runs(w, lambda x: sum(1 for y in range(h) if g[x, y] < DARK) > 3)
    rows = runs(h, lambda y: sum(1 for x in range(w) if g[x, y] < DARK) > 3)
    if len(cols) != 2 or len(rows) != 2:
        sys.exit(f"expected 2 column and 2 row runs, got cols={cols} rows={rows}: regenerate the sheet")
    cells = {"front": (0, 0), "back": (1, 0), "right": (0, 1), "left": (1, 1)}
    size = max(max(b - a for a, b in cols), max(b - a for a, b in rows)) + 2 * PAD
    out_dir.mkdir(parents=True, exist_ok=True)
    views = {}
    for name, (ci, ri) in cells.items():
        a, b = cols[ci]
        t, d = rows[ri]
        crop = im.crop((a - 6, t - 6, b + 7, d + 7))
        cell = Image.new("RGB", (size, size), (255, 255, 255))
        cell.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2))
        cell.save(out_dir / f"v-{name}.png")
        views[name] = cell
    order = ["front", "left", "back", "right"]
    preview = Image.new("RGB", (size * 4, size), "white")
    for i, name in enumerate(order):
        preview.paste(views[name], (i * size, 0))
    preview.resize((1600, 400)).save(out_dir / "preview.png")
    print(f"{size}px cells → {out_dir}/v-{{{','.join(order)}}}.png, preview.png")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(Path(sys.argv[1]), Path(sys.argv[2]))
