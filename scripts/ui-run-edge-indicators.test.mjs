import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Container } from "@pmndrs/uikit";
import { PerspectiveCamera, Texture, Vector3 } from "three";
import { UiStage, setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { GpuEdgeIndicators } from "../src/ui/gpu/run-edge-indicators.ts";
import { formOf } from "../src/run/sim/evolution.ts";

const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
const paged = JSON.parse(readFileSync(new URL(manifest["ui-800"].json, core), "utf8"));
const font = {
  pages: [],
  pageTextures: paged.pages.map(() => new Texture()),
  pageSizes: paged.pageSizes,
  chars: paged.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
    id,
    char: String.fromCodePoint(id),
    page,
    x,
    y,
    width,
    height,
    xoffset,
    yoffset,
    xadvance,
  })),
  info: { size: paged.size },
  common: { lineHeight: paged.lineHeight },
  distanceField: { distanceRange: paged.distanceRange },
  kernings: [],
};
const safe = { left: 44, right: 0, top: 0, bottom: 21 };

async function fixture(width = 844, height = 390, scale = 0.8, insets = safe) {
  setUiPixelRatio(3);
  const stage = new UiStage();
  stage.resize(width, height, scale, insets);
  stage.root.setProperties({
    fontFamilies: { "Poketone UI": { 500: font, 800: font } },
    paddingLeft: Math.max(12, stage.viewport.safeArea.left),
    paddingTop: 12,
    paddingBottom: Math.max(12, stage.viewport.safeArea.bottom),
  });
  const world = {
    players: [0, 1].map((id) => ({
      id,
      starter: "charmander",
      stage: 0,
      px: 0,
      x: 0,
      pz: 0,
      z: 0,
      alive: true,
    })),
    enemies: [],
    map: { terrain: { origin: -100, resolution: 0.01, samples: 3, heights: new Float32Array(9) } },
  };
  const obstacles = [];
  const indicators = new GpuEdgeIndicators(stage, obstacles);
  world.players.forEach((player, index) => {
    indicators.players[index].form = formOf(player).id;
  });
  const camera = new PerspectiveCamera(42, width / height, 0.5, 120);
  camera.position.set(0, 16, 13);
  camera.lookAt(0, 0.6, 0);
  camera.updateMatrixWorld();
  await new Promise((resolve) => setTimeout(resolve, 50));
  function frame(alpha = 1, delta = 1 / 60) {
    indicators.update(world, 0, camera, alpha, delta, true);
    stage.update(delta * 1000);
  }
  function move(x, z) {
    Object.assign(world.players[1], { px: x, x, pz: z, z });
  }
  function center(marker = indicators.players[1]) {
    const m = marker.root.globalMatrix.value.elements;
    return { x: m[12] + stage.viewport.width / 2, y: stage.viewport.height / 2 - m[13] };
  }
  function dispose() {
    indicators.dispose();
    stage.dispose();
    setUiPixelRatio(1);
  }
  return { stage, world, indicators, camera, obstacles, frame, move, center, dispose };
}

function bounds(stage, size = 42) {
  const v = stage.viewport,
    radius = size / 2 + 15;
  return {
    left: Math.max(12, v.safeArea.left) + radius,
    right: v.width - Math.max(12, v.safeArea.right) - radius,
    top: Math.max(12, v.safeArea.top) + radius,
    bottom: v.height - Math.max(12, v.safeArea.bottom) - radius,
  };
}

function assertOnEdge(point, b, tolerance) {
  const cx = (b.left + b.right) / 2,
    cy = (b.top + b.bottom) / 2;
  const qx = Math.abs(point.x - cx) - (b.right - b.left) / 2 + 24;
  const qy = Math.abs(point.y - cy) - (b.bottom - b.top) / 2 + 24;
  const distance =
    Math.hypot(Math.max(0, qx), Math.max(0, qy)) + Math.min(Math.max(qx, qy), 0) - 24;
  assert.ok(
    Math.abs(distance) <= tolerance,
    `marker must stay on inset perimeter: ${JSON.stringify({ point, distance })}`,
  );
}

