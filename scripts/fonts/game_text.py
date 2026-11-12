"""The game's own text, for the core set (build-core.py).

Source text is what the source can display, never comments: string literals, template-literal text
and JSX text with escapes decoded, extracted by source-text.mjs on TypeScript's scanner (the glyph
tests use the same extraction). Data the lobby shows comes from first-screen-text.mjs.
"""

import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]

# Characters every UI set carries whatever the source spells: all printable ASCII, the space included
# (layout draws it, and a line break with it; a charset that omits it gets no space glyph from
# msdf-atlas-gen), and punctuation the UI draws around external text.
REQUIRED = frozenset(chr(code) for code in range(0x20, 0x7F)) | frozenset("□…，。！？：；（）「」【】×−—★")


def check_baked(name, codes, cmap):
    """Fails the build before publishing if a baked font lacks a REQUIRED character its source
    font has (characters the source lacks are recorded as `unavailable` instead)."""
    missing = sorted(char for char in REQUIRED if ord(char) in cmap and ord(char) not in codes)
    if missing:
        raise SystemExit(f"{name}: baked without required characters {missing!r}")


def _bun(script):
    run = subprocess.run(
        ["bun", f"scripts/fonts/{script}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if run.returncode != 0:
        raise SystemExit(f"{script} failed\n{run.stderr.strip()}")
    return run.stdout


def game_text():
    """(chrome, content) character sets. Chrome is what the shell, the lobby and the windows over it
    display (src/ui/** and src/*), the data text the lobby shows, ASCII and UI punctuation: chrome
    page 0, the first screen's page. Content is the rest (items, enemies, moves, codex, ...), which
    grows with the game and never reaches the first screen."""
    source = json.loads(_bun("source-text.mjs"))
    shown = lambda text: {char for char in text if not char.isspace()}
    # Whitespace is dropped from extracted text; the glyphs layout needs come from REQUIRED.
    chrome = set(REQUIRED) | shown(source["chrome"] + _bun("first-screen-text.mjs"))
    return chrome, shown(source["content"]) - chrome
