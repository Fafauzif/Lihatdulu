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
  retryJob,
  stageIndex,
} from "./scan-api.js";
import { detailRows } from "./scan-views.js";

export { renderScanPreview } from "./scan-views.js";

// Buyer-visible result page. It only reads the job record, so reloading the
// URL resumes polling (or shows the finished model) without a new submission.

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

  const controller = new AbortController();
  const { signal } = controller;
  const state = { disposed: false, timer: 0, attempt: 0, viewer: null, job: null };

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

  function mountViewer(dto) {
    if (state.viewer || !dto.artifact?.url) return;
    placeholder.textContent = "Memuat model 3D…";
    void import("./scan-viewer.js")
      .then((module) => {
        if (state.disposed) return;
        state.viewer = module.mountScanViewer(viewerHost, {
          url: dto.artifact.url,
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
      facts.textContent = `${Number(dto.artifact?.splatCount ?? 0).toLocaleString("id-ID")} splat · ${formatBytes(dto.artifact?.bytes)} · diproses ${formatDuration(Math.round((dto.timings?.totalMs ?? 0) / 1000))}`;
      mountViewer(dto);
      placeholder.hidden = viewerHost.dataset.state === "ready";
      return;
    }

    statusCard.hidden = false;
    provenance.hidden = true;
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
