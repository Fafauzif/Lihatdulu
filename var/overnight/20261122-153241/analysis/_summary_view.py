import json
p = r"C:\Users\fauzi\OneDrive\Documents\GitHub\Lihatdulu\var\overnight\20261122-153241\analysis\spz-stats.json"
d = json.load(open(p))
for t in d["takes"]:
    pos = t["positions"]; sc = t["scales"]; op = t["opacity"]; ds = t["distance"]
    su = t["suspects"]; en = t["encoding"]
    print("=" * 110)
    print(t["key"], "|", t["label"], "| n=", t["count"], "| fillRatio=", t["fillRatio"])
    print(" enc: scaleLog=", en["scaleIsLogConfirmed"], "opacityLogit=", en["opacityIsLogitConfirmed"],
          "alpha8bit=", en["alphaGridIs8Bit"], "meanAbs=%.2e" % en["alphaGridMeanAbsResidual"],
          "p99Abs=%.2e" % en["alphaGrid99AbsResidual"])
    print("  scale xcheck: statsMed=%.6f expCSVmed=%.6f rawCSVmed=%.6f | statsMin=%.6g expCSVmin=%.6g | statsMax=%.6g expCSVmax=%.6g" % (
        en["scale0_statsMedian"], en["scale0_csvMedian_exp"], en["scale0_csvMedian_raw"],
        en["scale0_statsMin"], en["scale0_csvMin_exp"], en["scale0_statsMax"], en["scale0_csvMax_exp"]))
    print("  opacity xcheck: statsMed=%.6f sigCSVmed=%.6f rawCSVmed=%.6f | statsMin=%.6f sigCSVmin=%.6f | statsMax=%.6f sigCSVmax=%.6f" % (
        en["opacity_statsMedian"], en["opacity_csvMedian_sigmoid"], en["opacity_csvMedian_raw"],
        en["opacity_statsMin"], en["opacity_csvMin_sigmoid"], en["opacity_statsMax"], en["opacity_csvMax_sigmoid"]))
    print("  fullBox=", [round(x, 3) for x in pos["fullBoxSize"]], "diag=%.3f" % pos["fullBoxDiagonal"])
    print("  robustBox=", [round(x, 3) for x in pos["robustBoxSize"]], "diag=%.3f" % pos["robustBoxDiagonal1_99"],
          "ratio=%.2f" % pos["fullOverRobustDiagonal"], "p0.1-99.9 diag=%.3f" % pos["p01_99_9BoxDiagonal"])
    print("  center=", [round(x, 3) for x in pos["robustCenter"]], "radius=%.3f" % pos["robustRadius"],
          "insideFrac=%.4f" % pos["fractionInsideRobustBox"])
    print("  dist p50=%.3f p95=%.3f p99=%.3f max=%.3f (max/R=%.1f) frac>2R=%.4f >3R=%.4f >5R=%.4f" % (
        ds["50"], ds["95"], ds["99"], ds["max"], ds["max_over_radius"], ds["frac_gt_2R"], ds["frac_gt_3R"], ds["frac_gt_5R"]))
    print("  L p50=%.4f p90=%.4f p99=%.4f p99.9=%.4f max=%.4f max/med=%.1f p99/med=%.1f" % (
        sc["longestAxisL"]["50"], sc["longestAxisL"]["90"], sc["longestAxisL"]["99"],
        sc["longestAxisL"]["99.9"], sc["longestAxisL"]["max"], sc["maxOverMedian"], sc["p99OverMedian"]))
    print("  L>0.5:%d(%.4f) >1:%d >2:%d ; >4xMed:%d >8xMed:%d >16xMed:%d" % (
        sc["count_gt_0.5"], sc["frac_gt_0.5"], sc["count_gt_1"], sc["count_gt_2"],
        sc["count_gt_4xMedian"], sc["count_gt_8xMedian"], sc["count_gt_16xMedian"]))
    print("  alpha p50=%.4f p90=%.4f p99=%.4f min=%.4f max=%.4f; <0.01:%d <0.02:%d <0.05:%d <0.10:%d" % (
        op["50"], op["90"], op["99"], op["0.1"], op["max"],
        op["count_lt_0.01"], op["count_lt_0.02"], op["count_lt_0.05"], op["count_lt_0.10"]))
    print("  primary suspect:", {k: v for k, v in su["primary"].items() if k not in ("definition", "centralBig")})
    print("  centralBig:", su["primary"]["centralBig"])
    print("  cand:", {k: (round(v.get("thresholdL", v.get("thresholdAlpha", v.get("thresholdDistance", 0))), 4),
                          v["removes"], round(v["removesFrac"], 4)) for k, v in t["candidateFilters"].items()})
    print("  recommended:", {k: (round(v, 4) if isinstance(v, float) else v) for k, v in t["recommended"].items()})
print("=" * 110)
print("TRANSFORM DISPLACEMENT")
for r in d["transformDisplacement"]:
    print("  %-16s c=%s  oldDisp=%.3f  R=%.3f  disp/R=%.2f  disp/fullDiag=%.3f  disp%%robustDiag=%.1f%%" % (
        r["take"], [round(x, 2) for x in r["center"]], r["oldDisplacementMagnitude"], r["robustRadius"],
        r["oldDisplacementOverRadius"], r["oldDisplacementOverFullDiagonal"],
        r["oldDisplacementPctOfRobustDiagonal"]))
