import { WebRenderSurface } from "../src/platform/web/render-surface.ts";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
// In the Bun dev browser: await (await import('/scripts/ui-images.browser.mjs')).checkImageUploads()
// One upload per Source across 10 view cycles in one context generation, one more after a restore
// (readiness design §5.3), counted on the real WebGL calls of the real store and renderer.
import {
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderTarget,
} from "three";
import { AppRenderer } from "../src/rendering/app-renderer.ts";
import { createImageStore } from "../src/prepare/images.ts";
import { createPreparation } from "../src/prepare/preparation.ts";

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

export async function checkImageUploads(url = "/art/transition-pattern.webp") {
  const app = new AppRenderer(new WebRenderSurface(document.createElement("canvas")));
  const renderer = app.renderer;
  renderer.setSize(64, 64, false);
  const gl = renderer.getContext();
  // Uploads whose pixels come from a bitmap of `url`'s size (counted per call, by the source object).
  const uploads = [];
  for (const name of ["texImage2D", "texSubImage2D"]) {
    const original = gl[name].bind(gl);
    gl[name] = (...args) => {
      const source = args.find((a) => a instanceof ImageBitmap);
      if (source) uploads.push(source);
      return original(...args);
    };
  }
  const gpu = Object.assign(Object.create(app), {
    upload: (texture) => renderer.initTexture(texture),
    resident: (resident) => app.resident(resident),
    subscribe: (listener) => app.subscribe(listener),
    enqueue: (task) => app.enqueue(task),
  });
  Object.defineProperties(gpu, {
    generation: { get: () => app.generation },
    available: { get: () => app.available },
  });
  const store = createImageStore(gpu);
  const target = new WebGLRenderTarget(64, 64);
  // The harness's own GPU object follows the same rule as every resident: released on loss.
  app.resident({ release: () => target.dispose() });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
  const held = store.acquire(url, "pattern", "background");
  const draw = async (cycles) => {
    for (let cycle = 0; cycle < cycles; cycle++) {
      const preparation = createPreparation({
        revision: cycle,
        lane: "critical",
        needs: [store.need(url, "pattern")],
        context: gpu,
      });
      if ((await preparation.settled) !== "ready") throw new Error(`cycle ${cycle}: not ready`);
      const handle = store.acquire(url, "pattern");
      await handle.result;
      const view = handle.view();
      const material = new MeshBasicMaterial({ map: view });
      const mesh = new Mesh(new PlaneGeometry(2, 2), material);
      scene.add(mesh);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
      view.dispose();
      handle.release();
      preparation.cancel();
      await nextFrame();
    }
  };
  try {
    await draw(10);
    const firstGeneration = uploads.length;
    const lose = gl.getExtension("WEBGL_lose_context");
    lose.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 300));
    lose.restoreContext();
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let i = 0; i < 10; i++) await nextFrame();
    const afterRestore = uploads.length - firstGeneration;
    await draw(10);
    const secondGeneration = uploads.length - firstGeneration;
    const result = { firstGeneration, afterRestore, secondGeneration };
    if (firstGeneration !== 1 || secondGeneration !== 1)
      throw new Error(`expected one upload per generation: ${JSON.stringify(result)}`);
    return result;
  } finally {
    held.release();
    target.dispose();
    app.dispose();
  }
}
