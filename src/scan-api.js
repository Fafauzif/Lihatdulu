// Browser side of the KIRI scan API. Everything except the three requests is
// pure, so node tests can pin the copy, the validation and the polling steps
// without a DOM. No key ever reaches this file.

export class ScanApiError extends Error {
  constructor(code, message, status = 0, retryable = false) {
    super(message || "Terjadi kesalahan.");
    this.name = "ScanApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export const STAGE_SEQUENCE = Object.freeze([
  "uploading",
  "submitting",
  "queued",
  "processing",
  "downloading",
  "converting",
  "ready",
]);

export const STAGE_LABELS = Object.freeze({
  uploading: "Mengunggah video",
  submitting: "Mengirim ke KIRI Engine",
  queued: "Menunggu antrean KIRI",
  processing: "KIRI memproses video",
  downloading: "Mengunduh hasil",
  converting: "Menyiapkan pratinjau 3D",
  ready: "Selesai",
  failed: "Berhenti",
  expired: "Kedaluwarsa",
});

export const TERMINAL_STAGES = Object.freeze(["ready", "failed", "expired"]);

export const ERROR_COPY = Object.freeze({
  video_too_large: "Video melebihi 200 MB. Pilih rekaman yang lebih pendek.",
  video_too_long: "Video lebih dari 3 menit. Potong dulu menjadi satu putaran barang.",
  video_too_large_dimensions:
    "Resolusi video di atas 1920×1080. KIRI hanya menerima sampai Full HD.",
  video_not_mp4: "Berkas ini bukan MP4. Pilih video MP4 dari galeri.",
  video_unreadable: "Video ini tidak bisa dibaca browser. Coba MP4 lain.",
  upload_empty: "Berkas video kosong. Pilih video lain.",
  missing_key: "Server demo belum diberi kunci KIRI. Hubungi operator.",
  kiri_unauthorized: "Kunci KIRI ditolak. Operator perlu memeriksa KIRI_API_KEY.",
  kiri_no_credit: "Kredit KIRI Engine habis. Operator perlu menambah kredit.",
  kiri_rate_limited: "KIRI Engine sedang membatasi permintaan. Coba lagi sebentar.",
  kiri_unavailable: "KIRI Engine tidak bisa dihubungi sekarang. Coba lagi.",
  kiri_network: "Sambungan ke server terputus. Periksa jaringan lalu coba lagi.",
  kiri_failed:
    "KIRI Engine gagal menyusun model dari video ini. Rekam ulang dengan lebih banyak sudut.",
  kiri_expired: "Hasil ini sudah kedaluwarsa di KIRI Engine. Kirim video lagi.",
  zip_invalid: "Berkas hasil dari KIRI tidak bisa dibaca. Coba proses ulang.",
  ply_invalid: "Hasil KIRI bukan berkas splat 3D yang dikenali. Rekam ulang barangnya.",
  ply_empty: "Hasil KIRI tidak berisi titik splat. Rekam ulang barangnya.",
  model_invalid:
    "Hasil KIRI bukan berkas model 3D (GLB) yang dikenali. Rekam ulang barangnya.",
  convert_failed: "Konversi ke SPZ gagal di server. Coba proses ulang.",
  spz_invalid: "Berkas SPZ hasil konversi rusak. Coba proses ulang.",
  artifact_too_large: "Hasil 3D terlalu besar untuk dibuka di ponsel.",
  submit_interrupted: "Server sempat berhenti saat mengirim video. Kirim ulang video ini.",
  not_found: "Pekerjaan pindai tidak ditemukan.",
  conflict: "Pekerjaan ini belum bisa dicoba ulang.",
  network: "Sambungan terputus. Periksa jaringan lalu coba lagi.",
  aborted: "Pengiriman dibatalkan.",
  internal: "Terjadi kesalahan. Coba lagi.",
  default: "Terjadi kesalahan. Coba lagi.",
});

export const UPLOAD_COPY = Object.freeze({
  title: "Ubah video barangmu menjadi model 3D.",
  lede: "Pilih satu video MP4 yang sudah ada. Video dikirim ke KIRI Engine untuk diproses di cloud, lalu hasilnya bisa diputar di halaman ini.",
  consent:
    "Saya setuju video ini dikirim ke KIRI Engine untuk diproses di cloud.",
  submit: "Kirim ke KIRI Engine",
  submitting: "Mengirim…",
  pick: "Pilih video MP4",
  change: "Ganti video",
  openResult: "Buka hasil 3D",
  another: "Pindai barang lain",
  resend: "Kirim ulang video ini",
  retry: "Coba proses ulang",
  cloudNote:
    "Video diproses di server KIRI Engine, bukan di laptop ini. Satu kiriman memakai kredit KIRI milik operator.",
  privacyNote:
    "Server hanya menyimpan berkas video sementara untuk dikirim, lalu menghapusnya. Simpan hasil 3D di server ini, bukan di KIRI.",
  mockNote:
    "Mode simulasi aktif: KIRI tidak dihubungi, tidak ada kredit terpakai, dan model di halaman hasil dibuat secara lokal untuk menguji alur.",
  unconfiguredNote:
    "Server belum diberi kunci KIRI, jadi pengiriman dinonaktifkan. Alur dan tampilan masih bisa diperiksa.",
});

export const PREVIEW_COPY = Object.freeze({
  badge: "Hasil pindai",
  notFound: "Hasil pindai tidak ditemukan.",
  notFoundNote: "Periksa tautannya, atau pindai barang baru dari halaman penjual.",
  retake: "Pindai barang lain",
  catalog: "Lihat katalog",
  retry: "Coba proses ulang",
  modelNote:
    "Model 3D ini berasal dari video yang diproses KIRI Engine, bukan contoh Sora.",
  hint: "Tarik untuk memutar · cubit untuk memperbesar",
});

