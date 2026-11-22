"""Validate splat-transform filter-value semantics on SPZ input (CPU-only actions).

Checks whether --filter-value scale_0 / opacity compare against LINEAR values
(the in-memory representation) rather than the stored log/logit columns.
"""
import json
import os
import subprocess

import numpy as np
import pandas as pd

RUN = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241"
NODE = "node"
CLI = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu-overnight-20261122-153241\node_modules\@playcanvas\splat-transform\bin\cli.mjs"
SPZ = os.path.join(RUN, "jobs", "0283ca80-8f9c-4fa4-85a6-f0edb5fc962c", "output", "scan.spz")
OUT = os.path.join(RUN, "analysis", "csv")
TMP = os.path.join(RUN, "qa", "diag")

df = pd.read_csv(os.path.join(OUT, "golden.csv"), usecols=["scale_0", "opacity"])
sraw = df["scale_0"].to_numpy()
olin = 1.0 / (1.0 + np.exp(-df["opacity"].to_numpy()))
slin = np.exp(sraw)

cases = [
    ("scale_0,gt,1", int((slin > 1.0).sum()), int((sraw > 1.0).sum())),
    ("opacity,gt,0.5", int((olin > 0.5).sum()), int((df["opacity"].to_numpy() > 0.5).sum())),
    ("scale_0,gt,0.5", int((slin > 0.5).sum()), int((sraw > 0.5).sum())),
]

results = []
for i, (expr, pred_linear, pred_raw) in enumerate(cases):
    outp = os.path.join(TMP, "fvtest-%d.csv" % i)
    cmd = [NODE, CLI, "-w", SPZ, "--filter-value", expr, outp]
    p = subprocess.run(cmd, capture_output=True, text=True)
    rows = None
    if os.path.exists(outp):
        with open(outp, "rb") as f:
            rows = f.read().count(b"\n") - 1
    results.append({"filter": expr, "toolRows": rows,
                    "predictedKeepIfLinear": pred_linear,
                    "predictedKeepIfRawLogit": pred_raw,
                    "exit": p.returncode,
                    "verdict": ("linear" if rows == pred_linear else
                                ("raw_log/logit" if rows == pred_raw else "unexpected"))})

print(json.dumps(results, indent=2))
with open(os.path.join(RUN, "analysis", "filter-semantics.json"), "w", encoding="utf-8") as f:
    json.dump({"tool": "splat-transform v3.12.0", "input": "golden scan.spz",
               "results": results}, f, indent=2)
