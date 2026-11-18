import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Texture } from "three";
import { Component, Image, Text } from "@pmndrs/uikit";
import { setImageLoader } from "@pmndrs/uikit/dist/components/image.js";
import { installResources } from "../src/platform/resources.ts";
import { installRuntime } from "../src/platform/runtime.ts";
import { bindImages } from "../src/prepare/images.ts";
import { emptyProgress } from "../src/run/progress.ts";
import { GpuLab } from "../src/ui/gpu/lab.ts";
import { setUiPixelRatio } from "../src/ui/gpu/stage.ts";
import { fitScale } from "../src/ui/gpu/viewport.ts";
import { researchGroups } from "../src/run/codex.ts";
import { badgeIds } from "../src/run/sim/content/badges.ts";

// Real Yoga and committed glyph metrics, without raster decoding or GPU uploads: the 研究所's
// navigation between its room, its places and the 图鉴 at the two reference sizes.
const core = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
const textures = [];
function font(key) {
  const p = JSON.parse(readFileSync(new URL(manifest[key].json, core), "utf8"));
  const pageTextures = p.pages.map(() => new Texture());
  textures.push(...pageTextures);
  return {
    pages: p.pages,
    pageSizes: p.pageSizes,
    pageTextures,
    chars: p.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
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
    info: { size: p.size },
    common: { lineHeight: p.lineHeight },
    distanceField: { distanceRange: p.distanceRange },
    kernings: [],
  };
}
const fonts = {
  "Poketone UI": { 500: font("ui-500"), 700: font("ui-700"), 800: font("ui-800") },
  "Poketone Display": { 400: font("display") },
};

async function settle(lab) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (let frame = 0; frame < 40; frame++) {
    lab.stage.update(16);
    lab.afterLayout(16);
  }
}
const focused = (lab) => lab.controls[lab.focused];
const of = (lab, kind, key) =>
  lab.controls.findIndex((c) => c.kind === kind && (key === undefined || c.key === key));

function install() {
  installRuntime({ createAudioDecoder: () => ({}), activateAudio() {} });
  setImageLoader(() => new Promise(() => {}));
  installResources({ read: () => new Promise(() => {}), createTexture: () => new Texture() });
  bindImages({
    generation: 0,
    available: false,
    subscribe: () => () => {},
    enqueue() {},
    upload() {},
    resident: () => () => {},
  });
}
const callbacks = { buy() {}, archive() {}, codex() {}, back() {}, settings() {} };
const texts = (panel) => {
  const out = [];
  panel.traverse((node) => {
    if (node instanceof Text) out.push(String(node.properties.value.text ?? ""));
  });
  return out;
};

