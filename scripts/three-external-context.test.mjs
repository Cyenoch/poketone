import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebGL2Context } from "webgl-node";
import * as moduleThree from "three";
import * as sourceThree from "three/src/Three.js";
import { AppRenderer } from "../src/rendering/app-renderer.ts";

// Real EGL/ANGLE contexts; no document, canvas façade or DOM event shims reach Three.
for (const { entry, THREE } of [
  { entry: "module", THREE: moduleThree },
  { entry: "source", THREE: sourceThree },
]) {
  test(`${entry}: external context renders, resizes, resets and retains custom shader programs`, () => {
    assert.equal(typeof document, "undefined");
    const native = createWebGL2Context(32, 24);
    const gl = native.gl;
    Object.defineProperty(gl, "canvas", {
      configurable: true,
      get() {
        throw new Error("Three must not read the native mock canvas");
      },
    });
    let links = 0;
    const link = gl.linkProgram.bind(gl);
    gl.linkProgram = (...args) => {
      links++;
      return link(...args);
    };
    const renderer = new THREE.WebGLRenderer({ canvas: null, context: gl });
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    camera.position.z = 1;
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);
    const makeMaterial = () =>
      new THREE.ShaderMaterial({
        vertexShader:
          "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }",
      });
    let material = makeMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const read = (x, y, label) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      assert.deepEqual([...pixel], [255, 0, 0, 255], label);
      assert.equal(gl.getError(), gl.NO_ERROR, label);
    };
    try {
      assert.equal(renderer.domElement, null);
      assert.deepEqual(renderer.getSize(new THREE.Vector2()).toArray(), [32, 24]);
      renderer.render(scene, camera);
      read(16, 12, "first draw");
      const retained = renderer.createProgramRetention();
      const secondOwner = renderer.createProgramRetention();
      retained.retain(material);
      retained.retain(material);
      secondOwner.retain(material);
      const initialLinks = links;
      material.dispose();
      assert.equal(renderer.info.programs.length, 1);
      retained.dispose();
      retained.dispose();
      assert.equal(renderer.info.programs.length, 1, "second owner still holds the program");
      material = makeMaterial();
      mesh.material = material;
      renderer.render(scene, camera);
      read(16, 12, "next run");
      assert.equal(links, initialLinks, "identical custom shader must not relink after disposal");
      secondOwner.retain(material);
      material.defines.VARIANT = 1;
      material.needsUpdate = true;
      renderer.render(scene, camera);
      secondOwner.retain(material);
      assert.equal(links, initialLinks + 1, "new variant must link once");
      material.dispose();
      assert.equal(renderer.info.programs.length, 2, "both compiled variants are retained");
      material = makeMaterial();
      mesh.material = material;
      renderer.render(scene, camera);
      material.defines.VARIANT = 1;
      material.needsUpdate = true;
      renderer.render(scene, camera);
      assert.equal(links, initialLinks + 1, "both variants stay warm across recreation");
      native.resize(48, 36);
      renderer.setDrawingBufferSize(24, 18, 2);
      renderer.resetState();
      renderer.render(scene, camera);
      read(47, 35, "drawing buffer resize and resetState");
      assert.deepEqual(renderer.getDrawingBufferSize(new THREE.Vector2()).toArray(), [48, 36]);
      native.resize(40, 30);
      renderer.setSize(20, 15);
      renderer.render(scene, camera);
      read(39, 29, "setSize has no DOM style dependency");
      secondOwner.dispose();
      material.dispose();
      assert.equal(
        renderer.info.programs.length,
        0,
        "release removes programs after last material",
      );
      material = makeMaterial();
      mesh.material = material;
      renderer.render(scene, camera);
      assert.equal(links, initialLinks + 2, "released custom shaders recompile");
      const lostRetention = renderer.createProgramRetention();
      lostRetention.retain(material);
      renderer.notifyContextLost();
      assert.throws(() => lostRetention.retain(material), /invalidated/);
      // External host releases resident uploads before restoring the same context.
      material.dispose();
      geometry.dispose();
      renderer.render(scene, camera);
      assert.equal(links, initialLinks + 2, "loss suppresses rendering");
      assert.throws(
        () => renderer.restoreContext({}),
        /replacement context requires a new renderer/,
      );
      renderer.restoreContext(gl);
      renderer.render(scene, camera);
      read(39, 29, "host-driven restore");
      assert.equal(links, initialLinks + 3, "restored generation compiles anew");
      assert.throws(() => renderer.restoreContext(gl), /not marked lost/);
      lostRetention.dispose();
      const finalRetention = renderer.createProgramRetention();
      finalRetention.retain(material);
      material.dispose();
      renderer.dispose();
      assert.throws(() => finalRetention.retain(material), /invalidated/);
      assert.equal(gl.getError(), gl.NO_ERROR);
    } finally {
      geometry.dispose();
      native.destroy();
    }
  });
}

