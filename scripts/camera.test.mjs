import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraForward, cameraRight, turnYaw } from "../src/run/cameraYaw.ts";

const dot = ([ax, az], [bx, bz]) => ax * bx + az * bz;

test("turning right swings the view toward screen right, turning left toward screen left", () => {
  for (const yaw of [0, 1.3, -2.6]) {
    const right = cameraRight(yaw);
    assert.ok(dot(cameraForward(turnYaw(yaw, 1, 0.1)), right) > 0, `E at yaw ${yaw}`);
    assert.ok(dot(cameraForward(turnYaw(yaw, -1, 0.1)), right) < 0, `Q at yaw ${yaw}`);
  }
});
