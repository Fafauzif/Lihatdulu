import "./scan-preview.css";
import { esc } from "./components.js";
import {
  ERROR_COPY,
  PREVIEW_COPY,
  STAGE_LABELS,
  STAGE_SEQUENCE,
  formatArtifactSize,
  formatDimensions,
  formatDuration,
  getScan,
  nextPollDelay,
} from "./scan-api.js";

const TERMINAL = new Set(["ready", "failed"]);

export function renderScanPreview(id) {
  return `<section class="scan-preview" data-scan-preview data-scan-id="${esc(id)}">
    <header class="scan-preview-head">
      <span class="scan-preview-badge">${PREVIEW_COPY.badge}</span>
      <h1 data-scan-title>Hasil pindai</h1>
      <p class="scan-preview-facts" data-scan-facts>Memuat detail barang…</p>
      <p class="scan-preview-disclaimer">${PREVIEW_COPY.disclaimer}</p>
    </header>
    <div class="scan-preview-grid">
      <div class="scan-preview-main">
        <div class="scan-viewer" data-scan-viewer>
          <img class="scan-viewer-poster" data-scan-poster alt="Bingkai dari rekaman pindai" hidden>
          <p class="scan-viewer-placeholder" data-scan-viewer-placeholder>Menyiapkan pratinjau 3D…</p>
        </div>
        <section class="scan-stills" data-scan-stills hidden>
          <h2>Bingkai dari rekaman</h2>
          <div class="scan-stills-row" data-scan-stills-row></div>
        </section>
      </div>
      <aside class="scan-preview-side">
        <section class="scan-card" data-scan-status-card>
          <h2>Status pemrosesan</h2>
          <ol class="scan-stage-list" data-scan-stage-list>
            ${STAGE_SEQUENCE.map(
              (stage) =>
                `<li data-stage="${stage}"><span aria-hidden="true"></span>${STAGE_LABELS[stage]}</li>`,
            ).join("")}
          </ol>
          <p class="scan-card-note" data-scan-note>Proses berjalan di laptop demo. Jangan tutup laptop atau tab ini.</p>
          <p class="scan-error" data-scan-error role="alert" hidden></p>
          <div class="scan-retry" data-scan-retry hidden>
            <a class="scan-link-button primary" href="/jual/pindai" data-nav>${PREVIEW_COPY.retake}</a>
            <button type="button" class="scan-link-button" data-scan-reload>Coba lagi</button>
          </div>
        </section>
        <section class="scan-card scan-provenance" data-scan-provenance hidden>
          <h2>Asal rekaman</h2>
          <dl data-scan-provenance-list></dl>
        </section>
        <div class="scan-preview-actions">
          <a class="scan-link-button primary" href="/jual/pindai" data-nav>${PREVIEW_COPY.retake}</a>
          <a class="scan-link-button" href="/beli" data-nav>${PREVIEW_COPY.catalog}</a>
        </div>
      </aside>
    </div>
  </section>`;
}

