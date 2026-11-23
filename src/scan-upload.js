import "./scan.css";
import "./scan-upload.css";
import {
  DEFAULT_LIMITS,
  UPLOAD_COPY,
  errorCopy,
  formatBytes,
  formatDuration,
  getJob,
  getScanConfig,
  isTerminalStage,
  nextPollDelay,
  readStoredJobId,
  retryJob,
  stageIndex,
  storeJobId,
  uploadJob,
  validateVideoBasics,
  validateVideoFile,
} from "./scan-api.js";
import { STAGE_HEADING } from "./scan-views.js";

export { renderScanUpload } from "./scan-views.js";

// Upload-only seller flow. The browser never calls KIRI directly: it hands one
// MP4 to our server, which owns the key and the job record. Every state below
// mirrors a server stage so a reload can pick the same job back up.

function readVideoMetadata(url) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    const cleanup = () => {
      clearTimeout(timer);
      probe.removeAttribute("src");
      URL.revokeObjectURL?.(url);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("metadata timeout"));
    }, 5000);
    probe.addEventListener(
      "loadedmetadata",
      () => {
        const result = {
          durationS: Number(probe.duration),
          width: probe.videoWidth,
          height: probe.videoHeight,
        };
        cleanup();
        resolve(result);
      },
      { once: true },
    );
    probe.addEventListener(
      "error",
      () => {
        cleanup();
        reject(new Error("metadata"));
      },
      { once: true },
    );
    probe.src = url;
  });
}