export const STORAGE_KEY = "lihatdulu:kiri-job";

export const DEFAULT_LIMITS = Object.freeze({
  maxUploadBytes: 200 * 1024 * 1024,
  maxDurationS: 180,
  maxWidth: 1920,
  maxHeight: 1080,
});

const MP4_NAME = /\.mp4$/i;

export function validationError(code) {
  return { ok: false, code, message: ERROR_COPY[code] ?? ERROR_COPY.default };
}

// The checks that need nothing but the File handle. The upload page runs these
// first so a wrong file is rejected before the browser reads its metadata.
export function validateVideoBasics(
  { name = "", type = "", size = 0 } = {},
  limits = DEFAULT_LIMITS,
) {
  const isMp4 = MP4_NAME.test(name) || type === "video/mp4";
  if (!isMp4) return validationError("video_not_mp4");
  if (!size) return validationError("upload_empty");
  if (size > limits.maxUploadBytes) return validationError("video_too_large");
  return { ok: true, code: null, message: "" };
}

// KIRI accepts up to 1920x1080 and 3 minutes. We check in the browser because
// the server deliberately has no FFmpeg/probe step. The limit is about the size
// of the frame, not its orientation: a phone clip stored as 1080x1920 (portrait)
// is the same resolution as 1920x1080 and KIRI accepts it.
export function validateVideoFile(file = {}, limits = DEFAULT_LIMITS) {
  const basics = validateVideoBasics(file, limits);
  if (!basics.ok) return basics;
  const { durationS = 0, width = 0, height = 0 } = file;
  if (!Number.isFinite(durationS) || durationS <= 0)
    return validationError("video_unreadable");
  // A 3-minute limit is tight for a walk-around; allow a second of container
  // rounding rather than rejecting a clip KIRI would accept.
  if (durationS > limits.maxDurationS + 1)
    return validationError("video_too_long");
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (
    longEdge > Math.max(limits.maxWidth, limits.maxHeight) ||
    shortEdge > Math.min(limits.maxWidth, limits.maxHeight)
  )
    return validationError("video_too_large_dimensions");
  return { ok: true, code: null, message: "" };
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 MB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  const megabytes = value / 1048576;
  return `${megabytes.toFixed(megabytes >= 10 ? 0 : 1).replace(".", ",")} MB`;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes} mnt ${String(rest).padStart(2, "0")} dtk` : `${rest} dtk`;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function nextPollDelay(attempt) {
  const steps = [1500, 2000, 3000, 5000, 8000];
  return steps[Math.min(steps.length - 1, Math.max(0, Number(attempt) || 0))];
}

export function isTerminalStage(stage) {
  return TERMINAL_STAGES.includes(stage);
}

export function stageIndex(stage) {
  const index = STAGE_SEQUENCE.indexOf(stage);
  return index === -1 ? 0 : index;
}

export function errorCopy(code, fallback) {
  return ERROR_COPY[code] ?? fallback ?? ERROR_COPY.default;
}

export function readStoredJobId(storage) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeJobId(storage, id) {
  try {
    if (id) storage?.setItem(STORAGE_KEY, id);
    else storage?.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing can refuse storage; the job link still works.
  }
}

// Keep the small helper separate so a caller cannot forget to remove the id.
export function clearStoredJobId(storage) {
  storeJobId(storage, null);
}

async function parseError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const error = body?.error;
  return new ScanApiError(
    error?.code ?? "internal",
    error?.message,
    response.status,
    error?.retryable === true,
  );
}

export async function getScanConfig({ signal } = {}) {
  let response;
  try {
    response = await fetch("/api/kiri/config", { signal, headers: { accept: "application/json" } });
  } catch (error) {
    throw new ScanApiError("network", ERROR_COPY.network);
  }
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function getJob(id, { signal } = {}) {
  let response;
  try {
    response = await fetch(`/api/kiri/jobs/${encodeURIComponent(id)}`, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ScanApiError("network", ERROR_COPY.network);
  }
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function retryJob(id) {
  let response;
  try {
    response = await fetch(`/api/kiri/jobs/${encodeURIComponent(id)}/retry`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ScanApiError("network", ERROR_COPY.network);
  }
  if (!response.ok) throw await parseError(response);
  return response.json();
}

// XHR instead of fetch: the upload bar needs progress events, which fetch does
// not expose. The File is sent as the raw body; the name rides in a header.
export function uploadJob(file, { onProgress = () => {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/kiri/jobs");
    request.responseType = "json";
    request.setRequestHeader("content-type", file.type || "video/mp4");
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name || "video.mp4"));
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0)
        onProgress(Math.min(0.99, event.loaded / event.total));
    });
    request.addEventListener("load", () => {
      const body =
        request.response ??
        (() => {
          try {
            return JSON.parse(request.responseText);
          } catch {
            return null;
          }
        })();
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve(body);
        return;
      }
      const error = body?.error;
      reject(
        new ScanApiError(
          error?.code ?? "internal",
          error?.message,
          request.status,
          error?.retryable === true,
        ),
      );
    });
    request.addEventListener("error", () =>
      reject(new ScanApiError("network", ERROR_COPY.network)),
    );
    request.addEventListener("abort", () =>
      reject(new ScanApiError("aborted", ERROR_COPY.aborted)),
    );
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

export function resultUrl(id) {
  return `/api/kiri/jobs/${encodeURIComponent(id)}/result.spz`;
}
