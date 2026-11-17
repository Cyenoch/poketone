import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  MeshLambertMaterial,
  MeshStandardMaterial,
  ShaderLib,
  Vector3,
} from "three";

const { enemies } = await import("../src/run/sim/content/enemies.ts");
const { SITE } = await import("../src/run/sim/content/params/sites.ts");
const { SITE_POOLS } = await import("../src/run/sim/content/sites.ts");
const { WEATHER } = await import("../src/run/sim/content/params/field-events.ts");
const { shinyPalettes, shinyLook } = await import("../src/run/view/shiny.ts");
const { siteLook, createFieldSites } = await import("../src/run/view/fieldSites.ts");
const { fieldMarks, siteIcons } = await import("../src/run/view/fieldMapMarks.ts");
const { weatherStrength, createWeather } = await import("../src/run/view/weather.ts");
const { stageEnemyIds, stageSiteModels, siteModelUrl, siteSpecies } =
  await import("../src/run/view/assets.ts");
const { createWindUniforms } = await import("../src/run/view/environment/wind.ts");
const { stageThemes } = await import("../src/run/view/stageThemes.ts");

const site = (kind, state = "ready", extra = {}) => ({
  id: extra.id ?? 1,
  kind,
  x: extra.x ?? 0,
  z: extra.z ?? 0,
  radius: SITE.radius[kind],
  state,
  until: extra.until ?? 0,
  owner: null,
  data: { progress: 0, uses: 0, enemy: null, lastHurt: 0, ...extra.data },
});

test("every species has its own shiny colouring, not one shared tint", () => {
  for (const id of Object.keys(enemies)) assert.ok(shinyPalettes[id], `${id} 缺少异色配色`);
  const targets = new Set(
    Object.values(shinyPalettes).flatMap((palette) => [
      ...palette.swaps.map(([, to]) => to),
      ...(palette.grey ? [`g${palette.grey.hue}`] : []),
    ]),
  );
  assert.ok(targets.size >= 20, `only ${targets.size} target hues`);
  assert.deepEqual(shinyPalettes.gyarados.swaps[0].slice(0, 2), [215, 0], "red Gyarados");
  assert.equal(shinyPalettes.magikarp.swaps[0][1], 48, "gold Magikarp");
  const material = new MeshLambertMaterial();
  shinyLook(material, "voltorb");
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.lambert.vertexShader,
    fragmentShader: ShaderLib.lambert.fragmentShader,
  };
  material.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /uniform vec4 shinySwaps\[3\]/);
  assert.equal(
    shader.uniforms.shinySwaps.value[0].y,
    225 / 360,
    "the per-material palette reaches its program",
  );
});

test("each stage preloads every species and prop its sites can bring out", () => {
  for (const stage of Object.keys(SITE_POOLS)) {
    const ids = new Set(stageEnemyIds(stage));
    for (const kind of SITE_POOLS[stage])
      for (const species of siteSpecies[kind] ?? [])
        assert.ok(ids.has(species), `${stage} 缺少 ${species}`);
    for (const model of stageSiteModels(stage))
      assert.ok(existsSync(new URL(`../public${siteModelUrl(model)}`, import.meta.url)), model);
  }
  assert.ok(stageSiteModels("tower").includes("gengar-altar"));
  for (const kind of new Set(Object.values(SITE_POOLS).flat()))
    if (kind !== "glint" && kind !== "item-ball")
      assert.ok(
        existsSync(new URL(`../public${siteIcons[kind]}`, import.meta.url)),
        `${kind} 图标`,
      );
});

test("dormant and used-up sites never look available", () => {
  const dormant = siteLook(site("honey-tree", "dormant"), 10);
  assert.equal(dormant.rings.length, 0);
  assert.equal(dormant.emit, null);
  assert.ok(dormant.tone < 1);
  const spring = siteLook(site("spring", "spent"), 10);
  assert.ok(spring.show && spring.tone < 0.5 && spring.rings.length === 0 && spring.emit === null);
  for (const kind of ["item-ball", "egg", "glint", "silph-scope", "snorlax"])
    assert.equal(siteLook(site(kind, "spent"), 10).show, false, kind);
  assert.equal(siteLook(site("spring"), 10).rings[0].color, "#ffd45b");
});

test("site telegraphs follow the shared timers", () => {
  const honey = (time) => siteLook(site("honey-tree", "busy", { until: SITE.honeyDelay }), time);
  assert.ok(honey(1).shake < honey(7).shake, "the tree shakes harder before its visitor drops");
  assert.ok(Math.abs(honey(4).rings[0].fill - 0.5) < 1e-9);
  const trap = siteLook(
    site("item-ball", "busy", { until: 10, data: { trap: true } }),
    10 - SITE.balls.warning / 2,
  );
  assert.equal(trap.rings[0].radius, SITE.balls.blastRadius, "the warning marks the real blast");
  assert.ok(Math.abs(trap.rings[0].fill - 0.5) < 1e-9);
  assert.ok(trap.rings[0].wash > 0);
  // Before it goes off, a trap and a reward ball look the same.
  assert.deepEqual(
    siteLook(site("item-ball", "ready", { data: { trap: true } }), 3, 1),
    siteLook(site("item-ball"), 3, 1),
  );
  const fossil = siteLook(
    site("fossil", "ready", { data: { progress: SITE.fossilChannel / 4 } }),
    5,
  );
  assert.ok(
    fossil.rings.some((ring) => Math.abs(ring.fill - 0.25) < 1e-9),
    "kept digging progress shows",
  );
  const raid = siteLook(site("raid-den", "busy", { until: 40, data: { enemy: 9 } }), 10);
  assert.ok(Math.abs(raid.rings[0].fill - 30 / SITE.raid.seconds) < 1e-9, "the time limit drains");
  const glint = (time) => siteLook(site("glint", "ready", { id: 0 }), time).flash;
  assert.ok(glint(0.05) > 0.8 && glint(1) === 0 && glint(SITE.glintSeconds + 0.05) > 0.8);
  assert.equal(
    siteLook(site("snorlax", "busy", { data: { enemy: 3 } }), 1).show,
    false,
    "the sleeper becomes the enemy",
  );
});

