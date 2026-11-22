"""Camera coverage diagnostics for the Golden COLMAP alignment.

Parses COLMAP sparse models (binary or text) from
datasets/golden-25.35/sparse/<model>/ without invoking COLMAP, then reports:
camera centers, bbox/centroid/distances, azimuth histogram, consecutive frame
angular steps, viewing-direction concentration, height range, and the mapping
of sorted image names to the three stills. Writes analysis/coverage-golden-diag.json
and analysis/COVERAGE.md.
"""
import glob
import hashlib
import json
import math
import os
from datetime import datetime, timezone

import numpy as np

RUN = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241"
SPARSE = os.path.join(RUN, "datasets", "golden-25.35", "sparse")
AN = os.path.join(RUN, "analysis")
STILLS = os.path.join(RUN, "jobs", "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c", "stills")

# stills 000/001/002 hash-match frames 0001/0039/0076 (computed separately)
STILL_FRAMES = {"000.jpg": "0001.jpg", "001.jpg": "0039.jpg", "002.jpg": "0076.jpg"}


def qvec_to_rotmat(qw, qx, qy, qz):
    """COLMAP quaternion (world-to-camera) -> 3x3 rotation matrix."""
    n = math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    qw, qx, qy, qz = qw / n, qx / n, qy / n, qz / n
    return np.array([
        [1 - 2 * qy * qy - 2 * qz * qz, 2 * qx * qy - 2 * qw * qz, 2 * qz * qx + 2 * qw * qy],
        [2 * qx * qy + 2 * qw * qz, 1 - 2 * qz * qz - 2 * qx * qx, 2 * qy * qz - 2 * qw * qx],
        [2 * qz * qx - 2 * qw * qy, 2 * qy * qz + 2 * qw * qx, 1 - 2 * qx * qx - 2 * qy * qy],
    ])


def parse_images_bin(path):
    with open(path, "rb") as f:
        buf = f.read()
    off = 0

    def u64():
        nonlocal off
        v = int.from_bytes(buf[off:off + 8], "little")
        off += 8
        return v

    def i32():
        nonlocal off
        v = int.from_bytes(buf[off:off + 4], "little", signed=True)
        off += 4
        return v

    def f64():
        nonlocal off
        v = float(np.frombuffer(buf[off:off + 8], dtype="<f8")[0])
        off += 8
        return v

    n = u64()
    out = []
    for _ in range(n):
        image_id = i32()
        q = [f64() for _ in range(4)]
        t = [f64() for _ in range(3)]
        camera_id = i32()
        end = buf.index(b"\x00", off)
        name = buf[off:end].decode("utf-8", "replace")
        off = end + 1
        npts = u64()
        off += 24 * npts
        out.append({"image_id": image_id, "qvec": q, "tvec": t,
                    "camera_id": camera_id, "name": name, "num_points2D": npts})
    return out, len(buf) - off


def parse_images_txt(path):
    out = []
    with open(path, "r", encoding="utf-8") as f:
        lines = [ln.strip() for ln in f]
    i = 0
    while i < len(lines):
        ln = lines[i]
        i += 1
        if not ln or ln.startswith("#"):
            continue
        p = ln.split()
        if len(p) < 10:
            continue
        try:
            image_id = int(p[0])
            q = [float(p[1]), float(p[2]), float(p[3]), float(p[4])]
            t = [float(p[5]), float(p[6]), float(p[7])]
            camera_id = int(p[8])
            name = p[9]
        except ValueError:
            continue
        i += 1  # skip POINTS2D line
        out.append({"image_id": image_id, "qvec": q, "tvec": t,
                    "camera_id": camera_id, "name": name, "num_points2D": None})
    return out, 0


def parse_points3d_bin(path):
    with open(path, "rb") as f:
        buf = f.read()
    off = 0

    def u64():
        nonlocal off
        v = int.from_bytes(buf[off:off + 8], "little")
        off += 8
        return v

    n = u64()
    pts = np.empty((n, 3), dtype=np.float64)
    err = np.empty(n, dtype=np.float64)
    for i in range(n):
        off += 8  # id
        pts[i] = np.frombuffer(buf[off:off + 24], dtype="<f8")
        off += 24
        off += 3  # rgb
        err[i] = float(np.frombuffer(buf[off:off + 8], dtype="<f8")[0])
        off += 8
        m = u64()
        off += 8 * m  # track entries: int32 image_id, int32 point2d_idx
    return pts, err


