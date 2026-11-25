import "./scan.css";
import "./scan-preview.css";
import {
  PREVIEW_COPY,
  STAGE_LABELS,
  errorCopy,
  formatBytes,
  getJob,
  isTerminalStage,
  nextPollDelay,
  refineJob,
  retryJob,
  stageIndex,
} from "./scan-api.js";
import {
  detailRows,
  hasPoorCoverage,
  provenanceSummary,
  readSourceChoice,
  refineNote,
  resolveSource,
  sourceOptions,
  writeSourceChoice,
} from "./scan-views.js";

export { renderScanPreview } from "./scan-views.js";

// Buyer-visible result page. It only reads the job record, so reloading the
// URL resumes polling (or shows the finished model) without a new submission.
//
// A finished mesh job has up to three sources: the refined preview, KIRI's own
// scan and the seller's photos. Photos open first when the mesh sees through
// itself, but the buyer can always reach the raw scan and the photos from the
// same page, and the tab they pick is remembered for this result.

// A saved, already-paid chair scan ships with the app so a judge can open a
// real result without spending a credit or waiting. Its job record is a static
// file, not a live server route, so it also works on a plain static host.
export const DEMO_ID = "demo-chair";
export const DEMO_URL = "/demo/kursi/job.json";

export function isDemoId(id) {
  return id === DEMO_ID;
}

