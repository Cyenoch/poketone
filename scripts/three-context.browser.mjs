// Run in a browser to exercise the actual canvas context-loss event path.
export async function checkThreeContext() {
  const T = await import("../node_modules/three/build/three.module.js");
  const assert = (v, m) => {
    if (!v) throw new Error(m);
  };
  const renderer = new T.WebGLRenderer();
  const canvas = renderer.domElement;
  document.body.append(canvas);
  renderer.setSize(32, 24);
  assert(canvas.width === 32 && canvas.style.width === "32px", "canvas size/style regression");
  const gl = renderer.getContext();
  const gpu = gl.getExtension("WEBGL_debug_renderer_info");
  const device = gpu ? gl.getParameter(gpu.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const scene = new T.Scene();
  const geometry = new T.PlaneGeometry(2, 2);
  const material = new T.ShaderMaterial({
    vertexShader: "void main(){gl_Position=vec4(position,1.0);}",
    fragmentShader: "void main(){gl_FragColor=vec4(0.0,1.0,0.0,1.0);}",
  });
  scene.add(new T.Mesh(geometry, material));
  const camera = new T.Camera();
  const draw = () => {
    renderer.render(scene, camera);
    const p = new Uint8Array(4);
    gl.readPixels(16, 12, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p);
    assert(p.join() === "0,255,0,255", "pixel mismatch " + p);
    assert(gl.getError() === 0, "GL error");
    return [...p];
  };
  const before = draw();
  const retained = renderer.createProgramRetention();
  retained.retain(material);
  const lost = new Promise((resolve) =>
    canvas.addEventListener("webglcontextlost", resolve, { once: true }),
  );
  renderer.forceContextLoss();
  await lost;
  let invalid = false;
  try {
    retained.retain(material);
  } catch {
    invalid = true;
  }
  assert(invalid, "loss did not invalidate retention");
  material.dispose();
  geometry.dispose();
  const restored = new Promise((resolve) =>
    canvas.addEventListener("webglcontextrestored", resolve, { once: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  renderer.forceContextRestore();
  await Promise.race([
    restored,
    new Promise((_, reject) => setTimeout(() => reject(new Error("restore timeout")), 5000)),
  ]);
  const after = draw();
  assert(renderer.getContext() === gl, "context identity changed");
  material.dispose();
  geometry.dispose();
  renderer.dispose();
  canvas.remove();
  // Explicit OffscreenCanvas still follows the existing browser path.
  const offscreen = new T.WebGLRenderer({ canvas: new OffscreenCanvas(8, 8) });
  offscreen.setSize(8, 8, false);
  offscreen.clear();
  offscreen.dispose();
  return { device, before, after, loss: true, restore: true, offscreen: true };
}
