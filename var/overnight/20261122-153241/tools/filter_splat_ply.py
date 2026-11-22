"""Filter a Gaussian-splat PLY (Brush export layout) without external deps.

Usage: python filter_splat_ply.py in.ply out.ply [predicates...]

Predicates are ANDed; each removes splats:
  --max-scale S          drop splats whose longest linear axis > S
  --min-opacity A        drop splats whose linear opacity < A
  --sphere cx,cy,cz,r    keep only splats inside the sphere (world units)
  --box x0,y0,z0,x1,y1,z1 keep only splats inside the axis-aligned box
  --percentile-box LO,HI keep only splats whose center is inside the per-axis
                         LO..HI percentile box

Values are read from the raw PLY columns. Brush writes scale_* as log-scale and
opacity as a logit, matching the 3DGS PLY convention; the script verifies the
encoding by sampling and prints a summary before writing.
"""
import argparse
import json
import struct
import sys

import numpy as np


def read_ply(path):
    with open(path, "rb") as handle:
        header_end = None
        header = b""
        while True:
            line = handle.readline()
            if not line:
                raise SystemExit("PLY header truncated")
            header += line
            if line.strip() == b"end_header":
                header_end = True
                break
        text = header.decode("ascii", "replace")
        if "format binary_little_endian 1.0" not in text:
            raise SystemExit("only binary_little_endian PLY is supported")
        vertex_count = None
        properties = []
        in_vertex = False
        for line in text.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == "element":
                in_vertex = parts[1] == "vertex"
                if in_vertex:
                    vertex_count = int(parts[2])
            elif len(parts) >= 3 and parts[0] == "property" and in_vertex:
                kind, name = parts[1], parts[2]
                if kind != "float":
                    raise SystemExit(f"unsupported property type {kind} for {name}")
                properties.append(name)
        if vertex_count is None or not properties:
            raise SystemExit("no vertex element in PLY")
        data = handle.read()
    dtype = np.dtype([(name, "<f4") for name in properties])
    if len(data) != vertex_count * dtype.itemsize:
        raise SystemExit(
            f"payload size mismatch: {len(data)} != {vertex_count * dtype.itemsize}"
        )
    return text, np.frombuffer(data, dtype=dtype), properties


def write_ply(path, header, table):
    lines = []
    for line in header.splitlines():
        if line.startswith("element vertex"):
            continue
        lines.append(line)
        if line.startswith("format "):
            lines.append(f"element vertex {len(table)}")
    body = table.tobytes(order="C")
    with open(path, "wb") as handle:
        handle.write(("\n".join(lines) + "\n").encode("ascii"))
        handle.write(body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--max-scale", type=float)
    parser.add_argument("--min-opacity", type=float)
    parser.add_argument("--sphere")
    parser.add_argument("--box")
    parser.add_argument("--percentile-box")
    parser.add_argument("--json-out")
    args = parser.parse_args()

    header, table, properties = read_ply(args.input)
    total = len(table)
    keep = np.ones(total, dtype=bool)
    summary = {"input": args.input, "count_in": int(total), "predicates": {}}

    xyz = np.stack([table["x"], table["y"], table["z"]], axis=1).astype(np.float64)
    scale_columns = [name for name in ("scale_0", "scale_1", "scale_2") if name in properties]
    scales = np.stack([table[name] for name in scale_columns], axis=1).astype(np.float64)
    # Brush writes log-scale columns; detect and convert.
    log_scale = bool(np.nanmedian(np.abs(scales)) < 20 and np.nanmax(scales) < 20)
    linear_scales = np.exp(np.clip(scales, -30, 30)) if log_scale else scales
    longest = linear_scales.max(axis=1)
    opacity_raw = table["opacity"].astype(np.float64)
    # 3DGS PLY stores logit opacity in [0,1] after sigmoid; detect.
    logit_opacity = bool(np.nanmin(opacity_raw) < -0.01 or np.nanmax(opacity_raw) > 1.01)
    opacity = 1.0 / (1.0 + np.exp(-opacity_raw)) if logit_opacity else opacity_raw

    if args.max_scale is not None:
        mask = longest <= args.max_scale
        summary["predicates"]["max_scale"] = {
            "threshold": args.max_scale,
            "kept": int(mask.sum()),
            "removed": int(total - mask.sum()),
        }
        keep &= mask
    if args.min_opacity is not None:
        mask = opacity >= args.min_opacity
        summary["predicates"]["min_opacity"] = {
            "threshold": args.min_opacity,
            "kept": int(mask.sum()),
            "removed": int(total - mask.sum()),
        }
        keep &= mask
    if args.percentile_box:
        low, high = (float(value) for value in args.percentile_box.split(","))
        lows = np.percentile(xyz, low, axis=0)
        highs = np.percentile(xyz, high, axis=0)
        mask = np.all((xyz >= lows) & (xyz <= highs), axis=1)
        summary["percentile_box"] = {
            "percentiles": [low, high],
            "min": lows.tolist(),
            "max": highs.tolist(),
        }
        keep &= mask
    if args.sphere:
        cx, cy, cz, radius = (float(value) for value in args.sphere.split(","))
        distance = np.linalg.norm(xyz - np.array([cx, cy, cz]), axis=1)
        mask = distance <= radius
        summary["sphere"] = {
            "center": [cx, cy, cz],
            "radius": radius,
            "kept": int(mask.sum()),
        }
        keep &= mask
    if args.box:
        values = [float(value) for value in args.box.split(",")]
        lows = np.array(values[0:3])
        highs = np.array(values[3:6])
        mask = np.all((xyz >= lows) & (xyz <= highs), axis=1)
        summary["box"] = {"min": lows.tolist(), "max": highs.tolist(), "kept": int(mask.sum())}
        keep &= mask

    filtered = table[keep]
    summary.update(
        {
            "count_out": int(len(filtered)),
            "removed_total": int(total - len(filtered)),
            "removed_fraction": float(1.0 - len(filtered) / total) if total else 0.0,
            "log_scale_columns": log_scale,
            "logit_opacity": logit_opacity,
            "scale_linear_p50": float(np.median(longest)),
            "scale_linear_p99": float(np.percentile(longest, 99)),
            "scale_linear_max": float(longest.max()),
            "opacity_p50": float(np.median(opacity)),
        }
    )
    if len(filtered) == 0:
        raise SystemExit("filter removed every splat")
    write_ply(args.output, header, filtered)
    text = json.dumps(summary, indent=2)
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
