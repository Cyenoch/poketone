import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@pmndrs/uikit";
import { setUiPixelRatio, UiStage } from "../src/ui/gpu/stage.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("DPI changes resnap unchanged layout independently for each stage", async () => {
  const stages = [new UiStage(), new UiStage()];
  const panels = stages.map(() => new Container({ width: 10.3, height: 20 }));
  try {
    for (const [index, stage] of stages.entries()) {
      stage.resize(800, 200, index === 0 ? 1 : 0.8);
      stage.root.setProperties({ flexGrow: 3 });
      stage.root.add(panels[index]);
    }
    await settle();
    for (const ratio of [1, 2, 1.25, 1]) {
      setUiPixelRatio(ratio);
      for (const [index, stage] of stages.entries()) {
        assert.equal(stage.update(0), true, "a new grid must request a draw");
        const grid = stage.pixelGrid;
        assert.ok(Math.abs(panels[index].size.value[0] - Math.round(10.3 * grid) / grid) < 1e-6);
        assert.equal(stage.root.properties.value.flexGrow, 3, "authored layout stays intact");
      }
      // A property change after the other stage ran must still use this stage's grid.
      panels[0].setProperties({ height: ratio + 20 });
      stages[0].update(0);
      assert.ok(Math.abs(panels[0].size.value[0] - Math.round(10.3 * ratio) / ratio) < 1e-6);
    }
    for (const stage of stages) {
      for (let frame = 0; frame < 8; frame++) stage.update(16);
      assert.equal(stage.update(16), false, "unchanged grids must settle");
    }
  } finally {
    for (const stage of stages) stage.dispose();
    setUiPixelRatio(1);
  }
});

test("border authoring survives rounding, replacement, cloning and moves between stages", async () => {
  setUiPixelRatio(1);
  const stage = new UiStage();
  const other = new UiStage();
  const panel = new Container({ width: 60, height: 40, borderWidth: 1.4 });
  try {
    stage.resize(800, 200);
    other.resize(800, 200, 1.5);
    stage.root.add(panel);
    await settle();
    const border = () => panel.borderInset.value[0];
    stage.update(0);
    assert.equal(border(), 1);
    panel.setProperties({ backgroundColor: "red" });
    setUiPixelRatio(2);
    stage.update(0);
    assert.equal(border(), 1.5, "unrelated updates retain the original 1.4-unit border");

    // An author can intentionally replace 1.4 with its current rendered value, 1.5.
    panel.setProperties({ borderWidth: 1.5 });
    setUiPixelRatio(1);
    stage.update(0);
    assert.equal(border(), 2);

    other.root.add(panel);
    other.update(0);
    assert.ok(Math.abs(border() - 4 / 3) < 1e-6, "moving stages uses the new grid");
    const clone = panel.clone();
    stage.root.add(clone);
    stage.update(0);
    assert.equal(clone.borderInset.value[0], 2, "clones retain authored, not rounded widths");

    panel.resetProperties({ width: 60, height: 40, borderTopWidth: 0.2, borderXWidth: 2.2 });
    other.update(0);
    assert.ok(Math.abs(border() - 2 / 3) < 1e-6, "positive hairlines occupy one device pixel");
    assert.ok(Math.abs(panel.borderInset.value[1] - 2) < 1e-6);
    assert.equal(panel.borderInset.value[2], 0, "reset removes the old border alias");
    panel.setProperties({ borderTopWidth: 0, borderXWidth: undefined });
    other.update(0);
    assert.deepEqual(panel.borderInset.value, [0, 0, 0, 0]);
  } finally {
    stage.dispose();
    other.dispose();
    setUiPixelRatio(1);
  }
});

// The pause buttons: two growing halves with a gap. Yoga's own rounding (relative positions and
// absolute sizes rounded separately) ended one a device pixel past the row's content box whenever
// the row sat half a pixel or more off the grid; uikit now snaps every edge on its own.
test("children stay inside their parent's content box once edges snap to the grid", async () => {
  const grid = 1.9375; // 0.96875 fitted scale × 2 DPR
  setUiPixelRatio(grid);
  const stage = new UiStage();
  stage.resize(800, 200);
  const row = new Container({ flexDirection: "row", flexWrap: "wrap", paddingX: 18, gap: 8 });
  const halves = [0, 1].map(
    () => new Container({ width: "48%", flexGrow: 1, flexShrink: 0, height: 50 }),
  );
  row.add(...halves);
  stage.root.setProperties({ flexDirection: "row", alignItems: "flex-start" });
  stage.root.add(row);
  await settle();
  const past = [];
  for (const offset of [0, 0.25, 0.5, 0.75].map((pixels) => pixels / grid))
    for (let i = 0; i < 300; i++) {
      const width = 380 + i * 0.37;
      stage.root.setProperties({ paddingLeft: offset });
      row.setProperties({ width });
      stage.update(0);
      const [rowWidth] = row.size.value;
      const contentRight = rowWidth / 2 - row.paddingInset.value[1];
      for (const half of halves) {
        const right = half.relativeCenter.value[0] + half.size.value[0] / 2;
        if ((right - contentRight) * grid > 0.01) past.push(`offset ${offset} width ${width}`);
      }
    }
  stage.dispose();
  setUiPixelRatio(1);
  assert.deepEqual(past, []);
});
