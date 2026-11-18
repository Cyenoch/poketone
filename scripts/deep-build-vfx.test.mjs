import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { applyCommand, createWorld } from "../src/run/sim/world.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { createTerrainUniforms } from "../src/run/view/terrain.ts";
import { Vfx } from "../src/run/view/vfx.ts";
import { Decals } from "../src/run/view/vfx/decals.ts";
import { Echoes } from "../src/run/view/vfx/fx.ts";
import { pledgeFields, rainbowAura, rainbowBurst } from "../src/run/view/vfx/pledge.ts";
import { Ribbons } from "../src/run/view/vfx/ribbons.ts";
import { Sprites } from "../src/run/view/vfx/sprites.ts";
import { weatherCasts } from "../src/run/view/vfx/weatherMoves.ts";
import { createWeather } from "../src/run/view/weather.ts";

const timing = JSON.parse(
  readFileSync(new URL("../assets/audio/elevenlabs/master/timing.json", import.meta.url), "utf8"),
);
/** Longest tail (seconds after its hit) among a cue's mastered takes. */
function tail(cue) {
  const takes = Object.entries(timing).filter(([file]) => file.startsWith(`${cue}-`));
  assert.ok(takes.length > 0, `${cue} has mastered takes`);
  return Math.max(...takes.map(([, take]) => take.lenMs - take.hitMs)) / 1000;
}

function forest(t, players = [{ trainer: "chengxi", starter: "charmander" }]) {
  const world = createWorld({
    mode: "expedition",
    rules: [],
    stage: "forest",
    seed: 154,
    difficulty: 0,
    players,
  });
  world.map.terrain.heights.fill(0);
  world.enemies = [];
  for (const player of world.players) player.x = player.px = player.z = player.pz = 0;
  const uniforms = createTerrainUniforms(world.map.terrain);
  t.after(() => uniforms.uTerrainHeight.value.dispose());
  return { world, ground: { uniforms, heightAt: () => 0 } };
}

/** What the layers would draw this frame, the widest ground shape among them, and finite buffers. */
function inspect(meshes) {
  let vertices = 0;
  let reach = 0;
  for (const mesh of meshes) {
    if (!mesh.visible) continue;
    const g = mesh.geometry;
    const count = Number.isFinite(g.instanceCount) ? g.instanceCount : g.drawRange.count / 3 + 2;
    if (!count) continue;
    vertices += count;
    const extent = g.getAttribute("iX");
    if (extent) for (let i = 0; i < count; i++) reach = Math.max(reach, extent.getX(i));
    for (const attr of Object.values(g.attributes)) {
      if (!attr.isInterleavedBufferAttribute) continue;
      for (let i = 0; i < Math.min(count, attr.count); i++)
        for (let c = 0; c < attr.itemSize; c++)
          assert.ok(Number.isFinite(attr.data.array[i * attr.data.stride + attr.offset + c]));
    }
  }
  return { vertices, reach };
}

/** The effect layers on their own, framed in the order `Vfx.update` runs them. */
function stage(t) {
  const { ground } = forest(t);
  const uniforms = { uTime: { value: 0 } };
  const material = Decals.material(uniforms, ground.uniforms);
  const fx = {
    sprites: new Sprites(uniforms, 2800, 600),
    decals: new Decals(material, 160, 0.05),
    danger: new Decals(material, 192, 0.08),
    ribbons: new Ribbons(uniforms, 6000),
    echoes: new Echoes(64),
    ground,
    viewYaw: 0,
    time: 0,
    dt: 0,
  };
  t.after(() => {
    for (const layer of [fx.sprites, fx.decals, fx.danger, fx.ribbons]) layer.dispose();
    material.dispose();
  });
  const player = [fx.decals.mesh, fx.ribbons.mesh, fx.sprites.mesh];
  const frame = (draw, dt = TICK) => {
    fx.dt = dt;
    fx.time += dt;
    fx.decals.begin(dt);
    fx.danger.begin(dt);
    fx.ribbons.begin();
    draw?.(fx);
    fx.echoes.update(fx);
    fx.decals.end();
    fx.danger.end();
    fx.ribbons.end();
    fx.sprites.update(dt);
    assert.equal(inspect([fx.danger.mesh]).vertices, 0, "the enemy danger layer stays empty");
    return inspect(player);
  };
  const run = (seconds, draw) => {
    let last = inspect(player);
    for (let i = 0; i < Math.round(seconds / TICK); i++) last = frame(draw);
    return last;
  };
  return { fx, frame, run };
}

