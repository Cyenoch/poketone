import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@pmndrs/uikit";
import { fade, inheritedOpacity, stack } from "../src/ui/gpu/layer.ts";
import { UiStage } from "../src/ui/gpu/stage.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

test("a stacked child stays above a raised ancestor, also when attached before the ancestor is raised", async () => {
  const stage = new UiStage();
  stage.resize(400, 300);
  const root = stage.root;
  const button = new Container({ width: 44, height: 44, backgroundColor: "#0d233f" });
  const badge = stack(new Container({ width: 20, height: 12, backgroundColor: "#d8effb" }), 1);
  button.add(badge);
  root.add(button);
  await settle();
  assert.equal(badge.orderInfo.value?.majorIndex, 1);
  button.setProperties({ zIndex: 30 });
  await settle();
  assert.equal(button.orderInfo.value?.majorIndex, 30);
  assert.equal(badge.orderInfo.value?.majorIndex, 31, "the badge must draw over the raised button");
  const behind = stack(new Container({ width: 10, height: 10 }), -1);
  button.add(behind);
  await settle();
  assert.equal(
    behind.orderInfo.value?.majorIndex,
    29,
    "a negative layer sits under its parent only",
  );
  stage.dispose();
});

test("a child with its own opacity still fades with its window", async () => {
  const stage = new UiStage();
  stage.resize(400, 300);
  const window = new Container({ width: 200, height: 100, backgroundColor: "#ffffff" });
  const crest = fade(new Container({ width: 40, height: 40, backgroundColor: "#ffd45b" }), 0.28);
  const label = new Container({ width: 40, height: 20 });
  window.add(crest, label);
  stage.root.add(window);
  await settle();
  assert.equal(inheritedOpacity(crest), 0.28);
  fade(window, 0.5);
  await settle();
  assert.equal(inheritedOpacity(label), 0.5);
  assert.equal(inheritedOpacity(crest), 0.14);
  fade(window, 0);
  await settle();
  assert.equal(inheritedOpacity(crest), 0, "nothing may linger once the window is invisible");
  stage.dispose();
});

test("fading a window keeps its children's draw order, and restacking replaces the layer", async () => {
  const stage = new UiStage();
  stage.resize(400, 300);
  const window = stack(new Container({ width: 200, height: 100, backgroundColor: "#ffffff" }), 20);
  const plate = fade(
    stack(new Container({ width: 40, height: 40, backgroundColor: "#ffd45b" }), 1),
    1,
  );
  window.add(plate);
  stage.root.add(window);
  await settle();
  const order = plate.orderInfo.value;
  for (const opacity of [0.8, 0.5, 0.2]) {
    fade(window, opacity);
    await settle();
  }
  assert.equal(inheritedOpacity(plate), 0.2);
  assert.equal(
    plate.orderInfo.value,
    order,
    "a fade must not re-sort (and re-instance) the subtree",
  );
  stack(plate, 3);
  await settle();
  assert.equal(plate.orderInfo.value?.majorIndex, 23);
  plate.setProperties({ zIndex: 0, opacity: 1 });
  await settle();
  assert.equal(plate.orderInfo.value?.majorIndex, 23, "own properties cannot undo the layer");
  assert.equal(inheritedOpacity(plate), 0.2);
  stage.dispose();
});
