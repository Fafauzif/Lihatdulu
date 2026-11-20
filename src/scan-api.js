// Browser side of the scan API. Everything here except uploadScan/getScan is
// pure, so Node tests can pin the copy without a DOM.

export class ScanApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "ScanApiError";
    this.code = code;
    this.status = status;
  }
}

export const STAGE_SEQUENCE = Object.freeze([
  "queued",
  "validating",
  "extracting",
  "aligning",
  "reconstructing",
  "finalizing",
  "ready",
]);

export const STAGE_LABELS = Object.freeze({
  queued: "Menunggu antrean",
  validating: "Memeriksa rekaman",
  extracting: "Mengambil bingkai",
  aligning: "Menyelaraskan kamera",
  reconstructing: "Menyusun model 3D",
  finalizing: "Menyiapkan pratinjau",
  ready: "Siap dilihat",
  failed: "Gagal",
});

export const ERROR_COPY = Object.freeze({
  bad_metadata: "Detail barang belum lengkap. Periksa judul dan ukurannya.",
  unsupported_media:
    "Format video ini belum didukung. Coba Chrome atau Safari terbaru.",
  too_large: "Rekaman terlalu besar. Rekam lebih singkat.",
  length_required: "Berkas rekaman tidak terkirim lengkap. Coba kirim lagi.",
  upload_incomplete: "Berkas rekaman tidak terkirim lengkap. Coba kirim lagi.",
  not_found: "Hasil pindai tidak ditemukan.",
  not_ready: "Hasil pindai belum siap.",
  queue_full: "Antrean sedang penuh. Tunggu sebentar lalu kirim lagi.",
  footage_invalid: "Rekaman tidak bisa dibaca. Rekam ulang dengan kamera belakang.",
  footage_short:
    "Rekaman terlalu singkat. Rekam 30–45 detik sambil berjalan mengelilingi barang.",
  alignment_failed:
    "Kamera tidak cukup mengenali barangnya. Rekam lebih pelan dengan cahaya lebih terang.",
  artifact_too_large:
    "Hasilnya terlalu besar untuk dibuka di ponsel. Rekam lebih singkat.",
  disk_low: "Ruang penyimpanan laptop demo hampir penuh.",
  tool_missing: "Alat pemrosesan belum siap di laptop demo. Hubungi operator.",
  tool_timeout: "Pemrosesan melebihi batas waktu. Coba rekaman yang lebih pendek.",
  tool_failed: "Pemrosesan gagal di laptop demo. Coba lagi atau rekam ulang.",
  server_stopped: "Server demo berhenti sebelum pemrosesan selesai.",
  internal: "Terjadi kesalahan. Coba lagi.",
  network: "Sambungan terputus. Periksa jaringan lalu coba lagi.",
  aborted: "Unggahan dibatalkan. Rekam atau kirim lagi.",
  default: "Terjadi kesalahan. Coba lagi.",
});

export const PREVIEW_COPY = Object.freeze({
  badge: "Pindai baru",
  disclaimer: "Model ini dibuat dari rekaman kamera, bukan contoh Sora.",
  retake: "Rekam barang lain",
  catalog: "Lihat katalog",
  notFound: "Hasil pindai tidak ditemukan.",
});

export function nextPollDelay(attempt) {
  const steps = [2000, 3000, 5000, 8000];
  return steps[Math.min(steps.length - 1, Math.max(0, Number(attempt) || 0))];
}

const decimal = (value) => String(value).replace(".", ",");

export function formatDimensions(meta) {
  if (!meta) return "Ukuran belum dicatat";
  return `${decimal(meta.widthCm)} × ${decimal(meta.depthCm)} × ${decimal(meta.heightCm)} cm`;
}

export function formatArtifactSize(bytes) {
  const megabytes = (Number(bytes) || 0) / 1048576;
  if (!Number.isFinite(megabytes) || megabytes <= 0) return "0 MB";
  return `${megabytes.toFixed(1).replace(".", ",")} MB`;
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes
    ? `${minutes} mnt ${String(seconds).padStart(2, "0")} dtk`
    : `${seconds} dtk`;
}

export function buildMetaQuery(meta) {
  const params = new URLSearchParams();
  params.set("title", meta.title);
  params.set("w", String(meta.widthCm));
  params.set("d", String(meta.depthCm));
  params.set("h", String(meta.heightCm));
  if (meta.conditionNote) params.set("note", meta.conditionNote);
  if (meta.device) params.set("device", meta.device);
  if (meta.clientId) params.set("cid", meta.clientId);
  return params.toString();
}

export function uploadScan(meta, blob, onProgress = () => {}) {
  const request = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    request.open("POST", `/api/scans?${buildMetaQuery(meta)}`);
    request.responseType = "json";
    request.setRequestHeader(
      "content-type",
      blob.type.split(";")[0] || "video/webm",
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      const payload = request.response ?? {};
      if (request.status === 201 || request.status === 200) {
        resolve(payload);
        return;
      }
      reject(
        new ScanApiError(
          payload?.error?.code ?? "internal",
          payload?.error?.message ?? "Unggahan gagal.",
          request.status,
        ),
      );
    };
    request.onerror = () =>
      reject(
        new ScanApiError(
          "network",
          "Sambungan terputus. Periksa jaringan lalu coba lagi.",
          0,
        ),
      );
    request.onabort = () =>
      reject(new ScanApiError("aborted", "Unggahan dibatalkan.", 0));
    request.send(blob);
  });
  return { promise, abort: () => request.abort() };
}

export async function getScan(id, { signal } = {}) {
  const response = await fetch(`/api/scans/${encodeURIComponent(id)}`, {
    signal,
    headers: { accept: "application/json" },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok)
    throw new ScanApiError(
      payload?.error?.code ??
        (response.status === 404 ? "not_found" : "internal"),
      payload?.error?.message ?? "Hasil pindai belum bisa dibaca.",
      response.status,
    );
  return payload;
}
