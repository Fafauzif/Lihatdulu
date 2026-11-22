# SPZ statistics - overnight run 20261122-153241

Generated 2026-11-22T08:54:03.474725+00:00 from the seven fixture SPZs. Machine-readable copy: `analysis/spz-stats.json`; generator `analysis/spz_stats.py`.

## Method

```
node <impl>/node_modules/@playcanvas/splat-transform/bin/cli.mjs -w <spz> --filter-nan <take>.csv
node <impl>/node_modules/@playcanvas/splat-transform/bin/cli.mjs <spz> --stats json null > analysis/stats/<take>.json
```

- Converter: splat-transform v3.12.0 (5d5be2b); CPU-only actions (`--filter-nan`, CSV, `--stats`).

- Percentiles use numpy linear interpolation. `robust box` = per-axis [p1, p99] box; `robust center` = its midpoint; `robust radius` = half its diagonal.

- Box diagonals are Euclidean diagonals of the (per-axis min/max) or (per-axis p1/p99) box.


## Encoding verification (log scales / logit opacity -> linear)

| take | scale_0 median: --stats | exp(CSV median) | raw CSV median | scale confirmed log | opacity median: --stats | sigmoid(CSV median) | opacity confirmed logit | alpha 8-bit grid residual (mean) |
|---|---|---|---|---|---|---|---|---|
| golden | 0.028295 | 0.028368 | -3.5625 | YES | 0.209024 | 0.207843 | YES | 2.15e-06 |
| repeat | 0.030509 | 0.030197 | -3.5000 | YES | 0.254398 | 0.254902 | YES | 2.30e-06 |
| stress-10.03 | 0.044125 | 0.043937 | -3.1250 | YES | 0.246355 | 0.247059 | YES | 2.28e-06 |
| sweep-10.21 | 0.059793 | 0.060055 | -2.8125 | YES | 0.235017 | 0.235294 | YES | 2.25e-06 |
| sweep-14.59 | 0.030572 | 0.030197 | -3.5000 | YES | 0.224540 | 0.223529 | YES | 2.18e-06 |
| sweep-15.00 | 0.028382 | 0.028368 | -3.5625 | YES | 0.239063 | 0.239216 | YES | 2.25e-06 |
| sweep-4k-14.62 | 0.032152 | 0.032145 | -3.4375 | YES | 0.224279 | 0.223529 | YES | 2.17e-06 |

**Conclusion.** The CSV `scale_0..scale_2` columns are **natural log** scales: `exp()` of the CSV values reproduces the `--stats` min/median/max exactly (the stats tool already reports linear scale). The CSV `opacity` column is a **logit**: `sigmoid()` reproduces the stats min/median/max. In addition `sigmoid(opacity)*255` lands on integers to ~1e-6, so the SPZ alpha is an 8-bit linear alpha (`k/255`) read back as a logit.

**Do not exponentiate opacity**; do exponentiate `scale_0..2`. Filter semantics were also checked against the CLI (see `analysis/filter-semantics.json`): `--filter-value scale_0,...` and `--filter-value opacity,...` compare **linear** values (tool keeps 220 rows for `scale_0 > 1` and 3646 for `opacity > 0.5`, matching the linear predictions and not the raw CSV values).

## Position statistics per take (world units, arbitrary reconstruction scale)


### golden (Golden 25.35 s (tuning)) - 27447 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -0.273 | 0.549 | 1.092 | 1.855 | 4.345 | 7.921 | 9.510 | 11.119 | 16.964 | 4.714 | 2.149 |
| y | -5.259 | -3.464 | -2.279 | -1.794 | 2.961 | 5.463 | 6.608 | 7.435 | 8.532 | 2.469 | 2.750 |
| z | -12.404 | -9.462 | -5.181 | -3.140 | 1.715 | 5.498 | 6.142 | 7.226 | 10.076 | 1.903 | 2.648 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [17.237, 13.792, 22.48] | [8.418, 8.887, 11.323] | 1.889 | 22.561 | (5.30, 2.16, 0.48) | 8.338 | 0.9471 |
full box diagonal 31.507; per-axis 1-99 box diagonal 16.675; ratio 1.889


### repeat (Repeat 20.13 s (confirmation)) - 25181 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -5.922 | -4.117 | -3.462 | -2.434 | 1.405 | 4.983 | 8.046 | 12.969 | 15.613 | 1.292 | 2.472 |
| y | -18.648 | -7.682 | -6.608 | -4.670 | 2.346 | 4.466 | 4.954 | 6.030 | 9.063 | 1.362 | 2.843 |
| z | -1.195 | 3.484 | 4.867 | 5.805 | 7.210 | 10.205 | 12.469 | 13.906 | 19.006 | 7.583 | 1.516 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [21.535, 27.711, 20.201] | [11.508, 11.562, 7.602] | 2.250 | 24.260 | (2.29, -0.83, 8.67) | 8.999 | 0.9431 |
full box diagonal 40.494; per-axis 1-99 box diagonal 17.998; ratio 2.250


