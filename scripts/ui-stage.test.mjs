import assert from "node:assert/strict";
import test from "node:test";
import { Container } from "@pmndrs/uikit";
import { UiStage } from "../src/ui/gpu/stage.ts";

test("a panel requested during layout is rendered when its instance becomes ready", async () => {
  const stage = new UiStage();
  const panel = new Container({ width: 200, height: 100, backgroundColor: "red" });
  stage.root.add(panel);
  stage.resize(800, 600);
  // Yoga initializes asynchronously, as it does in the browser.
  await new Promise((resolve) => setTimeout(resolve, 100));
  let painted = false;
  const renderer = {
    toneMapping: 0,
    localClippingEnabled: false,
    autoClear: true,
    setTransparentSort() {},
    clearDepth() {},
    render(scene) {
      scene.traverse((object) => {
        if (object.isInstancedMesh && object.visible && object.count > 0) painted = true;
      });
    },
  };
  for (let frame = 0; frame < 8; frame++) {
    if (stage.update(16)) stage.render(renderer);
  }
  assert.ok(painted, "the stationary panel must become visible without a pointer event");
  assert.equal(stage.update(16), false, "stationary UI must stop requesting GPU draws");
  stage.dispose();
});
