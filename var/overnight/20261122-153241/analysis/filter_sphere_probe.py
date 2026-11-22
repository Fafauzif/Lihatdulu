"""Figure out what --filter-sphere actually kept (radius/center semantics)."""
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
cx, cy, cz = t["positions"]["robustCenter"]
r = t["positions"]["robustRadius"]

df = pd.read_csv(os.path.join(AN, "csv", "golden.csv"), usecols=["x", "y", "z"])
P = df[["x", "y", "z"]].to_numpy()
c = np.array([cx, cy, cz])
D = np.linalg.norm(P - c, axis=1)
D0 = np.linalg.norm(P, axis=1)


def tool_sphere(center, radius, out):
    cmd = [NODE, CLI, "-w", spz, "--filter-nan", "--filter-sphere",
           "%.4f,%.4f,%.4f,%.4f" % (center[0], center[1], center[2], radius), out]
    subprocess.run(cmd, capture_output=True, text=True)
    ps = subprocess.run([NODE, CLI, out, "--stats", "json", "null"], capture_output=True, text=True)
    return json.loads(ps.stdout)["numGaussians"]


print("pred counts: center R=%.4f -> outside %d; center 2R -> %d; origin R -> %d; origin 2R -> %d" % (
    r, (D > r).sum(), (D > 2 * r).sum(), (D0 > r).sum(), (D0 > 2 * r).sum()))
# what radius around the robust center would remove 353?
srt = np.sort(D)
print("radius removing exactly 353 (center robust):", srt[len(srt) - 353 - 1:len(srt) - 352])
# hypothesis: radius is interpreted as squared distance threshold
import math
print("exp(R/2)=%.4f, sqrt(R)=%.4f, R/2=%.4f" % (math.exp(r / 2), math.sqrt(r), r / 2))
tests = [
    ("center robust, r", (c, r)),
    ("center robust, 2r", (c, 2 * r)),
    ("origin, r", (np.zeros(3), r)),
    ("origin, 2r", (np.zeros(3), 2 * r)),
    ("center robust, r^2", (c, r * r)),
    ("center robust, exp(r)", (c, math.exp(r))),
]
for i, (name, (cc, rr)) in enumerate(tests):
    n = tool_sphere(cc, rr, os.path.join(QA, "sphere-test-%d.spz" % i))
    print("%-22s center=%s radius=%.4f -> kept %d (removed %d)" % (
        name, np.round(cc, 3).tolist(), rr, n, 27447 - n))
