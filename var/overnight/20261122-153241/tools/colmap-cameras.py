"""Parse a COLMAP sparse text model (images.txt) and report camera coverage.

Usage: python colmap-cameras.py <model_dir> [out.json] [--frames-dir <dir>]
Writes camera centers, viewing directions, azimuth histogram and a subject region
based on the camera constellation. COLMAP convention: world-to-camera
X_c = R * X_w + t, camera center C = -R^T * t.
"""
import json
import math
import os
import struct
import sys

import numpy as np


def read_binary_images(model_dir):
    """Legacy COLMAP images.bin parser (returns list of pose dicts)."""
    with open(os.path.join(model_dir, "images.bin"), "rb") as handle:
        data = handle.read()
    offset = 0
    (num_images,) = struct.unpack_from("<Q", data, offset)
    offset += 8
    images = []
    for _ in range(num_images):
        image_id, qw, qx, qy, qz, tx, ty, tz, camera_id = struct.unpack_from(
            "<i4d3di", data, offset
        )
        offset += 4 + 32 + 24 + 4
        end = data.index(b"\x00", offset)
        name = data[offset:end].decode("utf-8", "replace")
        offset = end + 1
        (num_points,) = struct.unpack_from("<Q", data, offset)
        offset += 8 + num_points * 24
        images.append(
            {
                "image_id": image_id,
                "qvec": (qw, qx, qy, qz),
                "tvec": np.array([tx, ty, tz]),
                "name": name,
            }
        )
    return images


def quat_to_rot(qw, qx, qy, qz):
    n = math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    if n == 0:
        return np.eye(3)
    qw, qx, qy, qz = qw / n, qx / n, qy / n, qz / n
    return np.array(
        [
            [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
            [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
            [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
        ]
    )


def main() -> None:
    model_dir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
    frames_dir = None
    if "--frames-dir" in sys.argv:
        frames_dir = sys.argv[sys.argv.index("--frames-dir") + 1]
    images_txt = os.path.join(model_dir, "images.txt")
    cameras = {}
    if os.path.exists(images_txt):
        with open(images_txt, "r", encoding="utf-8") as handle:
            lines = [line.rstrip("\n") for line in handle]
        index = 0
        while index < len(lines):
            line = lines[index].strip()
            index += 1
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 10:
                continue
            image_id = int(parts[0])
            qw, qx, qy, qz = (float(value) for value in parts[1:5])
            tx, ty, tz = (float(value) for value in parts[5:8])
            name = parts[9]
            rot = quat_to_rot(qw, qx, qy, qz)
            t = np.array([tx, ty, tz])
            center = -rot.T @ t
            forward = rot.T @ np.array([0.0, 0.0, 1.0])  # camera +Z axis in world
            cameras[name] = {
                "image_id": image_id,
                "center": center.tolist(),
                "forward": forward.tolist(),
            }
            # Skip the 2D point line that follows each image line.
            index += 1
    else:
        for image in read_binary_images(model_dir):
            qw, qx, qy, qz = image["qvec"]
            rot = quat_to_rot(qw, qx, qy, qz)
            t = image["tvec"]
            center = -rot.T @ t
            forward = rot.T @ np.array([0.0, 0.0, 1.0])
            cameras[image["name"]] = {
                "image_id": image["image_id"],
                "center": center.tolist(),
                "forward": forward.tolist(),
            }

    names = sorted(cameras, key=lambda value: int(os.path.splitext(value)[0]) if os.path.splitext(value)[0].isdigit() else value)
    centers = np.array([cameras[name]["center"] for name in names])
    forwards = np.array([cameras[name]["forward"] for name in names])
    centroid = centers.mean(axis=0)
    distances = np.linalg.norm(centers - centroid, axis=1)
    azimuths = np.degrees(np.arctan2(centers[:, 0] - centroid[0], centers[:, 2] - centroid[2]))
    elevation = np.degrees(
        np.arctan2(
            centers[:, 1] - centroid[1],
            np.linalg.norm(centers[:, [0, 2]] - centroid[[0, 2]], axis=1),
        )
    )
    bins = 12
    histogram = [0] * bins
    for azimuth in azimuths:
        histogram[int(((azimuth + 360.0) % 360.0) // (360.0 / bins))] += 1
    steps = np.diff(np.sort(azimuths))
    # Mean viewing direction concentration (forward vectors point into the scene).
    mean_forward = forwards.mean(axis=0)
    concentration = float(np.linalg.norm(mean_forward))
    mean_forward = (mean_forward / np.linalg.norm(mean_forward)).tolist() if concentration > 1e-9 else [0, 0, 0]
    # Subject region heuristic: chair sits near the camera-orbit centroid, inside
    # a radius well below the camera ring. Also use the intersection of forward
    # rays (least-squares closest point to all rays) as a second estimate.
    ray_target = None
    if len(centers) >= 3:
        # Solve for point minimizing sum ||(I - d d^T)(p - c)||^2.
        a = np.zeros((3, 3))
        b = np.zeros(3)
        for center, forward in zip(centers, forwards):
            projector = np.eye(3) - np.outer(forward, forward)
            a += projector
            b += projector @ center
        try:
            ray_target = np.linalg.solve(a, b).tolist()
        except np.linalg.LinAlgError:
            ray_target = None
    subject_center = centroid
    if ray_target is not None:
        subject_center = (centroid + np.array(ray_target)) / 2.0
    result = {
        "model": model_dir,
        "images": len(names),
        "names": names,
        "centers": centers.tolist(),
        "centroid": centroid.tolist(),
        "ray_target": ray_target,
        "subject_center": subject_center.tolist(),
        "camera_distance": {
            "min": float(distances.min()),
            "median": float(np.median(distances)),
            "max": float(distances.max()),
        },
        "radius_candidates": {
            "camera_median_0.35": float(0.35 * np.median(distances)),
            "camera_median_0.5": float(0.5 * np.median(distances)),
            "camera_min_0.8": float(0.8 * distances.min()),
        },
        "azimuth": {
            "bins": bins,
            "histogram": histogram,
            "occupied_bins": int(sum(1 for value in histogram if value > 0)),
            "occupied_fraction": float(sum(1 for value in histogram if value > 0) / bins),
            "min": float(azimuths.min()),
            "max": float(azimuths.max()),
            "step_median": float(np.median(steps)) if len(steps) else None,
            "step_p90": float(np.percentile(steps, 90)) if len(steps) else None,
        },
        "elevation": {
            "min": float(elevation.min()),
            "median": float(np.median(elevation)),
            "max": float(elevation.max()),
        },
        "forward_concentration": concentration,
        "mean_forward": mean_forward,
        "cameras": cameras,
    }
    if frames_dir and names:
        picks = {"first": names[0], "middle": names[len(names) // 2], "last": names[-1]}
        result["source_views"] = {
            role: {"name": name, **cameras[name]} for role, name in picks.items()
        }
        result["frames_dir"] = frames_dir
    text = json.dumps(result, indent=2)
    if out:
        with open(out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key not in ("centers", "cameras", "names")
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
