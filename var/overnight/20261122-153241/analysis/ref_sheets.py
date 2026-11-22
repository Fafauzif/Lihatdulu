"""Reference sheets for the LihatDulu overnight run (Pillow only)."""
import glob
import json
import os

from PIL import Image, ImageDraw, ImageFont, ImageOps

RUN = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241"
REF = os.path.join(RUN, "comparisons", "reference")
SCANS = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\scans"
os.makedirs(REF, exist_ok=True)

TAKES = [
    ("golden",         "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c", "Golden 25.35 s", "tuning", 25.35),
    ("repeat",         "a3e551df-7e05-4d0c-8146-d2a686a8d30a", "Repeat 20.13 s", "confirmation", 20.13),
    ("stress-10.03",   "f4755525-a4e8-4eb8-a279-5b8adb45c6ad", "10.03 s", "stress", 10.03),
    ("sweep-10.21",    "15d33c98-46e5-4bb0-90dc-bbe86ffc21f9", "10.21 s", "sweep", 10.21),
    ("sweep-14.59",    "bb588361-7337-490d-9dbf-2ce9492ca3b1", "14.59 s", "sweep", 14.59),
    ("sweep-15.00",    "e8d4c2a3-e898-422e-9d83-a9f2dd1b6cbe", "15.00 s", "sweep", 15.00),
    ("sweep-4k-14.62", "37a5694c-e960-46d2-84cb-38eafdb4f134", "4K 14.62 s", "sweep", 14.62),
]

