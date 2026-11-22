"""Smoke-test the exact recommended conservative cleanup pipeline on copies.

Reads the fixture SPZ (read-only) and writes the filtered SPZ under qa/diag/.
Also predicts the surviving count from the CSV export and compares with the tool's
own post-filter numGaussians, to validate the suggested thresholds and CLI form.
"""
import json
import os
import subprocess

import numpy as np
import pandas as pd

RUN = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241"
AN = os.path.join(RUN, "analysis")
QA = os.path.join(RUN, "qa", "diag")
NODE = "node"
CLI = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241\node_modules\@playcanvas\splat-transform\bin\cli.mjs"

TAKES = {
    "golden": "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c",
    "stress-10.03": "f4755525-a4e8-4eb8-a279-5b8adb45c6ad",
}

st = json.load(open(os.path.join(AN, "spz-stats.json"), encoding="utf-8"))
by_key = {t["key"]: t for t in st["takes"]}

results = {}
for key, jid in TAKES.items():
    t = by_key[key]
    cap = t["candidateFilters"]["maxScale_p99"]["thresholdL"]
    cx, cy, cz = t["positions"]["robustCenter"]
    r2 = 2 * t["positions"]["robustRadius"]
    spz = os.path.join(RUN, "jobs", jid, "output", "scan.spz")
    out = os.path.join(QA, "trial-%s-p99.spz" % key)
    cmd = [NODE, CLI, "-w", spz, "--filter-nan",
           "--filter-value", "scale_0,lt,%.4f" % cap,
           "--filter-value", "scale_1,lt,%.4f" % cap,
           "--filter-value", "scale_2,lt,%.4f" % cap,
           "--filter-value", "opacity,gte,0.02",
           "--filter-sphere", "%.4f,%.4f,%.4f,%.4f" % (cx, cy, cz, r2),
           out]
    p = subprocess.run(cmd, capture_output=True, text=True)
    # predict surviving count from the CSV export
    df = pd.read_csv(os.path.join(AN, "csv", key + ".csv"),
                     usecols=["x", "y", "z", "scale_0", "scale_1", "scale_2", "opacity"])
    P = df[["x", "y", "z"]].to_numpy()
    L = np.exp(df[["scale_0", "scale_1", "scale_2"]].to_numpy()).max(axis=1)
    A = 1.0 / (1.0 + np.exp(-df["opacity"].to_numpy()))
    D = np.linalg.norm(P - np.array([cx, cy, cz]), axis=1)
    cut = (L > cap) | (A < 0.02) | (D > r2)
    predicted_removed = int(cut.sum())
    predicted_kept = int((~cut).sum())
    # tool-side count
    ps = subprocess.run([NODE, CLI, out, "--stats", "json", "null"], capture_output=True, text=True)
    tool_n = None
    try:
        tool_n = json.loads(ps.stdout)["numGaussians"]
    except Exception:  # noqa: BLE001
        tool_n = None
    with open(os.path.join(QA, "trial-%s-p99.json" % key), "w", encoding="utf-8") as f:
        json.dump({"input": spz, "output": out, "capL": cap, "sphere": [cx, cy, cz, r2],
                   "predictedRemoved": predicted_removed, "predictedKept": predicted_kept,
                   "toolNumGaussians": tool_n, "inputCount": t["count"],
                   "toolExit": p.returncode, "toolStderrTail": p.stderr[-400:]}, f, indent=2)
    results[key] = {"cap": round(cap, 4), "input": t["count"], "predictedKept": predicted_kept,
                    "toolNumGaussians": tool_n, "match": tool_n == predicted_kept,
                    "toolExit": p.returncode}
    print(key, results[key])
print(json.dumps(results, indent=2))
