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
