import * as THREE from "three";
import { SparkControls, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

// The splat runtime is the heaviest dependency in the app (Spark + its shaders,
// about 2.7 MB minified). It is loaded by its own dynamic chunk, only when a job
// actually returns an SPZ. A sold GLB — including the saved chair demo — never
// downloads it.
export function mountSplatView({
  renderer,
  scene,
  camera,
  url,
  onProgress = () => {},
  onReady = () => {},
  onFail = () => {},
}) {
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const splat = new SplatMesh({ url, onProgress });
  scene.add(splat);
  const controls = new SparkControls({ canvas: renderer.domElement });
  let disposed = false;

  void splat.initialized
    .then(() => {
      if (disposed) return;
      const box = splat.getBoundingBox(true);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const fitRadius = Math.max(size.length() / 2, 0.02);
      // KIRI exports the splats in the same orientation as the source model.
      // Centre the box in world space so a future mesh rotation stays framed.
      const offset = center.clone().applyQuaternion(splat.quaternion);
      splat.position.copy(offset).multiplyScalar(-1);
      onReady({ fitRadius, splats: splat.numSplats ?? 0 });
    })
    .catch(onFail);

  return {
    update() {
      if (!disposed) controls.update(camera);
    },
    resize(fitRadius) {
      if (disposed) return;
      const vertical = THREE.MathUtils.degToRad(camera.fov);
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
      const distance = fitRadius / Math.sin(Math.min(vertical, horizontal) / 2);
      camera.position.set(0, distance * 0.18, distance * 1.15);
      camera.lookAt(0, 0, 0);
      camera.near = Math.max(0.01, distance - fitRadius * 2);
      camera.far = distance + fitRadius * 4;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      try {
        controls.dispose?.();
      } catch {}
      try {
        splat.dispose();
      } catch {}
      try {
        spark.dispose();
      } catch {}
    },
  };
}
