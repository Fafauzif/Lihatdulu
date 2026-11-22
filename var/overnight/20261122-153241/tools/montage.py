"""Build a labelled contact sheet from images (Pillow).

Usage: python montage.py out.jpg cols width label=path [label=path ...]
Each tile is scaled to the requested width, labelled at the top-left.
"""
import sys

from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1]
cols = int(sys.argv[2])
tile_width = int(sys.argv[3])
entries = []
for item in sys.argv[4:]:
    label, _, path = item.partition("=")
    entries.append((label, path))

font = ImageFont.load_default(size=max(12, tile_width // 22))
label_height = max(18, tile_width // 14)
tiles = []
for label, path in entries:
    image = Image.open(path).convert("RGB")
    ratio = tile_width / image.width
    image = image.resize((tile_width, max(1, round(image.height * ratio))), Image.LANCZOS)
    padded = Image.new("RGB", (image.width, image.height + label_height), (20, 20, 20))
    padded.paste(image, (0, label_height))
    draw = ImageDraw.Draw(padded)
    draw.text((6, 3), label, fill=(255, 240, 160), font=font)
    tiles.append(padded)

rows = (len(tiles) + cols - 1) // cols
row_heights = [
    max(tile.height for tile in tiles[row * cols : (row + 1) * cols])
    for row in range(rows)
]
sheet_width = cols * tile_width
sheet_height = sum(row_heights)
sheet = Image.new("RGB", (sheet_width, sheet_height), (12, 12, 12))
y = 0
for row in range(rows):
    row_tiles = tiles[row * cols : (row + 1) * cols]
    for index, tile in enumerate(row_tiles):
        sheet.paste(tile, (index * tile_width, y))
    y += row_heights[row]
sheet.save(out, quality=88)
print(f"{out} {sheet.width}x{sheet.height}")
