"""Bakes the committed core font set: the game's own text, paged, for every UI weight + the wordmark.

  bun run fonts:core

Requires msdf-atlas-gen 1.4 (toolchain: source.py). Rerun after changing any UI or content text.
Page 0 of each UI weight is chrome (shell and menu text, ASCII: everything the first screen
draws); content pages follow. Game-text growth adds content pages, never chrome. The fixed name
charset is the separate, generated base set (build-base.py). Layout: docs/fonts-paging-design.md.
"""

import argparse
import hashlib
from pathlib import Path
import tempfile

from fontTools.ttLib import TTFont

from atlas import fitted, font_json, glyph_rows, instance, page, page_file
from publish import publish
from game_text import check_baked, game_text
from source import ROOT, base_key, toolchain

OUTPUT = ROOT / "public/fonts/gpu/core"
UI_SOURCE = ROOT / "public/fonts/noto-sans-sc-game.woff2"
DISPLAY_SOURCE = ROOT / "public/fonts/poketone-display.woff2"
WEIGHTS = (500, 700, 800)
PAGE_WIDTH = 2048
PAGE_MAX_HEIGHT = 2048  # A full page holds ~1400 glyphs; past that a chunk gets its own page.
PAGE_STEP = 128
CHUNK = 1300


def bake_weight(weight, chrome, content, work, staging):
    name = f"ui-{weight}"
    ttf = work / f"{name}.ttf"
    cmap = instance(TTFont(UI_SOURCE), weight, ttf)
    # Recorded so a test can tell "the source font has no such glyph" from "the set is stale".
    unavailable = sorted(char for char in chrome | content if ord(char) not in cmap)
    chunks = []
    for group in (chrome, content):
        codes = sorted(ord(char) for char in group if ord(char) in cmap)
        chunks += [codes[start:start + CHUNK] for start in range(0, len(codes), CHUNK)]
    assert all(code in chunks[0] for code in range(0x20, 0x7F)), "ASCII must be on page 0"
    pages, rows, metrics = [], [], None
    for index, codes in enumerate(chunks):
        result = fitted(ttf, codes, work, PAGE_WIDTH, PAGE_MAX_HEIGHT, PAGE_STEP)
        if result is None:
            raise SystemExit(f"{name}: {len(codes)} glyphs do not fit a {PAGE_WIDTH}x{PAGE_MAX_HEIGHT} page; lower CHUNK")
        height, (webp, glyphs, metrics) = result
        pages.append((page_file(f"{name}-{index}", webp, staging), PAGE_WIDTH, height))
        rows += glyph_rows(glyphs, metrics, index)
    check_baked(name, {row[0] for row in rows}, cmap)
    entry = font_json(name, weight, metrics, pages, rows, staging)
    entry.update(unavailable="".join(unavailable), chromePages=1 + (len(chrome) - 1) // CHUNK)
    return entry


def bake_display(work, staging):
    ttf = work / "display.ttf"
    instance(TTFont(DISPLAY_SOURCE), 400, ttf)
    codes = sorted(ord(char) for char in "poketone ")
    webp, glyphs, metrics = page(ttf, codes, work, 128, 128, ["-potr"])
    pages = [(page_file("display-0", webp, staging), 128, 128)]
    return font_json("display", 400, metrics, pages, glyph_rows(glyphs, metrics, 0), staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUTPUT, help="publish here instead (dry builds)")
    output = parser.parse_args().out.resolve()
    tools = toolchain()
    chrome, content = game_text()
    with tempfile.TemporaryDirectory(prefix="poketone-fonts-") as folder:
        work = Path(folder)
        staging = work / "staging"
        staging.mkdir()
        # The base set this core set is drawn with: the loader reads base/<key>/ and nothing else.
        manifest = {"base": base_key(tools), "tools": tools}
        for weight in WEIGHTS:
            manifest[f"ui-{weight}"] = bake_weight(weight, chrome, content, work, staging)
        manifest["display"] = bake_display(work, staging)
        for name in (*(f"ui-{weight}" for weight in WEIGHTS), "display"):
            source = DISPLAY_SOURCE if name == "display" else UI_SOURCE
            manifest[name].update(source=str(source.relative_to(ROOT)), sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest())
        publish(staging, manifest, output)
    print(f"core set → {output} (base key {manifest['base']})")
    for name, entry in manifest.items():
        if isinstance(entry, dict) and "json" in entry:
            print(f"{name}: {entry['glyphs']} glyphs on {entry['pages']} page(s), {entry['json']}")


if __name__ == "__main__":
    main()
