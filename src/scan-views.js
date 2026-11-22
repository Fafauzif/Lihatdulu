// Pure markup builders for the KIRI scan pages. No CSS imports, so node tests
// can pin the Indonesian copy and the required controls without a DOM.

import { icon } from "./components.js";
import {
  DEFAULT_LIMITS,
  PREVIEW_COPY,
  STAGE_LABELS,
  STAGE_SEQUENCE,
  UPLOAD_COPY,
  formatBytes,
  formatDateTime,
  formatDuration,
} from "./scan-api.js";

export const STAGE_HEADING = Object.freeze({
  uploading: "Mengunggah video…",
  submitting: "Mengirim ke KIRI Engine…",
  queued: "Menunggu antrean KIRI…",
  processing: "KIRI memproses video…",
  downloading: "Mengunduh hasil…",
  converting: "Menyiapkan pratinjau 3D…",
  ready: "Model 3D siap",
  failed: "Pemrosesan berhenti",
  expired: "Hasil kedaluwarsa",
});

export function stageListMarkup() {
  return STAGE_SEQUENCE.map(
    (stage) =>
      `<li data-scan-stage="${stage}"><span aria-hidden="true"></span>${STAGE_LABELS[stage]}</li>`,
  ).join("");
}

export function renderScanUpload() {
  const limitMb = formatBytes(DEFAULT_LIMITS.maxUploadBytes);
  return `
  <section class="scan-upload" data-scan-upload>
    <header class="scan-upload-head">
      <p class="scan-eyebrow">Pindai furnitur · KIRI Engine</p>
      <h1>${UPLOAD_COPY.title}</h1>
      <p class="scan-lede">${UPLOAD_COPY.lede}</p>
      <p class="scan-mode" data-scan-mode hidden></p>
    </header>

    <div class="scan-upload-grid">
      <section class="scan-panel" data-scan-picker>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">1</span>
          <h2>Pilih video MP4</h2>
        </div>
        <p class="scan-panel-note">Satu video untuk satu barang. Rekam 30–60 detik sambil berjalan mengelilingi barang.</p>
        <input class="scan-file-input" data-scan-input type="file" accept="video/mp4" hidden>
        <div class="scan-drop" data-scan-drop>
          <button type="button" class="scan-choose" data-scan-choose>${icon("film")} ${UPLOAD_COPY.pick}</button>
          <p>atau seret berkas MP4 ke sini</p>
        </div>
        <figure class="scan-media" data-scan-media hidden>
          <video data-scan-video controls playsinline muted preload="metadata"></video>
          <figcaption data-scan-facts></figcaption>
        </figure>
        <p class="scan-field-error" data-scan-file-error role="alert" hidden></p>
        <button type="button" class="scan-link-button" data-scan-change hidden>${UPLOAD_COPY.change}</button>
      </section>

      <section class="scan-panel" data-scan-confirm>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">2</span>
          <h2>Setujui pengiriman</h2>
        </div>
        <ul class="scan-facts">
          <li><strong>Diproses di cloud.</strong> ${UPLOAD_COPY.cloudNote}</li>
          <li><strong>Butuh kredit.</strong> Setiap kiriman memakai kredit KIRI milik operator demo.</li>
          <li><strong>Batas KIRI.</strong> MP4 sampai ${limitMb}, ${DEFAULT_LIMITS.maxDurationS / 60} menit, maksimal 1920×1080.</li>
          <li><strong>Penyimpanan.</strong> ${UPLOAD_COPY.privacyNote}</li>
        </ul>
        <label class="scan-consent">
          <input type="checkbox" data-scan-consent>
          <span>${UPLOAD_COPY.consent}</span>
        </label>
        <button type="button" class="scan-submit" data-scan-submit disabled>${UPLOAD_COPY.submit}</button>
        <p class="scan-panel-note" data-scan-config-note hidden></p>
      </section>
    </div>

    <section class="scan-panel scan-job" data-scan-job hidden aria-live="polite">
      <div class="scan-job-head">
        <div>
          <p class="scan-eyebrow">Proses pindai</p>
          <h2 data-scan-job-title>Menunggu video</h2>
        </div>
        <span class="scan-job-badge" data-scan-job-badge hidden></span>
      </div>
      <p class="scan-mode" data-scan-job-mode hidden>${UPLOAD_COPY.mockNote}</p>
      <ol class="scan-stages" data-scan-stages>${stageListMarkup()}</ol>
      <div class="scan-progress" data-scan-progress role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span data-scan-progress-bar></span>
      </div>
      <p class="scan-progress-label" data-scan-progress-label></p>
      <p class="scan-job-error" data-scan-job-error role="alert" hidden></p>
      <div class="scan-job-actions">
        <a class="scan-link-button primary" data-scan-open href="/jual/pindai" data-nav hidden>${UPLOAD_COPY.openResult}</a>
        <button type="button" class="scan-link-button" data-scan-retry hidden>${UPLOAD_COPY.retry}</button>
        <button type="button" class="scan-link-button" data-scan-resend hidden>${UPLOAD_COPY.resend}</button>
        <button type="button" class="scan-link-button" data-scan-new hidden>${UPLOAD_COPY.another}</button>
      </div>
      <p class="scan-panel-note" data-scan-job-note hidden></p>
    </section>
  </section>`;
}

