// Pure capture rules for the in-page recorder. No DOM, so Node tests can pin
// the format preference, the guidance timing and the Indonesian recovery copy
// the page must show when a phone refuses the camera.

export const MIN_SECONDS = 8;
export const MAX_SECONDS = 45;
export const GUIDANCE_STEP_SECONDS = 7;

// One line per step, short enough to read while holding a phone. The order is
// the one that produced the best KIRI result: front, slow orbit, back, detail.
export const GUIDANCE = Object.freeze([
  "Mulai dari depan. Seluruh barang di dalam bingkai.",
  "Geser pelan ke kanan, jangan potong kakinya.",
  "Terus ke belakang, tunjukkan panel belakang.",
  "Dekati bagian dalam atau laci yang terbuka.",
  "Tunjukkan bekas pemakaian dari dekat.",
  "Kembali ke depan untuk menutup putaran.",
]);

// Two capture rules that came out of the real chair takes: side light gives the
// scanner edges, backlight flattens the object.
export const CAPTURE_TIPS = Object.freeze([
  "Nyalakan lampu ruangan. Hindari jendela terang tepat di belakang barang.",
  "Jalan satu putaran pelan dengan jarak tetap, barang utuh dari bawah sampai atas.",
  "Barang matte dan padat paling aman. Jaring tipis, kaca, atau bahan tembus cahaya sering berlubang pada hasil.",
  "Tunjukkan bagian tersembunyi seperti kaki dan kolom di bawah dudukan.",
]);

// iOS Safari records MP4; Android Chromium records WebM. MP4 first because it
// needs no conversion; WebM is accepted by the server and transcoded.
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
    } catch {
      // Safari throws on some codec strings instead of returning false.
    }
  }
  return null;
}

export function extensionForMime(mime) {
  return /mp4/i.test(String(mime ?? "")) ? "mp4" : "webm";
}

export function clipName(mime, stamp = Date.now()) {
  return `rekaman-${stamp}.${extensionForMime(mime)}`;
}

export function guidanceAt(seconds) {
  const step = Number.isFinite(seconds)
    ? Math.floor(Math.max(0, seconds) / GUIDANCE_STEP_SECONDS)
    : 0;
  return GUIDANCE[Math.min(GUIDANCE.length - 1, step)];
}

export function timeLabel(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

// The recovery sentence is the whole point of this function: every branch names
// what happened and what the seller can do next.
export function cameraErrorCopy(error) {
  if (error?.insecure)
    return "Kamera hanya bisa dibuka lewat sambungan aman (HTTPS). Rekam lewat aplikasi kamera, atau buka tautan ini dari alamat https.";
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Izin kamera ditolak. Izinkan kamera di pengaturan browser, lalu tekan Nyalakan kamera lagi — atau rekam lewat aplikasi kamera.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Kamera tidak ditemukan di perangkat ini. Rekam lewat aplikasi kamera, lalu pilih berkasnya di sini.";
    case "NotReadableError":
    case "AbortError":
      return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi — atau rekam lewat aplikasi kamera.";
    default:
      return "Kamera belum bisa dinyalakan. Coba muat ulang halaman, atau rekam lewat aplikasi kamera.";
  }
}

export function recorderErrorCopy(error) {
  if (error?.unsupported)
    return "Browser ini belum bisa merekam video di halaman. Rekam lewat aplikasi kamera, lalu pilih berkasnya di sini.";
  if (error?.empty) return "Rekaman kosong. Coba rekam lagi.";
  if (error?.short)
    return `Rekaman terlalu pendek. Rekam minimal ${MIN_SECONDS} detik supaya KIRI punya cukup sudut.`;
  return "Perekaman berhenti sebelum selesai. Coba rekam lagi.";
}
