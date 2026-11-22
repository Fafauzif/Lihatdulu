# Visual verdicts — Task 7 (programmatic; no image was viewed in chat)

Metrics come from the saved viewer-element PNGs (`viewer-1440.png` / `viewer-390.png`) and the
viewer's `data-splats`. Content = any pixel differing from the flat stage colour `#20261f` by more
than 2/255, which counts faint Gaussians without counting the stage. Labels are heuristics over
these numbers; nobody looked at the images, and a human contact sheet remains optional.

| clip | job | state | splats | viewer bytes | 1440 coverage | 390 coverage | 1440 edge frac | 1440 central share | label |
|---|---|---|---|---|---|---|---|---|---|
| `VID_20261121_184227976.mp4` | `0283ca80` | ready | 27447 | 121573 | 0.306 | 0.303 | 0.014 | 2.37 | recognizable chair |
| `VID_20261121_184349140.mp4` | `a3e551df` | ready | 25181 | 58331 | 0.097 | 0.171 | 0.045 | 2.65 | recognizable chair |
| `VID_20261121_184212135.mp4` | `f4755525` | ready | 34342 | 46346 | 0.071 | 0.149 | 0.059 | 2.51 | recognizable chair |
| `VID_20261121_184320272.mp4` | `15d33c98` | ready | 25811 | 60337 | 0.104 | 0.177 | 0.040 | 2.85 | recognizable chair |
| `VID_20261121_184453628.mp4` | `bb588361` | ready | 27466 | 55976 | 0.096 | 0.170 | 0.044 | 2.57 | recognizable chair |
| `VID_20261121_184626753.mp4` | `e8d4c2a3` | ready | 33284 | 69603 | 0.132 | 0.198 | 0.033 | 2.49 | recognizable chair |
| `VID_20261121_184714115.mp4` | `37a5694c` | ready | 18461 | 67801 | 0.117 | 0.188 | 0.036 | 3.03 | recognizable chair |

Label rules (documented so a later session can re-derive or contest them):

- `fragment only`: 1440 coverage < 4 % or splats < 5 000.
- `floating/cropped`: > 25 % of rendered pixels sit in the outer 2 % frame band AND the robust
  (2–98 percentile) content box spans > 90 % of both axes.
- `room dominates`: coverage > 25 % AND the central quarter is less than 1.6× the frame average
  (flat, edge-filled distribution).
- `recognizable chair`: everything else — centrally weighted, no edge clipping.

## Raw metrics

```json
[
  {
    "clip": "VID_20261121_184227976.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.3065,
      "edgeFraction": 0.014,
      "centralShare": 2.37,
      "robustWidth": 0.761,
      "robustHeight": 0.691
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.3027,
      "edgeFraction": 0.013,
      "centralShare": 2.12,
      "robustWidth": 0.747,
      "robustHeight": 0.66
    },
    "label": "recognizable chair"
  },
  {
    "clip": "VID_20261121_184349140.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.0969,
      "edgeFraction": 0.045,
      "centralShare": 2.65,
      "robustWidth": 0.9,
      "robustHeight": 0.973
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.1713,
      "edgeFraction": 0.024,
      "centralShare": 1.26,
      "robustWidth": 0.781,
      "robustHeight": 0.828
    },
    "label": "recognizable chair"
  },
  {
    "clip": "VID_20261121_184212135.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.0706,
      "edgeFraction": 0.059,
      "centralShare": 2.51,
      "robustWidth": 0.961,
      "robustHeight": 0.975
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.1495,
      "edgeFraction": 0.026,
      "centralShare": 1.02,
      "robustWidth": 0.793,
      "robustHeight": 0.695
    },
    "label": "recognizable chair"
  },
  {
    "clip": "VID_20261121_184320272.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.104,
      "edgeFraction": 0.04,
      "centralShare": 2.85,
      "robustWidth": 0.825,
      "robustHeight": 0.969
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.1771,
      "edgeFraction": 0.022,
      "centralShare": 1.41,
      "robustWidth": 0.781,
      "robustHeight": 0.778
    },
    "label": "recognizable chair"
  },
  {
    "clip": "VID_20261121_184453628.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.0957,
      "edgeFraction": 0.044,
      "centralShare": 2.57,
      "robustWidth": 0.913,
      "robustHeight": 0.973
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.1701,
      "edgeFraction": 0.023,
      "centralShare": 1.22,
      "robustWidth": 0.781,
      "robustHeight": 0.808
    },
    "label": "recognizable chair"
  },
  {
    "clip": "VID_20261121_184626753.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.1321,
      "edgeFraction": 0.033,
      "centralShare": 2.49,
      "robustWidth": 0.616,
      "robustHeight": 0.938
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.1979,
      "edgeFraction": 0.02,
      "centralShare": 1.39,
      "robustWidth": 0.775,
      "robustHeight": 0.857
    },
    "label": "recognizable chair"
  },
  {
    "clip": "VID_20261121_184714115.mp4",
    "wide": {
      "width": 685,
      "height": 514,
      "coverage": 0.1171,
      "edgeFraction": 0.036,
      "centralShare": 3.03,
      "robustWidth": 0.685,
      "robustHeight": 0.949
    },
    "narrow": {
      "width": 324,
      "height": 203,
      "coverage": 0.188,
      "edgeFraction": 0.021,
      "centralShare": 1.58,
      "robustWidth": 0.775,
      "robustHeight": 0.552
    },
    "label": "recognizable chair"
  }
]
```