def find_models():
    models = []
    for d in sorted(glob.glob(os.path.join(SPARSE, "*"))):
        if not os.path.isdir(d):
            continue
        rec = {"dir": os.path.relpath(d, RUN), "imagesBin": None, "imagesTxt": None,
               "mtime": os.path.getmtime(d), "files": {}}
        for name in ("images.bin", "images.txt", "cameras.bin", "cameras.txt",
                     "points3D.bin", "points3D.txt", "frames.bin", "rigs.bin"):
            p = os.path.join(d, name)
            if os.path.exists(p):
                rec["files"][name] = {"bytes": os.path.getsize(p),
                                      "mtime": datetime.fromtimestamp(
                                          os.path.getmtime(p), tz=timezone.utc).isoformat()}
        if os.path.exists(os.path.join(d, "images.bin")):
            rec["imagesBin"] = os.path.join(d, "images.bin")
        if os.path.exists(os.path.join(d, "images.txt")):
            rec["imagesTxt"] = os.path.join(d, "images.txt")
        if rec["imagesBin"] or rec["imagesTxt"]:
            models.append(rec)
    return models


def parse_model(rec):
    if rec["imagesTxt"]:
        imgs, leftover = parse_images_txt(rec["imagesTxt"])
        fmt = "images.txt"
    else:
        imgs, leftover = parse_images_bin(rec["imagesBin"])
        fmt = "images.bin"
    return imgs, leftover, fmt


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def circular_stats(deg):
    """mean resultant length and mean direction for angles in degrees."""
    rad = np.deg2rad(deg)
    C, S = np.cos(rad).mean(), np.sin(rad).mean()
    R = float(np.hypot(C, S))
    mean = float(np.rad2deg(math.atan2(S, C)) % 360.0)
    return R, mean


def wrap180(a):
    return (a + 180.0) % 360.0 - 180.0


