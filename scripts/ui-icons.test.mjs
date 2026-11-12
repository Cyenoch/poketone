import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { labItems } from "../src/run/lab.ts";
import { itemIds } from "../src/run/sim/content/items.ts";
import { stationNames } from "../src/run/sim/content/stations.ts";
import { itemIcon, stationIcon } from "../src/screens/runArt.ts";

const missing = (paths) => paths.filter((path) => !existsSync(`public${path}`));

// A missing icon renders as a blank square in the HUD, cards and 图鉴 instead of failing.
test("every item, lab upgrade and station has its icon file", () => {
  assert.deepEqual(missing([...itemIds, "tm-case", "oran-berry"].map(itemIcon)), []);
  assert.deepEqual(missing(labItems.map((item) => `/art/icons/lab/${item.id}.webp`)), []);
  assert.deepEqual(missing(Object.keys(stationNames).map(stationIcon)), []);
});
