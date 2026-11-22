"""Parse COLMAP binary images.bin without pycolmap.

Usage: python colmap-images-bin.py <model_dir> [out.json]
Legacy images.bin layout:
  uint64 num_reg_images
  repeat: int32 image_id, double qvec[4] (w,x,y,z), double tvec[3],
          int32 camera_id, C string name, uint64 num_points2D,
          num_points2D * { double x, double y, uint64 point3D_id }
If the layout has extra rig/frame fields (COLMAP 4.x), the parser reports the
failing offset instead of guessing.
"""
import json
import struct
import sys


def read_cstring(buffer, offset):
    end = buffer.index(b"\x00", offset)
    return buffer[offset:end].decode("utf-8", "replace"), end + 1


def main() -> None:
    model_dir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    with open(model_dir + "/images.bin", "rb") as handle:
        data = handle.read()
    offset = 0
    (num_images,) = struct.unpack_from("<Q", data, offset)
    offset += 8
    images = []
    try:
        for _ in range(num_images):
            (image_id, qw, qx, qy, qz, tx, ty, tz, camera_id) = struct.unpack_from(
                "<i4d3di", data, offset
            )
            offset += 4 + 32 + 24 + 4
            name, offset = read_cstring(data, offset)
            (num_points,) = struct.unpack_from("<Q", data, offset)
            offset += 8 + num_points * 24
            images.append(
                {
                    "image_id": image_id,
                    "qvec": [qw, qx, qy, qz],
                    "tvec": [tx, ty, tz],
                    "camera_id": camera_id,
                    "name": name,
                    "num_points2D": num_points,
                }
            )
        trailing = len(data) - offset
    except (struct.error, ValueError) as error:
        print(json.dumps({"error": str(error), "offset": offset, "images_read": len(images)}))
        raise SystemExit(1)
    result = {
        "model": model_dir,
        "num_images": num_images,
        "images": images,
        "trailing_bytes": trailing,
    }
    text = json.dumps(result, indent=2)
    if out:
        with open(out, "w", encoding="utf-8") as handle:
            handle.write(text + "\n")
    print(
        json.dumps(
            {
                "num_images": num_images,
                "trailing_bytes": trailing,
                "first": images[0]["name"] if images else None,
                "last": images[-1]["name"] if images else None,
                "points": [image["num_points2D"] for image in images[:5]],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