function smiteArea(move, type, radius, delay) {
  return {
    id: 9001,
    owner: 0,
    move,
    kind: "smite",
    type,
    x: 3,
    z: 2,
    dirX: 0,
    dirZ: 1,
    radius,
    length: 0,
    rise: 0,
    angle: 0,
    life: delay + 0.25,
    maxLife: delay + 0.25,
    delay,
    tick: 0,
    tickTimer: 0,
    dmg: 40,
    statusChance: 0,
    crit: 0,
    follow: false,
    count: 1,
    released: 0,
    scale: 1,
  };
}

// The sim's pledge casts are not in the tree yet: the area below follows `archetypes/smite.ts`
// (telegraph `delay`, one hit, 0.25 s linger) and reaches the look through the real index.
for (const [move, type] of [
  ["grass-pledge", "grass"],
  ["fire-pledge", "fire"],
  ["water-pledge", "water"],
])
  for (const radius of [1.5, 3])
    test(`${move} 半径 ${radius}：预警和落点不超出判定圈，柱子盖住施放音，结束后清空`, (t) => {
      const { world, ground } = forest(t);
      const vfx = new Vfx(ground, "forest");
      t.after(() => vfx.dispose());
      const layers = vfx.root.children;
      const update = () => {
        const before = JSON.stringify([world.areas, world.rng, world.players]);
        vfx.update(world, 1, TICK, 0, world.players[0], new Map());
        assert.equal(JSON.stringify([world.areas, world.rng, world.players]), before);
        return inspect(layers);
      };
      const area = smiteArea(move, type, radius, 0.5);
      world.areas = [area];
      let warned = 0;
      while (area.delay > 0) {
        const seen = update();
        warned = Math.max(warned, seen.vertices);
        assert.ok(seen.reach <= radius * 1.15, `telegraph reach ${seen.reach}`);
        area.delay -= TICK;
        area.life -= TICK;
      }
      assert.ok(warned > 0, "the telegraph is drawn");
      area.tickTimer = 1;
      const struck = update();
      assert.ok(struck.vertices > warned, "the strike is the peak");
      assert.ok(struck.reach <= radius * 1.15, `strike reach ${struck.reach}`);
      world.areas = [];
      const sound = tail(`cast-${move}`);
      for (let at = TICK; at < sound; at += TICK) update();
      assert.ok(
        update().vertices > 0,
        `still drawn ${sound}s after the hit, while its sound plays`,
      );
      for (let i = 0; i < 2 / TICK; i++) update();
      assert.equal(update().vertices, 0, "the pillar and its residue are gone");
    });

function field(radius, life, maxLife = 8) {
  return { ...smiteArea(null, "fire", radius, 0), life, maxLife, tickTimer: 1 };
}

for (const id of ["sea-of-fire", "swamp"])
  test(`${id}：全程画在判定圈内，随场地结束而清空，重连的场地不重播成形`, (t) => {
    const look = pledgeFields[id];
    const { frame, run } = stage(t);
    const area = field(2.5, 8);
    const formed = frame((fx) => {
      look.strike(fx, area, area.x, area.z);
      look.live(fx, area, area.x, area.z, 1);
    });
    assert.ok(formed.vertices > 0);
    while (area.life > 0) {
      const seen = frame((fx) => look.live(fx, area, area.x, area.z, 1));
      assert.ok(seen.vertices > 0, `drawn with ${area.life}s left`);
      assert.ok(seen.reach <= area.radius * 1.15, `reach ${seen.reach}`);
      area.life -= TICK;
    }
    assert.equal(run(1.5).vertices, 0, "nothing lingers after the field ends");

    const restored = stage(t);
    const aged = field(2.5, 4);
    assert.equal(
      restored.frame((fx) => look.strike(fx, aged, aged.x, aged.z)).vertices,
      0,
      "a field restored mid-life has no forming burst",
    );
    assert.ok(restored.frame((fx) => look.live(fx, aged, aged.x, aged.z, 1)).vertices > 0);
  });

