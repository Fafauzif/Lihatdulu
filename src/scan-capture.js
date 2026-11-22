import "./scan-capture.css";
import { icon } from "./components.js";
import { ERROR_COPY, uploadScan } from "./scan-api.js";
import {
  CAPTURE_TIPS,
  GUIDANCE,
  MAX_SECONDS,
  MIN_SECONDS,
  cameraErrorCopy,
  guidanceAt,
  pickRecorderMime,
} from "./scan-recorder.js";

// A completed clip lives at module scope so leaving the route and coming
// back still offers the last recording for upload retry.

let pendingClip = null;

const timeLabel = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function renderScanCapture() {
  return `<section class="scan-capture" data-scan-capture aria-labelledby="scan-heading">
    <header class="scan-bar">
      <a class="scan-back" href="/jual" data-nav>${icon("back")}Ruang penjual</a>
      <span class="scan-badge">Pindai baru</span>
    </header>
    <div class="scan-head">
      <h1 id="scan-heading">Pindai furniturmu.</h1>
      <p>Rekam satu putaran pelan. Pembeli bisa memutar hasilnya dari setiap sisi.</p>
    </div>
    <ul class="scan-tips">
      ${CAPTURE_TIPS.map((tip) => `<li>${tip}</li>`).join("")}
    </ul>
    <div class="scan-grid">
      <div class="scan-stage">
        <video data-scan-video playsinline muted autoplay></video>
        <video data-scan-review controls playsinline hidden></video>
        <div class="scan-empty" data-scan-empty>
          <span class="scan-empty-icon">${icon("camera")}</span>
          <p>Kamera belum menyala.</p>
        </div>
        <div class="scan-stage-top">
          <span data-scan-timer>0:00</span>
          <span class="scan-recording" data-scan-recording hidden><i aria-hidden="true"></i>Merekam</span>
        </div>
        <p class="scan-guidance" data-scan-guidance aria-live="polite">${GUIDANCE[0]}</p>
      </div>
      <aside class="scan-panel">
        <div class="scan-actions">
          <button type="button" class="scan-button primary" data-scan-camera>${icon("camera")}Nyalakan kamera</button>
          <button type="button" class="scan-button primary" data-scan-start disabled>Mulai merekam</button>
          <button type="button" class="scan-button secondary" data-scan-stop hidden disabled>Hentikan</button>
          <button type="button" class="scan-button primary" data-scan-use hidden disabled>Gunakan rekaman</button>
          <button type="button" class="scan-button secondary" data-scan-retake hidden>Rekam ulang</button>
          <button type="button" class="scan-button secondary" data-scan-last hidden>Gunakan rekaman terakhir</button>
        </div>
        <p class="scan-status" data-scan-status role="status" aria-live="polite"></p>
        <form class="scan-form" data-scan-form novalidate hidden>
          <h2>Detail barang</h2>
          <label class="scan-field"><span>Judul barang</span><input name="title" type="text" maxlength="80" autocomplete="off" placeholder="Kursi kayu jati"></label>
          <fieldset class="scan-dims"><legend>Ukuran terukur (cm)</legend>
            <label><span>Lebar</span><input name="widthCm" type="text" inputmode="decimal" autocomplete="off"></label>
            <label><span>Kedalaman</span><input name="depthCm" type="text" inputmode="decimal" autocomplete="off"></label>
            <label><span>Tinggi</span><input name="heightCm" type="text" inputmode="decimal" autocomplete="off"></label>
          </fieldset>
          <label class="scan-field"><span>Catatan kondisi <small>opsional</small></span><textarea name="conditionNote" rows="3" maxlength="200" placeholder="Goresan ringan di sisi kiri."></textarea></label>
          <p class="scan-form-error" data-scan-error role="alert" hidden></p>
          <div class="scan-submit-row">
            <button type="submit" class="scan-button primary" data-scan-send disabled>Kirim ke laptop</button>
            <button type="button" class="scan-button secondary" data-scan-cancel hidden>Batalkan</button>
          </div>
          <progress class="scan-progress" data-scan-progress max="100" value="0" hidden>0%</progress>
        </form>
        <ol class="scan-steps" aria-label="Panduan rekaman">
          ${GUIDANCE.map((step, index) => `<li><span>${index + 1}</span>${step}</li>`).join("")}
        </ol>
        <p class="scan-note">Rekaman diproses di laptop demo ini. Tidak dikirim ke layanan lain.</p>
      </aside>
    </div>
  </section>`;
}

