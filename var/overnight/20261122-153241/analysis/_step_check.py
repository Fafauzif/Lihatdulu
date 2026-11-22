import json

p = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\analysis\coverage-golden-diag.json"
try:
    d = json.load(open(p))
except FileNotFoundError:
    p = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\analysis\coverage-golden.json"
    d = json.load(open(p))
c = d["coverage"]
fr = c["framesOrdered"]
az = [f["azimuthDeg"] for f in fr]


def wrap(a):
    return (a + 180.0) % 360.0 - 180.0


steps = [abs(wrap(az[i + 1] - az[i])) for i in range(len(az) - 1)]
print("n frames", len(az))
print("first 10 names/az:", [(fr[i]["name"], round(az[i], 1)) for i in range(10)])
print("steps first 12:", [round(s, 1) for s in steps[:12]])
print("sorted steps:", [round(s, 2) for s in sorted(steps)[:10]], "...",
      [round(s, 2) for s in sorted(steps)[-10:]])
import numpy as np
print("median %.3f p90 %.3f max %.3f mean %.3f sum %.1f" % (
    np.median(steps), np.percentile(steps, 90), max(steps), np.mean(steps), sum(steps)))
print("az span (unwrap):", round(np.degrees(np.unwrap(np.radians(az))).ptp(), 1))
camdist = c["cameraCenters"]["distanceToCentroid"]
print("camDist:", {k: round(v, 3) for k, v in camdist.items()})
print("height:", c["heightY"])
print("viewdir:", c["viewingDirection"])