for (const [weather, cue] of [
  ["sun", "cast-sunny-day"],
  ["rain", "cast-rain-dance"],
  ["sandstorm", "cast-sandstorm"],
])
  test(`${cue}：施放演出盖住施放音，随后清空`, (t) => {
    const { frame, run } = stage(t);
    assert.ok(frame((fx) => weatherCasts[weather](fx, 1, -2, 0.45, 1)).vertices > 0);
    assert.ok(run(tail(cue)).vertices > 0, "still drawn while its sound plays");
    assert.equal(run(2).vertices, 0);
  });

test("彩虹：成形弧盖住成形音后清空；脚下光环只在增益期间出现", (t) => {
  const { frame, run } = stage(t);
  assert.ok(frame((fx) => rainbowBurst(fx, 0, 0, 1.5)).vertices > 0);
  assert.ok(run(tail("field-rainbow")).vertices > 0);
  assert.equal(run(2).vertices, 0);

  let remaining = 1;
  const aura = (fx) => rainbowAura(fx, 0, 0, remaining, 0.3);
  while (remaining > 0) {
    const seen = frame(aura);
    // Outside the seat ring (0.87 m), so it is not hidden under it; still a mark at the feet.
    assert.ok(
      seen.vertices > 0 && seen.reach > 0.87 + 0.3 && seen.reach < 1.3 + 1e-6,
      `reach ${seen.reach}`,
    );
    remaining -= TICK;
  }
  assert.equal(run(1, aura).vertices, 0, "an expired buff draws nothing and leaves nothing");
});

test("交换进化走进化事件，画出同一段进化演出", (t) => {
  const { world, ground } = forest(t, [
    { trainer: "chengxi", starter: "machop" },
    { trainer: "chengxi", starter: "gastly" },
  ]);
  const vfx = new Vfx(ground, "forest");
  t.after(() => vfx.dispose());
  for (const player of world.players) Object.assign(player, { level: 80, stage: 1 });
  world.events.length = 0;
  for (const player of [0, 1]) applyCommand(world, { t: "interact", player });
  assert.deepEqual(
    world.players.map((player) => formOf(player).id),
    ["machamp", "gengar"],
  );
  const evolved = world.events.filter((event) => event.t === "evolve");
  assert.equal(evolved.length, 2);
  for (const event of evolved) vfx.handle(event);
  vfx.update(world, 1, TICK, 0, world.players[0], new Map());
  assert.ok(inspect(vfx.root.children).vertices > 0);
});

const vertexCount = (vfx) => inspect(vfx.root.children);
const draw = (vfx, world) => {
  vfx.update(world, 1, TICK, 0, world.players[0], new Map());
  return vertexCount(vfx);
};

test("天气招式：施放事件在施放者身上画出演出，普通招式和恢复的画面都不画", (t) => {
  const { world, ground } = forest(t);
  for (const [move, id] of [
    ["sunny-day", "sun"],
    ["rain-dance", "rain"],
    ["sandstorm", "sandstorm"],
  ]) {
    const vfx = new Vfx(ground, "forest");
    vfx.handle({ t: "cast", player: 0, move: "ember", windup: 0 });
    assert.equal(draw(vfx, world).vertices, 0, "an ordinary cast has no beat of this kind");
    vfx.handle({ t: "cast", player: 0, move, windup: 0 });
    world.weather = { id, from: world.time, until: world.time + 30 };
    assert.ok(draw(vfx, world).vertices > 0, move);
    vfx.dispose();

    const restored = new Vfx(ground, "forest");
    assert.equal(draw(restored, world).vertices, 0, `${move}: no beat without its cast event`);
    restored.dispose();
  }
});

