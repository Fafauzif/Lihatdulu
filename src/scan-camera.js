import {
  GUIDANCE,
  MAX_SECONDS,
  MIN_SECONDS,
  cameraErrorCopy,
  clipName,
  extensionForMime,
  guidanceAt,
  pickRecorderMime,
  recorderErrorCopy,
  timeLabel,
} from "./scan-recorder.js";

// In-page phone recorder for /jual/pindai. It owns the camera stream and every
// timer it starts, so leaving the route stops the hardware: a phone that keeps
// its camera light on after navigation looks broken to a judge.
//
// The clip is handed back as a File. Everything after that is the normal upload
// path — validation, consent, progress, reload resume — so the recorder adds no
// second way to submit.

export function mountScanRecorder(host, { onClip = () => {}, onStatus = () => {} } = {}) {
  if (!host) return { open: () => {}, close: () => {}, stop: () => {} };
  const q = (selector) => host.querySelector(selector);
  const video = q("[data-rec-video]");
  const review = q("[data-rec-review]");
  const empty = q("[data-rec-empty]");
  const timer = q("[data-rec-timer]");
  const dot = q("[data-rec-dot]");
  const guide = q("[data-rec-guide]");
  const status = q("[data-rec-status]");
  const startButton = q("[data-rec-start]");
  const stopButton = q("[data-rec-stop]");
  const useButton = q("[data-rec-use]");
  const retakeButton = q("[data-rec-retake]");
  const nativeButton = q("[data-rec-native]");
  const nativeInput = q("[data-rec-native-input]");
  const closeButton = q("[data-rec-close]");

  let stream = null;
  let recorder = null;
  let chunks = [];
  let recording = false;
  let startedAt = 0;
  let elapsed = 0;
  let ticker = 0;
  let clip = null;
  let clipUrl = null;
  let disposing = false;

  const say = (message, tone = "") => {
    status.textContent = message;
    status.dataset.tone = tone;
    onStatus(message, tone);
  };

  function stopTracks() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function clearTicker() {
    clearInterval(ticker);
    ticker = 0;
  }

  function releaseClip() {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
    clipUrl = null;
    clip = null;
    if (review) {
      review.removeAttribute("src");
      review.load?.();
      review.hidden = true;
    }
    if (video) video.hidden = false;
    if (useButton) useButton.hidden = true;
    if (retakeButton) retakeButton.hidden = true;
  }

  function setStage(stage) {
    host.dataset.stage = stage;
    if (startButton) startButton.hidden = stage !== "live";
    if (stopButton) stopButton.hidden = stage !== "recording";
    if (useButton) useButton.hidden = stage !== "review";
    if (retakeButton) retakeButton.hidden = stage !== "review";
    if (dot) dot.hidden = stage !== "recording";
  }

  function idle(message = "", tone = "") {
    recording = false;
    clearTicker();
    stopTracks();
    releaseClip();
    setStage("idle");
    if (empty) empty.hidden = false;
    if (video) video.hidden = true;
    if (timer) timer.textContent = "0:00";
    if (guide) guide.textContent = GUIDANCE[0];
    if (message) say(message, tone);
  }

  function supported() {
    return Boolean(window.MediaRecorder) && Boolean(navigator.mediaDevices?.getUserMedia);
  }

  async function startCamera() {
    if (disposing) return;
    if (!window.isSecureContext) {
      say(cameraErrorCopy({ insecure: true }), "error");
      if (nativeButton) nativeButton.hidden = false;
      return;
    }
    if (!supported()) {
      say(recorderErrorCopy({ unsupported: true }), "error");
      if (nativeButton) nativeButton.hidden = false;
      if (startButton) startButton.hidden = true;
      return;
    }
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    if (!mime) {
      say(recorderErrorCopy({ unsupported: true }), "error");
      if (nativeButton) nativeButton.hidden = false;
      return;
    }
    if (startButton) startButton.disabled = true;
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
      if (disposing) {
        stopTracks();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (empty) empty.hidden = true;
      video.hidden = false;
      setStage("live");
      if (startButton) {
        startButton.hidden = false;
        startButton.disabled = false;
      }
      say("Kamera siap. Tekan Mulai merekam.", "ok");
    } catch (error) {
      if (startButton) startButton.disabled = false;
      idle();
      say(cameraErrorCopy(error), "error");
      if (nativeButton) nativeButton.hidden = false;
    }
  }

  function startRecording() {
    if (!stream || recording) return;
    const mime = pickRecorderMime((type) => MediaRecorder.isTypeSupported(type));
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime ?? undefined,
        videoBitsPerSecond: 6_000_000,
      });
    } catch {
      try {
        recorder = new MediaRecorder(stream);
      } catch {
        say(recorderErrorCopy({ unsupported: true }), "error");
        if (nativeButton) nativeButton.hidden = false;
        return;
      }
    }
    chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onstop = finishRecording;
    recorder.onerror = () => idle(recorderErrorCopy({}), "error");
    recorder.start(250);
    recording = true;
    startedAt = performance.now();
    elapsed = 0;
    setStage("recording");
    say("Merekam. Ikuti panduan di layar.", "ok");
    clearTicker();
    ticker = setInterval(() => {
      if (!recording) return;
      elapsed = (performance.now() - startedAt) / 1000;
      if (timer) timer.textContent = timeLabel(elapsed);
      if (guide) guide.textContent = guidanceAt(elapsed);
      if (elapsed >= MAX_SECONDS) stopRecording({ auto: true });
    }, 200);
  }

  function stopRecording({ auto = false } = {}) {
    if (!recording) return;
    elapsed = (performance.now() - startedAt) / 1000;
    recording = false;
    clearTicker();
    stopTracks();
    setStage("saving");
    if (!auto && elapsed < MIN_SECONDS) {
      // Do not throw the clip away: the review screen keeps it, but the button
      // that accepts it stays disabled until it is long enough.
      try {
        recorder?.stop();
      } catch {}
      elapsed = Math.max(elapsed, 0);
      return;
    }
    try {
      recorder?.stop();
    } catch {
      idle(recorderErrorCopy({}), "error");
    }
  }

  function finishRecording() {
    if (disposing) return;
    const type = recorder?.mimeType || "video/webm";
    const blob = new Blob(chunks, { type });
    chunks = [];
    if (!blob.size) {
      idle(recorderErrorCopy({ empty: true }), "error");
      return;
    }
    clip = new File([blob], clipName(type), { type });
    clipUrl = URL.createObjectURL(clip);
    review.src = clipUrl;
    review.hidden = false;
    video.hidden = true;
    if (empty) empty.hidden = true;
    setStage("review");
    const seconds = Math.round(elapsed);
    if (timer) timer.textContent = timeLabel(seconds);
    if (seconds < MIN_SECONDS) {
      if (useButton) useButton.disabled = true;
      say(recorderErrorCopy({ short: true }), "error");
      return;
    }
    if (useButton) useButton.disabled = false;
    say(`Rekaman ${timeLabel(seconds)} siap. Periksa dulu, lalu gunakan rekaman ini.`, "ok");
  }

  function useClip() {
    if (!clip) return;
    onClip({
      file: clip,
      mime: clip.type || "video/webm",
      durationS: Math.round(elapsed),
      source: "camera",
    });
    say("Rekaman dipakai. Lanjut ke persetujuan di bawah.", "ok");
  }

  function retake() {
    releaseClip();
    setStage("idle");
    void startCamera();
  }

  function open() {
    host.hidden = false;
    host.dataset.stage = "idle";
    if (nativeButton) nativeButton.hidden = false;
    guide && (guide.textContent = GUIDANCE[0]);
    void startCamera();
  }

  function close() {
    host.hidden = true;
    idle();
    say("");
  }

  function stop() {
    if (recording) {
      recording = false;
      try {
        recorder?.stop();
      } catch {}
    }
    clearTicker();
    stopTracks();
  }

  startButton?.addEventListener("click", startRecording);
  stopButton?.addEventListener("click", () => stopRecording({ auto: false }));
  useButton?.addEventListener("click", useClip);
  retakeButton?.addEventListener("click", retake);
  closeButton?.addEventListener("click", close);
  nativeButton?.addEventListener("click", () => nativeInput?.click());
  nativeInput?.addEventListener("change", () => {
    const [file] = nativeInput.files ?? [];
    if (!file) return;
    onClip({ file, mime: file.type || "video/mp4", durationS: null, source: "native" });
    say("Rekaman dari aplikasi kamera dipakai. Lanjut ke persetujuan di bawah.", "ok");
    nativeInput.value = "";
    close();
  });

  const onPageHide = () => stop();
  window.addEventListener("pagehide", onPageHide);

  return {
    open,
    close,
    stop,
    dispose() {
      disposing = true;
      window.removeEventListener("pagehide", onPageHide);
      stop();
      if (recording) {
        try {
          recorder?.stop();
        } catch {}
      }
      releaseClip();
    },
  };
}
