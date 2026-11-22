"""LihatDulu overnight diag: fixture verification + SPZ statistics + transform displacement.

Reads only fixtures under jobs/* and CSVs/stats produced in analysis/.
Writes analysis/spz-stats.json, analysis/SPZ_STATS.md, analysis/fixtures.md,
analysis/fixtures.json, analysis/transform-displacement.json.
"""
import json
import math
import os
import struct
from datetime import datetime, timezone

import numpy as np
import pandas as pd

RUN = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241"
AN = os.path.join(RUN, "analysis")
CSVD = os.path.join(AN, "csv")
STATSD = os.path.join(AN, "stats")

# take key -> (job id, role, label duration from TAKE MAP, notes)
TAKES = [
    ("golden",        "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c", "Golden 25.35 s (tuning)",     25.35),
    ("repeat",        "a3e551df-7e05-4d0c-8146-d2a686a8d30a", "Repeat 20.13 s (confirmation)", 20.13),
    ("stress-10.03",  "f4755525-a4e8-4eb8-a279-5b8adb45c6ad", "10.03 s stress",              10.03),
    ("sweep-10.21",   "15d33c98-46e5-4bb0-90dc-bbe86ffc21f9", "10.21 s sweep",               10.21),
    ("sweep-14.59",   "bb588361-7337-490d-9dbf-2ce9492ca3b1", "14.59 s sweep",               14.59),
    ("sweep-15.00",   "e8d4c2a3-e898-422e-9d83-a9f2dd1b6cbe", "15.00 s sweep",               15.00),
    ("sweep-4k-14.62","37a5694c-e960-46d2-84cb-38eafdb4f134", "4K 14.62 s sweep",            14.62),
]

PCTS = [0.1, 1, 5, 10, 25, 50, 75, 90, 95, 99, 99.5, 99.9]


def pct(a, q):
    return float(np.percentile(a, q))


def pct_dict(a, qs=PCTS):
    return {("%g" % q): pct(a, q) for q in qs}


def sigmoid(x):
    return 0.5 * (1.0 + np.tanh(0.5 * x))


def read_spz_header(path):
    """SPZ: uint32 magic(0x5053474e 'NGSP'), uint32 version, uint32 numPoints,
    uint8 shDegree, uint8 fractionalBits, uint8 flags, uint8 reserved."""
    with open(path, "rb") as f:
        b = f.read(16)
    magic, version, n, shdegree, fracbits, flags, reserved = struct.unpack("<IIIBBBB", b[:16])
    return dict(magic=hex(magic), version=version, numPoints=n, shDegree=shdegree,
                fractionalBits=fracbits, flags=flags, reserved=reserved,
                bytes=os.path.getsize(path))


