"""Re-centres Poketone UI's vertical metrics so text sits in the middle of its line box.

Noto Sans SC ships ascent 1160 / descent 288: the line box centre is 0.436 em above the baseline, so
every badge, button and bar showed its label low. This keeps the same 1.448 em box and moves its
centre to 0.371 em: between digits (ink 0..733, centre 0.366 em) and the UI's CJK labels (a label's ink
spans about -75..875, centre ~0.395 em; one glyph averages 0.377 em). Chrome rounds ascent and descent
to whole pixels separately, so the effective centre depends on the font size; 1095 / 353 is the pair
that keeps CJK and digit labels within about ±0.5 px at the sizes the UI boxes text in (11, 12, 14–18,
20, 23 px). 13 px rounds badly with any pair, so Tag chips use 12 px. `bun run check:centering` is the
gate for the result.

Run after any re-subset of the font:
  uv run --with fonttools --with brotli python scripts/fonts/centre-metrics.py public/fonts/noto-sans-sc-game.woff2
"""

import sys

from fontTools.ttLib import TTFont

ASC, DESC = 1095, 353

path = sys.argv[1]
font = TTFont(path)
hhea, os2 = font["hhea"], font["OS/2"]
hhea.ascent, hhea.descent, hhea.lineGap = ASC, -DESC, 0
os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ASC, -DESC, 0
os2.usWinAscent, os2.usWinDescent = ASC, DESC
os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS
centre = (ASC - DESC) / 2 / font["head"].unitsPerEm
cap = os2.sCapHeight / 2 / font["head"].unitsPerEm
assert cap - 0.01 < centre < 0.395, f"line-box centre {centre:.3f} em outside digit {cap:.3f} .. CJK 0.395 em"
font.flavor = "woff2"
font.save(path)
print(f"{path}: ascent {ASC}, descent {DESC}, centre {centre:.3f} em (cap centre {cap:.3f} em)")
