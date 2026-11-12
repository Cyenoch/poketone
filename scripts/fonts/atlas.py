"""MSDF page baking for the paged UI font sets (core and base): part of the base recipe (its key).

A set is one directory with a `manifest.json` that names, per font, one metrics json and its pages.
Every other file is named by the first 16 hex digits of its SHA-256 and recorded with its full
SHA-256 (the manifest holds the json's, the json holds its pages'), so a name never changes content
and the loader can verify every byte it uses. Quality settings are fixed here for every page of
every set: 48 px/em glyphs, 4 px distance range, 2 px outer field padding, lossless WebP.
Publishing a baked set: publish.py.
"""

import hashlib
import json
import subprocess

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

GLYPH_SIZE = 48
PX_RANGE = 4


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def instance(font, weight, ttf, vertical=None):
    """Writes the `weight` instance of `font` (a TTFont, consumed) as a plain TTF; returns its cmap.
    `vertical` = (ascent, descent) replaces the line metrics (see centre-metrics.py)."""
    if "fvar" in font:
        font = instantiateVariableFont(font, {"wght": weight}, inplace=True)
    if vertical:
        ascent, descent = vertical
        hhea, os2 = font["hhea"], font["OS/2"]
        hhea.ascent, hhea.descent, hhea.lineGap = ascent, -descent, 0
        os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, -descent, 0
        os2.usWinAscent, os2.usWinDescent = ascent, descent
        os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
    font.flavor = None
    font.save(ttf)
    return set(font.getBestCmap())


def page(ttf, codes, work, width, height, extra=(), threads=4):
    """Bakes `codes` into one width × height page: (webp bytes, glyphs, metrics), or None when they
    do not fit. One msdf-atlas-gen run; `work` is this run's scratch directory."""
    charset = work / "charset.txt"
    charset.write_text("\n".join(f"0x{code:x}" for code in codes))
    run = subprocess.run(
        [
            "msdf-atlas-gen", "-font", str(ttf), "-charset", str(charset),
            "-type", "msdf", "-size", str(GLYPH_SIZE), "-pxrange", str(PX_RANGE),
            "-dimensions", str(width), str(height),
            # Field (not bounds) around each glyph: a sample just past a quad's edge (MSAA
            # evaluates edge pixels at their centre, outside the quad) reads this glyph's own
            # outside field, not the next cell's channels, whose blend is a false edge.
            "-outerpxpadding", "2", *extra,
            "-yorigin", "top", "-imageout", str(work / "page.png"),
            "-json", str(work / "page.json"), "-threads", str(threads),
        ],
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        if "Could not fit" in run.stderr + run.stdout:
            return None
        raise SystemExit(f"msdf-atlas-gen failed on {ttf.name}\n{run.stderr.strip() or run.stdout.strip()}")
    webp = work / "page.webp"
    # Lossless and `exact`: every distance value is kept. For lossless WebP `quality` is only the
    # compression effort; 75 at method 6 is ~12× faster than 100 and no larger (same pixels).
    Image.open(work / "page.png").save(webp, "WEBP", lossless=True, quality=75, method=6, exact=True)
    data = json.loads((work / "page.json").read_text())
    if data.get("kerning"):
        # Every page is baked alone: pairs across pages would be lost, and layout would differ by
        # page. Noto Sans SC has GPOS kerning only, which msdf-atlas-gen does not read, so no page
        # carries any (nor did the single-page atlases). A font that does needs a charset-wide pass.
        raise SystemExit(f"{ttf.name}: per-page kerning is not supported by the paged build")
    atlas = data["atlas"]
    assert (atlas["width"], atlas["height"]) == (width, height), (atlas["width"], atlas["height"])
    return webp.read_bytes(), data["glyphs"], data["metrics"]


def fitted(ttf, codes, work, width, max_height, step, extra=(), threads=4):
    """The shortest page (a multiple of `step` tall, at most `max_height`) the codes pack into, as
    (height, baked); None when even the tallest does not fit. Starts from an area estimate."""
    estimate = len(codes) * 3300 // width
    height = min(max_height, max(step, -(-estimate // step) * step))
    baked = page(ttf, codes, work, width, height, extra, threads)
    if baked:
        while height > step and (smaller := page(ttf, codes, work, width, height - step, extra, threads)):
            height, baked = height - step, smaller
        return height, baked
    while height < max_height:
        height += step
        if baked := page(ttf, codes, work, width, height, extra, threads):
            return height, baked
    return None


def glyph_rows(glyphs, metrics, page_index):
    """Compact glyph metrics: [code, page, x, y, w, h, xoffset, yoffset, xadvance], in 48 px units.
    yoffset folds in the leading uikit removes: UIKit subtracts the full atlas leading, then adds
    half the requested line's leading, so this preserves the source font's baseline in the line box."""
    rows = []
    for glyph in glyphs:
        box = glyph.get("atlasBounds", dict(left=0, top=0, right=0, bottom=0))
        plane = glyph.get("planeBounds", dict(left=0, top=0, right=0, bottom=0))
        rows.append([
            glyph["unicode"], page_index, round(box["left"]), round(box["top"]),
            round(box["right"] - box["left"]), round(box["bottom"] - box["top"]),
            round(plane["left"] * GLYPH_SIZE, 4),
            round((plane["top"] - metrics["ascender"] + (metrics["lineHeight"] - 1) / 2) * GLYPH_SIZE, 4),
            round(glyph["advance"] * GLYPH_SIZE, 4),
        ])
    return rows


def page_file(name, webp, staging):
    """Stages a page under its content name; returns (file name, full SHA-256)."""
    digest = sha256(webp)
    file = f"{name}.{digest[:16]}.webp"
    (staging / file).write_bytes(webp)
    return file, digest


def font_json(name, weight, metrics, pages, rows, staging):
    """Writes the font's metrics json (its pages already staged); returns its manifest entry.
    `pages` = [((file, sha256), width, height)]."""
    rows.sort(key=lambda row: row[0])
    codes = [row[0] for row in rows]
    assert len(codes) == len(set(codes)), f"{name}: a glyph is on two pages"
    info = dict(
        name=name, weight=weight, size=GLYPH_SIZE, distanceRange=PX_RANGE,
        lineHeight=metrics["lineHeight"] * GLYPH_SIZE, base=-metrics["ascender"] * GLYPH_SIZE,
        pages=[file for (file, _), _, _ in pages], pageSha256=[digest for (_, digest), _, _ in pages],
        pageSizes=[[w, h] for _, w, h in pages], glyphs=rows,
    )
    data = json.dumps(info, ensure_ascii=False, separators=(",", ":")).encode()
    digest = sha256(data)
    file = f"{name}.{digest[:16]}.json"
    (staging / file).write_bytes(data)
    return dict(json=file, sha256=digest, weight=weight, glyphs=len(rows), pages=len(pages))