test("canvas: null requires an explicit context", () => {
  assert.throws(
    () => new moduleThree.WebGLRenderer({ canvas: null }),
    /requires an external WebGL2 context/,
  );
});

test("AppRenderer keeps instanced custom shaders warm across world teardown", () => {
  const T = moduleThree;
  const native = createWebGL2Context(32, 24);
  const renderer = new T.WebGLRenderer({ canvas: null, context: native.gl });
  const app = new AppRenderer({
    renderer,
    display: { width: 32, height: 24, pixelRatio: 1, coarsePointer: false },
    start: () => () => {},
    dispose: () => native.destroy(),
  });
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  const scene = new T.Scene();
  const geometry = new T.PlaneGeometry(2, 2);
  let links = 0;
  const link = native.gl.linkProgram.bind(native.gl);
  native.gl.linkProgram = (...args) => {
    links++;
    return link(...args);
  };
  const makeMesh = () => {
    const material = new T.ShaderMaterial({
      vertexShader:
        "void main(){gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}",
      fragmentShader: "void main(){gl_FragColor=vec4(1.0,0.0,0.0,1.0);}",
    });
    material.customProgramCacheKey = () => "world-retention-test";
    const mesh = new T.InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new T.Matrix4());
    return mesh;
  };
  let mesh = makeMesh();
  try {
    scene.add(mesh);
    app.inWorldTarget(() => renderer.render(scene, camera));
    app.retainWorldPrograms(scene);
    const firstLinks = links;
    assert.equal(scene.children.length, 1, "retention does not attach anchor meshes");
    scene.remove(mesh);
    mesh.material.dispose();
    mesh.dispose();
    mesh = makeMesh();
    scene.add(mesh);
    app.inWorldTarget(() => renderer.render(scene, camera));
    app.retainWorldPrograms(scene);
    assert.equal(links, firstLinks, "instancing and custom program keys stay warm");
    assert.equal(native.gl.getError(), native.gl.NO_ERROR);
  } finally {
    mesh.material.dispose();
    mesh.dispose();
    geometry.dispose();
    app.dispose();
  }
});

test("AppRenderer keeps the world mounted when the host replaces its native context", () => {
  const T = moduleThree;
  let native = createWebGL2Context(32, 24, { canvas: false });
  let renderer = new T.WebGLRenderer({ canvas: null, context: native.gl });
  renderer.setDrawingBufferSize(32, 24, 1);
  let events;
  const app = new AppRenderer({
    get renderer() {
      return renderer;
    },
    display: { width: 32, height: 24, pixelRatio: 1, coarsePointer: false },
    start(callbacks) {
      events = callbacks;
      return () => {};
    },
    dispose: () => native.destroy(),
  });
  const scene = new T.Scene();
  const geometry = new T.PlaneGeometry(2, 2);
  const material = new T.MeshBasicMaterial({ color: 0xff0000 });
  scene.add(new T.Mesh(geometry, material));
  const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  camera.position.z = 1;
  let advances = 0;
  app.setWorld({
    advance() {
      advances++;
      return true;
    },
    draw(target) {
      target.clear();
      target.render(scene, camera);
    },
  });
  app.resident({
    release() {
      geometry.dispose();
      material.dispose();
    },
  });
  const checkPicture = () => {
    events.frame();
    const pixel = new Uint8Array(4);
    native.gl.readPixels(16, 12, 1, 1, native.gl.RGBA, native.gl.UNSIGNED_BYTE, pixel);
    assert(pixel[0] > 200 && pixel[1] < 10 && pixel[2] < 10, `world pixel: ${String(pixel)}`);
    assert.equal(native.gl.getError(), native.gl.NO_ERROR);
  };
  try {
    assert.equal(native.canvas, null);
    checkPicture();
    const previous = app.renderer;
    renderer.notifyContextLost();
    events.lost();
    assert.equal(events.frame(), false);
    assert.equal(advances, 1, "the lost generation cannot advance simulation");
    renderer.dispose();
    native.destroy();
    native = createWebGL2Context(32, 24, { canvas: false });
    renderer = new T.WebGLRenderer({ canvas: null, context: native.gl });
    renderer.setDrawingBufferSize(32, 24, 1);
    events.restored();
    assert.notEqual(app.renderer, previous);
    checkPicture();
    assert.equal(advances, 2);
  } finally {
    geometry.dispose();
    material.dispose();
    app.dispose();
  }
});