test("组合场按 pledgeField 画到结束；恢复的画面只画场地，不重播成形", (t) => {
  for (const pledgeField of ["sea-of-fire", "swamp"]) {
    const { world, ground } = forest(t);
    // The field keeps the pledge its damage is credited to; its look still comes from the field.
    const area = { ...field(2.5, 8), move: "fire-pledge", pledgeField };
    world.areas = [area];
    const vfx = new Vfx(ground, "forest");
    const formed = draw(vfx, world).vertices;
    vfx.dispose();

    area.life = 4;
    const restored = new Vfx(ground, "forest");
    t.after(() => restored.dispose());
    const seen = draw(restored, world);
    assert.ok(seen.vertices > 0, "a pillar would have ended; the field is still drawn");
    assert.ok(seen.reach <= area.radius * 1.15, `reach ${seen.reach}`);
    assert.ok(formed > seen.vertices, "only a new field bursts");
    world.areas = [];
    for (let i = 0; i < 2 / TICK; i++) draw(restored, world);
    assert.equal(draw(restored, world).vertices, 0);
  }
});

test("彩虹：成形弧来自 pledge 事件；脚下光环读 rainbowUntil，恢复后仍在，倒地者没有", (t) => {
  const { world, ground } = forest(t, [
    { trainer: "chengxi", starter: "charmander" },
    { trainer: "chengxi", starter: "squirtle" },
  ]);
  world.players[1].x = world.players[1].px = 6;
  const vfx = new Vfx(ground, "forest");
  t.after(() => vfx.dispose());
  vfx.handle({ t: "pledge", result: "rainbow", x: 3, z: 0 });
  world.rainbowUntil = world.time + 10;
  const burst = draw(vfx, world).vertices;

  const restored = new Vfx(ground, "forest");
  t.after(() => restored.dispose());
  const aura = draw(restored, world);
  assert.ok(aura.vertices >= 2, "one ring under each player");
  assert.ok(burst > aura.vertices, "the arc is not replayed");
  world.players[1].alive = false;
  assert.ok(draw(restored, world).vertices < aura.vertices + 2);
  world.players[0].alive = false;
  for (let i = 0; i < 1 / TICK; i++) draw(restored, world);
  assert.equal(draw(restored, world).vertices, 0, "nobody standing carries it");
  world.players[0].alive = true;
  world.rainbowUntil = world.time;
  for (let i = 0; i < 1 / TICK; i++) draw(restored, world);
  assert.equal(draw(restored, world).vertices, 0, "it ends with the buff");
});

function sky(stage, castable) {
  const fog = new Fog("#a0c0e0", 30, 80);
  const base = {
    fog,
    background: new Color(),
    hemi: new HemisphereLight("#fff", "#888", 1),
    sun: new DirectionalLight("#fff", 2),
    meshes: [],
    add: (mesh) => base.meshes.push(mesh),
  };
  return { base, view: createWeather(stage, base, false, castable) };
}

test("招式天气在任何地图改变天空和光照：覆盖时平滑交接，恢复时直接是当前天气", () => {
  const centre = new Vector3();
  assert.equal(
    sky("forest", []).view,
    null,
    "a run nobody can change the weather in makes nothing",
  );
  const { base, view } = sky("forest", ["sun", "rain"]);
  const clear = base.fog.color.clone();
  const [sunFall, rainFall] = base.meshes;
  const rain = { id: "rain", from: 80, until: 110 };
  // A run restored mid-rain: the first frame is already the rain, with no ramp from a clear sky.
  view.frame(rain, 100, centre, TICK);
  const rainy = base.fog.color.clone();
  assert.ok(rainFall.visible && !sunFall.visible && base.sun.intensity < 1.2);
  // 大晴天 replaces it: no jump on the next frame, both weathers on screen while they change hands.
  const sunny = { id: "sun", from: 100, until: 130 };
  view.frame(sunny, 100 + TICK, centre, TICK);
  assert.ok(base.sun.intensity < 1.4, `light jumped to ${base.sun.intensity}`);
  assert.ok(rainFall.visible, "the rain thins out instead of vanishing");
  for (let time = 100 + 2 * TICK; time < 104; time += TICK) view.frame(sunny, time, centre, TICK);
  assert.ok(!rainFall.visible && sunFall.visible && base.sun.intensity > 2);
  assert.ok(!base.fog.color.equals(rainy) && !base.fog.color.equals(clear));
  for (let time = 130; time < 132; time += TICK) view.frame(null, time, centre, TICK);
  assert.ok(base.fog.color.equals(clear) && base.sun.intensity === 2 && !sunFall.visible);
  view.dispose();
});

