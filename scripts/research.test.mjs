import assert from "node:assert/strict";
import test from "node:test";
import { researchOf, researchedCount } from "../src/run/research.ts";
import { emptyProgress, parseProgress, recordRun, ruleAvailable } from "../src/run/progress.ts";
import { unlockStatus } from "../src/run/unlocks.ts";
import { codexEntry, enemyKey, researchedEntry } from "../src/run/codex.ts";
import { createWorld, applyCommand } from "../src/run/sim/world.ts";
import { rollExitMarkers } from "../src/run/sim/content/route.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { snapshotWorld, restoreWorld } from "../src/run/sim/snapshot.ts";
import { queueCard } from "../src/run/sim/progression.ts";
import { itemIds } from "../src/run/sim/content/items.ts";
import { offerKey } from "../src/run/sim/upgrades.ts";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerSession } from "../src/network/session.ts";

const counts = (seen, defeated, shiny = 0) => ({ seen, defeated, shiny });
const result = {
  zones: 0,
  starter: "charmander",
  difficulty: 0,
  danger: 0,
  outcome: "defeat",
  time: 20,
  kills: 1,
  stardust: 3,
  dex: {},
};

test("普通物种的异色可以提前完成；精英与守卫不依赖异色，半点不取整", () => {
  const dex = { caterpie: counts(400, 400), pinsir: counts(5, 24), scyther: counts(6, 6) };
  assert.equal(researchOf(dex, "caterpie").done, true);
  assert.equal(researchOf(dex, "pinsir").points, 8.5);
  assert.equal(researchOf(dex, "scyther").done, true);
  assert.equal(researchedCount(dex), 2);
  assert.equal(researchOf({ caterpie: counts(50, 399) }, "caterpie").done, false);
  assert.equal(researchOf({ caterpie: counts(50, 200, 1) }, "caterpie").points, 10);
});

test("未遇见的图鉴详情不显示物种信息；基础详情不显示数值", () => {
  const entry = codexEntry(enemyKey("scyther")).entry;
  const unseen = researchedEntry({}, entry, "scyther");
  assert.equal(unseen.name, "？？？");
  assert.deepEqual(unseen.types, []);
  assert.deepEqual(
    unseen.blocks.map((b) => b.kind),
    ["research"],
  );
  const seen = researchedEntry({ scyther: counts(1, 0) }, entry, "scyther");
  assert.equal(seen.name, entry.name);
  assert.ok(seen.blocks.some((b) => b.title === "出现地图"));
  assert.ok(!seen.blocks.some((b) => b.kind === "stats"));
});

test("重试未提交的结算时保留本局刚完成的研究、徽章与解锁，后续结算不重复授予", () => {
  const before = { ...emptyProgress(), dex: { magikarp: counts(7, 7) } };
  const earned = { ...result, dex: { magikarp: counts(1, 1) }, outcome: "victory", difficulty: 1 };
  const first = recordRun(before, earned);
  const retry = parseProgress(recordRun(before, earned));
  assert.deepEqual(retry, first);
  assert.deepEqual(before.unlocks, []);
  assert.ok(retry.unlocks.includes("fishing-gyarados"));
  assert.ok(retry.unlocks.includes("alpha-elites"));
  assert.ok(retry.unlocks.includes("nuzlocke"));
  assert.deepEqual(recordRun(retry, result).unlocks, retry.unlocks);
  assert.equal(retry.stardust, result.stardust);
  assert.equal(unlockStatus(retry).find((e) => e.id === "fishing-gyarados").met, true);
  const base = { ...emptyProgress(), clears: [1, 0, 0] };
  assert.equal(ruleAvailable(base, "mono-type"), true);
  assert.equal(ruleAvailable(base, "alpha-elites"), false);
  assert.equal(ruleAvailable({ ...retry, clears: [1, 1, 0] }, "nuzlocke"), true);
  assert.throws(() => parseProgress({ ...retry, unlocks: ["missing"] }), /unlocks/);
  assert.throws(() => parseProgress({ ...retry, unlocks: ["outbreak", "outbreak"] }), /unlocks/);
});

const player = (unlocks) => ({ starter: "charmander", trainer: "yewei", shiny: false, unlocks });
const mission = { mode: "expedition", stage: "forest", difficulty: 0, rules: [] };

test("相同种子只从房主开放的野外种类和事件中抽取", () => {
  const vs = (owned, guest) => {
    const world = createWorld({
      ...mission,
      seed: 10,
      unlocks: owned,
      players: [player(owned), player(guest)],
    });
    return { sites: world.sites.map((s) => s.kind), events: world.eventsUsed };
  };
  const all = ["raid-den", "outbreak"];
  const closed = vs([], all);
  assert.ok(!closed.sites.includes("raid-den") && !closed.events.includes("outbreak"));
  const open = vs(all, []);
  assert.deepEqual(open, vs(all, all));
  assert.ok(open.sites.includes("raid-den") && open.events.includes("outbreak"));
  const draw = (owned) =>
    Array.from({ length: 30 }, (_, seed) =>
      rollExitMarkers(createRng(seed), ["tower", "tower"], owned),
    ).flat();
  assert.ok(!draw([]).includes("gengar-deal"));
  assert.ok(draw(["gengar-deal"]).includes("gengar-deal"));
});

test("Harbor 下发共享解锁和各席位资格，重连快照中的特性膏药只授予已解锁席位", async (t) => {
  globalThis.__GAME_BUILD__ = "research-test";
  const server = startHarbor({ hostname: "127.0.0.1", port: 0 });
  const lifetime = new AbortController();
  t.after(async () => {
    lifetime.abort();
    await server.shutdown();
  });
  const settings = {
    signal: lifetime.signal,
    directPeer() {
      throw new Error("Use Harbor relay.");
    },
  };
  function connect(code, owned, options = {}) {
    return new MultiplayerSession(
      `ws://127.0.0.1:${server.port}/multiplayer`,
      code,
      player(owned),
      { ...settings, ...options },
    );
  }
  async function until(predicate) {
    const end = Date.now() + 5000;
    while (!predicate()) {
      assert(Date.now() < end, "等待房间下发研究配置超时");
      await Bun.sleep(5);
    }
  }
  const owned = ["raid-den", "outbreak", "solar-power"];
  const host = connect("", owned, { mission: { ...mission, unlocks: owned } });
  await until(() => host.state.room);
  const guest = connect(host.state.room.code, []);
  await until(() => host.state.canStart);
  let delivered;
  guest.onStart = (config) => (delivered = config);
  host.start();
  await until(() => delivered);
  assert.deepEqual(delivered.unlocks, owned);
  const world = createWorld({ ...delivered, seed: 5 });
  const restored = restoreWorld(world.map, snapshotWorld(world));
  for (const seat of restored.players) {
    seat.banished = itemIds.filter((id) => id !== "ability-patch").map(offerKey.item);
    queueCard(restored, seat, "chest", undefined, { kind: "trophy" });
    const front = seat.pending[0],
      index = front.options.findIndex((c) => c.item === "ability-patch");
    if (seat.id === 0) {
      assert.ok(index >= 0);
      applyCommand(restored, { t: "pick", player: seat.id, card: front.id, index });
      assert.equal(seat.abilitySlot, "hidden");
    } else {
      assert.equal(index, -1);
      assert.deepEqual(recordRun(emptyProgress(), { ...result, dex: seat.dex }).unlocks, []);
    }
  }
});