export function renderScanPreview() {
  return `
  <section class="scan-preview" data-scan-preview>
    <header class="scan-preview-head">
      <p class="scan-preview-badge">${PREVIEW_COPY.badge}</p>
      <h1 data-scan-title>Hasil pindai</h1>
      <p class="scan-preview-facts" data-scan-facts>Menyiapkan model 3D…</p>
      <p class="scan-preview-disclaimer" data-scan-provider></p>
    </header>
    <div class="scan-preview-grid">
      <div class="scan-preview-main">
        <div class="scan-viewer" data-scan-viewer data-state="idle">
          <p class="scan-viewer-placeholder" data-scan-viewer-placeholder>Menunggu model siap…</p>
        </div>
        <p class="scan-viewer-hint-line">${PREVIEW_COPY.hint}</p>
      </div>
      <aside class="scan-preview-side">
        <section class="scan-card" data-scan-status>
          <h2>Proses</h2>
          <ol class="scan-stages" data-scan-stages>${stageListMarkup()}</ol>
          <p class="scan-card-note" data-scan-note>Memuat status pekerjaan…</p>
        </section>
        <section class="scan-card scan-provenance" data-scan-provenance hidden>
          <h2>Rincian hasil</h2>
          <dl data-scan-details></dl>
        </section>
        <section class="scan-card" data-scan-error hidden>
          <h2>Belum bisa dibuka</h2>
          <p class="scan-error" data-scan-error-text></p>
          <div class="scan-retry">
            <button type="button" class="scan-link-button" data-scan-retry hidden>${PREVIEW_COPY.retry}</button>
          </div>
        </section>
        <div class="scan-preview-actions">
          <a class="scan-link-button primary" href="/jual/pindai" data-nav>${PREVIEW_COPY.retake}</a>
          <a class="scan-link-button" href="/beli" data-nav>${PREVIEW_COPY.catalog}</a>
        </div>
      </aside>
    </div>
  </section>`;
}

// Buyer-facing facts. The serial is truncated: it identifies the KIRI task but
// is not a credential, and there is no reason to publish the whole value.
export function detailRows(dto) {
  // Say how the model was actually built: a photoset sampled from the clip is
  // a different promise from sending the clip itself.
  const source = dto.mock
    ? "Mode simulasi · dibuat lokal, bukan dari KIRI"
    : dto.input?.mode === "mesh"
      ? `KIRI Engine · mesh objek (featureless), ${dto.input.photos} foto dari video`
      : dto.input?.mode === "photo"
        ? `KIRI Engine · 3DGS foto, ${dto.input.photos} still dari video`
        : dto.input?.fallback
          ? "KIRI Engine · 3DGS video, masking otomatis · mundur dari mode foto"
          : "KIRI Engine · 3DGS video, masking otomatis";
  const rows = [
    ["Sumber", source],
    [
      "Berkas video",
      [dto.source?.filename, formatBytes(dto.source?.bytes)].filter(Boolean).join(" · "),
    ],
  ];
  if (dto.kiri?.serial)
    rows.push([
      "Serial KIRI",
      `${dto.kiri.serial.slice(0, 12)}${dto.kiri.serial.length > 12 ? "…" : ""}`,
    ]);
  if (dto.artifact) {
    if (dto.artifact.format === "glb") {
      rows.push([
        "Jumlah segitiga",
        Number(dto.artifact.triangles ?? 0).toLocaleString("id-ID"),
      ]);
      rows.push(["Ukuran GLB", formatBytes(dto.artifact.bytes)]);
    } else {
      rows.push(["Jumlah splat", Number(dto.artifact.splatCount).toLocaleString("id-ID")]);
      rows.push(["Ukuran SPZ", formatBytes(dto.artifact.bytes)]);
    }
  }
  if (dto.timings?.totalMs)
    rows.push(["Waktu total", formatDuration(Math.round(dto.timings.totalMs / 1000))]);
  rows.push(["Selesai", formatDateTime(dto.completedAt)]);
  return rows;
}
