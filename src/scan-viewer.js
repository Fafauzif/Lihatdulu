import "./scan-viewer.css";
import * as THREE from "three";
import {
  SparkControls,
  SparkRenderer,
  SplatMesh,
} from "@sparkjsdev/spark";

// A dedicated viewer with its own renderer. It is deliberately separate from
// the GLB inspection engine: splats and authored meshes do not share a canvas.

const HINT = "Tarik untuk memutar · cubit untuk memperbesar";

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
  host.dataset.state = "loading";
  host.append(canvas, hint);

  let disposed = false;
  let observer = null;
  let intersection = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let spark = null;
  let splat = null;
  let controls = null;
  let visible = true;
  let fitRadius = 1;

  function setStatus(message, tone = "") {
    if (placeholder) {
      placeholder.textContent = message;
      placeholder.dataset.tone = tone;
    }
    onStatus(message, tone);
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const distance = fitRadius / Math.sin(Math.min(vertical, horizontal) / 2);
    camera.position.set(0, distance * 0.18, distance * 1.15);
    camera.lookAt(0, 0, 0);
    camera.near = Math.max(0.01, distance - fitRadius * 2);
    camera.far = distance + fitRadius * 4;
    camera.updateProjectionMatrix();
  }

  function loop() {
    if (disposed) return;
    controls?.update(camera);
    renderer.render(scene, camera);
  }

  function fail(error) {
    if (disposed) return;
    host.dataset.state = "error";
    if (placeholder) {
      placeholder.textContent =
        "Pratinjau 3D belum bisa dibuka di perangkat ini. Coba muat ulang halaman.";
      placeholder.dataset.tone = "error";
      placeholder.hidden = false;
    }
    if (posterNode && poster) {
      posterNode.hidden = false;
    }
    hint.hidden = true;
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
    scene.add(splat);
    controls = new SparkControls({ canvas });
    observer = new ResizeObserver(resize);
    observer.observe(host);
    intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!renderer) return;
      renderer.setAnimationLoop(visible ? loop : null);
    });
    intersection.observe(host);
    resize();

    void splat.initialized
      .then(() => {
        if (disposed) return;
        const box = splat.getBoundingBox(true);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        fitRadius = Math.max(size.length() / 2, 0.02);
        // KIRI exports the splats in the same orientation as the source model.
        // Centre the box in world space so a future mesh rotation stays framed.
        const offset = center.clone().applyQuaternion(splat.quaternion);
        splat.position.copy(offset).multiplyScalar(-1);
        resize();
        host.dataset.state = "ready";
        host.dataset.splats = String(splat.numSplats ?? 0);
        if (placeholder) placeholder.hidden = true;
        if (posterNode) posterNode.hidden = true;
        hint.hidden = false;
        renderer.setAnimationLoop(visible ? loop : null);
        onStatus("");
      })
      .catch(fail);
  } catch (error) {
    fail(error);
  }

  return () => {
    disposed = true;
    host.dataset.state = "disposed";
    observer?.disconnect();
    intersection?.disconnect();
    renderer?.setAnimationLoop(null);
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
  };
}