### stress-10.03 (10.03 s stress) - 34342 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -9.313 | -7.417 | -6.397 | -4.712 | 0.752 | 8.381 | 11.582 | 15.943 | 27.417 | 1.474 | 4.045 |
| y | -34.832 | -10.938 | -8.532 | -6.910 | -0.142 | 8.625 | 9.136 | 10.201 | 20.498 | 0.780 | 5.600 |
| z | -0.097 | 4.463 | 7.265 | 9.252 | 14.264 | 18.761 | 20.599 | 21.998 | 45.501 | 13.902 | 3.154 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [36.73, 55.329, 45.598] | [17.979, 17.668, 13.334] | 2.825 | 36.055 | (2.59, 0.30, 13.93) | 14.258 | 0.9440 |
full box diagonal 80.558; per-axis 1-99 box diagonal 28.517; ratio 2.825


### sweep-10.21 (10.21 s sweep) - 25811 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -15.705 | -10.648 | -9.310 | -7.857 | 0.010 | 7.929 | 11.722 | 15.071 | 21.480 | -0.300 | 5.045 |
| y | -23.648 | -12.749 | -11.310 | -9.507 | 1.594 | 8.050 | 8.815 | 10.220 | 22.218 | 0.862 | 5.995 |
| z | -0.828 | 7.020 | 8.611 | 10.236 | 13.556 | 19.206 | 22.341 | 26.249 | 39.406 | 13.978 | 2.840 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [37.185, 45.867, 40.233] | [21.032, 20.125, 13.73] | 2.220 | 39.482 | (1.21, -1.25, 15.48) | 16.093 | 0.9439 |
full box diagonal 71.451; per-axis 1-99 box diagonal 32.185; ratio 2.220


### sweep-14.59 (14.59 s sweep) - 27466 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -7.121 | -3.649 | -3.251 | -2.823 | 2.534 | 6.529 | 9.559 | 12.836 | 14.705 | 2.082 | 3.013 |
| y | -18.705 | -7.977 | -6.344 | -4.496 | 1.104 | 4.210 | 4.709 | 5.011 | 16.991 | 0.581 | 2.903 |
| z | 0.404 | 2.622 | 4.716 | 5.643 | 7.134 | 9.867 | 11.734 | 13.959 | 16.566 | 7.383 | 1.345 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [21.826, 35.697, 16.163] | [12.81, 11.053, 7.018] | 2.449 | 23.853 | (3.15, -0.82, 8.23) | 9.158 | 0.9425 |
full box diagonal 44.854; per-axis 1-99 box diagonal 18.317; ratio 2.449


### sweep-15.00 (15.00 s sweep) - 33284 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -2.177 | -0.312 | 0.354 | 0.926 | 5.080 | 7.782 | 9.988 | 11.625 | 13.088 | 4.711 | 2.251 |
| y | -11.029 | -5.527 | -4.997 | -4.030 | 2.621 | 4.903 | 5.248 | 5.534 | 7.477 | 1.348 | 3.190 |
| z | -14.682 | 0.481 | 2.550 | 3.433 | 6.011 | 9.171 | 10.870 | 12.081 | 13.466 | 6.116 | 1.664 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [15.264, 18.506, 28.148] | [9.634, 10.246, 8.32] | 2.263 | 19.986 | (5.17, 0.13, 6.71) | 8.170 | 0.9425 |
full box diagonal 36.983; per-axis 1-99 box diagonal 16.340; ratio 2.263


### sweep-4k-14.62 (4K 14.62 s sweep) - 18461 splats

| axis | min | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | mean | std |
|---|---|---|---|---|---|---|---|---|---|---|---|
| x | -1.425 | 0.310 | 1.395 | 1.975 | 5.162 | 8.704 | 10.195 | 11.205 | 12.370 | 5.224 | 2.115 |
| y | -3.758 | -2.044 | -1.229 | -0.326 | 5.349 | 6.546 | 6.840 | 7.252 | 8.856 | 4.456 | 2.183 |
| z | -0.311 | 0.966 | 2.181 | 2.940 | 5.193 | 8.656 | 10.396 | 11.191 | 11.961 | 5.443 | 1.653 |

| full box | 1-99 box | full/robust diag | p0.1-99.9 diag | robust center | robust radius | frac inside 1-99 box |
|---|---|---|---|---|---|---|
| [13.795, 12.614, 12.272] | [8.8, 8.068, 8.215] | 1.543 | 17.597 | (5.80, 2.81, 6.29) | 7.246 | 0.9439 |
full box diagonal 22.361; per-axis 1-99 box diagonal 14.492; ratio 1.543


