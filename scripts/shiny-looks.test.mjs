import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { encode } from "../src/network/codec.ts";
import { emptyProgress, recordRun, setShinyLook } from "../src/run/progress.ts";
import { snapshotWorld } from "../src/run/sim/snapshot.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";

const result = (dex) => ({
  zones: 0,
  danger: 0,
  outcome: "defeat",
  starter: "charmander",
  difficulty: 0,
  time: 300,
  level: 10,
  kills: 20,
  dex,
  stardust: 10,
  moves: [],
  items: [],
});
const shinyDefeat = { seen: 1, defeated: 1, shiny: 1 };

test("击败异色鬼斯通获得鬼斯系列外观，再次结算该系列不重复授予", () => {
  const first = recordRun(emptyProgress(), result({ haunter: shinyDefeat }));
  assert.deepEqual(first.looks.owned, ["gastly"]);
  assert.deepEqual(first.looks.worn, [], "获得后由玩家自行穿戴");
  const worn = setShinyLook(first, "gastly", true);
  const next = recordRun(worn, result({ gastly: shinyDefeat }));
  assert.deepEqual(next.looks, { owned: ["gastly"], worn: ["gastly"] });
  assert.deepEqual(setShinyLook(next, "gastly", false).looks, { owned: ["gastly"], worn: [] });
});

test("击败非伙伴系列的异色只记图鉴，普通伙伴形态也不授予外观", () => {
  const progress = recordRun(
    emptyProgress(),
    result({ caterpie: shinyDefeat, gastly: { seen: 1, defeated: 1, shiny: 0 } }),
  );
  assert.deepEqual(progress.dex.caterpie, shinyDefeat);
  assert.deepEqual(progress.looks.owned, []);
});

test("未拥有的异色外观不能穿戴", () => {
  const progress = emptyProgress();
  assert.throws(() => setShinyLook(progress, "gastly", true), /未拥有/);
  assert.deepEqual(progress.looks.worn, []);
});

test("同种子、同操作的普通与异色伙伴产生相同世界摘要", () => {
  const digest = (shiny) => {
    const world = createWorld({
      mode: "expedition",
      rules: [],
      seed: 7,
      stage: "forest",
      difficulty: 0,
      players: [{ trainer: "chengxi", starter: "gastly", shiny }],
    });
    const hash = createHash("sha256").update(encode(snapshotWorld(world)));
    for (let tick = 0; tick < 240; tick++)
      stepWorld(world, [{ t: "move", player: 0, x: tick < 120 ? 1 : -1, z: 0 }]);
    return hash.update(encode(snapshotWorld(world))).digest("hex");
  };
  assert.equal(digest(true), digest(false));
});