FONT_PATHS = [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"]
FONT_BOLD = [r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"]


def font(size, bold=False):
    for p in (FONT_BOLD if bold else FONT_PATHS):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:  # noqa: BLE001
                pass
    return ImageFont.load_default()


def load(path, w):
    im = Image.open(path)
    im = ImageOps.exif_transpose(im).convert("RGB")
    h = int(round(im.height * w / im.width))
    return im.resize((w, h), Image.LANCZOS)


def text_size(draw, s, f):
    b = draw.textbbox((0, 0), s, font=f)
    return b[2] - b[0], b[3] - b[1]


def take_counts():
    out = {}
    with open(os.path.join(RUN, "analysis", "spz-stats.json"), "r", encoding="utf-8") as f:
        d = json.load(f)
    for t in d["takes"]:
        out[t["key"]] = t["count"]
    return out


def per_take_sheet(key, jid, name, role, dur, n, cell_w=470, margin=14):
    sd = os.path.join(RUN, "jobs", jid, "stills")
    paths = sorted(glob.glob(os.path.join(sd, "*.jpg")))
    height = int(round(cell_w * 2276 / 1280))
    f_hdr, f_lbl = font(26, True), font(17)
    head_h, cap_h = 40, 44
    W = margin * 2 + cell_w * 3 + 8 * 2
    H = margin + head_h + height + cap_h + margin
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    dr = ImageDraw.Draw(canvas)
    dr.text((margin, margin + 4), "%s  -  %s  -  %.2f s  -  %d splats" %
            (name, role, dur, n), font=f_hdr, fill=(255, 255, 255))
    for i, p in enumerate(paths[:3]):
        im = load(p, cell_w)
        x = margin + i * (cell_w + 8)
        y = margin + head_h
        canvas.paste(im, (x, y))
        dr.rectangle([x - 1, y - 1, x + cell_w, y + height], outline=(90, 90, 95))
        lbl = "still %03d" % i
        dr.text((x + 2, y + height + 12), lbl, font=f_lbl, fill=(210, 210, 210))
    out = os.path.join(REF, "ref-%s.jpg" % key)
    canvas.save(out, quality=88, optimize=True)
    return out, canvas.size


def combined_sheet(counts, cell_w=300):
    height = int(round(cell_w * 2276 / 1280))
    f_row, f_lbl = font(19, True), font(13)
    left_w = 210
    margin, gap, cap_h = 12, 6, 22
    W = margin * 2 + left_w + cell_w * 3 + gap * 3
    rowh = height + cap_h
    H = margin * 2 + 34 + rowh * len(TAKES) + gap * (len(TAKES) - 1)
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    dr = ImageDraw.Draw(canvas)
    dr.text((margin, margin + 4), "LihatDulu overnight 20261122-153241 - all 7 takes (3 stills each, camera stills, not renders)",
            font=font(17, True), fill=(255, 255, 255))
    y0 = margin + 34
    for r, (key, jid, name, role, dur) in enumerate(TAKES):
        y = y0 + r * (rowh + gap)
        # row label block
        dr.rectangle([margin, y, margin + left_w - 8, y + height], fill=(38, 38, 42))
        dr.text((margin + 8, y + 10), name, font=f_row, fill=(255, 255, 255))
        dr.text((margin + 8, y + 38), role, font=f_lbl, fill=(180, 180, 185))
        dr.text((margin + 8, y + 58), "%.2f s" % dur, font=f_lbl, fill=(180, 180, 185))
        dr.text((margin + 8, y + 78), "%d splats" % counts.get(key, -1), font=f_lbl, fill=(180, 180, 185))
        dr.text((margin + 8, y + 104), key, font=f_lbl, fill=(130, 130, 135))
        sd = os.path.join(RUN, "jobs", jid, "stills")
        paths = sorted(glob.glob(os.path.join(sd, "*.jpg")))
        for i, p in enumerate(paths[:3]):
            x = margin + left_w + i * (cell_w + gap)
            canvas.paste(load(p, cell_w), (x, y))
            dr.rectangle([x - 1, y - 1, x + cell_w, y + height], outline=(80, 80, 85))
            dr.text((x + 2, y + height + 5), "%s still %03d" % (key, i), font=f_lbl, fill=(200, 200, 205))
    out = os.path.join(REF, "ref-all-takes.jpg")
    canvas.save(out, quality=85, optimize=True)
    return out, canvas.size


def frame_montage(key, job_id, label, cols=3, rows=4, cell_w=300):
    fdir = os.path.join(SCANS, job_id, "frames")
    files = sorted(glob.glob(os.path.join(fdir, "*.jpg")) + glob.glob(os.path.join(fdir, "*.png")))
    if not files:
        return None, None
    n = cols * rows
    if len(files) <= n:
        picks = files
    else:
        step = (len(files) - 1) / (n - 1)
        picks = [files[int(round(i * step))] for i in range(n)]
    im0 = Image.open(picks[0])
    ar = im0.height / im0.width
    height = int(round(cell_w * ar))
    f_hdr, f_lbl = font(22, True), font(13)
    margin, gap, cap_h = 12, 6, 20
    W = margin * 2 + cols * cell_w + (cols - 1) * gap
    H = margin * 2 + 32 + rows * (height + cap_h) + (rows - 1) * gap
    canvas = Image.new("RGB", (W, H), (24, 24, 26))
    dr = ImageDraw.Draw(canvas)
    dr.text((margin, margin + 2), "%s - 12 of %d frames sampled evenly" %
            (label, len(files)), font=f_hdr, fill=(255, 255, 255))
    for i, p in enumerate(picks):
        r, c = divmod(i, cols)
        x = margin + c * (cell_w + gap)
        y = margin + 32 + r * (height + cap_h + gap)
        canvas.paste(load(p, cell_w), (x, y))
        dr.rectangle([x - 1, y - 1, x + cell_w, y + height], outline=(80, 80, 85))
        dr.text((x + 2, y + height + 4), os.path.basename(p), font=f_lbl, fill=(205, 205, 210))
    out = os.path.join(REF, "ref-%s-frames.jpg" % key)
    canvas.save(out, quality=85, optimize=True)
    return out, canvas.size


def main():
    counts = take_counts()
    made = []
    for key, jid, name, role, dur in TAKES:
        out, size = per_take_sheet(key, jid, name, role, dur, counts.get(key, -1))
        made.append((out, size))
        print("wrote", out, size)
    out, size = combined_sheet(counts)
    made.append((out, size))
    print("wrote", out, size)
    for key, jid, label in (("golden", "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c", "Golden 25.35 s camera frames"),
                            ("stress", "f4755525-a4e8-4eb8-a279-5b8adb45c6ad", "10.03 s stress camera frames")):
        out, size = frame_montage(key, jid, label)
        if out:
            print("wrote", out, size)
        else:
            print("NO FRAMES for", key)
    with open(os.path.join(RUN, "qa", "diag", "reference-sheets.json"), "w", encoding="utf-8") as f:
        json.dump({"sheets": [{"path": os.path.relpath(p, RUN), "size": list(s)} for p, s in made]}, f, indent=2)


if __name__ == "__main__":
    main()