export function mountScanCapture(root, { onNavigate, onToast } = {}) {
  const host = root.matches?.("[data-scan-capture]")
    ? root
    : root.querySelector("[data-scan-capture]");
  if (!host) return () => {};
  const $ = (selector) => host.querySelector(selector);
  const video = $("[data-scan-video]");
  const review = $("[data-scan-review]");
  const empty = $("[data-scan-empty]");
  const timer = $("[data-scan-timer]");
  const guidance = $("[data-scan-guidance]");
  const recordingBadge = $("[data-scan-recording]");
  const status = $("[data-scan-status]");
  const form = $("[data-scan-form]");
  const formError = $("[data-scan-error]");
  const cameraButton = $("[data-scan-camera]");
  const startButton = $("[data-scan-start]");
  const stopButton = $("[data-scan-stop]");
  const useButton = $("[data-scan-use]");
  const retakeButton = $("[data-scan-retake]");
  const lastButton = $("[data-scan-last]");
  const sendButton = $("[data-scan-send]");
  const cancelButton = $("[data-scan-cancel]");
  const progress = $("[data-scan-progress]");

  let stream = null;
  let recorder = null;
  let chunks = [];
  let recording = false;
  let elapsed = 0;
  let startedAt = 0;
  let ticker = 0;
  let blob = null;
  let objectUrl = null;
  let disposed = false;
  let upload = null;
  let uploading = false;

  function say(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function formMessage(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  function setCameraReady(ready) {
    cameraButton.hidden = ready;
    startButton.hidden = !ready || recording;
    startButton.disabled = !ready || recording;
    empty.hidden = ready;
    video.hidden = !ready;
  }

  function stopTracks() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    video.srcObject = null;
  }

  function releaseReview() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    blob = null;
    review.removeAttribute("src");
    review.load();
    review.hidden = true;
    video.hidden = false;
    form.hidden = true;
    useButton.hidden = true;
    retakeButton.hidden = true;
    sendButton.disabled = true;
    sendButton.textContent = "Kirim ke laptop";
    progress.hidden = true;
    progress.value = 0;
    cancelButton.hidden = true;
  }

  function resetToIdle(message = "") {
    recording = false;
    clearInterval(ticker);
    stopTracks();
    releaseReview();
    setCameraReady(false);
    recordingBadge.hidden = true;
    stopButton.hidden = true;
    startButton.hidden = false;
    startButton.disabled = true;
    timer.textContent = "0:00";
    guidance.textContent = GUIDANCE[0];
    if (message) say(message, "error");
  }

  async function startCamera() {
    if (disposed) return;
    if (!window.isSecureContext) {
      say(cameraErrorCopy({ insecure: true }), "error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      say(cameraErrorCopy({ name: "NotFoundError" }), "error");
      return;
    }
    if (!window.MediaRecorder) {
      say(
        "Browser ini belum bisa merekam video. Coba Chrome atau Safari terbaru.",
        "error",
      );
      return;
    }
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) {
      say(
        "Browser ini belum bisa merekam video. Coba Chrome atau Safari terbaru.",
        "error",
      );
      return;
    }
    cameraButton.disabled = true;
    say("Meminta izin kamera…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      if (disposed) {
        stopTracks();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      setCameraReady(true);
      startButton.disabled = false;
      cameraButton.disabled = false;
      say("Kamera siap. Mulai merekam saat barang sudah di bingkai.", "ok");
    } catch (error) {
      cameraButton.disabled = false;
      say(cameraErrorCopy(error), "error");
      setCameraReady(false);
    }
  }

  function startRecording() {
    if (!stream || recording) return;
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime ?? undefined,
        videoBitsPerSecond: 8_000_000,
      });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        say("Perekaman belum bisa dimulai di browser ini.", "error");
        return;
      }
    }
    chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = () => finishRecording();
    recorder.onerror = () =>
      resetToIdle("Perekaman berhenti. Coba rekam lagi.");
    recorder.start(250);
    recording = true;
    startedAt = performance.now();
    elapsed = 0;
    recordingBadge.hidden = false;
    stopButton.hidden = false;
    stopButton.disabled = false;
    startButton.hidden = true;
    say("Merekam. Ikuti panduan di layar.", "ok");
    clearInterval(ticker);
    ticker = setInterval(() => {
      if (!recording) return;
      elapsed = (performance.now() - startedAt) / 1000;
      timer.textContent = timeLabel(elapsed);
      guidance.textContent = guidanceAt(elapsed);
      if (elapsed >= MAX_SECONDS) stopRecording(true);
    }, 200);
  }

  function stopRecording(auto = false) {
    if (!recording) return;
    elapsed = (performance.now() - startedAt) / 1000;
    if (!auto && elapsed < MIN_SECONDS) {
      say("Rekam minimal 8 detik.", "error");
      return;
    }
    recording = false;
    clearInterval(ticker);
    recordingBadge.hidden = true;
    stopButton.disabled = true;
    stopTracks();
    recorder.stop();
  }

  function finishRecording() {
    if (disposed) return;
    const type = recorder?.mimeType || "video/webm";
    blob = new Blob(chunks, { type });
    chunks = [];
    if (!blob.size) {
      resetToIdle("Rekaman kosong. Coba rekam lagi.");
      return;
    }
    objectUrl = URL.createObjectURL(blob);
    review.src = objectUrl;
    review.hidden = false;
    video.hidden = true;
    empty.hidden = true;
    timer.textContent = timeLabel(elapsed);
    recordingBadge.hidden = true;
    stopButton.hidden = true;
    startButton.hidden = true;
    useButton.hidden = false;
    useButton.disabled = false;
    retakeButton.hidden = false;
    say(`Rekaman ${timeLabel(elapsed)} siap. Periksa hasilnya.`, "ok");
  }

  function useRecording() {
    if (!blob) return;
    pendingClip = {
      blob,
      mime: blob.type || "video/webm",
      clientId: crypto.randomUUID(),
    };
    form.hidden = false;
    sendButton.disabled = false;
    sendButton.textContent = "Kirim ke laptop";
    say("Rekaman siap dikirim. Isi detail barang.", "ok");
    const first = form.querySelector('[name="title"]');
    first?.focus({ preventScroll: true });
  }

  function showReview(source) {
    blob = source.blob;
    objectUrl = objectUrl ? objectUrl : URL.createObjectURL(source.blob);
    review.src = objectUrl;
    review.hidden = false;
    video.hidden = true;
    empty.hidden = true;
    useButton.hidden = false;
    useButton.disabled = false;
    retakeButton.hidden = false;
    form.hidden = false;
    sendButton.disabled = false;
    say("Rekaman terakhir siap dikirim.", "ok");
  }

  function retake() {
    pendingClip = null;
    lastButton.hidden = true;
    releaseReview();
    setCameraReady(false);
    startButton.hidden = false;
    startButton.disabled = true;
    void startCamera();
  }

  function readForm() {
    const data = new FormData(form);
    return {
      title: String(data.get("title") ?? "").trim(),
      widthCm: String(data.get("widthCm") ?? "").trim(),
      depthCm: String(data.get("depthCm") ?? "").trim(),
      heightCm: String(data.get("heightCm") ?? "").trim(),
      conditionNote: String(data.get("conditionNote") ?? "").trim(),
      device: String(navigator.userAgent ?? "").slice(0, 120),
    };
  }

  function parseDimension(value) {
    if (!/^\d{1,4}(?:[.,]\d)?$/.test(value)) return null;
    const number = Number(value.replace(",", "."));
    if (!Number.isFinite(number) || number < 1 || number > 1000) return null;
    return number;
  }

  function validateForm() {
    const raw = readForm();
    if (raw.title.length < 2 || raw.title.length > 80) {
      formMessage("Judul barang perlu 2–80 karakter.");
      form.querySelector('[name="title"]')?.focus();
      return null;
    }
    const dimensions = {
      widthCm: parseDimension(raw.widthCm),
      depthCm: parseDimension(raw.depthCm),
      heightCm: parseDimension(raw.heightCm),
    };
    for (const [key, value] of Object.entries(dimensions)) {
      if (value === null) {
        formMessage("Ukuran perlu angka 1–1000 cm, satu angka di belakang koma.");
        form.querySelector(`[name="${key}"]`)?.focus();
        return null;
      }
    }
    if (raw.conditionNote.length > 200) {
      formMessage("Catatan kondisi maksimal 200 karakter.");
      form.querySelector('[name="conditionNote"]')?.focus();
      return null;
    }
    formMessage("");
    return {
      title: raw.title,
      widthCm: dimensions.widthCm,
      depthCm: dimensions.depthCm,
      heightCm: dimensions.heightCm,
      conditionNote: raw.conditionNote,
      device: raw.device,
    };
  }

  async function submitRecording(meta) {
    if (!pendingClip || uploading) return;
    uploading = true;
    sendButton.disabled = true;
    sendButton.textContent = "Mengirim… 0%";
    progress.hidden = false;
    progress.value = 0;
    cancelButton.hidden = false;
    say("Mengirim rekaman ke laptop demo…");
    upload = uploadScan(
      { ...meta, clientId: pendingClip.clientId },
      pendingClip.blob,
      (percent) => {
        progress.value = percent;
        sendButton.textContent = `Mengirim… ${percent}%`;
      },
    );
    try {
      const result = await upload.promise;
      if (!result?.id) throw new Error("Jawaban server tidak lengkap.");
      pendingClip = null;
      say("Rekaman diterima. Membuka status…", "ok");
      onNavigate?.(`/pindai/${result.id}`);
    } catch (error) {
      const code = error?.code ?? "internal";
      say(ERROR_COPY[code] ?? ERROR_COPY.default, "error");
      sendButton.textContent = "Coba kirim lagi";
      sendButton.disabled = false;
      progress.hidden = true;
    } finally {
      uploading = false;
      upload = null;
      cancelButton.hidden = true;
    }
  }

  function onPageHide() {
    if (recording) {
      recording = false;
      clearInterval(ticker);
      try {
        recorder?.stop();
      } catch {}
    }
    stopTracks();
  }

  cameraButton.addEventListener("click", startCamera);
  startButton.addEventListener("click", startRecording);
  stopButton.addEventListener("click", () => stopRecording(false));
  useButton.addEventListener("click", useRecording);
  retakeButton.addEventListener("click", retake);
  lastButton.addEventListener("click", () => {
    if (pendingClip) showReview(pendingClip);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (uploading) return;
    const meta = validateForm();
    if (meta) void submitRecording(meta);
  });
  cancelButton.addEventListener("click", () => {
    try {
      upload?.abort();
    } catch {}
  });
  window.addEventListener("pagehide", onPageHide);

  if (pendingClip) lastButton.hidden = false;

  return () => {
    disposed = true;
    clearInterval(ticker);
    window.removeEventListener("pagehide", onPageHide);
    try {
      upload?.abort();
    } catch {}
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {}
    stopTracks();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    host.replaceChildren();
  };
}
