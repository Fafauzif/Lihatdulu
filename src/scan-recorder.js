// Pure capture rules: no DOM, so Node tests can pin the format preference
// and the exact Indonesian failure copy the page must show.

export const MIN_SECONDS = 8;
export const MAX_SECONDS = 45;
export const GUIDANCE_STEP_SECONDS = 7;

export const GUIDANCE = Object.freeze([
  "Mulai dari depan. Pastikan seluruh barang masuk bingkai.",
  "Geser pelan ke sisi kanan, jangan memotong kaki.",
  "Putar ke belakang dan tunjukkan panel belakang.",
  "Dekati bagian dalam atau laci yang terbuka.",
  "Tunjukkan bekas pemakaian dari dekat.",
  "Kembali ke depan untuk menutup putaran.",
]);

// iOS records MP4; Android Chromium usually offers WebM. Try the most
// compatible type first, then fall back until MediaRecorder accepts one.
export const MIME_PREFERENCE = Object.freeze([
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
]);

export function pickRecorderMime(isTypeSupported) {
  if (typeof isTypeSupported !== "function") return null;
  for (const type of MIME_PREFERENCE) {
    try {
      if (isTypeSupported(type)) return type;
    } catch {}
  }
  return null;
}

export function guidanceAt(seconds) {
  const step = Number.isFinite(seconds)
    ? Math.floor(Math.max(0, seconds) / GUIDANCE_STEP_SECONDS)
    : 0;
  return GUIDANCE[Math.min(GUIDANCE.length - 1, step)];
}

export function cameraErrorCopy(error) {
  if (error?.insecure)
    return "Kamera perlu sambungan aman (HTTPS). Buka tautan demo dari laptop.";
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Izin kamera ditolak. Izinkan kamera lewat pengaturan browser, lalu coba lagi.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Kamera tidak ditemukan. Pastikan perangkat punya kamera belakang.";
    case "NotReadableError":
    case "AbortError":
      return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.";
    default:
      return "Kamera belum bisa dinyalakan. Coba muat ulang halaman.";
  }
}
