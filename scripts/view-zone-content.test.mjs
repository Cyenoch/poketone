import assert from "node:assert/strict";
import { test } from "node:test";
import { stat } from "node:fs/promises";
import { MeshLambertMaterial, ShaderLib } from "three";
import { installResources } from "../src/platform/resources.ts";
import { nativeResources } from "../src/platform/native/resources.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { createWorld } from "../src/run/sim/world.ts";
import { addHazard } from "../src/run/sim/skills/kit.ts";
import {
  enemyModel,
  loadRunAssets,
  runSharedNeeds,
  stageEnemyIds,
} from "../src/run/view/assets.ts";
import { createTerrainUniforms } from "../src/run/view/terrain.ts";
import { Vfx } from "../src/run/view/vfx.ts";
import { enemyLook, towerEnemySilhouette } from "../src/run/view/enemyLook.ts";
import { creatureLook } from "../src/run/view/materials.ts";
import { bodyMotion } from "../src/run/view/enemyMotion.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";

installResources(nativeResources(new URL("../public/", import.meta.url)));

// The readiness list and live loader must agree; a missing later-floor model interrupts the run.
test("stage preparation includes every roster, beat, guardian and only that map's enemy GLBs", async () => {
  for (const [stage, def] of Object.entries(stageDefs)) {
    const expected = new Set(
      def.zones.flatMap((zone) => [
        ...zone.roster.map(([, id]) => id),
        zone.guardian.species,
        ...zone.beats.flatMap(([, beat]) => ("species" in beat ? [beat.species].flat() : [])),
      ]),
    );
    assert.deepEqual(new Set(stageEnemyIds(stage)), expected);
    const needed = runSharedNeeds(stage)
      .map((need) => need.key)
      .filter((key) => key.startsWith("/models/enemies/"));
    assert.deepEqual(new Set(needed), new Set([...expected].map(enemyModel)));
    assert.equal(needed.length, new Set(needed).size, "aliases must not duplicate readiness work");
    for (const url of needed)
      assert.ok((await stat(new URL(`../public${url}`, import.meta.url))).size > 0, url);
  }
  assert.equal(enemyModel("haunter-guardian"), enemyModel("haunter"));
  assert.equal(enemyModel("marowak-ghost"), enemyModel("marowak"));
});