def verify_fixtures():
    rows = []
    out = {"generatedAt": datetime.now(timezone.utc).isoformat(), "takes": []}
    for key, jid, label, dur in TAKES:
        jdir = os.path.join(RUN, "jobs", jid)
        jpath = os.path.join(jdir, "job.json")
        rec = {"key": key, "jobId": jid, "label": label, "takeDurationS": dur,
               "jobJsonPath": os.path.relpath(jpath, RUN)}
        job = None
        try:
            with open(jpath, "r", encoding="utf-8") as f:
                job = json.load(f)
            rec["jobJsonParses"] = True
        except Exception as e:  # noqa: BLE001
            rec["jobJsonParses"] = False
            rec["jobJsonError"] = repr(e)
        spz = os.path.join(jdir, "output", "scan.spz")
        actual_bytes = os.path.getsize(spz) if os.path.exists(spz) else None
        rec["spzPath"] = os.path.relpath(spz, RUN)
        rec["spzBytes"] = actual_bytes
        hdr = read_spz_header(spz) if actual_bytes else None
        rec["spzHeader"] = hdr
        # csv line count (== splats after --filter-nan)
        csvp = os.path.join(CSVD, key + ".csv")
        csv_lines = None
        csv_rows = None
        if os.path.exists(csvp):
            with open(csvp, "rb") as f:
                # count newlines cheaply
                n = 0
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    n += chunk.count(b"\n")
            csv_lines = n
            csv_rows = n - 1
        rec["csvRows"] = csv_rows
        # stills
        stills = []
        sd = os.path.join(jdir, "stills")
        if os.path.isdir(sd):
            for name in sorted(os.listdir(sd)):
                if name.lower().endswith((".jpg", ".jpeg", ".png")):
                    p = os.path.join(sd, name)
                    stills.append({"name": name, "bytes": os.path.getsize(p)})
        rec["stills"] = stills
        ok = []
        if job:
            art = job.get("artifact", {}) or {}
            rec["jobArtifact"] = art
            rec["jobMedia"] = job.get("media", {})
            rec["jobMeta"] = job.get("meta", {})
            prov = job.get("provenance", {}) or {}
            rec["jobFrames"] = (prov.get("frames") or {})
            rec["jobTimings"] = (prov.get("timings") or {})
            rec["jobStage"] = job.get("stage")
            rec["jobError"] = job.get("error")
            declared_bytes = art.get("bytes")
            declared_count = art.get("splatCount")
            rec["declaredBytes"] = declared_bytes
            rec["declaredSplatCount"] = declared_count
            rec["bytesMatch"] = (declared_bytes == actual_bytes)
            # plausibility: splatCount vs header numPoints and csv rows
            rec["countMatchesHeader"] = (hdr is not None and declared_count == hdr["numPoints"])
            rec["countMatchesCsv"] = (declared_count == csv_rows)
            # bytes/splat consistency vs SPZ version expected footprint
            rec["bytesPerSplat"] = round(actual_bytes / declared_count, 4) if declared_count else None
            rec["stillsMatch"] = [s["name"] for s in stills] == list(art.get("stills") or [])
            rec["artifactFile"] = art.get("file")
            ok = [rec["bytesMatch"], rec["countMatchesHeader"], rec["countMatchesCsv"],
                  rec["stillsMatch"], len(stills) == 3]
        rec["pass"] = all(ok)
        out["takes"].append(rec)
        rows.append(rec)
    out["allPass"] = all(r["pass"] for r in out["takes"])
    return out


