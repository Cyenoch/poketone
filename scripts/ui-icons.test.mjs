import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { labItems } from "../src/run/lab.ts";
import { itemIds } from "../src/run/sim/content/items.ts";
import { formDefs, starters } from "../src/run/sim/content/lines/index.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { stationNames } from "../src/run/sim/content/stations.ts";
import { itemIcon, moveIcon, stationIcon } from "../src/screens/runArt.ts";
import { cardFaces } from "../src/ui/gpu/run-choice-surface.ts";

const missing = (paths) => paths.filter((path) => !existsSync(`public${path}`));

// An image the UI asks for and cannot load fails the surface that waits for it (`images.uploaded`), and
// with it the whole UI: every id the content can show needs its file.
test("every item, lab upgrade and station has its icon file", () => {
  assert.deepEqual(missing([...itemIds, "tm-case", "oran-berry"].map(itemIcon)), []);
  assert.deepEqual(missing(labItems.map((item) => `/art/icons/lab/${item.id}.webp`)), []);
  assert.deepEqual(missing(Object.keys(stationNames).map(stationIcon)), []);
});

test("every move, form portrait and starter ultimate has its art file", () => {
  assert.deepEqual(missing(Object.keys(moves).map(moveIcon)), []);
  assert.deepEqual(missing(Object.keys(formDefs).map((form) => `/art/portraits/${form}.webp`)), []);
  assert.deepEqual(
    missing(Object.keys(starters).map((starter) => `/art/icons/ultimates/${starter}.webp`)),
    [],
  );
});

test("every registered card face and playable form type has its art file", () => {
  for (const move of Object.values(moves))
    assert.ok(cardFaces.has(move.type), `card face: ${move.type}`);
  assert.deepEqual(
    missing([...cardFaces, "item", "train"].map((type) => `/art/cards/${type}.webp`)),
    [],
  );
  const formTypes = new Set(Object.values(formDefs).flatMap((form) => form.types));
  assert.deepEqual(missing([...formTypes].map((type) => `/art/icons/crests/${type}.webp`)), []);
});
