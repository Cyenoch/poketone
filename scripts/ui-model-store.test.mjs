import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
import assert from "node:assert/strict";
import test from "node:test";
import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";
import {
  bindModelStore,
  canonicalModel,
  formModels,
  instantiate,
  models,
} from "../src/run/view/assets.ts";

/** A minimal binary glTF: one triangle, default material, no images. */
function triangleGlb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (bytes, fill) => {
    const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(fill);
    out.set(bytes);
    return out;
  };
  text = pad(text, 0x20);
  const bin = pad(new Uint8Array(positions.buffer), 0);
  const total = 12 + 8 + text.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  view.setUint32(20 + text.length, bin.length, true);
  view.setUint32(24 + text.length, 0x004e4942, true);
  out.set(bin, 28 + text.length);
  return out;
}

const requests = [];
globalThis.fetch = async (url) => {
  requests.push(url);
  // A host that answers a missing model with its HTML page and a 200.
  if (url.includes("not-a-glb"))
    return new Response("<!doctype html><title>404</title>", { status: 200 });
  return new Response(triangleGlb(), { status: 200 });
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("every acquire of a URL shares one fetch and one parse; the last release drops it", async () => {
  const url = "/models/test-shared.glb";
  const handles = [
    models.acquire(url, "background"),
    models.acquire(url, "critical"),
    models.acquire(url, "keep"),
  ];
  const results = await Promise.all(handles.map((handle) => handle.result));
  assert.equal(requests.filter((r) => r === url).length, 1);
  assert.ok(
    results.every((result) => result === results[0]),
    "one canonical model",
  );

  const source = results[0].instance(1);
  assert.equal(results[0].instance(1), source, "an instance source is baked once per height");
  let disposed = 0;
  source.geometry.addEventListener("dispose", () => disposed++);
  handles[0].release();
  handles[1].release();
  await flush();
  assert.equal(disposed, 0, "a held entry keeps its resources");
  handles[2].release();
  assert.equal(disposed, 1, "the last release disposes the cache-owned geometry");
  const again = models.acquire(url, "critical");
  await again.result;
  assert.equal(requests.filter((r) => r === url).length, 2, "a dropped entry is fetched afresh");
  again.release();
});

test("canonical preparation failure releases parsed images before retry; successful holds retain them", async () => {
  const bytes = await Bun.file(
    new URL("../public/models/bulbasaur.glb", import.meta.url),
  ).arrayBuffer();
  const images = [];
  const handles = [];
  installResources({
    ...webResources,
    read: async () => new Response(bytes),
    async decodeImage() {
      const image = {
        source: { data: new Uint8Array(4), width: 1, height: 1 },
        width: 1,
        height: 1,
        releases: 0,
        release() {
          this.releases++;
        },
      };
      images.push(image);
      return image;
    },
  });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = images.length;
      // A valid GLB whose rig lacks Charmander's required Pelvis bone.
      const first = models.acquire(formModels.charmander.url, "critical");
      const second = models.acquire(formModels.charmander.url, "critical");
      handles.push(first, second);
      const results = await Promise.allSettled([first.result, second.result]);
      assert(results.every((result) => result.status === "rejected"));
      assert.match(results[0].reason.message, /Pelvis/);
      assert.equal(results[0].reason, results[1].reason, "holders receive the original failure");
      await flush();
      assert(images.length > before, "each retry parses and decodes afresh");
      assert(
        images.every((image) => image.releases === 1),
        "the loader still owns failed models",
      );
      first.release();
      second.release();
    }
    const before = images.length;
    const held = models.acquire(formModels.bulbasaur.url, "critical");
    handles.push(held);
    await held.result;
    assert(images.length > before);
    assert(images.slice(before).every((image) => image.releases === 0));
    held.release();
    await flush();
    assert(
      images.every((image) => image.releases === 1),
      "successful ownership passes to the cache",
    );
  } finally {
    for (const handle of handles) handle.release();
    await flush();
    installResources(webResources);
  }
});

/** A one-mesh skinned model carrying the bones Charmander's tail spec names, with tail vertices. */
function tailedModel() {
  const spec = formModels.charmander.tail;
  const waist = new Bone();
  waist.name = spec.parent;
  const root = new Group();
  root.add(waist);
  const points = spec.points;
  const positions = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    for (const t of [0.25, 0.75])
      positions.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
  }
  const count = positions.length / 3;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute(
    "skinIndex",
    new Uint16BufferAttribute(
      Array.from({ length: count * 4 }, () => 0),
      4,
    ),
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute(Array.from({ length: count }, () => [1, 0, 0, 0]).flat(), 4),
  );
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  root.add(mesh);
  mesh.bind(new Skeleton([waist]));
  const model = { root, animations: [], releaseUploads() {}, dispose() {} };
  return { model, geometry, material: mesh.material };
}

