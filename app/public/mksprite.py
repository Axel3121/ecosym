"""Gjør genererte bilder om til ekte sprites: beskjær, fjern svart, krymp hardt."""
from PIL import Image
import sys

def make(src, dst, h):
    im = Image.open(src).convert("RGBA")
    px = im.load()
    w0, h0 = im.size

    # finn figurens boks — alt som ikke er nesten-svart
    x0, y0, x1, y1 = w0, h0, 0, 0
    for y in range(h0):
        for x in range(w0):
            r, g, b, _ = px[x, y]
            if r + g + b > 70:
                x0, y0 = min(x0, x), min(y0, y)
                x1, y1 = max(x1, x), max(y1, y)
    if x1 <= x0:
        print(f"{src}: fant ingen figur")
        return

    im = im.crop((x0, y0, x1 + 1, y1 + 1))

    # skaler til ønsket høyde, NEAREST for harde piksler
    ratio = im.width / im.height
    im = im.resize((max(1, round(h * ratio)), h), Image.NEAREST)

    # svart -> gjennomsiktig
    im = im.convert("RGBA")
    d = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = d[x, y]
            if r + g + b < 60:
                d[x, y] = (0, 0, 0, 0)

    im.save(dst)
    print(f"{dst}  {im.size}")

make("axey-raw.png", "axey.png", 34)
make("crew-raw.png", "crew.png", 22)