test("offscreen markers stay on the safe perimeter through motion and actual Yoga position updates", async () => {
  for (const [width, height, scale, insets] of [
    [1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 }],
    [844, 390, 0.8, safe],
    [667, 375, 1.5, safe],
  ]) {
    const f = await fixture(width, height, scale, insets);
    try {
      for (const [x, z] of [
        [40, 0],
        [-40, 0],
        [0, -80],
        [0, 80],
        [80, 80],
      ]) {
        f.move(x, z);
        for (let i = 0; i < 12; i++) {
          f.frame();
          const marker = f.indicators.players[1];
          assert.ok(marker.root.displayed.value);
          const actual = f.center();
          assert.ok(
            Math.abs(actual.x - marker.x) <= 1 / f.stage.pixelGrid,
            `positionLeft reaches Yoga: ${JSON.stringify({ actual, x: marker.x })}`,
          );
          assert.ok(
            Math.abs(actual.y - marker.y) <= 1 / f.stage.pixelGrid,
            "positionTop reaches Yoga",
          );
          assertOnEdge(actual, bounds(f.stage), 1 / f.stage.pixelGrid);
        }
      }
    } finally {
      f.dispose();
    }
  }
});

test("projection uses interpolated terrain positions and the live rotated camera, including behind it", async () => {
  const f = await fixture();
  f.world.map.terrain.heights.fill(2);
  try {
    for (const yaw of [0, 1.3, -2.6]) {
      f.camera.position.set(7 + Math.sin(yaw) * 13, 18, -3 + Math.cos(yaw) * 13);
      f.camera.lookAt(7, 2.6, -3);
      f.camera.updateMatrixWorld();
      for (const [x, z] of [
        [7, -3],
        [80, 0],
        [-80, 0],
        [0, 80],
        [0, -80],
      ]) {
        Object.assign(f.world.players[1], { px: x - 3, x, pz: z + 4, z });
        const player = f.world.players[1];
        const rise = formOf(player).height / 2;
        for (const alpha of [0, 0.5, 1]) {
          const point = new Vector3(
            player.px + (x - player.px) * alpha,
            2 + rise,
            player.pz + (z - player.pz) * alpha,
          );
          const view = point.clone().applyMatrix4(f.camera.matrixWorldInverse);
          const ndc = point.clone().project(f.camera);
          const projected = f.indicators.project(f.world, f.camera, point.x, point.z, rise);
          assert.equal(projected.front, view.z < -f.camera.near);
          if (Math.abs(view.z) >= f.camera.near) {
            const sign = view.z < 0 ? 1 : -1;
            assert.ok(Math.abs(projected.x - ndc.x * sign) < 1e-12);
            assert.ok(Math.abs(projected.y - ndc.y * sign) < 1e-12);
          }
          f.frame(alpha, 0.2);
          const onScreen = view.z < -f.camera.near && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
          assert.equal(
            f.indicators.names[1].displayed.value,
            onScreen,
            "nameplate visibility follows the rendered world",
          );
          assert.equal(f.indicators.players[1].root.displayed.value, !onScreen);
          assert.equal(
            f.indicators.players[0].root.displayed.value,
            false,
            "local player never gets an edge portrait",
          );
          if (!onScreen) assertOnEdge(f.center(), bounds(f.stage), 1 / f.stage.pixelGrid);
        }
      }
    }
  } finally {
    f.dispose();
  }
});

test("an asymmetric safe area still reaches the far rounded corner along the projected ray", async () => {
  const f = await fixture();
  try {
    const { width, height } = f.stage.viewport;
    const ndc = new Vector3(2, (2 * width * Math.tan((20.7 * Math.PI) / 180)) / height, 0.5);
    const ray = ndc.clone().unproject(f.camera).sub(f.camera.position);
    const rise = formOf(f.world.players[1]).height / 2;
    const point = ray.multiplyScalar((rise - f.camera.position.y) / ray.y).add(f.camera.position);
    f.move(point.x, point.z);
    f.frame();
    const actual = f.center();
    assertOnEdge(actual, bounds(f.stage), 1 / f.stage.pixelGrid);
    const dx = actual.x - width / 2,
      dy = actual.y - height / 2;
    const angle = Math.atan2(-ndc.y * height, ndc.x * width);
    assert.ok(
      Math.abs(dx * Math.sin(angle) - dy * Math.cos(angle)) <= 1 / f.stage.pixelGrid,
      "actual marker center stays on the world projection ray",
    );
  } finally {
    f.dispose();
  }
});

test("crossing the camera plane keeps the direction finite and does not mirror behind-camera targets", async () => {
  const f = await fixture();
  try {
    f.camera.position.set(0, formOf(f.world.players[1]).height / 2, 0);
    f.camera.lookAt(0, f.camera.position.y, -1);
    f.camera.updateMatrixWorld();
    for (const z of [-2, -0.51, -0.49, 0, 0.49, 0.51, 2]) {
      f.move(40, z);
      f.frame();
      const actual = f.center();
      assertOnEdge(actual, bounds(f.stage), 1 / f.stage.pixelGrid);
      assert.ok(
        actual.x > f.stage.viewport.width / 2,
        "right-hand target stays on the right across the camera plane",
      );
      const arrow = f.indicators.players[1].arrow.globalMatrix.value.elements;
      assert.ok(
        arrow[12] > f.indicators.players[1].root.globalMatrix.value.elements[12],
        "actual chevron transform points right",
      );
    }
  } finally {
    f.dispose();
  }
});

