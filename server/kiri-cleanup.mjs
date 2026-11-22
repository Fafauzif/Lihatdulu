// KIRI's 3DGS export adds a synthetic backdrop: a ball of splats at one fixed
// radius, all with the same opacity and scale, sitting far outside the scanned
// subject. Left in place it dominates the bounding box, so the viewer frames a
// grey sphere instead of the furniture. This module removes only that ball, and
// only when the evidence is unambiguous; anything else is returned untouched.

const HEADER_END = "end_header";

// Returns null when the PLY is not the simple float layout we expect, so a
// surprising file is always passed through unchanged.
export function readPlyHeader(buffer) {
  const head = buffer.subarray(0, Math.min(buffer.length, 1 << 20)).toString("latin1");
  const marker = head.indexOf(HEADER_END);
  if (marker === -1) return null;
  const endOfHeader = marker + HEADER_END.length;
  const lineEnd = head.indexOf("\n", endOfHeader);
  const bodyStart = lineEnd === -1 ? head.length : lineEnd + 1;
  const lines = head.slice(0, marker).split(/\r?\n/);
  if (lines[0]?.trim() !== "ply") return null;
  let format = null;
  let count = 0;
  const props = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "format") format = parts[1];
    else if (parts[0] === "element") {
      if (parts[1] !== "vertex") return null;
      count = Number(parts[2]);
    } else if (parts[0] === "property") {
      if (parts[1] !== "float") return null;
      props.push(parts[2]);
    }
  }
  if (format !== "binary_little_endian" || !count || props.length < 14) return null;
  const rowBytes = props.length * 4;
  if (buffer.length < bodyStart + count * rowBytes) return null;
  return {
    count,
    props,
    headerText: head.slice(0, bodyStart),
    bodyStart,
    rowBytes,
  };
}

export function stripBackdrop(
  buffer,
  { share = 0.05, minCount = 200, medianMultiple = 5 } = {},
) {
  const unchanged = { buffer, removed: 0, reason: null };
  const head = readPlyHeader(buffer);
  if (!head) return unchanged;
  const ix = head.props.indexOf("x");
  const iy = head.props.indexOf("y");
  const iz = head.props.indexOf("z");
  const io = head.props.indexOf("opacity");
  if ([ix, iy, iz, io].includes(-1)) return unchanged;

  // The header length is arbitrary, so the body is not guaranteed to be 4-byte
  // aligned; read through a DataView instead of a Float32Array view.
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const stride = head.rowBytes;
  const radius = new Float64Array(head.count);
  const keys = new Array(head.count);
  for (let i = 0; i < head.count; i += 1) {
    const base = head.bodyStart + i * stride;
    const x = data.getFloat32(base + ix * 4, true);
    const y = data.getFloat32(base + iy * 4, true);
    const z = data.getFloat32(base + iz * 4, true);
    const alpha = 1 / (1 + Math.exp(-data.getFloat32(base + io * 4, true)));
    const r = Math.hypot(x, y, z);
    radius[i] = r;
    keys[i] = `${Math.round(r)}:${Math.round(alpha * 100)}`;
  }

  const median = Float64Array.from(radius).sort()[Math.floor(head.count / 2)] || 0;
  if (!median) return unchanged;

  const buckets = new Map();
  for (const key of keys) {
    const bucket = buckets.get(key);
    if (bucket) bucket.count += 1;
    else buckets.set(key, { key, count: 1 });
  }

  let candidate = null;
  for (const bucket of buckets.values()) {
    if (bucket.count < minCount) continue;
    if (bucket.count / head.count < share) continue;
    const bucketRadius = Number(bucket.key.split(":")[0]);
    if (bucketRadius < median * medianMultiple) continue;
    if (!candidate || bucket.count > candidate.count) candidate = bucket;
  }
  if (!candidate) return unchanged;

  let min = Infinity;
  let max = -Infinity;
  let removed = 0;
  for (let i = 0; i < head.count; i += 1) {
    if (keys[i] !== candidate.key) continue;
    removed += 1;
    min = Math.min(min, radius[i]);
    max = Math.max(max, radius[i]);
  }
  // A real reconstruction is never a perfect shell; require a tight radius.
  if (!removed || max - min > 1) return unchanged;
  if ((head.count - removed) / head.count < 0.5) return unchanged;

  const newHeader = head.headerText.replace(
    `element vertex ${head.count}`,
    `element vertex ${head.count - removed}`,
  );
  const out = Buffer.allocUnsafe(newHeader.length + (head.count - removed) * head.rowBytes);
  out.write(newHeader, 0, "latin1");
  let offset = newHeader.length;
  for (let i = 0; i < head.count; i += 1) {
    if (keys[i] === candidate.key) continue;
    const start = head.bodyStart + i * head.rowBytes;
    out.set(buffer.subarray(start, start + head.rowBytes), offset);
    offset += head.rowBytes;
  }
  return { buffer: out, removed, reason: "kiri-backdrop" };
}


// --- subject crop ----------------------------------------------------------

// KIRI's ZIP also carries cameras.json: one entry per photo with a position and
// a 3x3 rotation. The export is a whole room, and for a 360° orbit the subject
// sits where the optical axes meet, so the crossing point is a centre that does
// not depend on the backdrop or the walls.