test("the 研究所: places by page keys, species to the 图鉴 and back, back to the room first", async () => {
  install();
  try {
    for (const { width, height, dpr, safe } of [
      { width: 1280, height: 800, dpr: 1, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
      { width: 844, height: 390, dpr: 3, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
      { width: 760, height: 320, dpr: 2, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
    ]) {
      const where = `${width}×${height}`;
      setUiPixelRatio(dpr);
      const progress = {
        ...emptyProgress(),
        dex: { weedle: { seen: 3, defeated: 2, shiny: 0 } },
        badges: ["boulder"],
      };
      const opened = [];
      let left = 0;
      const callbacks = {
        buy() {},
        archive() {},
        codex: (key, at) => opened.push({ key, at }),
        back: () => left++,
        settings() {},
      };
      const lab = new GpuLab(fonts, new Texture(), progress, callbacks);
      try {
        lab.resize(width, height, 1, safe);
        await settle(lab);

        // The room: its three places, each one a touch target.
        const spots = lab.controls.filter((c) => c.kind === "spot");
        assert.deepEqual(
          spots.map((c) => c.key),
          ["shelf", "bench", "badges"],
          where,
        );
        for (const spot of spots) {
          const [w, h] = spot.panel.size.value;
          assert.ok(w >= 44 && h >= 44, `${where}: ${spot.key} is ${w}×${h}`);
        }

        // Page keys go round the places; ← → on the segments switch the place.
        lab.navigate("nextPage");
        await settle(lab);
        assert.equal(focused(lab).key, "shelf", where);
        lab.navigate("previousPage");
        assert.equal(focused(lab).key, "badges", `${where}: shelf ← badges`);
        lab.navigate("left");
        assert.equal(focused(lab).key, "bench", `${where}: ← opens the bench`);
        lab.navigate("nextPage");
        lab.navigate("nextPage");
        await settle(lab);
        assert.equal(focused(lab).key, "shelf", `${where}: badges → shelf`);

        // Into the shelf's research: from the binder, → reaches a species, not the segments.
        lab.focus(of(lab, "spine", "research"));
        lab.navigate("right");
        assert.equal(focused(lab).kind, "cell", `${where}: → from the binder`);
        lab.focus(of(lab, "cell", "weedle"));
        lab.navigate("confirm");
        assert.deepEqual(
          opened.at(-1),
          { key: "enemy:weedle", at: { place: "shelf", binder: "research", key: "weedle" } },
          where,
        );

        // Back: the place returns to the room, the room to the lobby.
        lab.navigate("cancel");
        await settle(lab);
        assert.equal(focused(lab).kind, "spot", `${where}: back to the room`);
        assert.equal(focused(lab).key, "shelf", `${where}: on the place left`);
        assert.equal(left, 0, where);
        lab.navigate("cancel");
        assert.equal(left, 1, `${where}: the room's back leaves`);
      } finally {
        lab.dispose();
      }

      // Coming back from the 图鉴 reopens the shelf on that species.
      const back = new GpuLab(fonts, new Texture(), progress, callbacks, opened.at(-1).at);
      try {
        back.resize(width, height, 1, safe);
        // The host offers fullscreen on mount; the new control must not drop the species' focus.
        back.setFullscreenAction(() => {}, false);
        await settle(back);
        assert.equal(focused(back).kind, "cell", where);
        assert.equal(focused(back).key, "weedle", `${where}: the species left`);
      } finally {
        back.dispose();
      }
    }
  } finally {
    for (const texture of textures) texture.dispose();
  }
});

test("every 研究所 control stays a 44 px touch target at 80% UI scale, down to the minimum layout", async () => {
  install();
  try {
    for (const { width, height, dpr, safe } of [
      { width: 1280, height: 800, dpr: 1, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
      { width: 844, height: 390, dpr: 3, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
      { width: 760, height: 320, dpr: 2, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
    ]) {
      setUiPixelRatio(dpr);
      const progress = {
        ...emptyProgress(),
        dex: { weedle: { seen: 3, defeated: 2, shiny: 0 } },
        badges: ["boulder"],
        lab: { archive: 1 },
      };
      const lab = new GpuLab(fonts, new Texture(), progress, callbacks);
      const scale = fitScale(0.8, width, height, safe, lab.minLayout);
      const check = (where) => {
        for (const control of lab.controls) {
          const [w, h] = control.panel.size.value.map((side) => side * scale);
          assert.ok(
            w >= 44 - 1e-6 && h >= 44 - 1e-6,
            `${width}×${height} ${where}: ${control.kind} ${control.key ?? ""} is ${w.toFixed(1)}×${h.toFixed(1)} px`,
          );
        }
      };
      try {
        lab.resize(width, height, scale, safe);
        await settle(lab);
        check("room");
        lab.open("shelf");
        await settle(lab);
        check("research");
        lab.activate(of(lab, "spine", "unlocks"));
        await settle(lab);
        check("unlocks");
        lab.activate(of(lab, "spine", "bonds"));
        await settle(lab);
        check("bonds");
        lab.open("bench");
        await settle(lab);
        lab.activate(of(lab, "drawer"));
        await settle(lab);
        check("bench with the drawer open");
        lab.open("badges");
        await settle(lab);
        check("badges");
      } finally {
        lab.dispose();
      }
    }
  } finally {
    for (const texture of textures) texture.dispose();
  }
});

test("an imported save rebuilds the open 研究所 and keeps focus on the same control", async () => {
  install();
  try {
    setUiPixelRatio(3);
    const safe = { left: 47, right: 47, top: 0, bottom: 21 };
    const before = { ...emptyProgress(), dex: { weedle: { seen: 3, defeated: 2, shiny: 0 } } };
    const done = { seen: 99999, defeated: 99999, shiny: 0 };
    const imported = {
      ...emptyProgress(),
      dex: { weedle: done, caterpie: { seen: 1, defeated: 0, shiny: 0 } },
      badges: badgeIds.slice(0, 2),
    };
    const total = researchGroups().flatMap((group) => group.species).length;
    const lab = new GpuLab(fonts, new Texture(), before, callbacks);
    try {
      lab.resize(844, 390, 1, safe);
      await settle(lab);
      const shelfCount = () => texts(lab.controls[of(lab, "spot", "shelf")].panel);
      assert.ok(shelfCount().includes(`0/${total}`), shelfCount().join(" "));
      assert.equal(lab.holes.length, 0);

      // The room: the shelf's count and the case's medals follow the import.
      lab.update(imported);
      await settle(lab);
      assert.ok(shelfCount().includes(`1/${total}`), shelfCount().join(" "));
      assert.equal(lab.holes.length, 2, "both imported badges sit in the case");

      // An open binder: names and checks follow; focus stays on the species it was on.
      lab.update(before);
      lab.open("shelf");
      await settle(lab);
      lab.focus(of(lab, "cell", "weedle"));
      const cell = (id) => lab.controls[of(lab, "cell", id)].panel;
      assert.ok(texts(cell("caterpie")).includes("？？？"));
      lab.update(imported);
      await settle(lab);
      assert.equal(focused(lab).kind, "cell");
      assert.equal(focused(lab).key, "weedle", "focus stays on its species");
      assert.ok(texts(cell("caterpie")).includes("绿毛虫"), "a species met in the import is named");
    } finally {
      lab.dispose();
    }
  } finally {
    for (const texture of textures) texture.dispose();
  }
});

test("the 羁绊 binder: one node per partner, sealed below bond Lv.3, bought like any node", async () => {
  install();
  try {
    for (const { width, height, dpr, safe } of [
      { width: 1280, height: 800, dpr: 1, safe: { left: 0, right: 0, top: 0, bottom: 0 } },
      { width: 844, height: 390, dpr: 3, safe: { left: 47, right: 47, top: 0, bottom: 21 } },
    ]) {
      const where = `${width}×${height}`;
      setUiPixelRatio(dpr);
      // Charmander's bond is Lv.3 (信赖), Squirtle's Lv.2.
      const progress = {
        ...emptyProgress(),
        stardust: 1000,
        bonds: { charmander: 60, squirtle: 30 },
      };
      const bought = [];
      const lab = new GpuLab(fonts, new Texture(), progress, {
        ...callbacks,
        buy: (id) => bought.push(id),
      });
      try {
        lab.resize(width, height, 1, safe);
        await settle(lab);
        lab.open("shelf");
        await settle(lab);
        const spine = of(lab, "spine", "bonds");
        assert.equal(lab.controls[spine].locked(), false, `the binder opens: ${where}`);
        lab.activate(spine);
        await settle(lab);
        const tiles = lab.controls.filter((c) => c.kind === "tile");
        assert.equal(tiles.length, 9, `a node per partner: ${where}`);
        assert.ok(
          tiles.every((c) => c.key.startsWith("bond-")),
          where,
        );

        const sealed = tiles.find((c) => c.key === "bond-squirtle");
        assert.equal(sealed.locked(), true, where);
        assert.equal(sealed.tip(), "羁绊 Lv.3", where);
        assert.ok(texts(sealed.panel).includes("Lv.3"), `the price says the level: ${where}`);
        lab.activate(lab.controls.indexOf(sealed));
        assert.deepEqual(bought, [], `a sealed node is not bought: ${where}`);

        const open = tiles.find((c) => c.key === "bond-charmander");
        assert.equal(open.locked(), false, where);
        assert.equal(open.tip(), null, where);
        assert.ok(texts(open.panel).includes("小火龙"), `named after the partner: ${where}`);
        lab.activate(lab.controls.indexOf(open));
        assert.deepEqual(bought, ["bond-charmander"], `bought through buy: ${where}`);

        // Two to a row with equal widths, reachable by direction from the spine.
        const [a, b] = [tiles[0].panel.size.value[0], tiles[1].panel.size.value[0]];
        assert.ok(Math.abs(a - b) < 0.5, `equal columns: ${where}`);
        assert.ok(
          Math.abs(
            tiles[0].panel.globalMatrix.value.elements[13] -
              tiles[1].panel.globalMatrix.value.elements[13],
          ) < 0.5,
          `two to a row: ${where}`,
        );
        lab.focus(spine);
        lab.navigate("right");
        assert.equal(focused(lab).kind, "tile", `→ from the spine enters the nodes: ${where}`);
      } finally {
        lab.dispose();
      }
    }
  } finally {
    setUiPixelRatio(1);
  }
});

test("leaving a 研究所 binder disposes its whole subtree, portraits included", async () => {
  install();
  const progress = { ...emptyProgress(), bonds: { charmander: 60 } };
  const lab = new GpuLab(fonts, new Texture(), progress, callbacks);
  // Every component under the shown tiles, down to each partner's portrait.
  const shown = () => {
    const out = [];
    for (const c of lab.controls.filter((c) => c.kind === "tile"))
      c.panel.traverse((node) => {
        if (node instanceof Component) out.push(node);
      });
    return out;
  };
  try {
    lab.resize(1280, 800, 1, { left: 0, right: 0, top: 0, bottom: 0 });
    await settle(lab);
    lab.open("shelf");
    await settle(lab);
    lab.activate(of(lab, "spine", "bonds"));
    await settle(lab);
    const bonds = shown();
    assert.ok(
      bonds.some((node) => node instanceof Image),
      "the bond tiles hold portraits",
    );

    lab.activate(of(lab, "spine", "unlocks"));
    await settle(lab);
    assert.equal(
      bonds.filter((node) => !node.abortSignal.aborted).length,
      0,
      "switching binder disposes the 羁绊 tiles",
    );

    const unlocks = shown();
    lab.navigate("cancel");
    await settle(lab);
    assert.equal(
      unlocks.filter((node) => !node.abortSignal.aborted).length,
      0,
      "back to the room disposes the open binder",
    );
  } finally {
    lab.dispose();
  }
});