def analyse_model(rec, imgs):
    names = [im["name"] for im in imgs]
    qnorm_dev = max(abs(np.linalg.norm(im["qvec"]) - 1.0) for im in imgs) if imgs else 0.0
    ok_names = all(all(32 <= ord(c) < 127 for c in n) for n in names) if names else False
    centers, fwds, rows = [], [], []
    for im in imgs:
        qw, qx, qy, qz = im["qvec"]
        R = qvec_to_rotmat(qw, qx, qy, qz)
        t = np.array(im["tvec"])
        C = -R.T @ t
        f = R.T @ np.array([0.0, 0.0, 1.0])
        centers.append(C)
        fwds.append(f)
        rows.append({"image_id": im["image_id"], "name": im["name"],
                     "camera_id": im["camera_id"],
                     "center": C.tolist(), "forward": f.tolist(),
                     "num_points2D": im["num_points2D"]})
    C = np.array(centers)
    F = np.array(fwds)
    centroid = C.mean(axis=0)
    lo, hi = C.min(axis=0), C.max(axis=0)
    dist = np.linalg.norm(C - centroid, axis=1)
    az = np.degrees(np.arctan2(C[:, 0] - centroid[0], C[:, 2] - centroid[2])) % 360.0
    elev = np.degrees(np.arctan2(C[:, 1] - centroid[1],
                                 np.hypot(C[:, 0] - centroid[0], C[:, 2] - centroid[2])))
    # viewing direction azimuth/elevation
    fwd_az = np.degrees(np.arctan2(F[:, 0], F[:, 2])) % 360.0
    fwd_el = np.degrees(np.arcsin(np.clip(F[:, 1], -1, 1)))
    # 12 bins of 30 deg, offset so bin 0 = [0,30)
    hist, edges = np.histogram(az, bins=12, range=(0, 360))
    occupied = int((hist > 0).sum())
    # order by sorted name (numeric frame order)
    order = np.argsort(np.array(names))
    C_s, az_s = C[order], az[order]
    steps = np.array([abs(wrap180(az[order[i + 1]] - az[order[i]]))
                      for i in range(len(order) - 1)])
    step_dist = np.linalg.norm(np.diff(C_s, axis=0), axis=1)
    norm_names = list(np.array(names)[order])
    # per-frame table ordered by name
    order_rows = [rows[i] for i in order]
    # still mapping
    stills = {}
    reg = {im["name"]: rows[i] for i, im in enumerate(imgs)}
    reg_idx = {im["name"]: i for i, im in enumerate(imgs)}
    for still, fname in STILL_FRAMES.items():
        if fname in reg:
            r = reg[fname]
            j = list(np.array(names)[order]).index(fname)
            stills[still] = {"frame": fname, "registered": True,
                             "rank": j, "center": r["center"],
                             "azimuthDeg": float(az[reg_idx[fname]]),
                             "elevationDeg": float(elev[reg_idx[fname]]),
                             "distanceToCentroid": float(dist[reg_idx[fname]])}
        else:
            # nearest registered by numeric suffix
            want = int(os.path.splitext(fname)[0])
            cand = [(abs(int(os.path.splitext(n)[0]) - want), n) for n in names
                    if os.path.splitext(n)[0].isdigit()]
            cand.sort()
            stills[still] = {"frame": fname, "registered": False,
                             "nearestRegistered": cand[0][1] if cand else None,
                             "nearestFrameDistance": cand[0][0] if cand else None}
    R_az, mean_az = circular_stats(az)
    R_fwd, mean_fwd_az = circular_stats(fwd_az)
    mean_fwd = F.mean(axis=0)
    mean_fwd_norm = float(np.linalg.norm(mean_fwd))
    mean_fwd_dir = (mean_fwd / mean_fwd_norm).tolist() if mean_fwd_norm > 1e-9 else None

    # ---- supplementary: coverage measured around the reconstructed subject
    # (sparse 3D-point centroid) instead of the camera-path centroid
    subject = None
    p3 = os.path.join(RUN, rec["dir"], "points3D.bin")
    if os.path.exists(p3):
        pts, err = parse_points3d_bin(p3)
        if len(pts):
            sc = np.median(pts, axis=0)
            d = np.linalg.norm(pts - sc, axis=1)
            r_robust = float(np.percentile(d, 99))
            cd = np.linalg.norm(C - sc, axis=1)
            az2 = np.degrees(np.arctan2(C[:, 0] - sc[0], C[:, 2] - sc[2])) % 360.0
            el2 = np.degrees(np.arctan2(C[:, 1] - sc[1],
                                        np.hypot(C[:, 0] - sc[0], C[:, 2] - sc[2])))
            h2, e2 = np.histogram(az2, bins=12, range=(0, 360))
            R2, m2 = circular_stats(az2)
            subject = {
                "pointCount": int(len(pts)),
                "points3DMedianCenter": sc.tolist(),
                "points3DRobustRadiusP99": r_robust,
                "meanReprojectionError": float(err.mean()),
                "cameraDistanceToSubject": {
                    "min": float(cd.min()), "median": float(np.median(cd)),
                    "max": float(cd.max()),
                    "medianOverSubjectRadius": float(np.median(cd) / r_robust),
                },
                "azimuthAroundSubject": {
                    "convention": "deg = atan2(x - sx, z - sz) mod 360 around sparse-point median center",
                    "histogram12bins30deg": {
                        "binStartDeg": [float(e) for e in e2[:-1]],
                        "counts": [int(x) for x in h2],
                        "binsOccupied": int((h2 > 0).sum()),
                        "fractionBinsOccupied": float((h2 > 0).sum() / 12.0),
                    },
                    "circularMeanResultantLength": R2,
                    "circularMeanDirectionDeg": m2,
                },
                "cameraElevationAroundSubjectDeg": {
                    "min": float(el2.min()), "max": float(el2.max()),
                    "median": float(np.median(el2)),
                },
            }

    return {
        "registeredImages": len(imgs),
        "imageNames": names,
        "format": rec.get("format"),
        "qnormMaxDeviation": float(qnorm_dev),
        "namesAsciiPrintable": ok_names,
        "leftoverBytes": rec.get("leftover"),
        "cameraCenters": {
            "bboxMin": lo.tolist(), "bboxMax": hi.tolist(),
            "bboxSize": (hi - lo).tolist(),
            "centroid": centroid.tolist(),
            "distanceToCentroid": {
                "min": float(dist.min()), "median": float(np.median(dist)),
                "mean": float(dist.mean()), "max": float(dist.max()),
                "p10": float(np.percentile(dist, 10)),
                "p90": float(np.percentile(dist, 90)),
            },
        },
        "azimuth": {
            "convention": "deg = atan2(x - cx, z - cz) mod 360; 0 deg = +Z from centroid, "
                          "90 deg = +X; measured in the XZ plane",
            "min": float(az.min()), "max": float(az.max()),
            "circularMeanResultantLength": R_az,
            "circularMeanDirectionDeg": mean_az,
            "histogram12bins30deg": {
                "binStartDeg": [float(e) for e in edges[:-1]],
                "counts": [int(x) for x in hist],
                "binsOccupied": occupied,
                "fractionBinsOccupied": occupied / 12.0,
            },
            "consecutiveFrameAngularStepDeg": {
                "median": float(np.median(steps)), "p90": float(np.percentile(steps, 90)),
                "max": float(steps.max()), "mean": float(steps.mean()),
                "min": float(steps.min()),
                "countZeroSteps": int((steps < 1e-6).sum()),
            },
        },
        "viewingDirection": {
            "concentrationMeanResultantLength3D": mean_fwd_norm,
            "meanDirection": mean_fwd_dir,
            "meanAzimuthDeg": mean_fwd_az,
            "azimuthCircularResultantLength": R_fwd,
            "elevationDeg": {
                "min": float(fwd_el.min()), "max": float(fwd_el.max()),
                "median": float(np.median(fwd_el)),
            },
        },
        "heightY": {
            "min": float(C[:, 1].min()), "max": float(C[:, 1].max()),
            "range": float(C[:, 1].max() - C[:, 1].min()),
            "median": float(np.median(C[:, 1])),
        },
        "cameraElevationAroundCentroidDeg": {
            "min": float(elev.min()), "max": float(elev.max()),
            "median": float(np.median(elev)),
        },
        "consecutiveFrameCenterStep": {
            "median": float(np.median(step_dist)),
            "p90": float(np.percentile(step_dist, 90)),
            "max": float(step_dist.max()),
        },
        "stills": stills,
        "framesOrdered": [{"name": r["name"], "azimuthDeg": float(az[names.index(r["name"])]),
                           "center": r["center"]} for r in order_rows],
        "subjectRelative": subject,
    }