## Splat scale (longest linear axis L = exp(max(scale_0..2)))

| take | L p50 | L p90 | L p99 | L p99.9 | L max | max/median | p99/median | n L>0.5 | n L>1 | n L>2 | n L>4x med | n L>8x med | n L>16x med |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| golden | 0.0874 | 0.3679 | 1.3668 | 3.7155 | 8.3729 | 95.8 | 15.6 | 1809 | 498 | 123 | 2930 | 975 | 270 |
| repeat | 0.0874 | 0.4169 | 1.2840 | 4.4817 | 15.6426 | 179.0 | 14.7 | 2055 | 467 | 95 | 3174 | 1059 | 221 |
| stress-10.03 | 0.1534 | 0.5698 | 2.2535 | 6.1257 | 17.7254 | 115.6 | 14.7 | 4368 | 1324 | 407 | 2976 | 947 | 274 |
| sweep-10.21 | 0.1850 | 0.7788 | 2.5536 | 6.1257 | 24.2278 | 131.0 | 13.8 | 4836 | 1557 | 443 | 2664 | 798 | 167 |
| sweep-14.59 | 0.0874 | 0.4169 | 1.4550 | 4.2102 | 17.7254 | 202.9 | 16.7 | 2158 | 552 | 120 | 3287 | 1140 | 297 |
| sweep-15.00 | 0.0821 | 0.3456 | 1.0645 | 2.8936 | 10.7510 | 131.0 | 13.0 | 1751 | 371 | 59 | 3350 | 960 | 198 |
| sweep-4k-14.62 | 0.0990 | 0.4437 | 1.2840 | 2.8936 | 6.9414 | 70.1 | 13.0 | 1574 | 328 | 42 | 2100 | 589 | 97 |

Note: reconstruction units are arbitrary (COLMAP scale), so absolute caps only make sense relative to each take's own percentiles; the count columns are provided as asked, and the **relative** counts (multiples of that take's median L) are the comparable measure.


## Opacity (linear alpha = sigmoid(csv opacity))

| take | p0.1 | p1 | p5 | p50 | p95 | p99 | p99.9 | max | n<0.01 | n<0.02 | n<0.05 | n<0.10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| golden | 0.008 | 0.020 | 0.039 | 0.208 | 0.686 | 0.871 | 0.965 | 0.992 | 31 | 368 | 2011 | 5994 |
| repeat | 0.012 | 0.020 | 0.047 | 0.255 | 0.710 | 0.899 | 0.976 | 0.996 | 17 | 284 | 1411 | 4061 |
| stress-10.03 | 0.008 | 0.020 | 0.051 | 0.247 | 0.757 | 0.929 | 0.984 | 0.996 | 45 | 361 | 1688 | 5397 |
| sweep-10.21 | 0.012 | 0.020 | 0.043 | 0.235 | 0.706 | 0.902 | 0.980 | 0.996 | 24 | 285 | 1564 | 4691 |
| sweep-14.59 | 0.010 | 0.020 | 0.047 | 0.224 | 0.659 | 0.863 | 0.969 | 0.996 | 28 | 310 | 1552 | 4896 |
| sweep-15.00 | 0.008 | 0.020 | 0.043 | 0.239 | 0.714 | 0.890 | 0.965 | 0.988 | 37 | 409 | 1991 | 5908 |
| sweep-4k-14.62 | 0.012 | 0.020 | 0.039 | 0.224 | 0.671 | 0.882 | 0.969 | 0.988 | 14 | 260 | 1329 | 3668 |

Minimum alpha is 0.0039-0.0118; the SPZ alpha grid (`k/255`) means the lowest representable non-zero alpha is 1/255 = 0.0039. There is no alpha = 0 population (SPZ drops invisible splats).


## Distance from robust center

| take | p50 | p95 | p99 | max | max/R | n > 1.5R | n > 2R | n > 2.5R | n > 3R |
|---|---|---|---|---|---|---|---|---|---|
| golden | 4.369 | 6.288 | 8.047 | 17.452 | 2.09 | 6 | 1 | 0 | 0 |
| repeat | 4.787 | 6.525 | 8.039 | 21.462 | 2.38 | 10 | 1 | 0 | 0 |
| stress-10.03 | 7.454 | 10.011 | 12.879 | 37.371 | 2.62 | 14 | 6 | 3 | 0 |
| sweep-10.21 | 8.748 | 11.593 | 13.470 | 36.883 | 2.29 | 3 | 1 | 0 | 0 |
| sweep-14.59 | 4.686 | 6.637 | 7.920 | 21.903 | 2.39 | 4 | 2 | 0 | 0 |
| sweep-15.00 | 4.455 | 5.965 | 6.438 | 23.125 | 2.83 | 2 | 1 | 1 | 0 |
| sweep-4k-14.62 | 3.982 | 5.543 | 6.392 | 9.319 | 1.29 | 0 | 0 | 0 | 0 |

