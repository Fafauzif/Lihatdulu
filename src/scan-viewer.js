import "./scan-viewer.css";
import * as THREE from "three";
import {
  SparkControls,
  SparkRenderer,
  SplatMesh,
} from "@sparkjsdev/spark";

// A dedicated viewer with its own renderer. It is deliberately separate from
// the GLB inspection engine: splats and authored meshes do not share a canvas.
//
// Two artifact formats arrive here. KIRI's 3DGS export is an SPZ read by Spark;
// the featureless-object profile returns a textured GLB the seller recognises as
// their own chair. The GLB path is a plain three.js scene with orbit controls and
// generous lighting, because a reconstructed shell has no environment light of
// its own and its materials are single-sided.

// Where the default camera stands for a mesh. A KIRI mesh is usually the whole
// room, so the front of the bounding box can be a blank wall; a three-quarter
// angle shows the subject instead.
const MESH_AZIMUTH = 35;
const MESH_ELEVATION = 12;

export function mountScanViewer(
  root,
  { url, poster, format = "spz", onStatus = () => {} } = {},
) {
  const host = root.matches?.("[data-scan-viewer]")
    ? root
    : root.querySelector("[data-scan-viewer]");
  if (!host || !url) return () => {};
  const placeholder = host.querySelector("[data-scan-viewer-placeholder]");
  const posterNode = host.querySelector("[data-scan-poster]");
  const canvas = document.createElement("canvas");
  canvas.className = "scan-viewer-canvas";
  canvas.setAttribute(
    "aria-label",
    "Model pindai 3D. Tarik untuk memutar dan cubit untuk memperbesar.",
  );
  host.dataset.state = "loading";
  host.append(canvas);

  let disposed = false;
  let observer = null;
  let intersection = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let spark = null;
  let splat = null;
  let controls = null;
  let orbit = null;
  let model = null;
  let visible = true;
  let fitRadius = 1;
  let framed = false;

  function setStatus(message, tone = "") {
    if (placeholder) {
      placeholder.textContent = message;
      placeholder.dataset.tone = tone;
    }
    onStatus(message, tone);
  }

  // The default pose exists once per model: later resizes must not throw away
  // the angle the buyer already dragged to.
  function frameModel() {
    if (!orbit || framed) return;
    const vertical = THREE.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    // A KIRI mesh is the room, not the chair: the box fit leaves the subject
    // small, so the opening pose sits closer than a full-box fit.
    const distance =
      (fitRadius / Math.sin(Math.min(vertical, horizontal) / 2)) * 0.82;
    const phi = THREE.MathUtils.degToRad(90 - MESH_ELEVATION);
    const theta = THREE.MathUtils.degToRad(MESH_AZIMUTH);
    camera.position.set(
      distance * Math.sin(phi) * Math.sin(theta),
      distance * Math.cos(phi),
      distance * Math.sin(phi) * Math.cos(theta),
    );
    camera.near = Math.max(0.02, fitRadius * 0.02);
    camera.far = fitRadius * 12;
    camera.updateProjectionMatrix();
    orbit.target.set(0, 0, 0);
    orbit.minDistance = Math.max(0.2, fitRadius * 0.35);
    orbit.maxDistance = fitRadius * 4;
    orbit.update();
    framed = true;
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    if (orbit) {
      frameModel();
      return;
    }
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
    if (orbit) orbit.update();
    else controls?.update(camera);
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
    renderer?.setAnimationLoop(null);
    console.error(error);
  }

  function ready() {
    host.dataset.state = "ready";
    if (placeholder) placeholder.hidden = true;
    if (posterNode) posterNode.hidden = true;
    renderer.setAnimationLoop(visible ? loop : null);
    onStatus("");
  }

  function countTriangles(rootNode) {
    let total = 0;
    rootNode.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      const geometry = node.geometry;
      total += geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count ?? 0) / 3;
    });
    return Math.round(total);
  }

  function progressHandler() {
    return (event) => {
      if (!event?.lengthComputable || !(event.total > 0)) return;
      const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
      setStatus(`Memuat model ${percent}%`);
    };
  }

  async function mountModel() {
    const [{ GLTFLoader }, { OrbitControls }] = await Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/controls/OrbitControls.js"),
    ]);
    if (disposed) return;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe6cc, 1.1);
    fill.position.set(-5, 3, -3);
    scene.add(fill);

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        // KIRI's mesh is an open shell: seen from outside, the front faces point
        // away and the model disappears. Both sides keeps it visible all round.
        model.traverse((node) => {
          if (!node.isMesh || !node.material) return;
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material]) {
            material.side = THREE.DoubleSide;
            material.needsUpdate = true;
          }
        });
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        fitRadius = Math.max(size.length() / 2, 0.02);
        // Centre the box once so orbit and controls share one origin.
        model.position.sub(center);
        scene.add(model);
        orbit = new OrbitControls(camera, canvas);
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.08;
        orbit.enablePan = false;
        orbit.minPolarAngle = 0.05;
        orbit.maxPolarAngle = Math.PI - 0.05;
        resize();
        host.dataset.triangles = String(countTriangles(model));
        ready();
      },
      progressHandler(),
      fail,
    );
  }

  function mountSplat() {
    spark = new SparkRenderer({ renderer });
    scene.add(spark);
    splat = new SplatMesh({
      url,
      onProgress: progressHandler(),
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
        host.dataset.splats = String(splat.numSplats ?? 0);
        ready();
      })
      .catch(fail);
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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);

    if (format === "glb") {
      observer = new ResizeObserver(resize);
      observer.observe(host);
      intersection = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!renderer) return;
        renderer.setAnimationLoop(visible ? loop : null);
      });
      intersection.observe(host);
      void mountModel().catch(fail);
    } else {
      mountSplat();
    }
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
      orbit?.dispose();
    } catch {}
    try {
      model?.traverse((node) => {
        node.geometry?.dispose?.();
        const materials = Array.isArray(node.material)
          ? node.material
          : node.material
            ? [node.material]
            : [];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value?.isTexture) value.dispose();
          }
          material.dispose?.();
        }
      });
    } catch {}
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
  };
}
