"""Isolate which filter in the recommended pipeline removes more than predicted."""
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

jid = "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c"
spz = os.path.join(RUN, "jobs", jid, "output", "scan.spz")
st = json.load(open(os.path.join(AN, "spz-stats.json"), encoding="utf-8"))
t = [x for x in st["takes"] if x["key"] == "golden"][0]
cap = t["candidateFilters"]["maxScale_p99"]["thresholdL"]
cx, cy, cz = t["positions"]["robustCenter"]
r2 = 2 * t["positions"]["robustRadius"]

df = pd.read_csv(os.path.join(AN, "csv", "golden.csv"),
                 usecols=["x", "y", "z", "scale_0", "scale_1", "scale_2", "opacity"])
P = df[["x", "y", "z"]].to_numpy()
S = np.exp(df[["scale_0", "scale_1", "scale_2"]].to_numpy())
L = S.max(axis=1)
A = 1.0 / (1.0 + np.exp(-df["opacity"].to_numpy()))
D = np.linalg.norm(P - np.array([cx, cy, cz]), axis=1)
print("cap=%.4f sphere=%.4f,%.4f,%.4f R=%.4f" % (cap, cx, cy, cz, r2))
print("pred: axis0>cap %d axis1>cap %d axis2>cap %d L>cap %d | A<0.02 %d | D>r %d" % (
    (S[:, 0] > cap).sum(), (S[:, 1] > cap).sum(), (S[:, 2] > cap).sum(), (L > cap).sum(),
    (A < 0.02).sum(), (D > r2).sum()))

cases = [
    ["--filter-nan"],
    ["--filter-nan", "--filter-sphere", "%.4f,%.4f,%.4f,%.4f" % (cx, cy, cz, r2)],
    ["--filter-nan", "--filter-value", "opacity,gte,0.02"],
    ["--filter-nan", "--filter-value", "scale_0,lt,%.4f" % cap],
    ["--filter-nan", "--filter-value", "scale_1,lt,%.4f" % cap],
    ["--filter-nan", "--filter-value", "scale_2,lt,%.4f" % cap],
    ["--filter-nan", "--filter-value", "scale_0,lt,%.4f" % cap,
     "--filter-value", "scale_1,lt,%.4f" % cap,
     "--filter-value", "scale_2,lt,%.4f" % cap],
]
out = []
for i, actions in enumerate(cases):
    p = os.path.join(QA, "iso-%d.spz" % i)
    cmd = [NODE, CLI, "-w", spz] + actions + [p]
    r = subprocess.run(cmd, capture_output=True, text=True)
    ps = subprocess.run([NODE, CLI, p, "--stats", "json", "null"], capture_output=True, text=True)
    try:
        n = json.loads(ps.stdout)["numGaussians"]
    except Exception:  # noqa: BLE001
        n = None
    out.append({"actions": actions, "numGaussians": n, "exit": r.returncode})
    print(actions, "->", n, "removed", 27447 - n if n else None)
with open(os.path.join(QA, "filter-isolation.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