def analyse_take(key, jid, label, dur):
    stats_path = os.path.join(STATSD, key + ".json")
    with open(stats_path, "r", encoding="utf-8") as f:
        stj = json.load(f)
    cols = stj["stats"][0]["columns"]
    ci = {c: i for i, c in enumerate(cols)}
    data = stj["stats"][0]["data"]

    usecols = ["x", "y", "z", "scale_0", "scale_1", "scale_2", "opacity"]
    df = pd.read_csv(os.path.join(CSVD, key + ".csv"), usecols=usecols)
    df = df[np.isfinite(df[usecols]).all(axis=1)].reset_index(drop=True)
    n = int(len(df))
    P = df[["x", "y", "z"]].to_numpy(np.float64)
    Sraw = df[["scale_0", "scale_1", "scale_2"]].to_numpy(np.float64)
    Oraw = df["opacity"].to_numpy(np.float64)

    # ---- encoding verification: cross-check CSV column against --stats tool ----
    def rel(a, b):
        return float(abs(a - b) / max(abs(b), 1e-12))

    s0_lin = np.exp(Sraw[:, 0])
    enc = {
        "positions": {
            "csvMin": [float(P.min(axis=0)[i]) for i in range(3)],
            "statsMin": [float(data["min"][ci[c]]) for c in ("x", "y", "z")],
            "matches": all(rel(float(P.min(axis=0)[i]), float(data["min"][ci[c]])) < 1e-6
                           for i, c in enumerate(("x", "y", "z"))),
        },
        "scale0_statsMedian": float(data["median"][ci["scale_0"]]),
        "scale0_csvMedian_raw": float(np.median(Sraw[:, 0])),
        "scale0_csvMedian_exp": float(np.exp(np.median(Sraw[:, 0]))),
        "scale0_statsMin": float(data["min"][ci["scale_0"]]),
        "scale0_csvMin_raw": float(Sraw[:, 0].min()),
        "scale0_csvMin_exp": float(np.exp(Sraw[:, 0].min())),
        "scale0_statsMax": float(data["max"][ci["scale_0"]]),
        "scale0_csvMax_raw": float(Sraw[:, 0].max()),
        "scale0_csvMax_exp": float(np.exp(Sraw[:, 0].max())),
        "opacity_statsMedian": float(data["median"][ci["opacity"]]),
        "opacity_csvMedian_raw": float(np.median(Oraw)),
        "opacity_csvMedian_sigmoid": float(np.median(sigmoid(Oraw))),
        "opacity_statsMin": float(data["min"][ci["opacity"]]),
        "opacity_csvMin_sigmoid": float(sigmoid(Oraw.min())),
        "opacity_statsMax": float(data["max"][ci["opacity"]]),
        "opacity_csvMax_sigmoid": float(sigmoid(Oraw.max())),
    }
    # scale columns are log iff exp(raw csv) reproduces stats' median/min/max scale_0
    enc["scaleIsLogConfirmed"] = bool(
        rel(enc["scale0_csvMedian_exp"], enc["scale0_statsMedian"]) < 0.02
        and rel(enc["scale0_csvMin_exp"], enc["scale0_statsMin"]) < 0.02
        and rel(enc["scale0_csvMax_exp"], enc["scale0_statsMax"]) < 0.02
        and rel(enc["scale0_csvMedian_raw"], enc["scale0_statsMedian"]) > 0.2)
    enc["opacityIsLogitConfirmed"] = bool(
        rel(enc["opacity_csvMedian_sigmoid"], enc["opacity_statsMedian"]) < 0.02
        and rel(enc["opacity_csvMax_sigmoid"], enc["opacity_statsMax"]) < 0.02)
    # alpha 8-bit grid check: sigmoid(logit)*255 should be near-integers if alpha is
    # stored as an 8-bit linear (0..1) value in SPZ and read back as logit.
    a8 = sigmoid(Oraw) * 255.0
    enc["alphaGridMeanAbsResidual"] = float(np.mean(np.abs(a8 - np.round(a8))))
    enc["alphaGrid99AbsResidual"] = float(np.percentile(np.abs(a8 - np.round(a8)), 99))
    enc["alphaGridIs8Bit"] = bool(enc["alphaGrid99AbsResidual"] < 1e-3)

    # ---- positions / box ----
    pos = {}
    axes = {}
    for i, ax in enumerate("xyz"):
        v = P[:, i]
        axes[ax] = {
            "min": float(v.min()), "max": float(v.max()), **pct_dict(v),
            "mean": float(v.mean()), "std": float(v.std()), "median": pct(v, 50),
        }
    lo_full = P.min(axis=0)
    hi_full = P.max(axis=0)
    lo_r = np.array([pct(P[:, i], 1) for i in range(3)])
    hi_r = np.array([pct(P[:, i], 99) for i in range(3)])
    lo_r01 = np.array([pct(P[:, i], 0.1) for i in range(3)])
    hi_r999 = np.array([pct(P[:, i], 99.9) for i in range(3)])
    diag_full = float(np.linalg.norm(hi_full - lo_full))
    diag_r = float(np.linalg.norm(hi_r - lo_r))
    diag_r01 = float(np.linalg.norm(hi_r999 - lo_r01))
    center = (lo_r + hi_r) / 2.0
    radius = diag_r / 2.0
    inside = np.all((P >= lo_r) & (P <= hi_r), axis=1)
    pos = {
        "axes": axes,
        "min": lo_full.tolist(), "max": hi_full.tolist(),
        "p01": lo_r.tolist(), "p99": hi_r.tolist(),
        "fullBoxSize": (hi_full - lo_full).tolist(),
        "robustBoxSize": (hi_r - lo_r).tolist(),
        "fullBoxDiagonal": diag_full,
        "robustBoxDiagonal1_99": diag_r,
        "fullOverRobustDiagonal": diag_full / diag_r,
        "p01_99_9BoxDiagonal": diag_r01,
        "robustCenter": center.tolist(),
        "robustRadius": radius,
        "fractionInsideRobustBox": float(inside.mean()),
        "statsCrossCheckP99_99": [float(pct(P[:, i], 99.99)) for i in range(3)],
    }
    # distance from robust center
    D = np.linalg.norm(P - center, axis=1)
    dstat = {**pct_dict(D), "mean": float(D.mean()), "max": float(D.max()),
             "radius": radius}
    dstat["p50_over_radius"] = float(pct(D, 50) / radius)
    dstat["p99_over_radius"] = float(pct(D, 99) / radius)
    dstat["max_over_radius"] = float(D.max() / radius)
    dstat["count_gt_2R"] = int((D > 2 * radius).sum())
    dstat["count_gt_3R"] = int((D > 3 * radius).sum())
    dstat["count_gt_5R"] = int((D > 5 * radius).sum())
    for k in (1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 5.0):
        kk = ("%g" % k)
        dstat["count_gt_%sR" % kk] = int((D > k * radius).sum())
        dstat["frac_gt_%sR" % kk] = float((D > k * radius).mean())

    # ---- scales (log -> linear, verified above) ----
    Slin = np.exp(Sraw)
    L = Slin.max(axis=1)
    Lmed = float(np.median(L))
    scl = {
        "logging": "CSV scale_0..2 are natural-log scales; linear = exp(csv). "
                   "Cross-checked against --stats json (stats already reports exp).",
        "perAxisLinear": {
            "scale_0": {**pct_dict(Slin[:, 0]), "mean": float(Slin[:, 0].mean())},
            "scale_1": {**pct_dict(Slin[:, 1]), "mean": float(Slin[:, 1].mean())},
            "scale_2": {**pct_dict(Slin[:, 2]), "mean": float(Slin[:, 2].mean())},
        },
        "longestAxisL": {**pct_dict(L), "mean": float(L.mean()), "max": float(L.max())},
        "L_median": Lmed,
        "maxOverMedian": float(L.max() / Lmed),
        "p99OverMedian": float(pct(L, 99) / Lmed),
        "p99_9OverMedian": float(pct(L, 99.9) / Lmed),
        "count_gt_0.5": int((L > 0.5).sum()),
        "count_gt_1": int((L > 1).sum()),
        "count_gt_2": int((L > 2).sum()),
        "frac_gt_0.5": float((L > 0.5).mean()),
        "frac_gt_1": float((L > 1).mean()),
        "frac_gt_2": float((L > 2).mean()),
        "sumL": float(L.sum()),
    }
    for k in (4, 8, 16, 32):
        scl["count_gt_%dxMedian" % k] = int((L > k * Lmed).sum())
        scl["frac_gt_%dxMedian" % k] = float((L > k * Lmed).mean())

    # ---- opacity ----
    A = sigmoid(Oraw)
    op = {
        "logging": "CSV opacity is logit; linear alpha = sigmoid(csv). "
                   "Cross-checked against --stats json (stats reports sigmoid).",
        **pct_dict(A), "mean": float(A.mean()), "max": float(A.max()),
        "count_lt_0.01": int((A < 0.01).sum()),
        "count_lt_0.02": int((A < 0.02).sum()),
        "count_lt_0.05": int((A < 0.05).sum()),
        "count_lt_0.10": int((A < 0.10).sum()),
        "frac_lt_0.01": float((A < 0.01).mean()),
        "frac_lt_0.02": float((A < 0.02).mean()),
        "frac_lt_0.05": float((A < 0.05).mean()),
        "frac_lt_0.10": float((A < 0.10).mean()),
    }

    # ---- haze / streak suspects ----
    susp = {}
    for k in (4, 8, 16):
        m = L > k * Lmed
        susp["long_%dxMedian" % k] = {"count": int(m.sum()), "frac": float(m.mean()),
                                      "sumLFrac": float(L[m].sum() / L.sum()) if m.any() else 0.0}
    for k in (1.5, 2.0):
        m = D > k * radius
        kk = ("%g" % k)
        susp["far_%sR" % kk] = {"count": int(m.sum()), "frac": float(m.mean()),
                               "sumLFrac": float(L[m].sum() / L.sum()) if m.any() else 0.0}
    # primary suspect definition: L > 8x median OR distance > 2R
    # (the 1-99 box is already wide: half-diagonal R spans the scene, so >2R is the
    #  effective "far" cap here; >3R triggers for nobody in these takes)
    m_long = L > 8 * Lmed
    m_far = D > 2 * radius
    m_both = m_long & m_far
    m_either = m_long | m_far
    susp["primary"] = {
        "definition": "L > 8 * median(L) OR distance(robust center) > 2 * robust radius",
        "count_long": int(m_long.sum()), "count_far": int(m_far.sum()),
        "count_both": int(m_both.sum()), "count_either": int(m_either.sum()),
        "frac_either": float(m_either.mean()),
        "sumLFrac_either": float(L[m_either].sum() / L.sum()),
        "distP50_either": float(pct(D[m_either], 50)) if m_either.any() else None,
        "distP99_either": float(pct(D[m_either], 99)) if m_either.any() else None,
        "Lp50_either": float(pct(L[m_either], 50)) if m_either.any() else None,
        "alphaP50_either": float(pct(A[m_either], 50)) if m_either.any() else None,
        "alphaBelow005_either": int((A[m_either] < 0.05).sum()),
        "centralBig": {  # big splats that are NOT far: risky to remove, may be real chair/background
            "count_Lgt8xMed_and_distLE1R": int((m_long & (D <= radius)).sum()),
            "count_Lgt8xMed_and_distLE2R": int((m_long & (D <= 2 * radius)).sum()),
        },
    }

    # ---- candidate conservative cleanup filters (measured, not applied) ----
    cand = {}
    for tag, q in (("p99", 99.0), ("p99.5", 99.5), ("p99.9", 99.9)):
        cap = pct(L, q)
        cut = L > cap
        cand["maxScale_%s" % tag] = {
            "thresholdL": cap, "removes": int(cut.sum()),
            "removesFrac": float(cut.mean()),
            "keeps": int((~cut).sum()),
            "sumLFrac": float(L[cut].sum() / L.sum()) if cut.any() else 0.0,
            # how many of the removed are near the subject (<= 1 robust radius)?
            "removesWithin1R": int((cut & (D <= radius)).sum()),
            "removesWithin2R": int((cut & (D <= 2 * radius)).sum()),
        }
    for tag, capop in (("0.01", 0.01), ("0.02", 0.02), ("0.05", 0.05)):
        cut = A < capop
        cand["opacity_lt_%s" % tag] = {"thresholdAlpha": capop, "removes": int(cut.sum()),
                                       "removesFrac": float(cut.mean()),
                                       "keeps": int((~cut).sum())}
    for tag, k in (("2R", 2.0), ("3R", 3.0)):
        cut = D > k * radius
        cand["sphere_gt_%s" % tag] = {"thresholdDistance": k * radius, "removes": int(cut.sum()),
                                      "removesFrac": float(cut.mean()),
                                      "keeps": int((~cut).sum())}
    # recommended combo: max-scale p99.9 OR (opacity < 0.02 & L > p50) OR distance > 2R
    cap999 = pct(L, 99.9)
    cut_combo = (L > cap999) | ((A < 0.02) & (L > Lmed)) | (D > 2 * radius)
    cand["combo_conservative"] = {
        "definition": "L > p99.9(L) OR (alpha < 0.02 AND L > median L) OR distance > 2R",
        "maxScaleCap": cap999, "removes": int(cut_combo.sum()),
        "removesFrac": float(cut_combo.mean()), "keeps": int((~cut_combo).sum()),
        "removesWithin1R": int((cut_combo & (D <= radius)).sum()),
    }
    # literal tool-side thresholds in native (linear) units -> for CLI --filter-value
    # We report axis caps: which per-axis max linear scale corresponds to p99.9 of L?
    cap999_axis = float(np.percentile(Slin.max(axis=1), 99.9))

    # ---- stats json extras ----
    fill = None
    try:
        fill = stj["stats"][0].get("fillRatio")
    except Exception:  # noqa: BLE001
        pass

    return {
        "key": key, "jobId": jid, "label": label, "takeDurationS": dur,
        "count": n,
        "statsJsonCount": stj.get("numGaussians"), "shBands": stj.get("shBands"),
        "model": stj.get("model"), "fillRatio": fill,
        "encoding": enc,
        "positions": pos,
        "distance": dstat,
        "scales": scl,
        "opacity": op,
        "suspects": susp,
        "candidateFilters": cand,
        "recommended": {
            "maxScaleCapL_p999": cap999_axis,
            "maxScaleCapL_p99": float(np.percentile(Slin.max(axis=1), 99.0)),
            "opacityFloor": 0.02,
            "distanceCapR": 3.0,
            "distanceCap": 3.0 * radius,
        },
    }