export function readCameras(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.cameras)
      ? parsed.cameras
      : null;
  if (!list || list.length < 3) return null;
  const cameras = [];
  for (const entry of list) {
    const position = entry?.position;
    const rotation = entry?.rotation;
    if (!Array.isArray(position) || position.length < 3) continue;
    if (!Array.isArray(rotation) || rotation.length < 3) continue;
    const numbers = position.slice(0, 3).map(Number);
    if (numbers.some((value) => !Number.isFinite(value))) continue;
    const matrix = rotation.slice(0, 3).map((row) => {
      if (!Array.isArray(row) || row.length < 3) return null;
      const values = row.slice(0, 3).map(Number);
      return values.every((value) => Number.isFinite(value)) ? values : null;
    });
    if (matrix.some((row) => !row)) continue;
    cameras.push({ position: numbers, rotation: matrix });
  }
  return cameras.length >= 3 ? cameras : null;
}

// Least-squares meeting point of the camera axes. Rotation may be stored as
// camera-to-world or world-to-camera, so the direction is chosen by checking
// which reading points at the middle of the camera ring.
export function orbitCenter(cameras) {
  if (!Array.isArray(cameras) || cameras.length < 3) return null;
  const count = cameras.length;
  const centroid = [0, 0, 0];
  for (const { position } of cameras)
    for (let axis = 0; axis < 3; axis += 1) centroid[axis] += position[axis] / count;

  let along = 0;
  const directions = cameras.map(({ rotation }) => {
    // Third column of R is the camera's +z axis in camera coordinates.
    const direction = [rotation[0][2], rotation[1][2], rotation[2][2]];
    const length = Math.hypot(...direction);
    return length > 0 ? direction.map((value) => value / length) : null;
  });
  if (directions.some((direction) => !direction)) return null;
  for (let index = 0; index < count; index += 1) {
    const toCentre = [
      centroid[0] - cameras[index].position[0],
      centroid[1] - cameras[index].position[1],
      centroid[2] - cameras[index].position[2],
    ];
    const length = Math.hypot(...toCentre) || 1;
    along +=
      (directions[index][0] * toCentre[0] +
        directions[index][1] * toCentre[1] +
        directions[index][2] * toCentre[2]) /
      length;
  }
  const sign = along < 0 ? -1 : 1;

  const a = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    const direction = directions[index].map((value) => value * sign);
    const position = cameras[index].position;
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        const projection = (row === column ? 1 : 0) - direction[row] * direction[column];
        a[row][column] += projection;
        b[row] += projection * position[column];
      }
    }
  }
  const determinant =
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) return null;
  const inverse = [
    [
      (a[1][1] * a[2][2] - a[1][2] * a[2][1]) / determinant,
      (a[0][2] * a[2][1] - a[0][1] * a[2][2]) / determinant,
      (a[0][1] * a[1][2] - a[0][2] * a[1][1]) / determinant,
    ],
    [
      (a[1][2] * a[2][0] - a[1][0] * a[2][2]) / determinant,
      (a[0][0] * a[2][2] - a[0][2] * a[2][0]) / determinant,
      (a[0][2] * a[1][0] - a[0][0] * a[1][2]) / determinant,
    ],
    [
      (a[1][0] * a[2][1] - a[1][1] * a[2][0]) / determinant,
      (a[0][1] * a[2][0] - a[0][0] * a[2][1]) / determinant,
      (a[0][0] * a[1][1] - a[0][1] * a[1][0]) / determinant,
    ],
  ];
  const centre = [0, 1, 2].map(
    (row) => inverse[row][0] * b[0] + inverse[row][1] * b[1] + inverse[row][2] * b[2],
  );
  return centre.every(Number.isFinite) ? centre : null;
}

// Keep only the splats around the subject. The viewer fits the bounding box, so
// leaving the rest of the room in place is what makes a chair look like a dot.
export function cropToSubject(buffer, { center, radius = 1.6, minKeep = 400 } = {}) {
  const unchanged = { buffer, removed: 0, reason: null };
  if (!Array.isArray(center) || center.length !== 3) return unchanged;
  if (!center.every(Number.isFinite) || !(radius > 0)) return unchanged;
  const head = readPlyHeader(buffer);
  if (!head) return unchanged;
  const ix = head.props.indexOf("x");
  const iy = head.props.indexOf("y");
  const iz = head.props.indexOf("z");
  if ([ix, iy, iz].includes(-1)) return unchanged;

  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const keep = new Uint8Array(head.count);
  let kept = 0;
  for (let index = 0; index < head.count; index += 1) {
    const base = head.bodyStart + index * head.rowBytes;
    const distance = Math.hypot(
      data.getFloat32(base + ix * 4, true) - center[0],
      data.getFloat32(base + iy * 4, true) - center[1],
      data.getFloat32(base + iz * 4, true) - center[2],
    );
    if (distance <= radius) {
      keep[index] = 1;
      kept += 1;
    }
  }
  const removed = head.count - kept;
  if (kept < minKeep || removed < 1) return unchanged;

  const newHeader = head.headerText.replace(
    `element vertex ${head.count}`,
    `element vertex ${kept}`,
  );
  const out = Buffer.allocUnsafe(newHeader.length + kept * head.rowBytes);
  out.write(newHeader, 0, "latin1");
  let offset = newHeader.length;
  for (let index = 0; index < head.count; index += 1) {
    if (!keep[index]) continue;
    const start = head.bodyStart + index * head.rowBytes;
    out.set(buffer.subarray(start, start + head.rowBytes), offset);
    offset += head.rowBytes;
  }
  return { buffer: out, removed, reason: "subject-crop", kept };
}
