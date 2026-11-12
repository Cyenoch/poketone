"""The UI font recipe shared by the core and base sets: pinned source, vertical metrics, toolchain.

Both sets must lay a character out identically, so they share one recipe. The core set reads the
committed subset (public/fonts/noto-sans-sc-game.woff2, made from upstream by SOURCES.txt's steps);
the base set reads pinned upstream directly. Narrowing upstream to wght 400–800 and applying
centre-metrics.py's 1095 / 353 reproduces that subset's outlines, advances and line metrics exactly.
"""

import hashlib
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache/fonts"
UPSTREAM_COMMIT = "2894aab31764f10f29c421bdfd2340d3b382d384"
UPSTREAM_URL = (
    f"https://raw.githubusercontent.com/google/fonts/{UPSTREAM_COMMIT}/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
)
UPSTREAM_SHA256 = "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"
WEIGHT_RANGE = (400, 800)
VERTICAL = (1095, 353)  # centre-metrics.py ASC / DESC: the line box the UI is laid out in

# Every tool that shapes a published byte. A different version is refused, not silently used: the
# pages, their metrics and the base key would no longer be what this recipe says.
TOOLS = {
    "msdf-atlas-gen": "MSDF-Atlas-Gen v1.4.0\n  with MSDFgen v1.13.0",
    "fonttools": "4.68.0",
    "pillow": "13.0.0",
    "brotli": "1.2.1",
}
UV_RUN = "uv run -q --with fonttools==4.68.0 --with brotli==1.2.1 --with pillow==13.0.0 python"


def toolchain():
    """The versions in use, checked against TOOLS; recorded in every manifest."""
    import brotli
    import fontTools
    import PIL
    from PIL import features

    found = {
        # Its first two lines name the generator and MSDFgen versions (a copyright line follows).
        "msdf-atlas-gen": "\n".join(
            subprocess.run(["msdf-atlas-gen", "-version"], capture_output=True, text=True).stdout.splitlines()[:2]
        ),
        "fonttools": fontTools.version,
        "pillow": PIL.__version__,
        "brotli": brotli.__version__,
    }
    wrong = {tool: version for tool, version in found.items() if version != TOOLS[tool]}
    if wrong:
        raise SystemExit(f"font toolchain differs from scripts/fonts/source.py TOOLS: {wrong}\nrun through: {UV_RUN}")
    return {**found, "libwebp": features.version("webp")}


def upstream():
    """The pinned upstream source font, downloaded once into .cache/fonts/ and checked every time."""
    path = CACHE / f"NotoSansSC-{UPSTREAM_SHA256[:16]}.ttf"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {UPSTREAM_URL}", file=sys.stderr)
        data = urllib.request.urlopen(UPSTREAM_URL, timeout=120).read()
        if hashlib.sha256(data).hexdigest() != UPSTREAM_SHA256:
            raise SystemExit(f"{UPSTREAM_URL}: SHA-256 differs from the pinned {UPSTREAM_SHA256}")
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        temporary.write_bytes(data)
        os.replace(temporary, path)
    elif hashlib.sha256(path.read_bytes()).hexdigest() != UPSTREAM_SHA256:
        raise SystemExit(f"{path}: cached source font is corrupt; delete it and rerun")
    return path


def base_key(tools):
    """Names the base set: a hash of everything it depends on (pinned source, toolchain, and the
    scripts that hold the charset, page layout and glyph parameters). The core set pins the key it
    was built against; the loader reads exactly that base set, never a 'latest' one."""
    parts = [UPSTREAM_SHA256, repr(sorted(tools.items()))]
    for script in ("atlas.py", "charset.py", "source.py", "build-base.py"):
        parts.append(hashlib.sha256((ROOT / "scripts/fonts" / script).read_bytes()).hexdigest())
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:16]
