// Pure markup builders for the KIRI scan pages. No CSS imports, so node tests
// can pin the Indonesian copy and the required controls without a DOM.

import { icon } from "./components.js";
import { GUIDANCE } from "./scan-recorder.js";
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

// Capture guidance for the upload page. Each line comes from a measured failure
// in the KIRI trials: see-through mesh (knit backrest) left a void, a backlit
// room dropped the gas-lift column, and fast motion blurred the frames.
export const CAPTURE_TIPS = Object.freeze([
  "Pilih barang matte dan padat. Jaring tipis, kaca, atau bahan tembus cahaya sering berlubang pada hasil.",
  "Nyalakan lampu ruangan dan hindari jendela tepat di belakang barang. Bagian yang selalu gelap tidak terbentuk.",
  "Berjalan satu putaran pelan dengan jarak tetap, barang utuh di dalam bingkai dari bawah sampai atas.",
  "Rekam juga bagian yang tersembunyi, misalnya kaki dan kolom di bawah dudukan, karena kamera tidak bisa menebaknya.",
]);

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
      <h1>Pindai furniturmu.</h1>
      <p class="scan-lede">Rekam satu putaran pelan, atau pilih video yang sudah ada. Video dikirim ke KIRI Engine dan kembali sebagai model 3D yang bisa diputar pembeli.</p>
      <p class="scan-mode" data-scan-mode hidden></p>
      <div class="scan-static" data-scan-static hidden>
        <p class="scan-eyebrow">Demo statis</p>
        <h2>Pindai langsung belum aktif di alamat ini</h2>
        <p>Alamat ini menyajikan aplikasi tanpa server pindai, jadi rekaman tidak bisa dikirim. Contoh hasil nyata tetap bisa dibuka sekarang.</p>
        <a class="scan-link-button primary" href="/pindai/demo-chair" data-nav>${icon("cube")} Buka contoh kursi asli</a>
        <p class="scan-static-note">Tanpa unggah dan tanpa kredit. Pemindaian baru membutuhkan host Node + FFmpeg dengan kunci KIRI milik operator.</p>
      </div>
      <p class="scan-example-link">${icon("cube")}<a href="/pindai/demo-chair" data-nav>Lihat contoh hasil dari kursi asli</a><span>· tanpa kredit, tanpa unggah</span></p>
    </header>

    <div class="scan-upload-grid">
      <section class="scan-panel" data-scan-picker>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">1</span>
          <h2>Ambil video</h2>
        </div>
        <p class="scan-panel-note">Satu video untuk satu barang. Rekam 15–45 detik sambil berjalan mengelilingi barang.</p>

        <div class="scan-source-actions">
          <button type="button" class="scan-source primary" data-scan-open-camera>${icon("camera")} Rekam dengan kamera</button>
          <button type="button" class="scan-source" data-scan-choose>${icon("film")} ${UPLOAD_COPY.pick}</button>
        </div>
        <p class="scan-source-note">Di ponsel, tombol rekam langsung memakai kamera belakang. Tidak ada yang diunggah sampai kamu menyetujui di langkah 2.</p>

        <div class="scan-recorder" data-scan-recorder hidden data-stage="idle">
          <div class="scan-recorder-stage">
            <video class="scan-recorder-video" data-rec-video playsinline muted autoplay></video>
            <video class="scan-recorder-video" data-rec-review playsinline controls hidden></video>
            <p class="scan-recorder-empty" data-rec-empty>Kamera belum menyala.</p>
            <div class="scan-recorder-hud">
              <span class="scan-recorder-timer" data-rec-timer>0:00</span>
              <span class="scan-recorder-dot" data-rec-dot hidden><i aria-hidden="true"></i>Merekam</span>
            </div>
            <p class="scan-recorder-guide" data-rec-guide aria-live="polite">${GUIDANCE[0]}</p>
          </div>
          <div class="scan-recorder-actions">
            <button type="button" class="scan-link-button primary" data-rec-start hidden>Mulai merekam</button>
            <button type="button" class="scan-link-button" data-rec-stop hidden>Hentikan</button>
            <button type="button" class="scan-link-button primary" data-rec-use hidden>Gunakan rekaman</button>
            <button type="button" class="scan-link-button" data-rec-retake hidden>Rekam ulang</button>
            <button type="button" class="scan-link-button" data-rec-native>Rekam lewat aplikasi kamera</button>
            <button type="button" class="scan-link-button" data-rec-close>Batal</button>
          </div>
          <input type="file" accept="video/*" capture="environment" data-rec-native-input hidden>
          <p class="scan-recorder-status" data-rec-status role="status" aria-live="polite"></p>
        </div>

        <input class="scan-file-input" data-scan-input type="file" accept="video/mp4,video/webm,video/quicktime" hidden>
        <div class="scan-drop" data-scan-drop>
          <p>atau seret berkas video ke sini · MP4, WebM, atau MOV sampai ${limitMb}</p>
        </div>
        <figure class="scan-media" data-scan-media hidden>
          <video data-scan-video controls playsinline muted preload="metadata"></video>
          <figcaption data-scan-facts></figcaption>
        </figure>
        <p class="scan-field-error" data-scan-file-error role="alert" hidden></p>
        <button type="button" class="scan-link-button" data-scan-change hidden>${UPLOAD_COPY.change}</button>

        <details class="scan-tips-block">
          <summary>Supaya hasilnya bersih</summary>
          <ul class="scan-tips" data-scan-tips>${CAPTURE_TIPS.map((tip) => `<li>${tip}</li>`).join("")}</ul>
        </details>
      </section>

      <section class="scan-panel" data-scan-confirm>
        <div class="scan-panel-head">
          <span class="scan-stepnum" aria-hidden="true">2</span>
          <h2>Setujui pengiriman</h2>
        </div>
        <ul class="scan-facts">
          <li><strong>Diproses di cloud.</strong> ${UPLOAD_COPY.cloudNote}</li>
          <li><strong>Butuh kredit.</strong> Setiap kiriman memakai kredit KIRI milik operator demo.</li>
          <li><strong>Batas KIRI.</strong> Video sampai ${limitMb}, ${DEFAULT_LIMITS.maxDurationS / 60} menit, maksimal 1920×1080.</li>
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
      <div class="scan-wait-links" data-scan-wait hidden>
        <p>Sambil menunggu, kamu bisa membuka hasil yang sudah tersimpan:</p>
        <a href="/pindai/demo-chair" data-nav>${icon("cube")} Contoh hasil pindai · kursi asli</a>
        <a href="/barang/sora?tab=model" data-nav>${icon("cube")} Lemari Sora dalam 3D</a>
      </div>
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
      <p class="scan-open-reason" data-scan-open-reason hidden></p>
    </header>
    <div class="scan-preview-grid">
      <div class="scan-preview-main">
        <div class="scan-source-tabs" data-scan-tabs role="tablist" aria-label="Sumber pratinjau" hidden></div>
        <div class="scan-evidence" data-scan-evidence role="tabpanel" aria-label="Bukti pindai" tabindex="0">
          <section class="scan-photos" data-scan-photos hidden>
            <figure class="scan-photo-hero">
              <img data-scan-photo-hero alt="Foto asli kursi dari penjual" width="960" height="1280" loading="eager" decoding="async">
              <figcaption><span data-scan-photo-hero-label>Foto asli</span><small>Difoto dengan ponsel penjual, bukan render 3D.</small></figcaption>
            </figure>
            <div class="scan-photos-head">
              <div>
                <h2>${PREVIEW_COPY.photosHeading}</h2>
                <p class="scan-photos-note">${PREVIEW_COPY.photosNote}</p>
              </div>
              <button type="button" class="scan-link-button primary" data-scan-open-model>${PREVIEW_COPY.openModel}</button>
            </div>
            <ul class="scan-photo-grid" data-scan-photo-grid></ul>
          </section>
          <div class="scan-viewer" data-scan-viewer data-state="idle">
            <p class="scan-viewer-placeholder" data-scan-viewer-placeholder>Menunggu model siap…</p>
          </div>
        </div>
        <div class="scan-viewer-foot">
          <p class="scan-viewer-hint-line" data-scan-hint>${PREVIEW_COPY.hint}</p>
          <button type="button" class="scan-link-button" data-scan-open-photos hidden>Lihat foto asli</button>
        </div>
        <section class="scan-summary" data-scan-summary hidden aria-label="Asal dan batas hasil">
          <p class="scan-summary-source" data-scan-summary-source></p>
          <ul class="scan-summary-limits" data-scan-summary-limits></ul>
          <details class="scan-details">
            <summary>Rincian teknis</summary>
            <dl data-scan-details></dl>
          </details>
        </section>
        <p class="scan-viewer-caveat" data-scan-caveat>${PREVIEW_COPY.caveat}</p>
        <p class="scan-refine-note" data-scan-refine-note hidden></p>
      </div>
      <aside class="scan-preview-side">
        <section class="scan-card" data-scan-status>
          <h2>Proses</h2>
          <ol class="scan-stages" data-scan-stages>${stageListMarkup()}</ol>
          <p class="scan-card-note" data-scan-note>Memuat status pekerjaan…</p>
        </section>
        <section class="scan-card" data-scan-error hidden>
          <h2>Belum bisa dibuka</h2>
          <p class="scan-error" data-scan-error-text></p>
          <div class="scan-retry">
            <button type="button" class="scan-link-button" data-scan-retry hidden>${PREVIEW_COPY.retry}</button>
            <a class="scan-link-button" href="/pindai/demo-chair" data-nav>Contoh kursi asli</a>
          </div>
        </section>
        <div class="scan-preview-actions">
          <button type="button" class="scan-link-button" data-scan-refine hidden>${PREVIEW_COPY.refine}</button>
          <a class="scan-link-button primary" href="/jual/pindai" data-nav>${PREVIEW_COPY.retake}</a>
          <a class="scan-link-button" href="/beli" data-nav>${PREVIEW_COPY.catalog}</a>
        </div>
      </aside>
    </div>
  </section>`;
}

// A scan that still sees through a tenth of its own silhouette is not a good
// first impression, and the photos are the honest evidence. This is the one
// rule that reorders the result page; it is a presentation choice, not a
// measurement, and it never hides the 3D view.
export const POOR_COVERAGE_SHARE = 0.1;

export function preferredSource(dto) {
  const options = sourceOptions(dto);
  const ids = options.map((option) => option.id);
  const photosFirst = Boolean(dto?.photos?.length) && hasPoorCoverage(dto);
  if (photosFirst && ids.includes("photos")) return "photos";
  if (ids.includes("refined")) return "refined";
  if (ids.includes("raw")) return "raw";
  return ids[0] ?? null;
}

export function hasPoorCoverage(dto) {
  // The coverage block is reported under refine.metrics on a job record and
  // under refine.coverage in the summary; accept both rather than silently
  // losing the rule on one page.
  const coverage = dto?.refine?.coverage ?? dto?.refine?.metrics?.coverage;
  const share = Number(coverage?.holeRatioAfter);
  return coverage?.verdict === "berlubang" && Number.isFinite(share) && share >= POOR_COVERAGE_SHARE;
}

// Which previews a buyer may open, best first. Pure so the tabs, the tests and
// the "why is this hidden" reasoning all read the same list.
export function sourceOptions(dto) {
  if (!dto || dto.stage !== "ready") return [];
  const options = [];
  const glb = dto.artifact?.format === "glb";
  if (glb && dto.artifact?.refined)
    options.push({
      id: "refined",
      label: PREVIEW_COPY.tabRefined,
      url: dto.artifact.url,
      format: "glb",
      caveat: PREVIEW_COPY.inferred,
    });
  if (glb)
    options.push({
      id: "raw",
      label: PREVIEW_COPY.tabRaw,
      url: dto.artifact?.raw?.url ?? dto.artifact.url,
      format: "glb",
      caveat: PREVIEW_COPY.caveat,
    });
  else if (dto.artifact?.url)
    options.push({
      id: "raw",
      label: PREVIEW_COPY.tabSplat,
      url: dto.artifact.url,
      format: "spz",
      caveat: PREVIEW_COPY.caveat,
    });
  if ((dto.photos ?? []).length)
    options.push({
      id: "photos",
      label: PREVIEW_COPY.tabPhotos,
      url: null,
      format: null,
      caveat: PREVIEW_COPY.photosCaveat,
    });
  // When photos win the first impression, they also come first in the tab
  // order: a buyer should not have to hunt for the view the page opened on.
  const preferred = hasPoorCoverage(dto) && dto.photos?.length ? "photos" : null;
  if (preferred) options.sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : 0));
  return options;
}

// 0.187566 reads as "18,8%" in Indonesian. One decimal is enough: the number
// is a share of a silhouette, not a measurement of the object.
export function holeShare(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `${(value * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
}

function holeShareOf(dto) {
  return holeShare(
    dto?.refine?.coverage?.holeRatioAfter ??
      dto?.refine?.metrics?.coverage?.holeRatioAfter,
  );
}

// The source choice belongs to the buyer of this result, not to the page: a
// fresh visit keeps the honest default (photos when the mesh sees through
// itself), while an explicit tap survives a reload of the same result.
export const SOURCE_STORAGE_PREFIX = "lihatdulu:scan:source:";

export function sourceChoiceKey(id) {
  return `${SOURCE_STORAGE_PREFIX}${id}`;
}

export function readSourceChoice(storage, id) {
  if (!storage || !id) return null;
  try {
    const value = storage.getItem(sourceChoiceKey(id));
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

export function writeSourceChoice(storage, id, source) {
  if (!storage || !id || !source) return false;
  try {
    storage.setItem(sourceChoiceKey(id), source);
    return true;
  } catch {
    return false;
  }
}

export function resolveSource(dto, stored) {
  const ids = sourceOptions(dto).map((option) => option.id);
  if (stored && ids.includes(stored)) return stored;
  return preferredSource(dto);
}

// Two short lines replace a wall of metrics: where the model came from, then
// what it cannot show. The full table stays one disclosure below.
export function provenanceSummary(dto) {
  if (!dto || dto.stage !== "ready") return { source: "", limits: [] };
  const photos = (dto.photos ?? []).length;
  const submitted = Number(dto.input?.photos ?? dto.source?.photos ?? photos) || photos;
  const quality = MODEL_QUALITY[dto.input?.modelQuality] ?? MODEL_QUALITY[0];
  const photoset = dto.input?.source === "photos" || dto.input?.mode === "photo";
  const pieces = [];
  if (dto.mock === true) pieces.push("Mode simulasi lokal, bukan KIRI");
  else if (photoset) pieces.push(`KIRI Engine Photo Scan ${quality}`);
  else if (dto.input?.mode === "mesh") pieces.push("KIRI Engine mesh objek");
  else pieces.push("KIRI Engine 3DGS video");
  if (submitted) pieces.push(`${submitted} foto dikirim`);
  if (dto.completedAt) pieces.push(`selesai ${formatDateTime(dto.completedAt)}`);
  const source = pieces.join(" · ");

  const limits = [];
  const hole = holeShareOf(dto);
  if (dto.demo === true && hole) {
    limits.push(
      `Kursi jaring tembus pandang: ${hole} siluet model masih berlubang dan tidak ditambal, karena jaringnya memang bolong.`,
    );
  } else if (hasPoorCoverage(dto) && hole) {
    limits.push(
      `${hole} siluet model masih tembus pandang; bagian berlubang tidak ditambal karena sering memang bolong pada barangnya.`,
    );
  }
  const d = dto.source?.dimensions;
  if (d)
    limits.push(
      `Ukuran ${d.length} × ${d.width} × ${d.height} ${d.unit || "cm"} berasal dari penjual, bukan hasil ukur model.`,
    );
  if (photos)
    limits.push(
      `${photos} foto asli disimpan di halaman ini; model hanya membantu membaca bentuk.`,
    );
  return { source, limits };
}

// The refinement is a second stage that can be skipped or fail without losing
// the scan, so its state gets one honest sentence, not a stack trace. When the
// mesh still sees through itself, the sentence says so instead of implying a
// closed surface: those holes are usually real openings in the product.
export function refineNote(dto) {
  const refine = dto?.refine;
  if (!refine) return "";
  if (refine.status === "applied") {
    const metrics = refine.metrics ?? {};
    const parts = [];
    if (metrics.fragmentsRemoved)
      parts.push(`${metrics.fragmentsRemoved} pecahan dibuang`);
    if (metrics.gapsFilled) parts.push(`${metrics.gapsFilled} celah kecil ditutup`);
    if (!parts.length) parts.push("geometri dirapikan");
    const before = Number(metrics.trianglesBefore ?? 0);
    const after = Number(metrics.trianglesAfter ?? 0);
    const geometry =
      before && after
        ? ` · ${before.toLocaleString("id-ID")} → ${after.toLocaleString("id-ID")} segitiga`
        : "";
    const share = holeShare(metrics.coverage?.holeRatioAfter);
    const seeThrough =
      metrics.coverage?.verdict === "berlubang" && share
        ? ` Masih ${share} siluet yang tembus pandang; bagian itu tidak ditambal karena seringkali memang bolong pada barangnya.`
        : "";
    return `Penyempurnaan lokal: ${parts.join(", ")}${geometry}.${seeThrough}`;
  }
  if (refine.status === "failed")
    return "Penyempurnaan lokal gagal. Pindaian asli tetap tersedia, dan tahap ini bisa dicoba lagi tanpa memakai kredit.";
  if (refine.status === "skipped")
    return "Penyempurnaan lokal dilewati: bentuk mesh ini belum bisa dirapikan dengan aman. Pindaian asli ditampilkan apa adanya.";
  if (refine.status === "disabled")
    return "Penyempurnaan lokal dimatikan di server ini. Pindaian asli ditampilkan apa adanya.";
  return "";
}

export function dimensionRows(dimensions) {
  if (!dimensions) return [];
  const unit = dimensions.unit === "cm" ? "cm" : dimensions.unit ?? "";
  return [
    [
      "Ukuran dari penjual",
      `${dimensions.length} × ${dimensions.width} × ${dimensions.height} ${unit}`.trim() +
        " · bukan hasil ukur model",
    ],
  ];
}

// KIRI's modelQuality is a number in the API and a promise to the seller. Name
// it, because "Photo Scan" alone does not say whether the scan was Ultra.
const MODEL_QUALITY = { 0: "High", 1: "Medium", 2: "Low", 3: "Ultra" };

// Buyer-facing facts. The serial is truncated: it identifies the KIRI task but
// is not a credential, and there is no reason to publish the whole value.
export function detailRows(dto) {
  // Say how the model was actually built: a photoset sampled from the clip is
  // a different promise from sending the clip itself.
  const quality = MODEL_QUALITY[dto.input?.modelQuality] ?? MODEL_QUALITY[0];
  const photoset = dto.input?.source === "photos";
  const source = dto.mock
    ? "Mode simulasi · dibuat lokal, bukan dari KIRI"
    : photoset
      ? `KIRI Engine · Photo Scan ${quality}, masking otomatis, ${dto.input?.photos ?? 0} foto pilihan penjual`
      : dto.input?.mode === "mesh"
      ? `KIRI Engine · mesh objek (featureless), ${dto.input.photos} foto dari video`
      : dto.input?.mode === "photo"
        ? `KIRI Engine · Photo Scan ${quality}, masking otomatis, ${dto.input.photos} foto dari video`
        : dto.input?.mode === "splat"
          ? `KIRI Engine · 3DGS foto, ${dto.input.photos} still dari video`
          : dto.input?.fallback
            ? "KIRI Engine · 3DGS video, masking otomatis · mundur ke unggah video"
            : "KIRI Engine · 3DGS video, masking otomatis";
  const rows = [
    ["Sumber", source],
    [
      photoset ? "Berkas foto" : "Berkas video",
      dto.demo === true
        ? [
            `${dto.source?.photos ?? dto.photos?.length ?? 0} foto dari ponsel`,
            formatBytes(dto.source?.bytes),
          ]
            .filter(Boolean)
            .join(" · ")
        : [dto.source?.filename, formatBytes(dto.source?.bytes)]
            .filter(Boolean)
            .join(" · "),
    ],
    ...(dto.source?.transcodedFrom
      ? [
          [
            "Format rekaman",
            `${String(dto.source.transcodedFrom).toUpperCase()} dari ponsel, dikonversi ke MP4 di server`,
          ],
        ]
      : []),
    ...dimensionRows(dto.source?.dimensions),
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
  if (dto.refine?.status === "applied" && dto.refine.metrics) {
    const metrics = dto.refine.metrics;
    rows.push([
      "Penyempurnaan",
      [
        metrics.trianglesBefore && metrics.trianglesAfter
          ? `${Number(metrics.trianglesBefore).toLocaleString("id-ID")} → ${Number(metrics.trianglesAfter).toLocaleString("id-ID")} segitiga`
          : null,
        metrics.fragmentsRemoved
          ? `${metrics.fragmentsRemoved} pecahan dibuang`
          : null,
        metrics.gapsFilled ? `${metrics.gapsFilled} celah ditutup` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "diterapkan",
    ]);
  }
  if ((dto.photos ?? []).length)
    rows.push(["Foto asli", `${dto.photos.length} foto disimpan`]);
  if (dto.timings?.totalMs)
    rows.push(["Waktu total", formatDuration(Math.round(dto.timings.totalMs / 1000))]);
  rows.push(["Selesai", formatDateTime(dto.completedAt)]);
  return rows;
}