def displacement_table(takes_out):
    """Defect 1: viewer applies 180 deg about X, position = -center (wrong) instead of -R*center.
    R = diag(1,-1,-1).  world center = R c + p.
      wrong:   p = -c        -> world center = R c - c, displacement |R c - c| = 2*sqrt(cy^2+cz^2)
      correct: p = -R c      -> world center = 0.
    """
    rows = []
    for t in takes_out:
        c = np.array(t["positions"]["robustCenter"])
        R = np.diag([1.0, -1.0, -1.0])
        Rc = R @ c
        wrong = Rc - c
        mag = float(np.linalg.norm(wrong))
        radius = t["positions"]["robustRadius"]
        rows.append({
            "take": t["key"], "label": t["label"],
            "center": c.tolist(),
            "Rc": Rc.tolist(),
            "wrongWorldCenter(=-Rc+c)": wrong.tolist(),
            "correctWorldCenter": [0.0, 0.0, 0.0],
            "oldDisplacementMagnitude": mag,
            "robustRadius": radius,
            "oldDisplacementOverRadius": mag / radius,
            "oldDisplacementOverFullDiagonal": mag / t["positions"]["fullBoxDiagonal"],
            "oldDisplacementPctOfRobustDiagonal": 100.0 * mag / t["positions"]["robustBoxDiagonal1_99"],
            "magnitudeFormula": "2*sqrt(cy^2 + cz^2) for R=diag(1,-1,-1)",
        })
    return rows


def main():
    fx = verify_fixtures()
    with open(os.path.join(AN, "fixtures.json"), "w", encoding="utf-8") as f:
        json.dump(fx, f, indent=2)

    out = {"generatedAt": datetime.now(timezone.utc).isoformat(),
           "runDir": RUN,
           "method": {
               "csv": "splat-transform -w <spz> --filter-nan <org>.csv",
               "stats": "splat-transform <spz> --stats json null",
               "percentiles": "numpy linear interpolation",
               "robustCenter": "per-axis midpoint of [p1, p99] box",
               "robustRadius": "half the p1-p99 box diagonal",
           },
           "takes": []}
    for key, jid, label, dur in TAKES:
        t = analyse_take(key, jid, label, dur)
        out["takes"].append(t)
        print("done", key, "n=", t["count"], "Lmed=%.4f" % t["scales"]["L_median"],
              "ratio=%.2f" % t["positions"]["fullOverRobustDiagonal"])
    out["transformDisplacement"] = displacement_table(out["takes"])
    with open(os.path.join(AN, "spz-stats.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("wrote spz-stats.json")


if __name__ == "__main__":
    main()