test("entering view fades the portrait in place, and returning offscreen resets its location", async () => {
  const f = await fixture();
  try {
    f.move(40, 0);
    f.frame(1, 0.2);
    const initial = f.center();
    f.move(0, 0);
    f.frame(1, 0.05);
    const fading = f.center();
    const marker = f.indicators.players[1];
    assert.ok(f.indicators.names[1].displayed.value);
    assert.ok(marker.root.displayed.value);
    assert.ok(marker.root.properties.value.opacity > 0 && marker.root.properties.value.opacity < 1);
    assert.ok(Math.hypot(fading.x - initial.x, fading.y - initial.y) <= 1 / f.stage.pixelGrid);
    f.frame(1, 0.15);
    assert.equal(marker.root.displayed.value, false);
    f.move(-40, -40);
    f.frame();
    assert.equal(f.indicators.names[1].displayed.value, false);
    assertOnEdge(f.center(), bounds(f.stage), 1 / f.stage.pixelGrid);
    assert.ok(
      f.center().x < f.stage.viewport.width / 2,
      "reappearing portrait starts at the new target edge",
    );

    // Resize while a portrait is fading: its old pixel position must not outlive the viewport.
    f.move(0, 0);
    f.stage.resize(667, 375, 1.5, safe);
    f.frame(1, 0.005);
    assertOnEdge(f.center(), bounds(f.stage), 1 / f.stage.pixelGrid);
  } finally {
    f.dispose();
  }
});

test("HUD obstacles and the stick reserve are avoided using their actual layout bounds", async () => {
  const f = await fixture();
  const { width, height } = f.stage.viewport;
  for (const properties of [
    { positionLeft: 0, positionTop: 0, width, height: 80 },
    { positionLeft: width - 180, positionTop: 80, width: 180, height: 140 },
    { positionLeft: width / 3, positionBottom: 0, width: (width * 2) / 3, height: 90 },
  ]) {
    const node = new Container({ positionType: "absolute", ...properties });
    f.stage.root.add(node);
    f.obstacles.push(node);
  }
  f.stage.update(16);
  try {
    for (let i = 0; i < 72; i++) {
      const angle = (i * Math.PI) / 36;
      f.move(Math.cos(angle) * 80, Math.sin(angle) * 80);
      f.frame(1, 0.2);
      const actual = f.center(),
        radius = 42 / 2 + 15;
      assertOnEdge(actual, bounds(f.stage), 1 / f.stage.pixelGrid);
      for (const node of f.obstacles) {
        const m = node.globalMatrix.value.elements,
          size = node.size.value;
        const dx = Math.abs(actual.x - (m[12] + width / 2));
        const dy = Math.abs(actual.y - (height / 2 - m[13]));
        assert.ok(
          dx + 1 / f.stage.pixelGrid >= radius + size[0] / 2 ||
            dy + 1 / f.stage.pixelGrid >= radius + size[1] / 2,
          "portrait clears the actual HUD layout",
        );
      }
      assert.ok(
        actual.x - radius >=
          Math.max(f.stage.viewport.safeArea.left + 170, width * 0.25) - 1 / f.stage.pixelGrid ||
          actual.y + radius <= height - 180 + 1 / f.stage.pixelGrid,
        "portrait clears the reserved touch region",
      );
    }
  } finally {
    f.dispose();
  }
});

test("a downed teammate keeps an urgent locator until revival or departure", async () => {
  const f = await fixture();
  try {
    f.move(60, 0);
    const mate = f.world.players[1];
    const marker = f.indicators.players[1];
    mate.alive = false;
    f.frame(1, 0.2);
    assert.ok(marker.root.displayed.value);
    assert.ok(marker.danger.displayed.value);
    assert.ok(marker.halo.displayed.value);
    assertOnEdge(f.center(), bounds(f.stage), 1 / f.stage.pixelGrid);
    mate.alive = true;
    f.frame(1, 0.2);
    assert.ok(marker.root.displayed.value, "living offscreen teammate remains locatable");
    assert.equal(marker.danger.displayed.value, false);
    assert.equal(marker.halo.displayed.value, false);
    mate.alive = false;
    mate.departed = true;
    f.frame(1, 0.2);
    assert.equal(marker.root.displayed.value, false, "a departed seat needs no rescue");
  } finally {
    f.dispose();
  }
});
