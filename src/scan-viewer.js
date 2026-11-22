import "./scan-viewer.css";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import {
  boxCenter,
  boxSize,
  formatPose,
  normalizePose,
  placementPosition,
  poseDirection,
  robustFocusBounds,
  rotateVector,
} from "./scan-viewer-math.js";

// A dedicated viewer with its own renderer. It is deliberately separate from
// the GLB inspection engine: splats and authored meshes do not share a canvas.

const HINT = "Tarik untuk memutar · cubit untuk memperbesar";
const RESET_LABEL = "Atur ulang";
const RESET_TITLE = "Kembalikan sudut pandang awal";
const MIN_FIT_RADIUS = 0.02;
const AZIMUTH_DEG_PER_PIXEL = 0.35;
const ELEVATION_DEG_PER_PIXEL = 0.3;
const WHEEL_ZOOM_RATE = 0.0012;
// Keep the audited upright convention: a half turn about X maps the capture's
// Y-down axis into the viewer's Y-up world. Verified against the source stills
// in the overnight run before changing anything else.
const UPRIGHT_QUATERNION = Object.freeze({ x: 1, y: 0, z: 0, w: 0 });
// Three-quarter front view picked from the azimuth sweep (see run evidence
// comparisons/viewer-fix/sweep): az 290 / el 15 kept the whole chair upright
// and recognizable with the room behind it, unlike the edge-on angles.
const INITIAL_POSE = Object.freeze({
  azimuthDeg: 290,
  elevationDeg: 15,
  distanceScale: 1,
});

function toPlainBounds(box) {
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z },
  };
}

function boundsPayload(bounds) {
  return JSON.stringify({
    min: [bounds.min.x, bounds.min.y, bounds.min.z],
    max: [bounds.max.x, bounds.max.y, bounds.max.z],
  });
}