test("tower loader reuses alias geometry and releases actual model resources", async () => {
  const world = createWorld({
    stage: "tower",
    seed: 154,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  world.partners.push({
    id: -10,
    owner: 0,
    species: "marowak",
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    faceX: 0,
    faceZ: 1,
    cooldown: 0,
    guard: 0,
  });
  const controller = new AbortController();
  const assets = await loadRunAssets(world, controller.signal);
  let disposed = 0;
  assets.enemies["marowak-ghost"].geometry.addEventListener("dispose", () => disposed++);
  try {
    assert.deepEqual(
      new Set(Object.keys(assets.enemies)),
      new Set([...stageEnemyIds("tower"), "marowak"]),
    );
    assert.equal(assets.enemies.haunter, assets.enemies["haunter-guardian"]);
    assert.equal(assets.enemies.marowak, assets.enemies["marowak-ghost"]);
    assert.equal(assets.enemies.dragonite, undefined);
  } finally {
    assets.dispose();
  }
  assert.equal(disposed, 1, "the aliased geometry has one owner and is released once");
});

function withFx(t, stage = "tower") {
  const world = createWorld({
    stage,
    seed: 154,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  const uniforms = createTerrainUniforms(world.map.terrain);
  const vfx = new Vfx({ uniforms, heightAt: () => 0 }, stage);
  const update = () => vfx.update(world, 1, 0, 0, world.players[0], new Map());
  t.after(() => {
    vfx.dispose();
    uniforms.uTerrainHeight.value.dispose();
  });
  return { world, vfx, update };
}

function liveBuffers(vfx) {
  let shapes = 0;
  vfx.root.traverse((mesh) => {
    const geometry = mesh.geometry;
    if (!geometry) return;
    const n = geometry.instanceCount;
    if (!Number.isFinite(n) || !n) return;
    shapes += n;
    for (const attr of Object.values(geometry.attributes)) {
      const data = attr.data;
      if (!data) continue;
      for (let i = 0; i < n * data.stride; i++)
        assert.ok(
          Number.isFinite(data.array[i]),
          `${mesh.name || "FX"} contains a non-finite position/phase at ${i}`,
        );
    }
  });
  return shapes;
}

test("scheduled falls stay invisible until armed and new guardian shapes submit finite geometry", (t) => {
  const { world, vfx, update } = withFx(t);
  const fall = addHazard(world, {
    kind: "boss-fall",
    x: 0,
    y: 0,
    z: 0,
    radius: 1.6,
    life: 1.4,
    duration: 1.4,
    active: 0.3,
    delay: 0.5,
    dmg: 12,
    element: "fire",
  });
  update();
  assert.equal(liveBuffers(vfx), 0, "a delayed hazard has not warned or hurt yet");
  fall.delay = 0;
  update();
  assert.ok(liveBuffers(vfx) > 0, "the armed fall must have a warning");
  world.hazards = [];
  for (const spec of [
    { kind: "boss-beam", element: "ice", radius: 0.8, length: 12 },
    { kind: "cone", element: "flying", angle: Math.PI / 6, length: 8 },
    { kind: "closing-box", element: "psychic", radius: 0.4, length: 4.5, gap: 1 },
    { kind: "orbit", element: "ice", radius: 0.35, length: 3.2 },
    { kind: "curse-mark", element: "ghost", radius: 2, target: 0 },
    { kind: "sweep", element: "dragon", radius: 1.2, length: 20, angle: Math.PI / 4 },
    { kind: "ice-trail", radius: 1.1, length: 4 },
    { kind: "burning-pool", radius: 1.4 },
    { kind: "ghost-fire", radius: 1.2 },
    { kind: "teleport-mark", radius: 0.7 },
  ])
    addHazard(world, {
      x: 0,
      y: 0,
      z: 0,
      dirX: 0,
      dirZ: 1,
      life: 1.5,
      duration: 2,
      active: 1,
      dmg: 10,
      ...spec,
    });
  update();
  assert.ok(liveBuffers(vfx) > 10);
  for (const h of world.hazards) h.life = 0.2;
  update();
  assert.ok(liveBuffers(vfx) > 10, "active geometry must remain finite through the end phase");
});

test("ghost and teleport body motion leaves sim state untouched and preserves fade phases", (t) => {
  const { world } = withFx(t);
  const enemy = spawnEnemy(world, "kadabra", 0, 0);
  enemy.phase = "under";
  enemy.phaseTime = 0.2;
  const before = structuredClone(enemy);
  assert.ok(Math.abs(bodyMotion(world, enemy, 1).show - 0.5) < 1e-6);
  assert.deepEqual(enemy, before);
  enemy.phase = "windup";
  enemy.phaseTime = 0.08;
  assert.ok(bodyMotion(world, enemy, 1).show > 0 && bodyMotion(world, enemy, 1).show < 1);
});

test("closing light walls keep the designated escape gap open before and during contraction", (t) => {
  const { world, vfx, update } = withFx(t);
  function covered(x, z) {
    const mesh = vfx.root.children.find(
      (object) => object.geometry?.getAttribute("iP") && object.material.depthTest === false,
    );
    const geometry = mesh.geometry,
      origin = geometry.getAttribute("iOrigin"),
      rect = geometry.getAttribute("iRect"),
      params = geometry.getAttribute("iP");
    for (let i = 0; i < geometry.instanceCount; i++) {
      const angle = origin.getZ(i),
        dx = x - origin.getX(i),
        dz = z - origin.getY(i);
      const along = dx * Math.sin(angle) + dz * Math.cos(angle),
        across = -dx * Math.cos(angle) + dz * Math.sin(angle);
      if (along >= 0 && along <= rect.getW(i) && Math.abs(across) <= params.getZ(i)) return true;
    }
    return false;
  }
  for (let gap = 0; gap < 4; gap++) {
    world.hazards = [];
    const wall = addHazard(world, {
      kind: "closing-box",
      x: 0,
      y: 0,
      z: 0,
      radius: 0.4,
      length: 4.5,
      gap,
      life: 2,
      active: 1,
      duration: 2.2,
      dmg: 10,
    });
    for (const life of [2, 0.6]) {
      wall.life = life;
      update();
      const half = wall.length * Math.min(1, wall.life / wall.active),
        sign = gap < 2 ? 1 : -1,
        vertical = gap % 2 === 0;
      const at = (along) => [vertical ? sign * half : along, vertical ? along : sign * half];
      assert.equal(covered(...at(0)), false, `side ${gap}'s escape opening must be visible`);
      assert.equal(
        covered(...at(half * 0.8)),
        true,
        `side ${gap}'s damaging segment must be marked`,
      );
    }
  }
});

test("species material patches compose with the real Lambert shader and leave shared sources alone", () => {
  for (const id of [
    "haunter-guardian",
    "marowak-ghost",
    "gengar",
    "golbat",
    "grimer",
    "muk",
    "magmar",
    "flareon",
  ]) {
    const material = creatureLook(new MeshLambertMaterial());
    enemyLook(material, id);
    const shader = {
      uniforms: {},
      vertexShader: ShaderLib.lambert.vertexShader,
      fragmentShader: ShaderLib.lambert.fragmentShader,
    };
    material.onBeforeCompile(shader, {});
    assert.ok(
      shader.fragmentShader.includes("gl_FragColor") ||
        shader.fragmentShader.includes("#include <opaque_fragment>"),
    );
    if (["haunter-guardian", "marowak-ghost", "gengar"].includes(id))
      assert.ok(material.opacity >= 0.7);
    material.dispose();
  }
  const silhouette = towerEnemySilhouette();
  assert.equal(silhouette.depthWrite, false);
  silhouette.dispose();
});

test("new decal, note and creature patches compile and render on a real EGL context", async (t) => {
  const { createWebGL2Context } = await import("webgl-node");
  const {
    AmbientLight,
    BoxGeometry,
    InstancedMesh,
    Matrix4,
    PerspectiveCamera,
    Scene,
    WebGLRenderer,
  } = await import("three");
  const { applyWorldOutput } = await import("../src/run/view/grade.ts");
  const native = createWebGL2Context(64, 64, { canvas: false });
  const gl = native.gl;
  const renderer = new WebGLRenderer({ canvas: null, context: gl });
  const errors = [];
  renderer.debug.onShaderError = (context, program, vertex, fragment) =>
    errors.push(
      [
        context.getProgramInfoLog(program),
        context.getShaderInfoLog(vertex),
        context.getShaderInfoLog(fragment),
      ].join("\n"),
    );
  const { world, vfx, update } = withFx(t);
  const scene = new Scene();
  scene.add(new AmbientLight(0xffffff, 2), vfx.root);
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 12, 12);
  camera.lookAt(0, 0, 0);
  const geometry = new BoxGeometry(1, 1, 1);
  const owned = [];
  for (const [i, id] of ["gengar", "golbat", "magmar", "flareon"].entries()) {
    const material = creatureLook(new MeshLambertMaterial());
    enemyLook(material, id);
    owned.push(material);
    const mesh = new InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new Matrix4().makeTranslation(i - 2, 0.5, 0));
    scene.add(mesh);
    owned.push(mesh);
  }
  const silhouette = towerEnemySilhouette();
  owned.push(silhouette);
  const mesh = new InstancedMesh(geometry, silhouette, 1);
  mesh.setMatrixAt(0, new Matrix4());
  scene.add(mesh);
  owned.push(mesh);
  for (const spec of [
    { kind: "cone", length: 8, angle: Math.PI / 6 },
    { kind: "sing", radius: 3 },
    { kind: "boss-beam", length: 8, radius: 0.8, element: "ice" },
    { kind: "closing-box", length: 4.5, radius: 0.4, gap: 1 },
  ])
    addHazard(world, {
      x: 0,
      y: 0.5,
      z: 0,
      dirX: 0,
      dirZ: 1,
      life: 1.2,
      active: 0.3,
      duration: 1.5,
      dmg: 10,
      ...spec,
    });
  try {
    for (const life of [1.2, 0.2]) {
      for (const h of world.hazards) h.life = life;
      update();
      applyWorldOutput(scene);
      renderer.render(scene, camera);
      assert.deepEqual(errors, []);
      assert.equal(gl.getError(), gl.NO_ERROR);
    }
  } finally {
    for (const resource of owned) resource.dispose();
    geometry.dispose();
    renderer.dispose();
    native.destroy();
  }
});