export function mountScanPreview(root, { id, onNavigate, onToast } = {}) {
  const host = root.matches?.("[data-scan-preview]")
    ? root
    : root.querySelector("[data-scan-preview]");
  if (!host) return () => {};
  const $ = (selector) => host.querySelector(selector);
  const title = $("[data-scan-title]");
  const facts = $("[data-scan-facts]");
  const stageList = $("[data-scan-stage-list]");
  const note = $("[data-scan-note]");
  const errorNode = $("[data-scan-error]");
  const retry = $("[data-scan-retry]");
  const provenance = $("[data-scan-provenance]");
  const provenanceList = $("[data-scan-provenance-list]");
  const stills = $("[data-scan-stills]");
  const stillsRow = $("[data-scan-stills-row]");
  const viewerHost = $("[data-scan-viewer]");
  const poster = $("[data-scan-poster]");
  const placeholder = $("[data-scan-viewer-placeholder]");
  const reload = $("[data-scan-reload]");

  let disposed = false;
  let timer = 0;
  let attempt = 0;
  let controller = null;
  let viewerCleanup = null;
  let last = null;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(load, nextPollDelay(attempt));
  }

  function setStage(stage) {
    const index = STAGE_SEQUENCE.indexOf(stage);
    stageList.hidden = false;
    for (const item of stageList.querySelectorAll("li")) {
      const position = STAGE_SEQUENCE.indexOf(item.dataset.stage);
      item.classList.toggle(
        "is-done",
        stage === "ready" || (index > -1 && position < index),
      );
      item.classList.toggle("is-active", position === index);
    }
  }

  function paintStills(dto) {
    const urls = dto.artifact?.stills ?? [];
    stillsRow.replaceChildren();
    for (const url of urls) {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "Bingkai dari rekaman pindai";
      image.loading = "lazy";
      image.width = 320;
      image.height = 200;
      stillsRow.append(image);
    }
    stills.hidden = urls.length === 0;
  }

  function paintProvenance(dto) {
    const source = dto.provenance;
    if (!source) {
      provenance.hidden = true;
      return;
    }
    const rows = [
      ["Durasi rekaman", `${String(source.source?.clipSeconds ?? 0).replace(".", ",")} detik`],
      ["Perangkat", source.source?.device || "Tidak tercatat"],
      [
        "Bingkai",
        `${source.frames?.extracted ?? 0} diambil · ${source.frames?.registered ?? 0} terdaftar (${Math.round((source.frames?.ratio ?? 0) * 100)}%)`,
      ],
      ["Waktu proses", formatDuration(source.timings?.totalMs)],
      [
        "Artefak",
        `${formatArtifactSize(source.artifact?.bytes)} · ${Number(source.artifact?.splatCount ?? 0).toLocaleString("id-ID")} splat`,
      ],
    ];
    provenanceList.replaceChildren(
      ...rows.map(([label, value]) => {
        const term = document.createElement("dt");
        term.textContent = label;
        const detail = document.createElement("dd");
        detail.textContent = value;
        return [term, detail];
      }).flat(),
    );
    provenance.hidden = false;
  }

  function mountViewer(dto) {
    if (viewerCleanup || !dto.artifact?.url) return;
    if (poster && dto.artifact.stills?.[0]) {
      poster.src = dto.artifact.stills[0];
      poster.hidden = false;
    }
    void import("./scan-viewer.js")
      .then((module) => {
        if (disposed) return;
        viewerCleanup = module.mountScanViewer(viewerHost, {
          url: dto.artifact.url,
          poster: dto.artifact.stills?.[0],
          onStatus: (message, tone = "") => {
            if (!placeholder) return;
            if (message) {
              placeholder.textContent = message;
              placeholder.hidden = false;
            }
            placeholder.dataset.tone = tone;
          },
        });
      })
      .catch(() => {
        if (disposed || !placeholder) return;
        placeholder.textContent =
          "Pratinjau 3D belum bisa dibuka di perangkat ini. Bingkai rekaman tetap tersedia.";
        placeholder.dataset.tone = "error";
        placeholder.hidden = false;
      });
  }

  function paint(dto) {
    last = dto;
    title.textContent = dto.meta?.title || "Hasil pindai";
    facts.textContent = dto.meta
      ? `${formatDimensions(dto.meta)}${dto.meta.conditionNote ? ` · ${dto.meta.conditionNote}` : ""}`
      : "";
    errorNode.hidden = true;
    retry.hidden = true;
    if (dto.stage === "failed") {
      stageList.hidden = true;
      errorNode.textContent =
        ERROR_COPY[dto.error?.code] ?? ERROR_COPY.default;
      errorNode.hidden = false;
      retry.hidden = false;
      note.textContent = "Pemrosesan berhenti. Rekam ulang barang yang sama.";
      note.hidden = false;
      return;
    }
    setStage(dto.stage);
    if (dto.stage === "ready") {
      note.textContent =
        "Pemrosesan selesai di laptop demo. Model ini berasal dari rekaman barumu.";
      paintStills(dto);
      paintProvenance(dto);
      mountViewer(dto);
      return;
    }
    note.hidden = false;
  }

  function paintMissing() {
    if (disposed) return;
    title.textContent = PREVIEW_COPY.notFound;
    facts.textContent = "";
    stageList.hidden = true;
    errorNode.hidden = true;
    retry.hidden = false;
    note.textContent =
      "Periksa tautan atau rekam barang baru dari halaman pindai.";
    note.hidden = false;
    if (placeholder)
      placeholder.textContent = "Tidak ada pratinjau untuk tautan ini.";
  }

  async function load() {
    if (disposed) return;
    controller = new AbortController();
    try {
      const dto = await getScan(id, { signal: controller.signal });
      if (disposed) return;
      attempt = 0;
      paint(dto);
      if (!TERMINAL.has(dto.stage)) schedule();
    } catch (error) {
      if (disposed || error?.name === "AbortError") return;
      if (error?.code === "not_found") {
        paintMissing();
        return;
      }
      attempt += 1;
      schedule();
    }
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(timer);
      controller?.abort();
      return;
    }
    if (!TERMINAL.has(last?.stage)) load();
  }

  reload?.addEventListener("click", () => {
    errorNode.hidden = true;
    retry.hidden = true;
    stageList.hidden = false;
    attempt = 0;
    load();
  });
  document.addEventListener("visibilitychange", onVisibility);
  void load();

  return () => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
    viewerCleanup?.();
    document.removeEventListener("visibilitychange", onVisibility);
    host.replaceChildren();
  };
}