// The real programs on a real context. CI has no GPU host (CLAUDE.md), so this stays a local check.
test(
  "真实 EGL：森林里的天气、誓约柱、组合场和彩虹都编译并画在该在的像素上",
  { skip: process.env.CI ? "needs a GPU host" : false },
  async (t) => {
    const { createWebGL2Context } = await import("webgl-node");
    const { applyWorldOutput } = await import("../src/run/view/grade.ts");
    const [W, H] = [320, 200];
    const native = createWebGL2Context(W, H, { canvas: false });
    const gl = native.gl;
    const renderer = new WebGLRenderer({ canvas: null, context: gl });
    renderer.setSize(W, H, false);
    const errors = [];
    renderer.debug.onShaderError = (context, program, vertex, fragment) =>
      errors.push(
        [
          context.getProgramInfoLog(program),
          context.getShaderInfoLog(vertex),
          context.getShaderInfoLog(fragment),
        ].join("\n"),
      );
    const floor = new Mesh(
      new PlaneGeometry(400, 400),
      new MeshLambertMaterial({ color: "#6fae55" }),
    );
    floor.rotation.x = -Math.PI / 2;
    const camera = new PerspectiveCamera(42, W / H, 0.5, 120);
    camera.position.set(0, 6, 15);
    camera.lookAt(0, 1.5, 0);
    camera.updateMatrixWorld();
    t.after(() => {
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      native.destroy();
    });

    /** A forest scene with its own effects; `shot` advances it and returns the rendered frame. */
    function scene() {
      const { world, ground } = forest(t);
      world.players[0].x = world.players[0].px = -6;
      const vfx = new Vfx(ground, "forest");
      const { base, view } = sky("forest", ["sun", "rain", "sandstorm"]);
      const root = new Scene();
      root.fog = base.fog;
      root.add(base.hemi, base.sun, floor, vfx.root, ...base.meshes);
      t.after(() => {
        vfx.dispose();
        view.dispose();
      });
      const shot = (seconds = TICK) => {
        for (let i = 0; i < Math.round(seconds / TICK); i++) {
          world.time += TICK;
          vfx.update(world, 1, TICK, 0, world.players[0], new Map());
          view.frame(world.weather, world.time, point.set(0, 0, 0), TICK);
        }
        applyWorldOutput(root);
        renderer.setClearColor(base.background);
        renderer.render(root, camera);
        assert.deepEqual(errors, []);
        assert.equal(gl.getError(), gl.NO_ERROR);
        const frame = new Uint8Array(W * H * 4);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, frame);
        return frame;
      };
      return { world, vfx, shot };
    }
    const point = new Vector3();
    /** Calls `each(offset)` for the pixels within `half` of a world point's place on screen. */
    function around(x, y, z, half, each) {
      point.set(x, y, z).project(camera);
      const px = Math.round((point.x * 0.5 + 0.5) * W);
      const py = Math.round((point.y * 0.5 + 0.5) * H);
      for (let dy = -half; dy <= half; dy++)
        for (let dx = -half; dx <= half; dx++) each(((py + dy) * W + px + dx) * 4);
    }
    /** Share of the pixels round a world point that an effect repainted. */
    function painted(frame, plain, x, y, z, half = 6) {
      let count = 0;
      around(x, y, z, half, (at) => {
        const shift = [0, 1, 2].map((c) => Math.abs(frame[at + c] - plain[at + c]));
        if (Math.max(...shift) > 16) count++;
      });
      return count / (2 * half + 1) ** 2;
    }
    function luma(frame, x, y, z) {
      let sum = 0;
      around(x, y, z, 6, (at) => {
        sum += 0.3 * frame[at] + 0.6 * frame[at + 1] + 0.1 * frame[at + 2];
      });
      return sum / 169;
    }
    const GRASS = [4, 0, 6];
    const HORIZON = [0, 1.5, -150];

    const clear = scene().shot();
    // Where each beat is densest: the sun and the cloud over the head, the sand round the feet.
    for (const [move, id, ...beat] of [
      ["sunny-day", "sun", -6, 1.6, 0],
      ["rain-dance", "rain", -6, 1.6, 0],
      ["sandstorm", "sandstorm", -6, 0.2, 0],
    ]) {
      const { world, vfx, shot } = scene();
      shot();
      vfx.handle({ t: "cast", player: 0, move, windup: 0 });
      world.weather = { id, from: world.time, until: world.time + 30 };
      const cast = shot(0.2);
      assert.ok(painted(cast, clear, ...beat) > 0.15, `${move} shows on its caster`);
      assert.ok(painted(cast, clear, ...GRASS) < 0.05, `${move} has not changed the field yet`);
      const settled = shot(5);
      assert.ok(painted(settled, clear, ...HORIZON) > 0.9, `${id} tints the sky`);
      const light = luma(settled, ...GRASS) - luma(clear, ...GRASS);
      if (id === "sun") assert.ok(light > 1, `the sun brightens the ground (${light})`);
      else assert.ok(light < -4, `${id} dims the ground (${light})`);
    }

    for (const [move, type] of [
      ["grass-pledge", "grass"],
      ["fire-pledge", "fire"],
      ["water-pledge", "water"],
    ]) {
      const { world, shot } = scene();
      world.areas = [{ ...smiteArea(move, type, 1.5, 0), x: 0, z: 0, tickTimer: 1 }];
      const struck = shot(0.1);
      assert.ok(painted(struck, clear, 0, 1, 0) > 0.15, `${move} raises a pillar`);
      assert.ok(painted(struck, clear, 0, 0, 2.6) < 0.05, `${move} stays in its ring`);
    }

    for (const pledgeField of ["sea-of-fire", "swamp"]) {
      const { world, shot } = scene();
      world.areas = [{ ...field(2.5, 5), x: 0, z: 0, move: "fire-pledge", pledgeField }];
      const live = shot(1);
      assert.ok(painted(live, clear, 0.8, 0, 0.8) > 0.5, `${pledgeField} covers its ground`);
      assert.ok(painted(live, clear, 0, 0, 3.8) < 0.05, `${pledgeField} ends at its radius`);
    }

    const { world, vfx, shot } = scene();
    shot();
    vfx.handle({ t: "pledge", result: "rainbow", x: 0, z: 0 });
    world.rainbowUntil = world.time + 10;
    assert.ok(painted(shot(0.6), clear, 0, 1.7, 0) > 0.15, "the arc stands where the pledges met");
    assert.ok(painted(shot(3), clear, 0, 1.7, 0) < 0.05, "the arc has gone");
  },
);