def main():
    models = find_models()
    scanned = []
    parsed = []
    for rec in models:
        imgs, leftover, fmt = parse_model(rec)
        rec2 = dict(rec)
        rec2["format"] = fmt
        rec2["leftover"] = leftover
        rec2["parsedImages"] = len(imgs)
        scanned.append(rec2)
        if imgs:
            parsed.append((rec2, imgs))
    if not parsed:
        print("NO MODEL YET")
        return 2
    # choose the model with the highest registered count, newest dir mtime as tiebreak
    parsed.sort(key=lambda x: (x[0]["parsedImages"], x[0]["mtime"]), reverse=True)
    rec, imgs = parsed[0]
    res = analyse_model(rec, imgs)
    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": "COLMAP sparse model under datasets/golden-25.35/sparse (parsed directly; no COLMAP invoked)",
        "sparseDir": os.path.relpath(SPARSE, RUN),
        "modelsScanned": [{
            "dir": m["dir"], "format": m["format"], "parsedImages": m["parsedImages"],
            "files": m["files"]} for m in scanned],
        "chosenModel": {"dir": rec["dir"], "format": rec["format"],
                        "registeredImages": rec["parsedImages"],
                        "files": rec["files"],
                        # cheap identity of the chosen model files
                        "sha256": {k: sha256_file(os.path.join(RUN, rec["dir"], k))
                                   for k in rec["files"] if k in ("images.bin", "images.txt")}},
        "coverage": res,
    }
    with open(os.path.join(AN, "coverage-golden-diag.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({"chosenModel": out["chosenModel"]["dir"],
                      "registered": res["registeredImages"],
                      "qnormDev": res["qnormMaxDeviation"],
                      "namesAscii": res["namesAsciiPrintable"],
                      "leftover": res["leftoverBytes"],
                      "centroid": res["cameraCenters"]["centroid"],
                      "bbox": res["cameraCenters"]["bboxSize"],
                      "distRange": [res["cameraCenters"]["distanceToCentroid"]["min"],
                                    res["cameraCenters"]["distanceToCentroid"]["max"]],
                      "azBins": res["azimuth"]["histogram12bins30deg"]["counts"],
                      "binsOccupied": res["azimuth"]["histogram12bins30deg"]["binsOccupied"],
                      "azResultant": res["azimuth"]["circularMeanResultantLength"],
                      "stepsMedian": res["azimuth"]["consecutiveFrameAngularStepDeg"]["median"],
                      "stepsP90": res["azimuth"]["consecutiveFrameAngularStepDeg"]["p90"],
                      "viewConc": res["viewingDirection"]["concentrationMeanResultantLength3D"],
                      "viewAz": res["viewingDirection"]["meanAzimuthDeg"],
                      "heightRange": res["heightY"]["range"],
                      "stills": res["stills"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