export async function loadDemoJob(fetchImpl = fetch) {
  const response = await fetchImpl(DEMO_URL, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("demo");
  return response.json();
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

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
  const details = q("[data-scan-details]");
  const summary = q("[data-scan-summary]");
  const summarySource = q("[data-scan-summary-source]");
  const summaryLimits = q("[data-scan-summary-limits]");
  const errorCard = q("[data-scan-error]");
  const errorText = q("[data-scan-error-text]");
  const retryButton = q("[data-scan-retry]");
  const refineButton = q("[data-scan-refine]");
  const tabs = q("[data-scan-tabs]");
  const evidence = q("[data-scan-evidence]");
  const caveat = q("[data-scan-caveat]");
  const hint = q("[data-scan-hint]");
  const refineLine = q("[data-scan-refine-note]");
  const photosPanel = q("[data-scan-photos]");
  const photoHero = q("[data-scan-photo-hero]");
  const photoHeroLabel = q("[data-scan-photo-hero-label]");
  const photoGrid = q("[data-scan-photo-grid]");
  const openReason = q("[data-scan-open-reason]");
  const openModel = q("[data-scan-open-model]");
  const openPhotos = q("[data-scan-open-photos]");
  const storage = browserStorage();

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
    tabsKey: null,
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
    const [hero, ...rest] = photos;
    photosPanel.hidden = !photos.length || state.source !== "photos";
    if (hero) {
      photoHero.src = hero.url;
      photoHero.alt = `Foto asli kursi dari penjual, tampak 1 dari ${photos.length}`;
      photoHero.width = 960;
      photoHero.height = 1280;
      photoHeroLabel.textContent = `Foto asli 1 dari ${photos.length}`;
    }
    photoGrid.replaceChildren(
      ...rest.map((photo, index) => {
        const item = document.createElement("li");
        const image = document.createElement("img");
        image.src = photo.url;
        image.alt = `Foto asli barang ${index + 2}`;
        image.loading = "lazy";
        image.width = 480;
        image.height = 360;
        item.append(image);
        return item;
      }),
    );
    const modelOption = (state.job ? sourceOptions(state.job) : []).find(
      (option) => option.format,
    );
    openModel.hidden = !modelOption || state.source !== "photos";
    openModel.textContent = modelOption?.id === "raw" ? "Buka pindaian asli" : PREVIEW_COPY.openModel;
    openPhotos.hidden = !photos.length || state.source === "photos";
  }

  function selectSource(sourceId, { focus = false } = {}) {
    const option = sourceOptions(state.job).find((item) => item.id === sourceId);
    if (!option || state.source === sourceId) {
      if (focus) tabs.querySelector(`[data-scan-source="${sourceId}"]`)?.focus();
      return;
    }
    state.source = sourceId;
    writeSourceChoice(storage, id, sourceId);
    paintSources(state.job);
    if (focus) tabs.querySelector(`[data-scan-source="${sourceId}"]`)?.focus();
  }

  function buildTabs(options) {
    const key = options.map((option) => `${option.id}:${option.label}`).join("|");
    if (key === state.tabsKey) return;
    state.tabsKey = key;
    const focused = document.activeElement?.dataset?.scanSource;
    tabs.replaceChildren(
      ...options.map((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "scan-source-tab";
        button.id = `scan-tab-${option.id}`;
        button.dataset.scanSource = option.id;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", "scan-evidence");
        button.textContent = option.label;
        button.addEventListener("click", () => selectSource(option.id, { focus: true }), {
          signal,
        });
        return button;
      }),
    );
    if (focused && tabs.querySelector(`[data-scan-source="${focused}"]`))
      tabs.querySelector(`[data-scan-source="${focused}"]`).focus();
  }

  function paintSources(dto) {
    const options = sourceOptions(dto);
    const available = options.map((option) => option.id);
    if (!available.includes(state.source))
      state.source = resolveSource(dto, readSourceChoice(storage, id));
    buildTabs(options);
    tabs.hidden = options.length < 2;
    for (const tab of tabs.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.scanSource === state.source;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (options.length > 1)
      evidence.setAttribute("aria-labelledby", `scan-tab-${state.source}`);
    else {
      evidence.removeAttribute("aria-labelledby");
      evidence.setAttribute("aria-label", "Bukti pindai");
    }

    const active = options.find((option) => option.id === state.source) ?? null;
    caveat.textContent = active?.caveat ?? PREVIEW_COPY.caveat;
    // The photo hero already carries its own caption.
    caveat.hidden = !active || active.id === "photos";
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

  function paintSummary(dto) {
    const summaryCopy = provenanceSummary(dto);
    summarySource.textContent = summaryCopy.source;
    summaryLimits.replaceChildren(
      ...summaryCopy.limits.map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      }),
    );
    summary.hidden = !summaryCopy.source;
    details.innerHTML = detailRows(dto)
      .map(([term, value]) => `<dt>${term}</dt><dd>${value}</dd>`)
      .join("");
  }

  function paintJob(dto) {
    state.job = dto;
    title.textContent =
      dto.stage === "ready"
        ? dto.demo === true
          ? "Kursi jaring hitam, hasil pindai"
          : "Model 3D hasil pindai"
        : "Pindai furnitur";
    provider.textContent = dto.mock
      ? "Mode simulasi: hasil ini dibuat lokal untuk menguji alur, bukan dari KIRI Engine."
      : PREVIEW_COPY.modelNote;
    errorCard.hidden = true;
    retryButton.hidden = true;
    if (dto.demo === true) {
      // Saved example: nothing to retry and nothing to re-refine here.
      refineButton.hidden = true;
      provider.textContent = PREVIEW_COPY.demoNote;
    }
    paintStages(dto.stage);

    if (dto.stage === "ready") {
      statusCard.hidden = true;
      const seeThrough =
        hasPoorCoverage(dto) && (dto.photos ?? []).length
          ? "Dibuka di foto asli karena model masih berlubang. Ketiga sumber ada di tab di atas."
          : "";
      openReason.textContent = seeThrough;
      openReason.hidden = !seeThrough;
      // A mesh has triangles, a splat cloud has points; say which one this is
      // instead of printing "0 splat" for a GLB.
      const parts =
        dto.artifact?.format === "glb"
          ? [
              `${Number(dto.artifact?.triangles ?? 0).toLocaleString("id-ID")} segitiga`,
              dto.artifact?.refined ? "model disempurnakan" : "mesh",
              `GLB ${formatBytes(dto.artifact?.bytes)}`,
            ]
          : [
              `${Number(dto.artifact?.splatCount ?? 0).toLocaleString("id-ID")} splat`,
              `SPZ ${formatBytes(dto.artifact?.bytes)}`,
            ];
      facts.textContent = parts.join(" · ");
      // The summary already states the limitation in short form, and the
      // technical rows keep the numbers; only a non-applied refine stage needs
      // its own sentence.
      refineLine.textContent =
        dto.refine?.status === "applied" ? "" : refineNote(dto);
      refineLine.hidden = !refineLine.textContent;
      // The refine stage is free to retry from the saved GLB, so it is offered
      // whenever it did not apply and the job kept KIRI's mesh.
      refineButton.hidden =
        dto.demo === true ||
        !(
          dto.artifact?.format === "glb" &&
          dto.artifact?.raw &&
          dto.refine?.status !== "applied"
        );
      paintSummary(dto);
      paintSources(dto);
      placeholder.hidden = viewerHost.dataset.state === "ready" || state.source === "photos";
      return;
    }

    statusCard.hidden = false;
    summary.hidden = true;
    openReason.hidden = true;
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
    summary.hidden = true;
    errorCard.hidden = true;
    refineLine.hidden = true;
    refineButton.hidden = true;
    openReason.hidden = true;
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
      const dto = isDemoId(id) ? await loadDemoJob() : await getJob(id);
      if (state.disposed) return;
      state.attempt = 0;
      paintJob(dto);
      if (!isTerminalStage(dto.stage) && !isDemoId(id))
        state.timer = setTimeout(() => void load(), nextPollDelay(state.attempt++));
    } catch (error) {
      if (state.disposed || error?.name === "AbortError") return;
      if (error?.code === "not_found") {
        paintMissing();
        return;
      }
      if (error?.code === "unavailable") {
        // A static host has no scan server. Say that once, and keep the saved
        // example reachable instead of retrying into a spinner.
        errorCard.hidden = false;
        errorText.textContent = errorCopy("unavailable");
        placeholder.hidden = false;
        placeholder.textContent = "Hasil ini butuh server pindai.";
        placeholder.dataset.tone = "error";
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

  tabs.addEventListener(
    "keydown",
    (event) => {
      const current = tabs.querySelector('[role="tab"][aria-selected="true"]');
      if (!current) return;
      const list = [...tabs.querySelectorAll('[role="tab"]')];
      const index = list.indexOf(current);
      let next = null;
      if (event.key === "ArrowRight") next = list[(index + 1) % list.length];
      else if (event.key === "ArrowLeft")
        next = list[(index - 1 + list.length) % list.length];
      else if (event.key === "Home") next = list[0];
      else if (event.key === "End") next = list[list.length - 1];
      if (!next) return;
      event.preventDefault();
      selectSource(next.dataset.scanSource);
      next.focus();
    },
    { signal },
  );

  openModel.addEventListener(
    "click",
    () => {
      const option = (state.job ? sourceOptions(state.job) : []).find(
        (candidate) => candidate.format,
      );
      if (!option) return;
      selectSource(option.id, { focus: true });
      viewerHost.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    },
    { signal },
  );

  openPhotos.addEventListener(
    "click",
    () => {
      selectSource("photos", { focus: true });
      photosPanel.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    },
    { signal },
  );

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
