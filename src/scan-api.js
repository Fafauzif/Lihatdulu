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
  video_too_long:
    "Video lebih dari 3 menit. Rekam satu putaran barang saja, lalu coba lagi.",
  video_needs_converter:
    "Rekaman ini berformat WebM dan server belum bisa mengonversinya. Rekam lewat aplikasi kamera atau pilih berkas MP4.",
  video_convert_failed:
    "Rekaman gagal dikonversi ke MP4. Coba rekam lagi, atau pilih berkas MP4 dari galeri.",
  video_unreadable: "Video ini tidak bisa dibaca browser. Coba rekam ulang atau pilih berkas lain.",
  upload_empty: "Berkas video kosong. Pilih video lain.",
  photos_too_few:
    "Kirim minimal 20 foto. KIRI meminta 20 sampai 300 sudut untuk menyusun bentuk.",
  photos_invalid: "Berkas ZIP hanya boleh berisi foto JPG atau PNG.",
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
  unavailable:
    "Alamat ini hanya menyajikan contoh tersimpan, tanpa server pindai. Contoh kursi asli tetap bisa dibuka.",
  conflict: "Pekerjaan ini belum bisa dicoba ulang.",
  network: "Sambungan terputus. Periksa jaringan lalu coba lagi.",
  aborted: "Pengiriman dibatalkan.",
  internal: "Terjadi kesalahan. Coba lagi.",
  default: "Terjadi kesalahan. Coba lagi.",
});

export const UPLOAD_COPY = Object.freeze({
  title: "Ubah video barangmu menjadi model 3D.",
  lede: "Rekam satu putaran pelan, atau pilih video yang sudah ada. Video dikirim ke KIRI Engine untuk diproses di cloud, lalu hasilnya bisa diputar di halaman ini.",
  consent:
    "Saya setuju video ini dikirim ke KIRI Engine untuk diproses di cloud.",
  submit: "Kirim ke KIRI Engine",
  submitting: "Mengirim…",
  pick: "Pilih video",
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
  demoNote:
    "Contoh tersimpan: satu pindaian kursi asli yang sudah diproses KIRI Engine. Tidak ada kredit terpakai untuk membukanya.",
  hint: "Tarik untuk memutar · cubit untuk memperbesar",
  // Source tabs on the result page: the refined preview, KIRI's own mesh, the
  // seller's stills. The refined one is always labelled as an estimate.
  tabRefined: "Hasil halus",
  tabRaw: "Pindaian asli",
  tabSplat: "Pindaian asli",
  tabPhotos: "Foto asli",
  // Exactly this sentence must be shown for inferred geometry.
  inferred: "Pratinjau 3D perkiraan. Cek foto asli untuk kondisi barang.",
  photosHeading: "Foto asli dari penjual",
  photosNote:
    "Foto ini yang dilihat KIRI. Bandingkan dengan model: warna, tekstur, dan lubang asli paling jelas di sini.",
  photosCaveat: "Tampilan foto, bukan model 3D.",
  openModel: "Buka model 3D",
  refine: "Coba haluskan lagi",
  // Measured, not boilerplate: the knit backrest and the glossy base are the two
  // parts KIRI lost on every route, and both are visible in this viewer.
  caveat:
    "Hasil cloud bergantung pada rekaman: bahan tembus cahaya dapat berlubang, dan bagian yang mengkilap atau tidak pernah terlihat kamera dapat kehilangan bentuk.",
});

export const STORAGE_KEY = "lihatdulu:kiri-job";

export const DEFAULT_LIMITS = Object.freeze({
  maxUploadBytes: 200 * 1024 * 1024,
  maxDurationS: 180,
  maxWidth: 1920,
  maxHeight: 1080,
});

// MP4 is what KIRI accepts; WebM and MOV are what phones actually record. The
// server normalizes the last two to MP4 before KIRI sees them, so the browser
// must not reject a clip the pipeline can use.
const ACCEPTED_NAME = /\.(mp4|webm|mov)$/i;
const ACCEPTED_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
]);

export function validationError(code) {
  return { ok: false, code, message: ERROR_COPY[code] ?? ERROR_COPY.default };
}

// The checks that need nothing but the File handle. The upload page runs these
// first so a wrong file is rejected before the browser reads its metadata.
export function validateVideoBasics(
  { name = "", type = "", size = 0 } = {},
  limits = DEFAULT_LIMITS,
) {
  const accepted = ACCEPTED_NAME.test(name) || ACCEPTED_TYPES.has(type);
  if (!accepted) return validationError("video_not_mp4");
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
  // Android records WebM without a duration header. `null` means "the browser
  // cannot tell us yet" and the server enforces the limit after converting;
  // 0 or NaN means the file itself is unreadable.
  const durationUnknown = durationS === null;
  if (!durationUnknown && (!Number.isFinite(durationS) || durationS <= 0))
    return validationError("video_unreadable");
  // A 3-minute limit is tight for a walk-around; allow a second of container
  // rounding rather than rejecting a clip KIRI would accept.
  if (!durationUnknown && durationS > limits.maxDurationS + 1)
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
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const total = Math.max(0, Math.round(value));
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

// A static host answers /api/... with the SPA shell instead of JSON. That is not
// a broken job: the origin has no scan server, and the saved example is the way
// forward. Fail fast and say so instead of polling five times.
async function readJson(response) {
  const type = response.headers.get("content-type") || "";
  if (!/json/i.test(type))
    throw new ScanApiError("unavailable", ERROR_COPY.unavailable);
  try {
    return await response.json();
  } catch {
    throw new ScanApiError("unavailable", ERROR_COPY.unavailable);
  }
}

export async function getScanConfig({ signal } = {}) {
  let response;
  try {
    response = await fetch("/api/kiri/config", { signal, headers: { accept: "application/json" } });
  } catch (error) {
    throw new ScanApiError("network", ERROR_COPY.network);
  }
  if (!response.ok) throw await parseError(response);
  return readJson(response);
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
  return readJson(response);
}

export async function refineJob(id) {
  let response;
  try {
    response = await fetch(`/api/kiri/jobs/${encodeURIComponent(id)}/refine`, {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ScanApiError("network", ERROR_COPY.network);
  }
  if (!response.ok) throw await parseError(response);
  return readJson(response);
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
  return readJson(response);
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
