"""Quick CSV statistics for one splat-transform CSV dump.

Usage: python spz-csv-stats.py <csv> [out.json]
Columns are raw file values: x,y,z world centers, scale_0..2 log-scale,
opacity logit. Percentile box uses per-axis 1st/99th percentiles.
"""
import json
import sys

import numpy as np
import pandas as pd


def main() -> None:
    path = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    df = pd.read_csv(path)
    n = len(df)
    pcts = [0, 0.1, 1, 5, 50, 95, 99, 99.9, 100]
    result = {"file": path, "count": int(n), "axes": {}}
    for axis in ("x", "y", "z"):
        vals = df[axis].to_numpy(dtype=np.float64)
        q = {str(p): float(np.percentile(vals, p)) for p in pcts}
        result["axes"][axis] = q
    lo = np.array([result["axes"][a]["1"] for a in "xyz"])
    hi = np.array([result["axes"][a]["99"] for a in "xyz"])
    flo = np.array([result["axes"][a]["0"] for a in "xyz"])
    fhi = np.array([result["axes"][a]["100"] for a in "xyz"])
    robust_diag = float(np.linalg.norm(hi - lo))
    full_diag = float(np.linalg.norm(fhi - flo))
    center = (lo + hi) / 2.0
    robust_radius = robust_diag / 2.0
    logs = df[["scale_0", "scale_1", "scale_2"]].to_numpy(dtype=np.float64)
    linear = np.exp(logs)
    longest = linear.max(axis=1)
    logit = df["opacity"].to_numpy(dtype=np.float64)
    opacity = 1.0 / (1.0 + np.exp(-logit))
    scale_pcts = {}
    for p in (50, 90, 95, 99, 99.5, 99.9, 100):
        scale_pcts[str(p)] = float(np.percentile(longest, p))
    # Distance from robust center, type-in-safe.
    dist = np.linalg.norm(df[["x", "y", "z"]].to_numpy(dtype=np.float64) - center, axis=1)
    result.update(
        {
            "robust_box": {"min": lo.tolist(), "max": hi.tolist()},
            "full_box": {"min": flo.tolist(), "max": fhi.tolist()},
            "robust_diag": robust_diag,
            "full_diag": full_diag,
            "full_over_robust": full_diag / robust_diag if robust_diag else None,
            "robust_center": center.tolist(),
            "robust_radius": robust_radius,
            "longest_linear_scale": scale_pcts,
            "max_over_median_scale": scale_pcts["100"] / scale_pcts["50"] if scale_pcts["50"] else None,
            "threshold_counts": {
                "scale_gt_0.5": int((longest > 0.5).sum()),
                "scale_gt_1.0": int((longest > 1.0).sum()),
                "scale_gt_2.0": int((longest > 2.0).sum()),
                "scale_gt_3.0": int((longest > 3.0).sum()),
                "dist_gt_radius": int((dist > robust_radius).sum()),
                "dist_gt_2x_radius": int((dist > 2 * robust_radius).sum()),
                "opacity_lt_0.05": int((opacity < 0.05).sum()),
                "opacity_lt_0.02": int((opacity < 0.02).sum()),
            },
            "opacity_pcts": {
                str(p): float(np.percentile(opacity, p)) for p in (1, 5, 50, 95, 99)
            },
        }
    )
    text = json.dumps(result, indent=2)
    if out:
        with open(out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
