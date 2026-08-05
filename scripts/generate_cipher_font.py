"""
Generate a cipher font that maps the encoded PUA range U+E000–U+E05F
back to visible ASCII glyphs using a system monospace font as source.

Requirements (install once):
    pip3 install fonttools brotli

Usage:
    python3 scripts/generate_cipher_font.py
Output:
    public/fonts/sigma-cipher.ttf
    public/fonts/sigma-cipher.woff2 (if brotli available)
"""
import os
import sys
from pathlib import Path

try:
    from fontTools.ttLib import TTFont  # type: ignore
    try:
        from fontTools.ttLib import woff2  # type: ignore
        has_woff2 = True
    except Exception:
        has_woff2 = False
except Exception:
    print("fontTools not installed. Run: pip3 install fonttools brotli", file=sys.stderr)
    sys.exit(1)

ROBOTO_CANDIDATES = [
    str(Path.home() / "Library/Fonts/Roboto-Regular.ttf"),
    "/Library/Fonts/Roboto-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Roboto-Regular.ttf",
]

BASE_FONT_CANDIDATES = [
    *ROBOTO_CANDIDATES,
    "/System/Library/Fonts/Supplemental/Roboto-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
    "/System/Library/Fonts/SFMono-Regular.otf",
]

PUA_START = 0xE000
BASE_CHARS = [chr(32 + i) for i in range(95)]  # space .. ~
EXTRA_CHARS = ["\n", "\r", "\t"]
CIPHER_ALPHABET = BASE_CHARS + EXTRA_CHARS


def find_base_font(cli_path=None):
    if cli_path:
        if os.path.exists(cli_path):
            return cli_path
        raise FileNotFoundError(f"CLI --base-font not found: {cli_path}")

    env_font = os.environ.get("CIPHER_BASE_FONT")
    if env_font:
        if os.path.exists(env_font):
            return env_font
        raise FileNotFoundError(f"CIPHER_BASE_FONT not found: {env_font}")

    for path in BASE_FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("No base font found. Update BASE_FONT_CANDIDATES.")


def pick_cmap(tt):
    for cmap in tt["cmap"].tables:
        if cmap.platformID == 3 and cmap.platEncID in (1, 10):  # Windows Unicode BMP/Full
            return cmap
    return tt["cmap"].tables[0]


def main():
    cli_font = None
    if len(sys.argv) > 1:
        # naive parse: python script.py /path/to/font or --base-font=/path
        arg = sys.argv[1]
        if arg.startswith("--base-font="):
            cli_font = arg.split("=", 1)[1]
        else:
            cli_font = arg

    repo_root = Path(__file__).resolve().parents[1]
    fonts_dir = repo_root / "public" / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)

    base_font_path = find_base_font(cli_font)
    print(f"Using base font: {base_font_path}")

    tt = TTFont(base_font_path)
    cmap_table = pick_cmap(tt)
    best_map = cmap_table.cmap

    space_glyph = best_map.get(ord(" "), ".notdef")

    for idx, ch in enumerate(CIPHER_ALPHABET):
        codepoint = PUA_START + idx
        glyph = best_map.get(ord(ch), space_glyph)
        cmap_table.cmap[codepoint] = glyph

    out_ttf = fonts_dir / "sigma-cipher.ttf"
    tt.save(out_ttf)
    print(f"Saved {out_ttf}")

    if has_woff2:
        out_woff2 = fonts_dir / "sigma-cipher.woff2"
        try:
            # fontTools >= 4.49
            woff2.compress(str(out_ttf), str(out_woff2))
        except Exception:
            # fallback: CLI-style main
            woff2.main([str(out_ttf), str(out_woff2)])
        print(f"Saved {out_woff2}")
    else:
        print("brotli/woff2 not available. Install brotli for woff2 output.")


if __name__ == "__main__":
    main()
