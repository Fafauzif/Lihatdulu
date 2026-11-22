// One error type for everything the KIRI prototype can fail on. The client
// shows `copy` by code, so the words live here and in src/scan-api.js only.
// `retryable` means "the job can be finalized again without a new upload".

const DEFINITIONS = {
  video_too_large: {
    status: 413,
    copy: "Video melebihi batas ukuran. Pilih rekaman yang lebih pendek.",
  },
  video_not_mp4: {
    status: 415,
    copy: "Berkas ini bukan MP4. Pilih video MP4 dari galeri.",
  },
  upload_empty: { status: 400, copy: "Berkas video kosong. Pilih video lain." },
  missing_key: {
    status: 503,
    copy: "Server belum punya kunci KIRI. Hubungi operator demo.",
  },
  kiri_unauthorized: {
    status: 502,
    copy: "Kunci KIRI ditolak. Operator perlu memeriksa KIRI_API_KEY.",
  },
  kiri_no_credit: {
    status: 402,
    copy: "Kredit KIRI Engine habis. Operator perlu menambah kredit.",
  },
  kiri_rate_limited: {
    status: 429,
    copy: "KIRI Engine sedang membatasi permintaan. Coba lagi beberapa saat.",
    retryable: true,
  },
  kiri_unavailable: {
    status: 502,
    copy: "KIRI Engine tidak bisa dihubungi sekarang. Coba lagi.",
    retryable: true,
  },
  kiri_network: {
    status: 502,
    copy: "Sambungan ke KIRI Engine terputus. Coba lagi.",
    retryable: true,
  },
  kiri_failed: {
    status: 422,
    copy: "KIRI Engine gagal menyusun model dari video ini. Rekam ulang dengan lebih banyak sudut.",
  },
  kiri_expired: {
    status: 410,
    copy: "Hasil ini sudah kedaluwarsa di KIRI Engine. Kirim video lagi.",
  },
  zip_invalid: {
    status: 502,
    copy: "Berkas hasil dari KIRI tidak bisa dibaca. Coba proses ulang.",
    retryable: true,
  },
  ply_invalid: {
    status: 422,
    copy: "Hasil KIRI bukan berkas splat 3D yang dikenali. Rekam ulang barangnya.",
  },
  ply_empty: {
    status: 422,
    copy: "Hasil KIRI tidak berisi titik splat. Rekam ulang barangnya.",
  },
  model_invalid: {
    status: 422,
    copy: "Hasil KIRI bukan berkas model 3D (GLB) yang dikenali. Rekam ulang barangnya.",
  },
  convert_failed: {
    status: 500,
    copy: "Konversi ke SPZ gagal di server. Coba proses ulang.",
    retryable: true,
  },
  spz_invalid: {
    status: 500,
    copy: "Berkas SPZ hasil konversi rusak. Coba proses ulang.",
    retryable: true,
  },
  artifact_too_large: {
    status: 422,
    copy: "Hasil 3D terlalu besar untuk dibuka di ponsel. Rekam lebih singkat.",
  },
  not_found: { status: 404, copy: "Pekerjaan pindai tidak ditemukan." },
  conflict: {
    status: 409,
    copy: "Pekerjaan ini belum bisa dicoba ulang.",
  },
  submit_interrupted: {
    status: 500,
    copy: "Server sempat berhenti saat mengirim video. Kirim ulang video ini.",
  },
  internal: { status: 500, copy: "Terjadi kesalahan di server. Coba lagi." },
};

export const ERROR_CODES = Object.freeze(Object.keys(DEFINITIONS));

export class KiriError extends Error {
  constructor(code, { cause, detail } = {}) {
    const definition = DEFINITIONS[code] ?? DEFINITIONS.internal;
    super(definition.copy);
    this.name = "KiriError";
    this.code = DEFINITIONS[code] ? code : "internal";
    this.status = definition.status;
    this.retryable = definition.retryable === true;
    this.detail = detail ?? null;
    if (cause) this.cause = cause;
  }
}

export function toKiriError(error, fallback = "internal") {
  if (error instanceof KiriError) return error;
  return new KiriError(fallback, { cause: error });
}

export function errorPayload(error) {
  const kiriError = toKiriError(error);
  return {
    error: {
      code: kiriError.code,
      message: kiriError.message,
      retryable: kiriError.retryable,
    },
  };
}

// Upstream text (KIRI messages, fetch errors) can echo a URL or header. Only
// the human message is kept, and bearer tokens are scrubbed before logging.
export function redact(value) {
  return String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/api[_-]?key=[^&\s]+/gi, "api_key=[redacted]");
}
