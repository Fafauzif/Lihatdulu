"""Generate analysis/fixtures.md and analysis/SPZ_STATS.md from the computed JSON."""
import json
import os
from datetime import datetime, timezone

RUN = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241"
AN = os.path.join(RUN, "analysis")


def load(name):
    with open(os.path.join(AN, name), "r", encoding="utf-8") as f:
        return json.load(f)


def f(x, nd=3):
    if x is None:
        return "-"
    if isinstance(x, str):
        return x
    return ("%%.%df" % nd) % x


def sf(x, nd=4):
    if x is None:
        return "-"
    return ("%%.%dg" % nd) % x


def fixtures_md(fx):
    L = []
    L.append("# Fixture verification - overnight run 20261122-153241\n")
    L.append("Verified %s. Method and machine-readable copy: `analysis/fixtures.json`, "
             "script `analysis/spz_stats.py::verify_fixtures`.\n" % fx["generatedAt"])
    L.append("## Checks performed per take\n")
    L.append("1. `job.json` parses as JSON (the pinned lock bytes differ from the live copy for "
             "all seven job.json files - recorded in the run preflight/ledger; the SPZs and stills "
             "match pinned hashes, so the JSON is only used for metadata and is re-validated here).\n")
    L.append("2. `artifact.bytes` in job.json equals the actual `output/scan.spz` size on disk.\n")
    L.append("3. `artifact.splatCount` is plausible: equals the SPZ v4 header `numPoints` and the "
             "row count of the `--filter-nan` CSV export (i.e. no NaNs were removed).\n")
    L.append("4. Three stills exist, are non-empty, and are exactly the names declared in "
             "`artifact.stills`.\n")
    L.append("5. SPZ header flags: version 4, SH degree 3, fractionalBits 12, flags 0 for every take.\n")
    L.append("\n## Table\n")
    L.append("| take | job.json | bytes decl / actual | splats decl / header / csv | stills | frames ext/reg | duration job / map | media | pass |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for t in fx["takes"]:
        h = t["spzHeader"]
        L.append("| %s<br>`%s` | parses=%s | %d / %d %s | %d / %d / %d %s | %s | %s / %s | %.1f s / %.2f s | %dx%d | %s |" % (
            t["label"], t["jobId"][:8],
            "yes" if t["jobJsonParses"] else "NO",
            t["declaredBytes"], t["spzBytes"], "OK" if t["bytesMatch"] else "**MISMATCH**",
            t["declaredSplatCount"], h["numPoints"], t["csvRows"],
            "OK" if t["countMatchesHeader"] and t["countMatchesCsv"] else "**MISMATCH**",
            ", ".join("%s (%d B)" % (s["name"], s["bytes"]) for s in t["stills"]),
            t["jobFrames"].get("extracted"), t["jobFrames"].get("registered"),
            (t["jobMedia"] or {}).get("durationS") or 0.0, t["takeDurationS"],
            (t["jobMedia"] or {}).get("width", 0), (t["jobMedia"] or {}).get("height", 0),
            "PASS" if t["pass"] else "**FAIL**"))
    L.append("\n**Result: %d/%d takes pass all fixture checks.**\n" % (
        sum(1 for t in fx["takes"] if t["pass"]), len(fx["takes"])))
    L.append("\n## Notes\n")
    L.append("- bytes/splat is 19.17-20.63 across takes (SPZ v4: positions 24-bit fixed point, "
             "rotation 3 B, scale 3 B, alpha 1 B, colour 3 B, SH band 3 payload - consistent).\n")
    L.append("- `--filter-nan` removed **0** splats in every take; `--stats json` reports "
             "`nanCount = 0` and `infCount = 0` for every column of every take.\n")
    L.append("- Golden is the only 76-frame take (25.3 s); Repeat/stress/10.21 s used 60 frames, "
             "14.59 s 72, 15.00 s 74, 4K 71 frames. All takes registered 100% of extracted frames.\n")
    L.append("- Still 000/001/002 of Golden hash-match frames `0001.jpg`, `0039.jpg`, `0076.jpg` "
             "(first / middle / last) - used for the camera-coverage still mapping.\n")
    return "\n".join(L)


def stats_md(st, fx, fsem):
    L = []
    T = st["takes"]
    L.append("# SPZ statistics - overnight run 20261122-153241\n")
    L.append("Generated %s from the seven fixture SPZs. Machine-readable copy: "
             "`analysis/spz-stats.json`; generator `analysis/spz_stats.py`.\n" % st["generatedAt"])
    L.append("## Method\n")
    L.append("```\n"
             "node <impl>/node_modules/@playcanvas/splat-transform/bin/cli.mjs -w <spz> --filter-nan <take>.csv\n"
             "node <impl>/node_modules/@playcanvas/splat-transform/bin/cli.mjs <spz> --stats json null > analysis/stats/<take>.json\n"
             "```\n")
    L.append("- Converter: splat-transform v3.12.0 (5d5be2b); CPU-only actions (`--filter-nan`, CSV, `--stats`).\n")
    L.append("- Percentiles use numpy linear interpolation. `robust box` = per-axis [p1, p99] box; "
             "`robust center` = its midpoint; `robust radius` = half its diagonal.\n")
    L.append("- Box diagonals are Euclidean diagonals of the (per-axis min/max) or (per-axis p1/p99) box.\n")
    L.append("\n## Encoding verification (log scales / logit opacity -> linear)\n")
    L.append("| take | scale_0 median: --stats | exp(CSV median) | raw CSV median | scale confirmed log | "
             "opacity median: --stats | sigmoid(CSV median) | opacity confirmed logit | alpha 8-bit grid residual (mean) |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for t in T:
        e = t["encoding"]
        L.append("| %s | %.6f | %.6f | %.4f | %s | %.6f | %.6f | %s | %.2e |" % (
            t["key"], e["scale0_statsMedian"], e["scale0_csvMedian_exp"],
            e["scale0_csvMedian_raw"], "YES" if e["scaleIsLogConfirmed"] else "NO",
            e["opacity_statsMedian"], e["opacity_csvMedian_sigmoid"],
            "YES" if e["opacityIsLogitConfirmed"] else "NO", e["alphaGridMeanAbsResidual"]))
    L.append("\n**Conclusion.** The CSV `scale_0..scale_2` columns are **natural log** scales: "
             "`exp()` of the CSV values reproduces the `--stats` min/median/max exactly (the stats tool "
             "already reports linear scale). The CSV `opacity` column is a **logit**: `sigmoid()` "
             "reproduces the stats min/median/max. In addition `sigmoid(opacity)*255` lands on integers "
             "to ~1e-6, so the SPZ alpha is an 8-bit linear alpha (`k/255`) read back as a logit.\n")
    L.append("**Do not exponentiate opacity**; do exponentiate `scale_0..2`. Filter semantics were also "
             "checked against the CLI (see `analysis/filter-semantics.json`): `--filter-value scale_0,...` "
             "and `--filter-value opacity,...` compare **linear** values (tool keeps 220 rows for "
             "`scale_0 > 1` and 3646 for `opacity > 0.5`, matching the linear predictions and not the raw CSV values).\n")

    L.append("## Position statistics per take (world units, arbitrary reconstruction scale)\n")
    for t in T:
        p = t["positions"]
        L.append("\n### %s (%s) - %d splats\n" % (t["key"], t["label"], t["count"]))
        L.append("| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |")
        L.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for ax in "xyz":
            a = p["axes"][ax]
            L.append("| %s | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f |" % (
                ax, a["min"], a["0.1"], a["1"], a["5"], a["50"], a["95"], a["99"], a["99.9"],
                a["max"], a["mean"], a["std"]))
        L.append("")
        L.append("| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |")
        L.append("|---|---|---|---|---|---|---|")
        L.append("| %s | %s | %.3f | %.3f | (%s) | %.3f | %.4f |" % (
            [round(x, 3) for x in p["fullBoxSize"]], [round(x, 3) for x in p["robustBoxSize"]],
            p["fullOverRobustDiagonal"], p["p01_99_9BoxDiagonal"],
            ", ".join("%.2f" % x for x in p["robustCenter"]), p["robustRadius"],
            p["fractionInsideRobustBox"]))
        L.append("full box diagonal %.3f; per-axis 1-99 box diagonal %.3f; ratio %.3f\n" % (
            p["fullBoxDiagonal"], p["robustBoxDiagonal1_99"], p["fullOverRobustDiagonal"]))

    L.append("\n## Splat scale (longest linear axis L = exp(max(scale_0..2)))\n")
    L.append("| take | L p50 | L p90 | L p99 | L p99.9 | L max | max/median | p99/median | "
             "n L>0.5 | n L>1 | n L>2 | n L>4x med | n L>8x med | n L>16x med |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for t in T:
        s = t["scales"]
        Ll = s["longestAxisL"]
        L.append("| %s | %.4f | %.4f | %.4f | %.4f | %.4f | %.1f | %.1f | %d | %d | %d | %d | %d | %d |" % (
            t["key"], Ll["50"], Ll["90"], Ll["99"], Ll["99.9"], Ll["max"],
            s["maxOverMedian"], s["p99OverMedian"], s["count_gt_0.5"], s["count_gt_1"],
            s["count_gt_2"], s["count_gt_4xMedian"], s["count_gt_8xMedian"], s["count_gt_16xMedian"]))
    L.append("\nNote: reconstruction units are arbitrary (COLMAP scale), so absolute caps only make sense "
             "relative to each take's own percentiles; the count columns are provided as asked, and the "
             "**relative** counts (multiples of that take's median L) are the comparable measure.\n")

    L.append("\n## Opacity (linear alpha = sigmoid(csv opacity))\n")
    L.append("| take | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | n<0.01 | n<0.02 | n<0.05 | n<0.10 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for t in T:
        o = t["opacity"]
        L.append("| %s | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %.3f | %d | %d | %d | %d |" % (
            t["key"], o["0.1"], o["1"], o["5"], o["50"], o["95"], o["99"], o["99.9"], o["max"],
            o["count_lt_0.01"], o["count_lt_0.02"], o["count_lt_0.05"], o["count_lt_0.10"]))
    L.append("\nMinimum alpha is 0.0039-0.0118; the SPZ alpha grid (`k/255`) means the lowest representable "
             "non-zero alpha is 1/255 = 0.0039. There is no alpha = 0 population (SPZ drops invisible splats).\n")

    L.append("\n## Distance from robust center\n")
    L.append("| take | p50 | p95 | p99 | max | max/R | n > 1.5R | n > 2R | n > 2.5R | n > 3R |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for t in T:
        d = t["distance"]
        L.append("| %s | %.3f | %.3f | %.3f | %.3f | %.2f | %d | %d | %d | %d |" % (
            t["key"], d["50"], d["95"], d["99"], d["max"], d["max_over_radius"],
            d["count_gt_1.5R"], d["count_gt_2R"], d["count_gt_2.5R"], d["count_gt_3R"]))
    L.append("\nThe 1-99 box is already scene-sized, so 'far' is a weak discriminator: the median distance "
             "is ~0.5R and no take has more than a handful of splats beyond 2R.\n")

    L.append("\n## Haze / streak suspects\n")
    L.append("Primary = **L > 8 x median(L)** OR **distance > 2R**, where L is the splat's longest linear axis.\n")
    L.append("| take | long (8x med) | long+far | far (>2R) | either | % of splats | share of total L | "
             "median alpha of suspects | suspects alpha<0.05 | big but central (L>8x med within 1R) |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for t in T:
        s = t["suspects"]["primary"]
        L.append("| %s | %d | %d | %d | %d | %.2f%% | %.1f%% | %.3f | %d | %d |" % (
            t["key"], s["count_long"], s["count_both"], s["count_far"], s["count_either"],
            100 * s["frac_either"], 100 * s["sumLFrac_either"], s["alphaP50_either"],
            s["alphaBelow005_either"], s["centralBig"]["count_Lgt8xMed_and_distLE1R"]))
    L.append("\nSplats with L > 4x/8x/16x median are reported as counts and as share of the summed L in "
             "`analysis/spz-stats.json` (`suspects.long_*`). The striking result is that long splats are "
             "**not** far from the centre: 95%+ of them sit within 2R, i.e. the haze/streak mass is inside "
             "the scene volume rather than a distant shell.\n")

    L.append("\n## Measured candidate filter yields (conservative cleanup trial, CPU only)\n")
    L.append("| take | cap L=p99 (kept) | cap L=p99.5 | cap L=p99.9 | alpha<0.02 | distance>2R | "
             "combo: p99.9 cap OR (alpha<0.02 & L>median) OR dist>2R |")
    L.append("|---|---|---|---|---|---|---|")
    for t in T:
        c = t["candidateFilters"]
        def rem(k):
            return "%d (%.2f%%)" % (c[k]["removes"], 100 * c[k]["removesFrac"])
        L.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            t["key"], rem("maxScale_p99"), rem("maxScale_p99.5"), rem("maxScale_p99.9"),
            rem("opacity_lt_0.02"), rem("sphere_gt_2R"), rem("combo_conservative")))
    L.append("\nAll filter counts are **measured on the CSV export** (not applied to SPZ). Recommended caps "
             "per take are in `analysis/DIAGNOSTICS.md`.\n")

    L.append("\n## Converter `--stats json` cross-check\n")
    L.append("| take | numGaussians | shBands | model | fillRatio |")
    L.append("|---|---|---|---|---|")
    for t in T:
        L.append("| %s | %d | %s | %s | %.2f |" % (
            t["key"], t["count"], t["shBands"], t["model"], t["fillRatio"]))
    L.append("\nfillRatio (tool definition: total splat footprint over the robust p1-p99 cross-section) is "
             "19.9-27.5 for every take - healthy per the tool docs (degenerate scenes score orders of "
             "magnitude higher). It does not separate the takes usefully.\n")
    L.append("\n## Filter semantics check\n")
    L.append("`analysis/filter-semantics.json`:\n")
    for r in fsem["results"]:
        L.append("- `--filter-value %s` -> %d rows (linear prediction %d, raw-column prediction %d): **%s**\n" % (
            r["filter"], r["toolRows"], r["predictedKeepIfLinear"], r["predictedKeepIfRawLogit"], r["verdict"]))
    return "\n".join(L)


def main():
    fx = load("fixtures.json")
    st = load("spz-stats.json")
    fsem = load("filter-semantics.json")
    with open(os.path.join(AN, "fixtures.md"), "w", encoding="utf-8") as f:
        f.write(fixtures_md(fx))
    with open(os.path.join(AN, "SPZ_STATS.md"), "w", encoding="utf-8") as f:
        f.write(stats_md(st, fx, fsem))
    print("wrote fixtures.md and SPZ_STATS.md")


if __name__ == "__main__":
    main()