test("a form is rigged once, before any clone: copies share its skin unchanged and own their bones", () => {
  const { model, geometry, material } = tailedModel();
  const canonical = canonicalModel(formModels.charmander.url, model);
  assert.ok(canonical.tail.length > 0, "the tail chain is part of the canonical rig");
  const skinIndex = geometry.getAttribute("skinIndex").array.slice();
  const skinWeight = geometry.getAttribute("skinWeight").array.slice();
  const shared = [];
  geometry.addEventListener("dispose", () => shared.push("geometry"));
  material.addEventListener("dispose", () => shared.push("material"));

  const copies = Array.from({ length: 3 }, () => instantiate(canonical));
  for (const copy of copies) {
    const mesh = copy.root.getObjectByProperty("type", "SkinnedMesh");
    assert.equal(mesh.geometry, geometry, "geometry is shared, not copied");
    assert.notEqual(
      mesh.skeleton,
      canonical.model.root.getObjectByProperty("type", "SkinnedMesh").skeleton,
    );
    assert.equal(copy.tail.length, canonical.tail.length);
    assert.ok(
      copy.tail.every(
        (bone, i) => bone !== canonical.tail[i] && bone.name === canonical.tail[i].name,
      ),
    );
  }
  assert.deepEqual(
    geometry.getAttribute("skinIndex").array,
    skinIndex,
    "N copies rewrite no skin index",
  );
  assert.deepEqual(geometry.getAttribute("skinWeight").array, skinWeight);

  for (const copy of copies) copy.dispose();
  assert.deepEqual(shared, [], "a consumer's release keeps the shared geometry and material");
});

test("a background model waits unparsed until the idle lane runs it or its lane rises", async () => {
  const settled = (handle) =>
    Promise.race([handle.result.then(() => true), flush().then(() => false)]);
  const waiting = models.acquire("/models/test-waits.glb", "background");
  await flush();
  assert.equal(
    await settled(waiting),
    false,
    "fetched, but no main-thread parse on a background lane",
  );
  const urgent = models.acquire("/models/test-waits.glb", "interactive");
  assert.equal(
    await settled(urgent).then(async (done) => done || (await flush(), settled(urgent))),
    true,
  );
  waiting.release();
  urgent.release();

  const units = [];
  bindModelStore({ resident() {}, trySchedule: (unit) => (units.push(unit), () => {}) });
  const idle = models.acquire("/models/test-idle.glb", "background");
  for (let i = 0; i < 5 && units.length === 0; i++) await flush();
  assert.equal(units.length, 1, "offered to the idle lane, sized from the file");
  assert.deepEqual(units[0].size, { vertices: 3, texturePixels: 0 });
  assert.equal(await settled(idle), false);
  units[0].run();
  await idle.result;
  idle.release();
});

test("a background file that is no GLB fails its handle instead of waiting forever", async () => {
  bindModelStore({ resident() {}, trySchedule: () => () => {} });
  const handle = models.acquire("/models/not-a-glb.glb", "background");
  await assert.rejects(handle.result, /不是可读的 GLB/);
  handle.release();
});

test("a parse queued on the idle lane leaves it when its lane drops to keep", async () => {
  const units = [];
  const cancelled = [];
  bindModelStore({
    resident() {},
    trySchedule: (unit) => {
      units.push(unit);
      return () => cancelled.push(unit);
    },
  });
  const handle = models.acquire("/models/test-keep.glb", "background");
  for (let i = 0; i < 5 && units.length === 0; i++) await flush();
  assert.equal(units.length, 1, "queued on the idle lane");
  handle.setLane("keep");
  assert.deepEqual(cancelled, units, "keep cancels the queued parse");
  units[0].run(); // a unit already taken by the queue when the lane dropped
  const settled = await Promise.race([handle.result.then(() => true), flush().then(() => false)]);
  assert.equal(settled, false, "and running it anyway starts nothing");
  handle.setLane("background");
  for (let i = 0; i < 5 && units.length === 1; i++) await flush();
  assert.equal(units.length, 2, "back to background: offered again");
  units[1].run();
  await handle.result;
  handle.release();
});