function localStore() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function mountScanUpload(root, { onNavigate = () => {}, onToast = () => {} } = {}) {
  const host = root.matches?.("[data-scan-upload]") ? root : root.querySelector("[data-scan-upload]");
  if (!host) return () => {};
  const q = (selector) => host.querySelector(selector);
  const controller = new AbortController();
  const { signal } = controller;
  const picker = q("[data-scan-picker]");
  const confirm = q("[data-scan-confirm]");
  const input = q("[data-scan-input]");
  const drop = q("[data-scan-drop]");
  const choose = q("[data-scan-choose]");
  const change = q("[data-scan-change]");
  const media = q("[data-scan-media]");
  const video = q("[data-scan-video]");
  const facts = q("[data-scan-facts]");
  const fileError = q("[data-scan-file-error]");
  const consent = q("[data-scan-consent]");
  const submitButton = q("[data-scan-submit]");
  const configNote = q("[data-scan-config-note]");
  const modeBanner = q("[data-scan-mode]");
  const jobPanel = q("[data-scan-job]");
  const jobTitle = q("[data-scan-job-title]");
  const jobBadge = q("[data-scan-job-badge]");
  const jobMode = q("[data-scan-job-mode]");
  const stages = [...host.querySelectorAll("[data-scan-stage]")];
  const progress = q("[data-scan-progress]");
  const progressBar = q("[data-scan-progress-bar]");
  const progressLabel = q("[data-scan-progress-label]");
  const jobError = q("[data-scan-job-error]");
  const openLink = q("[data-scan-open]");
  const retryButton = q("[data-scan-retry]");
  const resendButton = q("[data-scan-resend]");
  const newButton = q("[data-scan-new]");
  const jobNote = q("[data-scan-job-note]");

  const state = {
    file: null,
    objectUrl: null,
    metadata: null,
    validation: null,
    limits: { ...DEFAULT_LIMITS },
    config: null,
    job: null,
    busy: false,
    pollTimer: 0,
    pollAttempt: 0,
    disposed: false,
  };

  function showMode(config) {
    state.config = config;
    if (config.mode === "mock") {
      modeBanner.hidden = false;
      modeBanner.dataset.tone = "mock";
      modeBanner.textContent = UPLOAD_COPY.mockNote;
      jobMode.hidden = false;
    } else if (config.mode === "unconfigured") {
      modeBanner.hidden = false;
      modeBanner.dataset.tone = "warning";
      modeBanner.textContent = UPLOAD_COPY.unconfiguredNote;
      configNote.hidden = false;
      configNote.textContent = UPLOAD_COPY.unconfiguredNote;
    }
    applyLimits();
  }

  function applyLimits() {
    if (state.config?.limits) {
      state.limits = { ...DEFAULT_LIMITS, ...state.config.limits };
      confirm.querySelector(
        ".scan-facts li:nth-child(3)",
      ).innerHTML = `<strong>Batas KIRI.</strong> MP4 sampai ${formatBytes(state.limits.maxUploadBytes)}, ${Math.round(state.limits.maxDurationS / 60)} menit, maksimal ${state.limits.maxWidth}×${state.limits.maxHeight}.`;
    }
    refreshSubmit();
  }

  function showFileError(code, message) {
    fileError.hidden = !message;
    fileError.textContent = message;
  }

  function refreshSubmit() {
    const blocked =
      !state.file ||
      !state.validation?.ok ||
      !consent.checked ||
      state.busy ||
      state.config?.mode === "unconfigured" ||
      (state.job && !isTerminalStage(state.job.stage));
    submitButton.disabled = Boolean(blocked);
    submitButton.textContent = state.busy ? UPLOAD_COPY.submitting : UPLOAD_COPY.submit;
  }

  function resetFile() {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    state.file = null;
    state.metadata = null;
    state.validation = null;
    video.removeAttribute("src");
    video.load?.();
    media.hidden = true;
    change.hidden = true;
    input.value = "";
    showFileError(null, "");
    refreshSubmit();
  }

  async function acceptFile(file) {
    if (!file) return;
    resetFile();
    state.file = file;
    showFileError(null, "");
    const basic = validateVideoBasics(
      { name: file.name, type: file.type, size: file.size },
      state.limits,
    );
    if (!basic.ok) {
      state.validation = basic;
      showFileError(basic.code, basic.message);
      refreshSubmit();
      return;
    }
    state.objectUrl = URL.createObjectURL(file);
    video.src = state.objectUrl;
    media.hidden = false;
    change.hidden = false;
    facts.textContent = `${file.name} · ${formatBytes(file.size)} · memuat detail video…`;
    try {
      const probeUrl = URL.createObjectURL(file);
      state.metadata = await readVideoMetadata(probeUrl);
    } catch {
      state.metadata = null;
    }
    const metadata = state.metadata ?? {};
    state.validation = validateVideoFile(
      {
        name: file.name,
        type: file.type,
        size: file.size,
        durationS: metadata.durationS,
        width: metadata.width,
        height: metadata.height,
      },
      state.limits,
    );
    facts.textContent = [
      file.name,
      formatBytes(file.size),
      metadata.durationS ? formatDuration(metadata.durationS) : null,
      metadata.width ? `${metadata.width}×${metadata.height}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (!state.validation.ok) showFileError(state.validation.code, state.validation.message);
    refreshSubmit();
  }

  function setProgress({ percent = null, tone = "" } = {}) {
    progress.dataset.indeterminate = percent === null ? "true" : "false";
    progress.dataset.tone = tone;
    if (percent === null) {
      progress.removeAttribute("aria-valuenow");
      progressBar.style.width = "100%";
    } else {
      const value = Math.max(0, Math.min(100, Math.round(percent * 100)));
      progress.setAttribute("aria-valuenow", String(value));
      progressBar.style.width = `${value}%`;
    }
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

  function clearPoll() {
    clearTimeout(state.pollTimer);
    state.pollTimer = 0;
  }

  function showJob(job) {
    state.job = job;
    jobPanel.hidden = false;
    host.dataset.hasJob = "1";
    picker.hidden = true;
    confirm.hidden = true;
    jobMode.hidden = !job.mock;
    jobMode.textContent = job.mock ? UPLOAD_COPY.mockNote : "";
    jobTitle.textContent = STAGE_HEADING[job.stage] ?? "Proses pindai";
    jobBadge.hidden = false;
    jobBadge.dataset.tone =
      job.stage === "ready" ? "ready" : job.stage === "failed" || job.stage === "expired" ? "error" : "busy";
    jobBadge.textContent =
      job.stage === "ready"
        ? "Siap dilihat"
        : job.stage === "failed"
          ? "Berhenti"
          : job.stage === "expired"
            ? "Kedaluwarsa"
            : "Berjalan";
    paintStages(job.stage);
    jobError.hidden = true;
    retryButton.hidden = true;
    resendButton.hidden = true;
    newButton.hidden = true;
    openLink.hidden = false;
    openLink.href = `/pindai/${job.id}`;
    openLink.textContent = job.stage === "ready" ? UPLOAD_COPY.openResult : "Buka halaman proses";

    if (job.stage === "uploading") {
      setProgress({ percent: state.uploadPercent ?? 0 });
      progressLabel.textContent = `Mengunggah ${Math.round((state.uploadPercent ?? 0) * 100)}%`;
      jobNote.hidden = false;
      jobNote.textContent = "Biarkan tab ini terbuka sampai unggahan selesai.";
    } else if (job.stage === "ready") {
      setProgress({ percent: 1 });
      progressLabel.textContent = `Selesai · ${job.artifact?.splatCount?.toLocaleString("id-ID") ?? "—"} splat · ${formatBytes(job.artifact?.bytes)}`;
      jobNote.hidden = false;
      jobNote.textContent = "Model tersimpan di server ini. Kamu bisa membuka hasilnya kapan saja.";
      newButton.hidden = false;
      newButton.textContent = UPLOAD_COPY.another;
    } else if (job.stage === "failed" || job.stage === "expired") {
      setProgress({ percent: 1, tone: "error" });
      progressLabel.textContent = job.stage === "expired" ? "Hasil tidak tersedia lagi" : "Proses berhenti sebelum selesai";
      jobError.hidden = false;
      jobError.textContent = errorCopy(job.error?.code, job.error?.message);
      if (job.error?.retryable && job.kiri?.serial) retryButton.hidden = false;
      else if (state.file) resendButton.hidden = false;
      if (!state.file) {
        newButton.hidden = false;
        newButton.textContent = "Pilih video lain";
      }
      jobNote.hidden = false;
      jobNote.textContent =
        "Tidak ada video yang dikirim ulang tanpa persetujuanmu. Cek videonya, lalu kirim lagi bila perlu.";
    } else {
      setProgress({ percent: null });
      progressLabel.textContent = job.stage === "processing" ? "KIRI memproses video di cloud." : "Menunggu giliran di server KIRI.";
      jobNote.hidden = false;
      jobNote.textContent = "Proses berjalan di server. Kamu boleh menutup tab ini lalu membuka tautan hasilnya lagi.";
    }
    refreshSubmit();
  }

  function showJobError(error) {
    jobPanel.hidden = false;
    host.dataset.hasJob = "1";
    picker.hidden = true;
    confirm.hidden = true;
    jobTitle.textContent = "Pengiriman gagal";
    jobBadge.hidden = false;
    jobBadge.dataset.tone = "error";
    jobBadge.textContent = "Gagal";
    jobError.hidden = false;
    jobError.textContent = errorCopy(error?.code, error?.message);
    openLink.hidden = true;
    retryButton.hidden = true;
    resendButton.hidden = !state.file;
    newButton.hidden = false;
    newButton.textContent = state.file ? "Pilih video lain" : "Pilih video";
    setProgress({ percent: 1, tone: "error" });
    progressLabel.textContent = "Video belum terkirim";
    jobNote.hidden = false;
    jobNote.textContent = "Coba lagi setelah sambungan membaik. Kiriman hanya terjadi saat kamu menekan tombol.";
    state.busy = false;
    refreshSubmit();
  }

  function resetToPicker() {
    clearPoll();
    storeJobId(localStore(), null);
    state.job = null;
    state.busy = false;
    host.dataset.hasJob = "";
    jobPanel.hidden = true;
    picker.hidden = false;
    confirm.hidden = false;
    jobError.hidden = true;
    openLink.hidden = true;
    retryButton.hidden = true;
    resendButton.hidden = true;
    newButton.hidden = true;
    jobNote.hidden = true;
    jobBadge.hidden = true;
    progressLabel.textContent = "";
    setProgress({ percent: 0 });
    resetFile();
    choose.focus?.();
  }

  async function pollJob(id) {
    if (state.disposed) return;
    clearPoll();
    try {
      const job = await getJob(id);
      if (state.disposed) return;
      state.pollAttempt = 0;
      showJob(job);
      if (isTerminalStage(job.stage)) {
        clearPoll();
        return;
      }
      clearPoll();
      state.pollTimer = setTimeout(
        () => void pollJob(id),
        nextPollDelay(state.pollAttempt++),
      );
    } catch (error) {
      if (state.disposed || error?.name === "AbortError") return;
      if (error?.code === "not_found") {
        clearPoll();
        storeJobId(localStore(), null);
        jobError.hidden = false;
        jobError.textContent = errorCopy("not_found");
        jobTitle.textContent = "Pekerjaan tidak ditemukan";
        openLink.hidden = true;
        newButton.hidden = false;
        newButton.textContent = "Pindai barang baru";
        return;
      }
      if (state.pollAttempt >= 5) {
        showJobError(error);
        return;
      }
      clearPoll();
      state.pollTimer = setTimeout(
        () => void pollJob(id),
        nextPollDelay(state.pollAttempt++),
      );
    }
  }

  async function submit() {
    if (state.busy || !state.file || !state.validation?.ok || !consent.checked) return;
    if (state.config?.mode === "unconfigured") {
      onToast?.(UPLOAD_COPY.unconfiguredNote);
      return;
    }
    state.busy = true;
    state.uploadPercent = 0;
    refreshSubmit();
    jobPanel.hidden = false;
    host.dataset.hasJob = "1";
    picker.hidden = true;
    confirm.hidden = true;
    jobTitle.textContent = STAGE_HEADING.uploading;
    jobBadge.hidden = true;
    jobError.hidden = true;
    openLink.hidden = true;
    retryButton.hidden = true;
    resendButton.hidden = true;
    newButton.hidden = true;
    paintStages("uploading");
    setProgress({ percent: 0 });
    progressLabel.textContent = "Mengunggah 0%";
    try {
      const job = await uploadJob(state.file, {
        onProgress: (value) => {
          state.uploadPercent = value;
          if (state.job) return;
          if (jobPanel.hidden) return;
          paintStages("uploading");
          setProgress({ percent: value });
          progressLabel.textContent = `Mengunggah ${Math.round(value * 100)}%`;
        },
      });
      if (state.disposed) return;
      state.busy = false;
      storeJobId(localStore(), job.id);
      state.uploadPercent = null;
      showJob(job);
      if (!isTerminalStage(job.stage)) {
        clearPoll();
        state.pollAttempt = 0;
        state.pollTimer = setTimeout(
          () => void pollJob(job.id),
          nextPollDelay(0),
        );
      }
    } catch (error) {
      if (state.disposed) return;
      state.busy = false;
      showJobError(error);
    }
  }

  async function restore() {
    const id = readStoredJobId(localStore());
    if (!id) return;
    try {
      const job = await getJob(id);
      if (state.disposed) return;
      showJob(job);
      if (!isTerminalStage(job.stage)) void pollJob(id);
    } catch (error) {
      if (error?.code === "not_found") storeJobId(localStore(), null);
    }
  }

  choose.addEventListener("click", () => input.click(), { signal });
  change.addEventListener("click", () => input.click(), { signal });
  input.addEventListener(
    "change",
    () => {
      const [file] = input.files ?? [];
      if (file) void acceptFile(file);
    },
    { signal },
  );
  for (const event of ["dragenter", "dragover"]) {
    drop.addEventListener(
      event,
      (dragEvent) => {
        dragEvent.preventDefault();
        drop.dataset.dragging = "true";
      },
      { signal },
    );
  }
  for (const event of ["dragleave", "drop"]) {
    drop.addEventListener(
      event,
      (dragEvent) => {
        dragEvent.preventDefault();
        drop.dataset.dragging = "false";
      },
      { signal },
    );
  }
  drop.addEventListener(
    "drop",
    (dragEvent) => {
      const [file] = dragEvent.dataTransfer?.files ?? [];
      if (file) void acceptFile(file);
    },
    { signal },
  );
  consent.addEventListener("change", refreshSubmit, { signal });
  submitButton.addEventListener("click", () => void submit(), { signal });
  newButton.addEventListener("click", () => resetToPicker(), { signal });
  resendButton.addEventListener("click", () => void submit(), { signal });
  retryButton.addEventListener(
    "click",
    async () => {
      if (!state.job) return;
      retryButton.disabled = true;
      try {
        const job = await retryJob(state.job.id);
        showJob(job);
        void pollJob(job.id);
      } catch (error) {
        showJobError(error);
      } finally {
        retryButton.disabled = false;
      }
    },
    { signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden || !state.job || isTerminalStage(state.job.stage)) return;
      void pollJob(state.job.id);
    },
    { signal },
  );

  refreshSubmit();
  void getScanConfig()
    .then((config) => {
      if (!state.disposed) showMode(config);
    })
    .catch(() => {
      if (state.disposed) return;
      modeBanner.hidden = false;
      modeBanner.dataset.tone = "warning";
      modeBanner.textContent = "Server pindai belum bisa dihubungi. Periksa apakah proses API berjalan.";
      submitButton.disabled = true;
    });
  void restore();

  return () => {
    state.disposed = true;
    clearPoll();
    controller.abort();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    host.replaceChildren();
  };
}
