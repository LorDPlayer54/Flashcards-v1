"""Lot 4 : génère les icônes de l'application (dessin original : deux fiches superposées et « ENA »).
Usage facultatif (les icônes sont fournies dans public/) : python3 scripts/generate-icons.py
Nécessite Python 3 et Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent.parent / 'public'
BLUE, LIGHT, WHITE = (31, 78, 121), (156, 192, 224), (255, 255, 255)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def draw(size: int, rounded: bool) -> Image.Image:
    s = size / 512
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(96 * s), fill=BLUE)
    else:  # « maskable » et Apple : fond plein, le système applique sa propre forme
        d.rectangle([0, 0, size, size], fill=BLUE)
    d.rounded_rectangle([150 * s, 120 * s, 400 * s, 330 * s], radius=int(28 * s), fill=LIGHT)
    d.rounded_rectangle([112 * s, 180 * s, 362 * s, 390 * s], radius=int(28 * s), fill=WHITE)
    font = ImageFont.truetype(FONT, int(80 * s))
    box = d.textbbox((0, 0), 'ENA', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text((237 * s - w / 2 - box[0], 270 * s - h / 2 - box[1]), 'ENA', font=font, fill=BLUE)
    d.rounded_rectangle([172 * s, 330 * s, 302 * s, 344 * s], radius=int(7 * s), fill=LIGHT)
    return img


if __name__ == '__main__':
    draw(192, True).save(OUT / 'icon-192.png')
    draw(512, True).save(OUT / 'icon-512.png')
    draw(512, False).save(OUT / 'icon-maskable-512.png')
    draw(180, False).convert('RGB').save(OUT / 'apple-touch-icon.png')
    draw(32, True).save(OUT / 'favicon-32.png')
    print('Icônes écrites dans', OUT)