The 1-99 box is already scene-sized, so 'far' is a weak discriminator: the median distance is ~0.5R and no take has more than a handful of splats beyond 2R.


## Haze / streak suspects

Primary = **L > 8 x median(L)** OR **distance > 2R**, where L is the splat's longest linear axis.

| take | long (8x med) | long+far | far (>2R) | either | % of splats | share of total L | median alpha of suspects | suspects alpha<0.05 | big but central (L>8x med within 1R) |
|---|---|---|---|---|---|---|---|---|---|
| golden | 975 | 1 | 1 | 975 | 3.55% | 27.4% | 0.145 | 129 | 806 |
| repeat | 1059 | 1 | 1 | 1059 | 4.21% | 29.5% | 0.157 | 102 | 963 |
| stress-10.03 | 947 | 5 | 6 | 948 | 2.76% | 23.9% | 0.129 | 160 | 831 |
| sweep-10.21 | 798 | 1 | 1 | 798 | 3.09% | 23.4% | 0.125 | 126 | 773 |
| sweep-14.59 | 1140 | 2 | 2 | 1140 | 4.15% | 30.2% | 0.157 | 123 | 1067 |
| sweep-15.00 | 960 | 1 | 1 | 960 | 2.88% | 22.2% | 0.141 | 137 | 899 |
| sweep-4k-14.62 | 589 | 0 | 0 | 589 | 3.19% | 21.8% | 0.149 | 71 | 557 |

Splats with L > 4x/8x/16x median are reported as counts and as share of the summed L in `analysis/spz-stats.json` (`suspects.long_*`). The striking result is that long splats are **not** far from the centre: 95%+ of them sit within 2R, i.e. the haze/streak mass is inside the scene volume rather than a distant shell.


## Measured candidate filter yields (conservative cleanup trial, CPU only)

| take | cap L=p99 (kept) | cap L=p99.5 | cap L=p99.9 | alpha<0.02 | distance>2R | combo: p99.9 cap OR (alpha<0.02 & L>median) OR dist>2R |
|---|---|---|---|---|---|---|
| golden | 270 (0.98%) | 135 (0.49%) | 26 (0.09%) | 368 (1.34%) | 1 (0.00%) | 239 (0.87%) |
| repeat | 248 (0.98%) | 121 (0.48%) | 23 (0.09%) | 284 (1.13%) | 1 (0.00%) | 225 (0.89%) |
| stress-10.03 | 317 (0.92%) | 153 (0.45%) | 34 (0.10%) | 361 (1.05%) | 6 (0.02%) | 275 (0.80%) |
| sweep-10.21 | 234 (0.91%) | 111 (0.43%) | 24 (0.09%) | 285 (1.10%) | 1 (0.00%) | 227 (0.88%) |
| sweep-14.59 | 263 (0.96%) | 120 (0.44%) | 24 (0.09%) | 310 (1.13%) | 2 (0.01%) | 254 (0.92%) |
| sweep-15.00 | 322 (0.97%) | 152 (0.46%) | 30 (0.09%) | 409 (1.23%) | 1 (0.00%) | 262 (0.79%) |
| sweep-4k-14.62 | 177 (0.96%) | 79 (0.43%) | 16 (0.09%) | 260 (1.41%) | 0 (0.00%) | 133 (0.72%) |

All filter counts are **measured on the CSV export** (not applied to SPZ). Recommended caps per take are in `analysis/DIAGNOSTICS.md`.


## Converter `--stats json` cross-check

| take | numGaussians | shBands | model | fillRatio |
|---|---|---|---|---|
| golden | 27447 | 3 | default | 27.47 |
| repeat | 25181 | 3 | default | 20.24 |
| stress-10.03 | 34342 | 3 | default | 22.75 |
| sweep-10.21 | 25811 | 3 | default | 20.68 |
| sweep-14.59 | 27466 | 3 | default | 21.95 |
| sweep-15.00 | 33284 | 3 | default | 23.70 |
| sweep-4k-14.62 | 18461 | 3 | default | 19.91 |

fillRatio (tool definition: total splat footprint over the robust p1-p99 cross-section) is 19.9-27.5 for every take - healthy per the tool docs (degenerate scenes score orders of magnitude higher). It does not separate the takes usefully.


## Filter semantics check

`analysis/filter-semantics.json`:

- `--filter-value scale_0,gt,1` -> 220 rows (linear prediction 220, raw-column prediction 27): **linear**

- `--filter-value opacity,gt,0.5` -> 3646 rows (linear prediction 3646, raw-column prediction 1956): **linear**

- `--filter-value scale_0,gt,0.5` -> 761 rows (linear prediction 761, raw-column prediction 83): **linear**
