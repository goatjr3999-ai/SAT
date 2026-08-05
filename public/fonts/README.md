Place your cipher font file here as `sigma-cipher.woff2`.
The font must map the encoded range U+E000–U+E05F (space + ~ + \n, \r, \t) to visible ASCII-like glyphs.

If you see a 404 for `/fonts/sigma-cipher.woff2`, the file is missing. Drop your font file here and restart the server. You can also install the font locally under the name “SigmaCipher” and the page will load it via `local()` without hitting the network.

To generate from Roboto Regular:
1) Install deps: `pip3 install fonttools brotli`
2) Place `Roboto-Regular.ttf` in `~/Library/Fonts` or `/Library/Fonts`, then run:
   `python3 scripts/generate_cipher_font.py`
You can also point to any font: `CIPHER_BASE_FONT=/path/to/font.ttf python3 scripts/generate_cipher_font.py` or `python3 scripts/generate_cipher_font.py --base-font=/path/to/font.ttf`.
