"""The fixed base charset for names (game text: game_text.py). Part of the base set's key.

Base charset (provisional, lead's choice pending user confirmation; docs/fonts-paging-design.md):
these Unicode ranges, intersected with the source font's cmap. Everything outside is reported
by `fonts.unsupported()` at the input boundary, never drawn. Latin Extended-A, CJK Extension A/B+
and emoji are deliberately outside.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

BASE_RANGES = (
    (0x0020, 0x007E),  # ASCII
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x2000, 0x206F),  # General Punctuation
    (0x2100, 0x22FF),  # Letterlike, Number Forms, Arrows, Mathematical Operators
    (0x2460, 0x24FF),  # Enclosed Alphanumerics
    (0x2500, 0x257F),  # Box Drawing
    (0x25A0, 0x27BF),  # Geometric Shapes, Miscellaneous Symbols, Dingbats
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0x3040, 0x30FF),  # Hiragana, Katakana
    (0x31F0, 0x31FF),  # Katakana Phonetic Extensions
    (0x3200, 0x33FF),  # Enclosed CJK Letters and Months, CJK Compatibility
    (0x4E00, 0x9FFF),  # CJK Unified Ideographs
    (0xF900, 0xFAFF),  # CJK Compatibility Ideographs
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms
)

def in_base(code):
    return any(low <= code <= high for low, high in BASE_RANGES)


def _codec(encoding, rows, cells=range(0xA1, 0xFF)):
    """Ideographs of a double-byte national standard, in the standard's own (frequency tier) order."""
    found = []
    for row in rows:
        for cell in cells:
            try:
                char = bytes([row, cell]).decode(encoding)
            except UnicodeDecodeError:
                continue
            if len(char) == 1:
                found.append(ord(char))
    return found


def _tiers():
    """Han in name-friendly order: each standard's first (most common) level before any second
    level, so a typical name's characters share few pages. Standard tables come from Python's
    codecs (no hand-kept lists): GB2312, JIS X 0208 (EUC-JP), Big5."""
    return [
        _codec("gb2312", range(0xB0, 0xD8)),  # GB2312 level 1 (3755, most common Simplified)
        _codec("euc_jp", range(0xB0, 0xD0)),  # JIS X 0208 level 1 (2965)
        _codec("big5", range(0xA4, 0xC7), range(0x40, 0xFF)),  # Big5 常用字 (5401)
        _codec("gb2312", range(0xD8, 0xF8)),  # GB2312 level 2
        _codec("euc_jp", range(0xD0, 0xF5)),  # JIS X 0208 level 2
        _codec("big5", range(0xC9, 0xFA), range(0x40, 0xFF)),  # Big5 次常用字
    ]


def base_charset(cmap):
    """The base charset in page order: everything that is not Han first (Latin, kana, punctuation,
    symbols: what most names and imported text mix in), then Han by tier, then the rest of the
    Han blocks. Only code points the source font draws."""
    ordered, seen = [], set()

    def add(codes):
        for code in codes:
            if code in cmap and in_base(code) and code not in seen:
                seen.add(code)
                ordered.append(code)

    def han(code):
        return 0x4E00 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF

    every = [code for low, high in BASE_RANGES for code in range(low, high + 1)]
    add(code for code in every if not han(code))
    for tier in _tiers():
        add(sorted(tier))
    add(code for code in every if han(code))
    return ordered
