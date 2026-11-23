// Scratch explorer for the saved KIRI chair. Everything is inlined into one
// HTML file by build-explore.mjs, so this works from file:// with no server.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const stage = document.getElementById("stage");
const hud = document.getElementById("hud");
const state = {
  exposure: 1.15,
  material: "texture",
  autoRotate: false,
  wireframe: false,
};

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = state.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141814);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 1.15;

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);

const key = new THREE.DirectionalLight(0xfff4e2, 2.4);
key.position.set(2.4, 3.8, 2.8);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.bias = -0.0015;
key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xcfdcff, 0.9);
rim.position.set(-2.8, 1.8, -3.0);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0xffffff, 0x2b332c, 0.35));

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(6, 64),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.34 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.rotateSpeed = 0.85;
controls.minDistance = 0.9;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.52;
controls.target.set(0, 0.42, 0);
controls.autoRotateSpeed = 1.6;

let model = null;
let bounds = new THREE.Box3();
const normalMaterial = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });

function frame() {
  bounds.setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  model.position.y -= bounds.min.y;
  bounds.setFromObject(model);
  const height = size.y || 1;
  const distance = (height / (2 * Math.tan((camera.fov * Math.PI) / 360))) / 0.78;
  controls.target.set(centre.x, bounds.min.y + height * 0.46, centre.z);
  camera.position.set(
    centre.x + distance * 0.55,
    bounds.min.y + height * 0.78,
    centre.z + distance * 0.86,
  );
  camera.near = Math.max(0.01, distance * 0.02);
  camera.far = distance * 12;
  camera.updateProjectionMatrix();
  controls.update();
  ground.position.y = bounds.min.y - 0.002;
  return { height: +height.toFixed(3), size: size.toArray().map((v) => +v.toFixed(3)) };
}

function applyMaterial(mode) {
  state.material = mode;
  if (!model) return;
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.material = mode === "normals" ? normalMaterial : node.userData.textureMaterial;
    node.material.wireframe = state.wireframe;
  });
}

function resize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

const raw = Uint8Array.from(atob(window.__CHAIR_GLB), (c) => c.charCodeAt(0));
const loader = new GLTFLoader();
loader.parse(
  raw.buffer,
  "",
  (gltf) => {
    model = gltf.scene;
    let triangles = 0;
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const geometry = node.geometry;
      triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
      // A reconstructed shell is single-sided; without DoubleSide the inside of
      // the backrest is invisible and the hole reads as a lighting bug.
      const material = Array.isArray(node.material) ? node.material : [node.material];
      for (const entry of material) {
        if (!entry) continue;
        entry.side = THREE.DoubleSide;
        if (entry.map) entry.map.colorSpace = THREE.SRGBColorSpace;
        entry.needsUpdate = true;
      }
      node.userData.textureMaterial = node.material;
    });
    scene.add(model);
    const measured = frame();
    applyMaterial(state.material);
    const count = Math.round(triangles);
    document.getElementById("tris").textContent = count.toLocaleString("id-ID");
    document.getElementById("height").textContent = `${measured.height.toFixed(2)} m`;
    hud.dataset.state = "ready";
    window.__explore = {
      ready: true,
      triangles: count,
      height: measured.height,
      // Test hooks: drive the same controls a person would.
      setView(az, el) {
        const target = controls.target.clone();
        const radius = camera.position.distanceTo(target);
        const a = (az * Math.PI) / 180;
        const e = (el * Math.PI) / 180;
        camera.position.set(
          target.x + radius * Math.cos(e) * Math.sin(a),
          target.y + radius * Math.sin(e),
          target.z + radius * Math.cos(e) * Math.cos(a),
        );
        controls.update();
      },
      get azimuth() {
        const off = camera.position.clone().sub(controls.target);
        return +(((Math.atan2(off.x, off.z) * 180) / Math.PI + 360) % 360).toFixed(1);
      },
    };
  },
  (error) => {
    hud.dataset.state = "error";
    document.getElementById("error").textContent = String(error?.message ?? error);
  },
);

function loop() {
  requestAnimationFrame(loop);
  // OrbitControls owns the turntable: it keeps the polar angle while it spins.
  controls.autoRotate = state.autoRotate;
  controls.update();
  renderer.render(scene, camera);
}
resize();
loop();

window.addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") resetView();
});

function resetView() {
  if (!model) return;
  frame();
}

// Controls in the page.
for (const button of document.querySelectorAll("[data-material]")) {
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-material]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    applyMaterial(button.dataset.material);
  });
}
document.getElementById("autorotate").addEventListener("change", (event) => {
  state.autoRotate = event.target.checked;
});
document.getElementById("wireframe").addEventListener("change", (event) => {
  state.wireframe = event.target.checked;
  applyMaterial(state.material);
});
document.getElementById("exposure").addEventListener("input", (event) => {
  state.exposure = Number(event.target.value);
  renderer.toneMappingExposure = state.exposure;
});
document.getElementById("reset").addEventListener("click", resetView);
document.getElementById("save").addEventListener("click", () => {
  renderer.render(scene, camera);
  const link = document.createElement("a");
  link.download = "kursi-kiri-360.png";
  link.href = renderer.domElement.toDataURL("image/png");
  link.click();
});
