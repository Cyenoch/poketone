"""Generates the base font set: the fixed name charset (charset.py) for every UI weight, in 512² pages.

  bun run fonts:base            # skips when public/fonts/gpu/base/<key>/ already exists

Requires msdf-atlas-gen 1.4 (toolchain: source.py) and network on the first run (the source font
is cached in .cache/fonts/). The set is not committed: CI and local builds generate it into
public/fonts/gpu/base/<key>/, where the key (source.base_key) covers the source font, toolchain,
charset and every build parameter; the core set pins the key it was built against.
CI downloads release fonts-base-<key> instead of rebuilding (~25 min); the tracked pre-push hook
(.githooks/pre-push) publishes the local set when a push pins a key that has no release.

Source: upstream Noto Sans SC, pinned to a google/fonts commit and SHA-256. It is narrowed to
wght 400–800 and given the same vertical metrics as public/fonts/noto-sans-sc-game.woff2
(centre-metrics.py), which reproduces that file's outlines and advances exactly, so a character's
metrics are identical in core and base pages (scripts/ui-fonts-paged.test.mjs).
"""

import argparse
from concurrent.futures import ProcessPoolExecutor
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

from atlas import font_json, glyph_rows, instance, page, page_file
from publish import publish
from charset import base_charset
from source import ROOT, UPSTREAM_SHA256, UPSTREAM_URL, VERTICAL, WEIGHT_RANGE, base_key, toolchain, upstream

SETS = ROOT / "public/fonts/gpu/base"
WEIGHTS = (500, 700, 800)
PAGE = 512
PER_PAGE = 81  # CJK glyphs that fit a 512² page at 48 px; a page that does not fit takes fewer.


def source_instance(weight, work):
    """The source at `weight`, narrowed like the committed woff2, with its vertical metrics,
    subset to the base charset (smaller files for the hundreds of msdf-atlas-gen runs)."""
    font = instantiateVariableFont(TTFont(upstream()), {"wght": WEIGHT_RANGE})
    ttf = work / f"ui-{weight}.ttf"
    cmap = instance(font, weight, ttf, VERTICAL)
    codes = base_charset(cmap)
    assert 0x20 in codes, "the base set must carry the space glyph (layout draws it)"
    font = TTFont(ttf)
    options = Options()
    options.layout_features, options.notdef_outline, options.name_IDs = [], True, ["*"]
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=codes)
    subsetter.subset(font)
    font.save(ttf)
    return ttf, codes


def bake_page(job):
    """One page in its own work dir (pool worker): fills it with as many codes as fit."""
    ttf, codes, index, work = job
    work = Path(work)
    work.mkdir()
    count = min(PER_PAGE, len(codes))
    while not (baked := page(Path(ttf), codes[:count], work, PAGE, PAGE, threads=1)):
        count -= 3
    webp, glyphs, metrics = baked
    shutil.rmtree(work)
    return index, count, webp, glyphs, metrics


def bake_weight(weight, work, staging, pool):
    name = f"ui-{weight}"
    ttf, codes = source_instance(weight, work)
    # Pages are cut in order and a page that cannot hold PER_PAGE takes fewer, which shifts every
    # later cut. So a batch bakes the next pages in parallel assuming full pages, and keeps results
    # only up to the first short one.
    pages, rows, start, metrics = [], [], 0, None
    workers = os.cpu_count() or 4
    while start < len(codes):
        offsets = [start + k * PER_PAGE for k in range(workers) if start + k * PER_PAGE < len(codes)]
        batch = [(str(ttf), codes[offset:], len(pages) + k, str(work / f"{name}-{len(pages) + k}"))
                 for k, offset in enumerate(offsets)]
        for index, count, webp, glyphs, metrics in pool.map(bake_page, batch):
            pages.append((page_file(f"{name}-{index}", webp, staging), PAGE, PAGE))
            rows += glyph_rows(glyphs, metrics, index)
            start += count
            if count < PER_PAGE:
                break
        print(f"{name}: {start}/{len(codes)}", file=sys.stderr)
    entry = font_json(name, weight, metrics, pages, rows, staging)
    entry["charset"] = len(codes)
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", type=Path, default=SETS, help="publish base/<key>/ under here instead")
    parser.add_argument("--force", action="store_true", help="rebuild even when base/<key>/ exists")
    args = parser.parse_args()
    tools = toolchain()
    key = base_key(tools)
    output = args.sets.resolve() / key
    if not args.force and (output / "manifest.json").exists():
        print(f"base font set {key} is current ({output})")
        return
    with tempfile.TemporaryDirectory(prefix="poketone-fonts-base-") as folder, ProcessPoolExecutor() as pool:
        work = Path(folder)
        staging = work / "staging"
        staging.mkdir()
        manifest = {"key": key, "source": UPSTREAM_URL, "sourceSha256": UPSTREAM_SHA256, "tools": tools}
        for weight in WEIGHTS:
            manifest[f"ui-{weight}"] = bake_weight(weight, work, staging, pool)
        publish(staging, manifest, output)
    print(f"base set {key} → {output}")
    for name, entry in manifest.items():
        if isinstance(entry, dict) and "json" in entry:
            print(f"{name}: {entry['glyphs']} glyphs on {entry['pages']} pages, {entry['json']}")


if __name__ == "__main__":
    main()