export function mountScanViewer(root, { url, poster, onStatus = () => {} } = {}) {
  const host = root.matches?.("[data-scan-viewer]")
    ? root
    : root.querySelector("[data-scan-viewer]");
  if (!host || !url) return () => {};
  const placeholder = host.querySelector("[data-scan-viewer-placeholder]");
  const posterNode = host.querySelector("[data-scan-poster]");
  const hint = document.createElement("p");
  hint.className = "scan-viewer-hint";
  hint.dataset.scanViewerHint = "";
  hint.textContent = HINT;
  hint.hidden = true;
  const canvas = document.createElement("canvas");
  canvas.className = "scan-viewer-canvas";
  canvas.setAttribute(
    "aria-label",
    "Model pindai 3D. Tarik untuk memutar dan cubit untuk memperbesar.",
  );
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "scan-viewer-reset";
  resetButton.textContent = RESET_LABEL;
  resetButton.title = RESET_TITLE;
  resetButton.setAttribute("aria-label", RESET_TITLE);
  resetButton.hidden = true;
  host.dataset.state = "loading";
  host.append(canvas, hint, resetButton);

  let disposed = false;
  let observer = null;
  let intersection = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let spark = null;
  let splat = null;
  let visible = true;
  let splatReady = false;
  let fitRadius = 1;
  let fitDistance = 1;
  let pose = normalizePose(INITIAL_POSE, INITIAL_POSE);

  const pointers = new Map();
  let drag = null;
  let pinchSpread = null;

  function publicPose() {
    return formatPose(pose);
  }

  function setStatus(message, tone = "") {
    if (placeholder) {
      placeholder.textContent = message;
      placeholder.dataset.tone = tone;
    }
    onStatus(message, tone);
  }

  function applyCameraPose() {
    if (!camera) return;
    const direction = poseDirection(pose);
    const distance = Math.max(fitDistance * pose.distanceScale, 1e-4);
    camera.up.set(0, 1, 0);
    camera.position.set(
      direction.x * distance,
      direction.y * distance,
      direction.z * distance,
    );
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.01, distance - fitRadius * 2.5);
    camera.far = Math.max(1, distance + fitRadius * 6);
    camera.updateProjectionMatrix();
    host.dataset.scanPose = JSON.stringify(publicPose());
    if (splatReady && renderer && scene) renderer.render(scene, camera);
  }

  function computeFitDistance() {
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    return fitRadius / Math.sin(Math.min(vertical, horizontal) / 2);
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    fitDistance = computeFitDistance();
    // Resizing only refreshes the projection; azimuth, elevation and dolly
    // scale are preserved so a phone rotation never throws away the view.
    applyCameraPose();
  }

  function pointerSpread() {
    const points = [...pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function onPointerDown(event) {
    if (disposed || !splatReady) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {}
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      pinchSpread = null;
    } else if (pointers.size === 2) {
      drag = null;
      pinchSpread = pointerSpread();
    }
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (disposed || !splatReady) return;
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    entry.x = event.clientX;
    entry.y = event.clientY;
    if (pointers.size >= 2) {
      const spread = pointerSpread();
      if (spread > 4 && pinchSpread > 4) {
        pose = normalizePose(
          {
            azimuthDeg: pose.azimuthDeg,
            elevationDeg: pose.elevationDeg,
            distanceScale: pose.distanceScale * (pinchSpread / spread),
          },
          pose,
        );
        applyCameraPose();
      }
      pinchSpread = spread;
      event.preventDefault();
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    pose = normalizePose(
      {
        azimuthDeg: pose.azimuthDeg - deltaX * AZIMUTH_DEG_PER_PIXEL,
        elevationDeg: pose.elevationDeg - deltaY * ELEVATION_DEG_PER_PIXEL,
        distanceScale: pose.distanceScale,
      },
      pose,
    );
    applyCameraPose();
    event.preventDefault();
  }

  function releasePointer(event) {
    pointers.delete(event.pointerId);
    if (drag && drag.id === event.pointerId) drag = null;
    if (pointers.size < 2) pinchSpread = null;
    if (pointers.size === 1 && !drag) {
      const [id, point] = [...pointers][0];
      drag = { id, x: point.x, y: point.y };
    }
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {}
  }

  function onWheel(event) {
    if (disposed || !splatReady) return;
    event.preventDefault();
    const rate = event.deltaMode === 1 ? 0.03 : WHEEL_ZOOM_RATE;
    const nextScale =
      pose.distanceScale * Math.exp(event.deltaY * rate);
    pose = normalizePose(
      {
        azimuthDeg: pose.azimuthDeg,
        elevationDeg: pose.elevationDeg,
        distanceScale: nextScale,
      },
      pose,
    );
    applyCameraPose();
  }

  function loop() {
    if (disposed) return;
    renderer.render(scene, camera);
  }

  function fail(error) {
    if (disposed) return;
    host.dataset.state = "error";
    if (placeholder) {
      placeholder.textContent =
        "Pratinjau 3D belum bisa dibuka di perangkat ini. Bingkai rekaman tetap tersedia.";
      placeholder.dataset.tone = "error";
      placeholder.hidden = false;
    }
    if (posterNode && poster) {
      posterNode.hidden = false;
    }
    hint.hidden = true;
    resetButton.hidden = true;
    delete host.scanViewer;
    renderer?.setAnimationLoop(null);
    console.error(error);
  }

  try {
    const context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
    });
    if (!context) throw new Error("WebGL2 tidak tersedia.");
    renderer = new THREE.WebGLRenderer({
      canvas,
      context,
      alpha: true,
      antialias: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    spark = new SparkRenderer({ renderer });
    scene.add(spark);
    splat = new SplatMesh({
      url,
      onProgress: (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(
            99,
            Math.round((event.loaded / event.total) * 100),
          );
          setStatus(`Memuat model ${percent}%`);
        }
      },
    });
    splat.quaternion.set(
      UPRIGHT_QUATERNION.x,
      UPRIGHT_QUATERNION.y,
      UPRIGHT_QUATERNION.z,
      UPRIGHT_QUATERNION.w,
    );
    scene.add(splat);
    observer = new ResizeObserver(resize);
    observer.observe(host);
    intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!renderer) return;
      renderer.setAnimationLoop(visible ? loop : null);
    });
    intersection.observe(host);
    resize();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", releasePointer);
    canvas.addEventListener("pointercancel", releasePointer);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const api = {
      setPose(next) {
        if (disposed) return publicPose();
        const requested = next && typeof next === "object" ? next : {};
        pose = normalizePose(
          {
            azimuthDeg: Number.isFinite(requested.azimuthDeg)
              ? requested.azimuthDeg
              : pose.azimuthDeg,
            elevationDeg: Number.isFinite(requested.elevationDeg)
              ? requested.elevationDeg
              : pose.elevationDeg,
            // distanceScale is optional and deterministic: it defaults to 1.
            distanceScale: Number.isFinite(requested.distanceScale)
              ? requested.distanceScale
              : 1,
          },
          pose,
        );
        applyCameraPose();
        return publicPose();
      },
      getPose() {
        return publicPose();
      },
      reset() {
        pose = normalizePose(INITIAL_POSE, INITIAL_POSE);
        applyCameraPose();
        return publicPose();
      },
      fit() {
        pose = normalizePose(
          {
            azimuthDeg: pose.azimuthDeg,
            elevationDeg: pose.elevationDeg,
            distanceScale: 1,
          },
          pose,
        );
        applyCameraPose();
        return publicPose();
      },
    };
    resetButton.addEventListener("click", () => {
      api.reset();
    });

    void splat.initialized
      .then(() => {
        if (disposed) return;
        // Robust subject fit: the raw center box includes the room, floor
        // streaks and isolated floaters, so frame the 1st-99th percentile
        // center bounds instead, falling back to the raw box when degenerate.
        const rawBox = splat.getBoundingBox(true);
        const fallbackBounds = toPlainBounds(rawBox);
        let samples = [];
        try {
          samples = [];
          splat.forEachSplat((_index, center) => {
            samples.push({ x: center.x, y: center.y, z: center.z });
          });
        } catch {
          samples = [];
        }
        const focusBounds = robustFocusBounds(samples, fallbackBounds, 1, 99);
        const focusCenter = boxCenter(focusBounds);
        const focusSize = boxSize(focusBounds);
        fitRadius = Math.max(
          Math.hypot(focusSize.x, focusSize.y, focusSize.z) / 2,
          MIN_FIT_RADIUS,
        );
        const position = placementPosition(focusCenter, UPRIGHT_QUATERNION);
        splat.position.set(position.x, position.y, position.z);
        const worldCenter = rotateVector(UPRIGHT_QUATERNION, focusCenter);
        host.dataset.scanFocusBox = boundsPayload(focusBounds);
        host.dataset.scanFocusCenter = JSON.stringify([
          worldCenter.x + position.x,
          worldCenter.y + position.y,
          worldCenter.z + position.z,
        ]);
        host.dataset.scanFocusRadius = String(fitRadius);
        host.dataset.scanRootBox = boundsPayload(fallbackBounds);
        splatReady = true;
        resize();
        host.scanViewer = api;
        host.dataset.state = "ready";
        host.dataset.splats = String(splat.numSplats ?? 0);
        host.dataset.scanPose = JSON.stringify(publicPose());
        if (placeholder) placeholder.hidden = true;
        if (posterNode) posterNode.hidden = true;
        hint.hidden = false;
        resetButton.hidden = false;
        renderer.setAnimationLoop(visible ? loop : null);
        onStatus("");
      })
      .catch(fail);
  } catch (error) {
    fail(error);
  }

  return () => {
    disposed = true;
    splatReady = false;
    host.dataset.state = "disposed";
    delete host.scanViewer;
    delete host.dataset.scanPose;
    observer?.disconnect();
    intersection?.disconnect();
    renderer?.setAnimationLoop(null);
    pointers.clear();
    drag = null;
    pinchSpread = null;
    try {
      splat?.dispose();
    } catch {}
    try {
      spark?.dispose();
    } catch {}
    try {
      renderer?.dispose();
      renderer?.forceContextLoss?.();
    } catch {}
    canvas.remove();
    hint.remove();
    resetButton.remove();
  };
}
