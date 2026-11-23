import "./scan.css";
import "./scan-preview.css";
import {
  PREVIEW_COPY,
  STAGE_LABELS,
  errorCopy,
  formatBytes,
  formatDuration,
  getJob,
  isTerminalStage,
  nextPollDelay,
  refineJob,
  retryJob,
  stageIndex,
} from "./scan-api.js";
import { detailRows, refineNote, sourceOptions } from "./scan-views.js";

export { renderScanPreview } from "./scan-views.js";

// Buyer-visible result page. It only reads the job record, so reloading the
// URL resumes polling (or shows the finished model) without a new submission.
//
// A finished mesh job has up to three sources: the refined preview, KIRI's own
// scan and the seller's photos. The refined one is preselected, but the buyer
// can always reach the raw scan and the photos from the same page.

export function mountScanPreview(root, { id, onToast = () => {} } = {}) {
  const host = root.matches?.("[data-scan-preview]") ? root : root.querySelector("[data-scan-preview]");
  if (!host) return () => {};
  const q = (selector) => host.querySelector(selector);
  const title = q("[data-scan-title]");
  const facts = q("[data-scan-facts]");
  const provider = q("[data-scan-provider]");
  const viewerHost = q("[data-scan-viewer]");
  const placeholder = q("[data-scan-viewer-placeholder]");
  const stages = [...host.querySelectorAll("[data-scan-stage]")];
  const note = q("[data-scan-note]");
  const statusCard = q("[data-scan-status]");
  const provenance = q("[data-scan-provenance]");
  const details = q("[data-scan-details]");
  const errorCard = q("[data-scan-error]");
  const errorText = q("[data-scan-error-text]");
  const retryButton = q("[data-scan-retry]");
  const refineButton = q("[data-scan-refine]");
  const tabs = q("[data-scan-tabs]");
  const caveat = q("[data-scan-caveat]");
  const hint = q("[data-scan-hint]");
  const refineLine = q("[data-scan-refine-note]");
  const photosPanel = q("[data-scan-photos]");
  const photoGrid = q("[data-scan-photo-grid]");

  const controller = new AbortController();
  const { signal } = controller;
  const state = {
    disposed: false,
    timer: 0,
    attempt: 0,
    viewer: null,
    job: null,
    source: null,
    mountedFor: null,
  };

  function clearTimer() {
    clearTimeout(state.timer);
    state.timer = 0;
  }

  function paintStages(stage) {
    const current = stageIndex(stage);
    const stopped = stage === "failed" || stage === "expired";
    for (const item of stages) {
      const index = stageIndex(item.dataset.scanStage);
      item.classList.toggle("is-done", !stopped && index < current);
      item.classList.toggle("is-active", !stopped && index === current);
      item.classList.toggle("is-stopped", stopped && index === current);
    }
  }

  function unmountViewer() {
    state.viewer?.();
    state.viewer = null;
    state.mountedFor = null;
    viewerHost.dataset.state = "idle";
    for (const canvas of viewerHost.querySelectorAll("canvas")) canvas.remove();
    placeholder.hidden = false;
    placeholder.dataset.tone = "";
    placeholder.textContent = "Memuat model 3D…";
  }

  function mountViewer(option) {
    if (!option?.url) return;
    if (state.mountedFor === option.url) return;
    unmountViewer();
    state.mountedFor = option.url;
    void import("./scan-viewer.js")
      .then((module) => {
        if (state.disposed || state.mountedFor !== option.url) return;
        state.viewer = module.mountScanViewer(viewerHost, {
          url: option.url,
          format: option.format,
          onStatus: (message, tone = "") => {
            if (!message) return;
            placeholder.hidden = false;
            placeholder.textContent = message;
            placeholder.dataset.tone = tone;
          },
        });
      })
      .catch(() => {
        if (state.disposed) return;
        placeholder.hidden = false;
        placeholder.textContent = "Pratinjau 3D belum bisa dibuka di perangkat ini.";
        placeholder.dataset.tone = "error";
      });
  }

  function paintPhotos(dto) {
    const photos = dto.photos ?? [];
    photoGrid.replaceChildren(
      ...photos.map((photo, index) => {
        const item = document.createElement("li");
        const image = document.createElement("img");
        image.src = photo.url;
        image.alt = `Foto asli barang ${index + 1}`;
        image.loading = "lazy";
        image.width = 480;
        image.height = 360;
        item.append(image);
        return item;
      }),
    );
    photosPanel.hidden = !photos.length || state.source !== "photos";
  }

  function paintSources(dto) {
    const options = sourceOptions(dto);
    const available = options.map((option) => option.id);
    const preferred = available.includes("refined")
      ? "refined"
      : available.includes("raw")
        ? "raw"
        : available.includes("photos")
          ? "photos"
          : null;
    if (!available.includes(state.source)) state.source = preferred;

    tabs.hidden = options.length < 2;
    tabs.replaceChildren(
      ...options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scan-source-tab";
        button.dataset.scanSource = option.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(option.id === state.source));
        button.textContent = option.label;
        button.addEventListener(
          "click",
          () => {
            if (state.source === option.id) return;
            state.source = option.id;
            paintSources(state.job);
          },
          { signal },
        );
        return button;
      }),
    );

    const active = options.find((option) => option.id === state.source) ?? null;
    caveat.textContent = active?.caveat ?? PREVIEW_COPY.caveat;
    caveat.hidden = !active;
    hint.hidden = active?.id === "photos";
    viewerHost.hidden = active?.id === "photos";
    if (active?.id === "photos") {
      unmountViewer();
      viewerHost.hidden = true;
    } else {
      viewerHost.hidden = false;
      mountViewer(active);
    }
    paintPhotos(dto);
  }

  function paintJob(dto) {
    state.job = dto;
    title.textContent = dto.stage === "ready" ? "Model 3D hasil pindai" : "Pindai furnitur";
    provider.textContent = dto.mock
      ? "Mode simulasi: hasil ini dibuat lokal untuk menguji alur, bukan dari KIRI Engine."
      : PREVIEW_COPY.modelNote;
    errorCard.hidden = true;
    retryButton.hidden = true;
    paintStages(dto.stage);

    if (dto.stage === "ready") {
      statusCard.hidden = true;
      provenance.hidden = false;
      details.innerHTML = detailRows(dto)
        .map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`)
        .join("");
      // A mesh has triangles, a splat cloud has points; say which one this is
      // instead of printing "0 splat" for a GLB.
      const parts =
        dto.artifact?.format === "glb"
          ? [
              `${Number(dto.artifact?.triangles ?? 0).toLocaleString("id-ID")} segitiga`,
              dto.artifact?.refined ? "model disempurnakan" : "mesh",
            ]
          : [`${Number(dto.artifact?.splatCount ?? 0).toLocaleString("id-ID")} splat`];
      facts.textContent = `${parts.join(" · ")} · ${formatBytes(dto.artifact?.bytes)} · diproses ${formatDuration(Math.round((dto.timings?.totalMs ?? 0) / 1000))}`;
      refineLine.textContent = refineNote(dto);
      refineLine.hidden = !refineLine.textContent;
      // The refine stage is free to retry from the saved GLB, so it is offered
      // whenever it did not apply and the job kept KIRI's mesh.
      refineButton.hidden = !(
        dto.artifact?.format === "glb" &&
        dto.artifact?.raw &&
        dto.refine?.status !== "applied"
      );
      paintSources(dto);
      placeholder.hidden = viewerHost.dataset.state === "ready" || state.source === "photos";
      return;
    }

    statusCard.hidden = false;
    provenance.hidden = true;
    refineLine.hidden = true;
    refineButton.hidden = true;
    tabs.hidden = true;
    photosPanel.hidden = true;
    facts.textContent = "Model sedang disiapkan. Halaman ini memperbarui statusnya sendiri.";
    if (dto.stage === "failed" || dto.stage === "expired") {
      errorCard.hidden = false;
      errorText.textContent = errorCopy(dto.error?.code, dto.error?.message);
      retryButton.hidden = !(dto.error?.retryable && dto.kiri?.serial);
      note.textContent =
        dto.stage === "expired"
          ? "KIRI menyimpan hasil tiga hari. Setelah itu model harus diproses ulang dari video."
          : "Proses berhenti. Coba proses ulang bila kesalahannya di unduhan atau konversi; kalau tidak, pindai ulang barangnya.";
      placeholder.hidden = false;
      placeholder.textContent =
        dto.stage === "expired" ? "Hasil sudah tidak tersedia." : "Belum ada model untuk ditampilkan.";
      placeholder.dataset.tone = "error";
      return;
    }
    note.textContent =
      dto.stage === "processing"
        ? "KIRI Engine sedang menyusun model. Biasanya beberapa menit untuk satu barang."
        : "Menunggu antrean. Halaman ini memeriksa ulang secara berkala.";
    viewerHost.hidden = false;
    placeholder.hidden = false;
    placeholder.textContent = STAGE_LABELS[dto.stage] ?? "Menyiapkan model…";
    placeholder.dataset.tone = "";
  }

  function paintMissing() {
    title.textContent = PREVIEW_COPY.notFound;
    facts.textContent = PREVIEW_COPY.notFoundNote;
    provider.textContent = "";
    statusCard.hidden = true;
    provenance.hidden = true;
    errorCard.hidden = true;
    refineLine.hidden = true;
    refineButton.hidden = true;
    tabs.hidden = true;
    photosPanel.hidden = true;
    placeholder.hidden = false;
    placeholder.textContent = "Tidak ada model untuk tautan ini.";
    placeholder.dataset.tone = "error";
  }

  async function load() {
    if (state.disposed) return;
    clearTimer();
    try {
      const dto = await getJob(id);
      if (state.disposed) return;
      state.attempt = 0;
      paintJob(dto);
      if (!isTerminalStage(dto.stage))
        state.timer = setTimeout(() => void load(), nextPollDelay(state.attempt++));
    } catch (error) {
      if (state.disposed || error?.name === "AbortError") return;
      if (error?.code === "not_found") {
        paintMissing();
        return;
      }
      if (state.attempt >= 5) {
        errorCard.hidden = false;
        errorText.textContent = errorCopy(error?.code, error?.message);
        placeholder.hidden = false;
        placeholder.textContent = "Status belum bisa dimuat.";
        placeholder.dataset.tone = "error";
        return;
      }
      state.timer = setTimeout(() => void load(), nextPollDelay(state.attempt++));
    }
  }

  retryButton.addEventListener(
    "click",
    async () => {
      if (!state.job) return;
      retryButton.disabled = true;
      try {
        const dto = await retryJob(state.job.id);
        paintJob(dto);
        void load();
      } catch (error) {
        onToast?.(errorCopy(error?.code, error?.message));
      } finally {
        retryButton.disabled = false;
      }
    },
    { signal },
  );

  refineButton.addEventListener(
    "click",
    async () => {
      if (!state.job) return;
      refineButton.disabled = true;
      refineButton.textContent = "Menyempurnakan…";
      try {
        const dto = await refineJob(state.job.id);
        state.mountedFor = null;
        paintJob(dto);
        const status = dto.refine?.status;
        if (status === "applied") onToast?.("Model disempurnakan dari pindaian yang tersimpan.");
        else if (status === "failed" || status === "skipped")
          onToast?.("Penyempurnaan belum berhasil. Pindaian asli tetap bisa dibuka.");
      } catch (error) {
        onToast?.(errorCopy(error?.code, error?.message));
      } finally {
        refineButton.disabled = false;
        refineButton.textContent = PREVIEW_COPY.refine;
      }
    },
    { signal },
  );

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden && !isTerminalStage(state.job?.stage)) void load();
    },
    { signal },
  );

  void load();

  return () => {
    state.disposed = true;
    clearTimer();
    controller.abort();
    state.viewer?.();
    host.replaceChildren();
  };
}