test("训练师道具在画出的弹出帧报告一次，名单取自事件，慢放时随画面推迟", (t) => {
  const { world, ground } = forest(t, [
    { trainer: "shuoye", starter: "charmander" },
    { trainer: "shuoye", starter: "squirtle" },
    { trainer: "shuoye", starter: "bulbasaur" },
  ]);
  const event = { t: "assist", player: 0, item: "superPotion", x: 0, z: 0, to: [0, 1] };
  for (const dt of [TICK, TICK / 10]) {
    const vfx = new Vfx(ground, "forest");
    vfx.handle(event);
    const before = JSON.stringify(world.players);
    const pops = [];
    let elapsed = 0;
    for (let frame = 0; frame < 400 && elapsed < 1; frame++) {
      vfx.update(world, 1, dt, 0, world.players[0], new Map());
      elapsed += dt;
      for (const pop of vfx.assistPops) pops.push({ ...pop, elapsed });
    }
    assert.equal(JSON.stringify(world.players), before, "the view writes nothing back");
    assert.equal(pops.length, 1, `dt ${dt}: one pop`);
    const [pop] = pops;
    assert.deepEqual([pop.player, pop.to, pop.item], [0, [0, 1], "superPotion"]);
    assert.ok(pop.late >= 0 && pop.late < dt, `late ${pop.late} inside the drawn frame`);
    // The throw runs on the drawn clock: the pop lands ASSIST_POP of drawn time after the event.
    assert.ok(Math.abs(pop.elapsed - pop.late - 0.24) < dt + 1e-9, `pop at ${pop.elapsed}`);
    vfx.dispose();
  }
});
