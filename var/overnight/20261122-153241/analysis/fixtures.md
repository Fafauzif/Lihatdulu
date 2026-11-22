# Fixture verification - overnight run 20261122-153241

Verified 2026-11-22T08:54:03.418582+00:00. Method and machine-readable copy: `analysis/fixtures.json`, script `analysis/spz_stats.py::verify_fixtures`.

## Checks performed per take

1. `job.json` parses as JSON (the pinned lock bytes differ from the live copy for all seven job.json files - recorded in the run preflight/ledger; the SPZs and stills match pinned hashes, so the JSON is only used for metadata and is re-validated here).

2. `artifact.bytes` in job.json equals the actual `output/scan.spz` size on disk.

3. `artifact.splatCount` is plausible: equals the SPZ v4 header `numPoints` and the row count of the `--filter-nan` CSV export (i.e. no NaNs were removed).

4. Three stills exist, are non-empty, and are exactly the names declared in `artifact.stills`.

5. SPZ header flags: version 4, SH degree 3, fractionalBits 12, flags 0 for every take.


## Table

| take | job.json | bytes decl / actual | splats decl / header / csv | stills | frames ext/reg | duration job / map | media | pass |
|---|---|---|---|---|---|---|---|---|
| Golden 25.35 s (tuning)<br>`0283ca80` | parses=yes | 544854 / 544854 OK | 27447 / 27447 / 27447 OK | 000.jpg (291019 B), 001.jpg (278481 B), 002.jpg (275760 B) | 76 / 76 | 25.3 s / 25.35 s | 1920x1080 | PASS |
| Repeat 20.13 s (confirmation)<br>`a3e551df` | parses=yes | 495405 / 495405 OK | 25181 / 25181 / 25181 OK | 000.jpg (292103 B), 001.jpg (236323 B), 002.jpg (271278 B) | 60 / 60 | 20.1 s / 20.13 s | 1920x1080 | PASS |
| 10.03 s stress<br>`f4755525` | parses=yes | 708640 / 708640 OK | 34342 / 34342 / 34342 OK | 000.jpg (288550 B), 001.jpg (297202 B), 002.jpg (161595 B) | 60 / 60 | 10.0 s / 10.03 s | 1920x1080 | PASS |
| 10.21 s sweep<br>`15d33c98` | parses=yes | 523603 / 523603 OK | 25811 / 25811 / 25811 OK | 000.jpg (271593 B), 001.jpg (235395 B), 002.jpg (190160 B) | 60 / 60 | 10.2 s / 10.21 s | 1920x1080 | PASS |
| 14.59 s sweep<br>`bb588361` | parses=yes | 538833 / 538833 OK | 27466 / 27466 / 27466 OK | 000.jpg (293795 B), 001.jpg (253341 B), 002.jpg (233293 B) | 72 / 72 | 14.6 s / 14.59 s | 1920x1080 | PASS |
| 15.00 s sweep<br>`e8d4c2a3` | parses=yes | 651694 / 651694 OK | 33284 / 33284 / 33284 OK | 000.jpg (293706 B), 001.jpg (209233 B), 002.jpg (248181 B) | 74 / 74 | 15.0 s / 15.00 s | 1920x1080 | PASS |
| 4K 14.62 s sweep<br>`37a5694c` | parses=yes | 353915 / 353915 OK | 18461 / 18461 / 18461 OK | 000.jpg (418979 B), 001.jpg (242111 B), 002.jpg (339507 B) | 71 / 71 | 14.6 s / 14.62 s | 3840x2160 | PASS |

**Result: 7/7 takes pass all fixture checks.**


## Notes

- bytes/splat is 19.17-20.63 across takes (SPZ v4: positions 24-bit fixed point, rotation 3 B, scale 3 B, alpha 1 B, colour 3 B, SH band 3 payload - consistent).

- `--filter-nan` removed **0** splats in every take; `--stats json` reports `nanCount = 0` and `infCount = 0` for every column of every take.

- Golden is the only 76-frame take (25.3 s); Repeat/stress/10.21 s used 60 frames, 14.59 s 72, 15.00 s 74, 4K 71 frames. All takes registered 100% of extracted frames.

- Still 000/001/002 of Golden hash-match frames `0001.jpg`, `0039.jpg`, `0076.jpg` (first / middle / last) - used for the camera-coverage still mapping.