test("maps show usable sites once per pad and never the glint", () => {
  const balls = [0, 1, 2].map((i) => site("item-ball", "ready", { id: 10 + i, x: 20 + i, z: 5 }));
  const world = {
    sites: [
      site("glint", "ready", { id: 1 }),
      site("spring", "dormant", { id: 2 }),
      site("egg", "spent", { id: 3 }),
      site("fishing", "busy", { id: 4, x: -10 }),
      site("item-ball", "busy", { id: 20, x: 40, data: { trap: true } }),
      ...balls,
    ],
  };
  const marks = fieldMarks(world);
  assert.deepEqual(
    marks.map(({ kind, ready }) => [kind, ready]),
    [
      ["fishing", false],
      ["item-ball", true],
    ],
  );
  assert.ok(Math.abs(marks[1].x - 21) < 1e-9);
});

test("glints remain discoverable when slow frames miss the flash peak", () => {
  const view = createFieldSites({}, () => 0, createWindUniforms(stageThemes.forest.clouds));
  const world = {
    time: 0,
    silphScope: false,
    enemies: [],
    players: [],
    sites: [site("glint", "ready", { id: 0 })],
  };
  const visibleCycles = new Set();
  try {
    for (let frame = 0; frame < 200; frame++) {
      world.time = 0.04 + frame / 20;
      view.frame(world, 1, world.time, 1 / 20);
      if (view.root.children.some((mesh) => mesh.isInstancedMesh && mesh.count > 0))
        visibleCycles.add(Math.floor(world.time / SITE.glintSeconds));
    }
    assert.equal(
      visibleCycles.size,
      5,
      "each two-second cycle is visible at 20 FPS with a 40ms phase offset",
    );
    world.sites[0].state = "spent";
    for (let frame = 0; frame < 60; frame++) {
      world.time += 1 / 20;
      view.frame(world, 1, world.time, 1 / 20);
    }
    assert.ok(
      view.root.children.every((mesh) => !mesh.isInstancedMesh || mesh.count === 0),
      "a collected glint stops advertising itself",
    );
  } finally {
    view.dispose();
  }
});

test("a forecast only tints the sky; the weather itself starts later", () => {
  const weather = { id: "rain", from: 100, until: 100 + WEATHER.seconds };
  assert.deepEqual(weatherStrength(weather, 90), { sky: 0, fall: 0 });
  const forecast = weatherStrength(weather, 100 - WEATHER.forecast / 2);
  assert.ok(forecast.sky > 0 && forecast.sky <= 0.35 && forecast.fall === 0);
  assert.deepEqual(weatherStrength(weather, 130), { sky: 1, fall: 1 });
  assert.deepEqual(weatherStrength(weather, weather.until), { sky: 0, fall: 0 });

  const fog = new Fog("#a0c0e0", 30, 80);
  const before = fog.color.clone();
  const background = new Color();
  const added = [];
  const hemi = new HemisphereLight("#fff", "#888", 1);
  const sun = new DirectionalLight("#fff", 2);
  assert.equal(
    createWeather("forest", { fog, background, hemi, sun, add: (m) => added.push(m) }, false),
    null,
  );
  const view = createWeather(
    "coast",
    { fog, background, hemi, sun, add: (m) => added.push(m) },
    true,
  );
  assert.equal(added.length, 1);
  view.frame(weather, 98, new Vector3(), 1 / 60);
  assert.ok(!fog.color.equals(before) && added[0].visible === false, "forecast: sky only");
  view.frame(weather, 130, new Vector3(), 1 / 60);
  assert.ok(added[0].visible && sun.intensity < 2);
  view.frame(null, 200, new Vector3(), 1 / 60);
  assert.ok(fog.color.equals(before) && sun.intensity === 2, "the stage's own sky returns");
  view.dispose();
});

test("site props follow state changes and free what they made", () => {
  const source = {
    geometry: new BoxGeometry(1, 1, 1),
    material: new MeshStandardMaterial(),
    height: 1,
  };
  const sources = Object.fromEntries(
    [
      "honey-tree",
      "item-ball",
      "fishing",
      "fossil",
      "raid-den",
      "spring",
      "egg",
      "gengar-altar",
      "snorlax",
    ].map((k) => [k, source]),
  );
  const view = createFieldSites(sources, () => 0, createWindUniforms(stageThemes.forest.clouds));
  const world = {
    time: 5,
    silphScope: false,
    enemies: [],
    players: [],
    sites: [
      site("honey-tree", "busy", { id: 1, until: 9 }),
      site("raid-den", "ready", { id: 2, x: 8 }),
      site("glint", "ready", { id: 3 }),
    ],
  };
  view.frame(world, 1, 1, 1 / 30);
  const visibleProps = view.root.children.filter(
    (child) => child.type === "Group" && child.visible,
  );
  assert.equal(visibleProps.length, 2, "the glint has no prop");
  world.sites[0].state = "spent";
  world.sites.pop();
  view.frame(world, 1, 1.1, 1 / 30);
  view.dispose();
  assert.equal(view.root.parent, null);
});
