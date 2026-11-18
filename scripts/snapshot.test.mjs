// World snapshot contract (docs/state-machines/simulation.md): snapshot a mid-run world, restore it in a
// fresh worker (no module caches from the original), feed both the same commands to the end, and get the
// same golden digests and the same full state. The original keeps its cache history up to the snapshot.
import { unlockIds } from "../src/run/sim/content/unlocks.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { pack, unpack } from "../src/network/wire.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { generateMap } from "../src/run/sim/mapgen/index.ts";
import { cos, sin } from "../src/run/sim/math.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { refreshFlowFields, requestFlowField } from "../src/run/sim/nav/index.ts";
import { restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import {
  createWorld,
  createWorldFromSeeds,
  stepSharedWorld,
  stepWorld,
} from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { routeTo, selectTestExit } from "./fixtures/route.mjs";
import { answerCard, eventFacts, project, SAMPLE_EVERY, STAGE_TICKS } from "./golden.mjs";

/** Golden's "coop/charmander+squirtle/d1/s7" case (determinism/run.mjs exports golden's CASES itself). */
const CASE = {
  mode: "expedition",
  unlocks: unlockIds,
  rules: [],
  seed: 7,
  difficulty: 1,
  players: [
    { trainer: "chengxi", starter: "charmander" },
    { trainer: "chengxi", starter: "squirtle" },
  ],
};
/** The snapshot is taken at the first call from here on that leaves the risky state below. */
const FROM_TICK = 3000;
/** Full-state fingerprints every this many calls (and right at the snapshot). */
const STRICT_EVERY = 30;

/** Golden's scripted input; `decisions` is driver state, not world state. */
function commandsFor(world, decisions) {
  const commands = [];
  for (const player of world.players) {
    const angle = world.tick / 120 + player.id * Math.PI;
    commands.push({ t: "move", player: player.id, x: cos(angle), z: sin(angle * 0.7) });
    if (player.pending[0]) commands.push(answerCard(player, decisions[player.id]++, world.tick));
    if (world.tick % 240 < 90) commands.push({ t: "dash", player: player.id });
    if (world.tick % 30 === 0) commands.push({ t: "ult", player: player.id });
    if (player.dialog) commands.push({ t: "leave", player: player.id, dialog: player.dialog.id });
  }
  return commands;
}

/**
 * Golden's HP refill (`refill: true`), applied by both sides before every call: a rule on each world's own
 * state, read after the previous call's fingerprint, so it cannot hide a difference.
 */
function refill(world) {
  for (const player of world.players) player.hp = playerStats(player).maxHp;
}

/**
 * Hash of the whole world, read independently of `snapshotWorld`: every field, exact numbers (−0,
 * Infinity), the nav's published costs, and the running search's work buffer and live queue. Leaves out
 * the static map, A* buffers, refresh scratch and idle work buffers, which never carry state.
 */
function fingerprint(world) {
  const hash = createHash("sha256");
  const nav = world.nav;
  const running = nav.flow?.layer ?? null;
  const skip = new Set([world.map]);
  for (const layer of nav.layers) if (layer.field && layer !== running) skip.add(layer.field.work);
  let parts = [];
  const bytes = (array) => {
    hash.update(parts.join(""));
    parts = [];
    hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  };
  const walk = (value) => {
    if (skip.has(value)) return parts.push("~");
    if (typeof value === "number") return parts.push(Object.is(value, -0) ? "-0," : `${value},`);
    if (typeof value !== "object" || value === null) return parts.push(`${JSON.stringify(value)},`);
    if (ArrayBuffer.isView(value)) return bytes(value);
    if (Array.isArray(value)) {
      parts.push("[");
      value.forEach(walk);
      return parts.push("]");
    }
    parts.push("{");
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      parts.push(`${key}:`);
      if (value === nav && ["flow", "search", "targets"].includes(key)) parts.push("~");
      else walk(value[key]);
    }
    parts.push("}");
  };
  walk(world);
  if (running) {
    const { queue, settled } = nav.flow;
    walk([nav.layers.indexOf(running), settled, queue.size, queue.level]);
    queue.counts.forEach((count, i) => bytes(queue.buckets[i].subarray(0, count)));
  }
  hash.update(parts.join(""));
  return hash.digest("hex").slice(0, 16);
}

/**
 * Steps `world` while `next(call)` gives commands, digesting golden's projection and event facts from a
 * fresh window: the events still queued at the start come first. Returns the samples, the end digest
 * and the full-state fingerprints.
 */
function continueRun(world, next) {
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  let window = createHash("sha256");
  let chain = "";
  const samples = [];
  const strict = [`snapshot@${world.tick} ${fingerprint(world)}`];
  const drain = () => {
    for (const event of world.events) {
      const facts = eventFacts(event);
      if (facts) window.update(`${JSON.stringify(facts)}\n`);
    }
    world.events.length = 0;
  };
  drain();
  for (let call = 0, commands; (commands = next(call)); call++) {
    const tick = world.tick;
    refill(world);
    stepWorld(world, commands);
    if (call % STRICT_EVERY === 0) strict.push(`${call}@${world.tick} ${fingerprint(world)}`);
    drain();
    if (world.tick !== tick && world.tick % SAMPLE_EVERY === 0) {
      const digest = sha(JSON.stringify(project(world)) + window.digest("hex"));
      samples.push(`${world.tick}:${digest.slice(0, 8)}`);
      chain = sha(chain + digest);
      window = createHash("sha256");
    }
  }
  const end = sha(chain + JSON.stringify(project(world)) + window.digest("hex")).slice(0, 16);
  return { samples, end: `${world.tick} ${world.outcome} ${end}`, strict };
}

/** Golden's run up to the snapshot point: a search in flight toward new targets while enemies live. */
function riskyState(world) {
  const running = world.nav.flow?.layer;
  const { seeds, published } = running?.field ?? {};
  return (
    world.tick >= FROM_TICK &&
    world.enemies.length > 0 &&
    world.events.length > 0 &&
    published !== null &&
    published !== undefined &&
    seeds.join() !== published.join()
  );
}

function restoreInWorker(snapshot, commands) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: { stage: "forest", seed: CASE.seed, snapshot, commands },
    });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

if (isMainThread) {
  for (const stage of Object.keys(stageDefs)) {
    test(`${stage}: a real co-op map and snapshot survive the network codec and continue identically`, () => {
      let seed = CASE.seed;
      const world = createWorldFromSeeds(
        {
          mode: CASE.mode,
          rules: CASE.rules,
          stage,
          route: routeTo(stage),
          difficulty: CASE.difficulty,
          players: CASE.players,
        },
        () => seed++,
      );
      const snapshot = snapshotWorld(world);
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(snapshot.navigation)),
        snapshot.navigation,
        "navigation must be reversible plain JSON",
      );
      assert.equal(fingerprint(restoreWorld(world.map, snapshot)), fingerprint(world));
      const received = unpack(pack({ map: world.map, snapshot }));
      const restored = restoreWorld(received.map, received.snapshot);
      assert.equal(fingerprint(restored), fingerprint(world), "all navigation masks and fields");
      const decisions = world.players.map(() => 0);
      for (let tick = 0; tick < 90; tick++) {
        const commands = commandsFor(world, decisions);
        stepWorld(world, commands);
        stepWorld(restored, commands);
        if (tick % STRICT_EVERY === 0) assert.equal(fingerprint(restored), fingerprint(world));
      }
      assert.equal(fingerprint(restored), fingerprint(world));
    });
  }

  for (const mobility of ["swim", "amphibious"]) {
    test(`coast: codec restoration preserves a running ${mobility} field and its published routes`, () => {
      const world = createWorld({ stage: "coast", route: routeTo("coast"), ...CASE });
      for (const player of world.players) player.x += 3;
      const layer = requestFlowField(world.nav, mobilityClasses[mobility]);
      world.nav.cursor = world.nav.layers.indexOf(layer);
      refreshFlowFields(world.nav, world.players, 1);
      assert.strictEqual(world.nav.flow.layer, layer);
      assert.notDeepEqual(layer.field.seeds, layer.field.published);
      const restored = restoreWorld(world.map, unpack(pack(snapshotWorld(world))));
      assert.equal(fingerprint(restored), fingerprint(world), "search prefix and published field");
      for (let tick = 0; tick < 90; tick++) {
        stepWorld(world, []);
        stepWorld(restored, []);
        if (tick % STRICT_EVERY === 0) assert.equal(fingerprint(restored), fingerprint(world));
      }
      assert.equal(fingerprint(restored), fingerprint(world));
    });
  }

  test("快照保留已选出口、实走路线、入图标记和词条，以及各自的耿鬼交易", () => {
    const world = createWorld({ stage: "forest", ...CASE, seed: 2 });
    selectTestExit(world, "coast");
    enterZone(world, prepareZone(world));
    const leaving = selectTestExit(world, "volcano");
    const chosen = world.zone.exits[leaving];
    const { modifier } = prepareZone(world);
    assert.equal(chosen.marker, "gengar-deal");
    assert.ok(modifier, "种子 2 的火山应带地图词条");

    const traveling = restoreWorld(world.map, unpack(pack(snapshotWorld(world))));
    assert.deepEqual(traveling.route, ["forest", "coast"]);
    assert.deepEqual(traveling.zone.exits, world.zone.exits);
    assert.equal(traveling.zone.leaving, leaving);
    enterZone(traveling, prepareZone(traveling));
    assert.equal(traveling.stage, "volcano");

    const altar = traveling.sites.find((site) => site.kind === "gengar-deal");
    assert.ok(altar);
    for (const player of traveling.players)
      Object.assign(player, { x: altar.x, z: altar.z, px: altar.x, pz: altar.z });
    const [host, guest] = traveling.players;
    stepSharedWorld(traveling, [
      { t: "interact", player: host.id },
      { t: "interact", player: guest.id },
    ]);
    const [hostDeal] = host.pending;
    const [guestDeal] = guest.pending;
    assert.equal(hostDeal?.offer?.site, altar.id);
    assert.equal(guestDeal?.offer?.site, altar.id);
    stepSharedWorld(traveling, [{ t: "pick", player: host.id, card: hostDeal.id, index: 0 }]);
    assert.ok(host.tradeHp < 1, "房主先完成自己的交易");

    const restored = restoreWorld(traveling.map, unpack(pack(snapshotWorld(traveling))));
    assert.deepEqual(restored.route, ["forest", "coast", "volcano"]);
    assert.equal(restored.marker, chosen.marker);
    assert.equal(restored.modifier, modifier);
    const [restoredHost, restoredGuest] = restored.players;
    const restoredAltar = restored.sites.find((site) => site.id === altar.id);
    assert.deepEqual(restoredAltar.data.traded, [host.id]);
    assert.deepEqual(
      restored.players.map((player) => player.tradeHp),
      [host.tradeHp, 1],
    );
    assert.deepEqual(restoredGuest.pending[0], guestDeal);

    stepSharedWorld(restored, [
      { t: "interact", player: restoredHost.id },
      { t: "pick", player: restoredGuest.id, card: guestDeal.id, index: 0 },
    ]);
    assert.ok(restoredHost.pending.every((card) => card.offer?.kind !== "deal"));
    assert.deepEqual(restoredAltar.data.traded, [host.id, guest.id]);
    assert.deepEqual(
      restored.players.map((player) => player.tradeHp),
      [host.tradeHp, host.tradeHp],
    );
  });

  test("恢复飞行中的守卫奖杯后，离区只向所属席位结算", () => {
    const world = createWorld({ stage: "forest", ...CASE });
    const [host, guest] = world.players;
    const guardian = spawnEnemy(world, "scyther", host.x, host.z);
    guardian.hp = 0;
    killEnemy({ world, grid: new EnemyGrid() }, guardian, null);
    const restored = restoreWorld(world.map, unpack(pack(snapshotWorld(world))));
    assert.deepEqual(
      restored.pickups.filter((pickup) => pickup.kind === "trophy").map((pickup) => pickup.owner),
      [host.id, guest.id],
    );
    selectTestExit(restored, "coast");
    enterZone(restored, prepareZone(restored));
    const trophies = restored.players.map((player) =>
      player.pending.filter((card) => card.offer?.kind === "trophy"),
    );
    assert.deepEqual(
      trophies.map((cards) => cards.length),
      [1, 1],
    );
    assert.notEqual(trophies[0][0].id, trophies[1][0].id);
    assert.deepEqual(
      restored.events
        .filter((event) => event.t === "route" && event.kind === "trophy")
        .map((event) => event.player),
      [host.id, guest.id],
    );
  });

  test("snapshot boundaries reject invalid mobility, layer order, format and non-finite data", () => {
    const world = createWorld({ stage: "coast", route: routeTo("coast"), ...CASE });
    const snapshot = snapshotWorld(world);
    for (const [mutate, error] of [
      [(value) => (value.navigation.layers[1].mobility = "toString"), /机动类别无效/],
      [(value) => (value.navigation.layers[1].mobility = "ground"), /顺序与快照不符/],
      [(value) => (value.navigation.clock = Infinity), /不是有限数/],
      [(value) => (value.players[0].mega = "not-a-form"), /players.0.mega/],
      [(value) => (value.version += 1), /快照格式/],
      [(value) => (value.version -= 1), /快照格式/],
      [(value) => delete value.spawn.pressure, /快照增援压力无效/],
      [(value) => (value.spawn.pressure = 2), /快照增援压力无效/],
      [(value) => delete value.zone.exits, /快照出口无效/],
      [(value) => (value.zone.leaving = 0), /快照出口无效/],
      [(value) => (value.zone.phase = "cleared"), /快照出口无效/],
      [
        (value) =>
          Object.assign(value.zone, {
            phase: "cleared",
            exits: [{ x: 0, z: 0, to: "tower", marker: "chests" }],
          }),
        /快照出口无效/,
      ],
      [(value) => delete value.zone.schedule, /zone.schedule/],
      [(value) => (value.spawn.fired = [value.zone.schedule.length]), /spawn.fired/],
      [(value) => (value.eventsUsed = ["horde", "horde"]), /eventsUsed/],
      [(value) => (value.weather = { id: "missing", from: 5, until: 80 }), /weather/],
      [(value) => (value.sites[0].owner = 99), /sites.*owner/],
      [(value) => (value.players[0].egg = { species: "rattata", distance: 2 }), /egg/],
      [(value) => (value.players[0].dex = { missing: { seen: 1, defeated: 0, shiny: 0 } }), /dex/],
      [(value) => (value.players[0].ult.protection = 6), /ult.protection/],
      [(value) => (value.players[0].ult.cast = -1), /ult.cast/],
    ]) {
      const invalid = structuredClone(snapshot);
      mutate(invalid);
      assert.throws(() => restoreWorld(world.map, invalid), error);
    }
    world.nav.clock = Infinity;
    assert.throws(() => snapshotWorld(world), /不是有限数/);
  });

  test("route snapshots preserve a complete exit group and only award victory at a selected tower exit", () => {
    const world = createWorld({ stage: "forest", ...CASE });
    selectTestExit(world, "coast");
    const snapshot = snapshotWorld(world);
    for (const [mutate, error] of [
      [(value) => (value.modifier = "fog"), /modifier/],
      [(value) => (value.marker = "research"), /marker/],
      [(value) => (value.zone.exits[0].marker = "gengar-deal"), /快照出口无效/],
      [(value) => (value.zone.exits[1].marker = value.zone.exits[0].marker), /快照出口无效/],
      [
        (value) => {
          value.zone.exits = [value.zone.exits[0]];
          value.zone.leaving = 0;
        },
        /快照出口无效/,
      ],
      [
        (value) => {
          value.zone.phase = "cleared";
          value.outcome = "victory";
        },
        /快照出口无效/,
      ],
    ]) {
      const invalid = structuredClone(snapshot);
      mutate(invalid);
      assert.throws(() => restoreWorld(world.map, invalid), error);
    }
    const tower = createWorld({ ...CASE, stage: "tower", route: routeTo("tower") });
    selectTestExit(tower, null);
    const terminal = snapshotWorld(tower);
    assert.equal(restoreWorld(tower.map, terminal).outcome, "victory");
    terminal.zone.leaving = null;
    assert.throws(() => restoreWorld(tower.map, terminal), /快照出口无效/);
  });

  test("snapshots exclude static map data and restore against the complete GeneratedMap", () => {
    const world = createWorld({ stage: "forest", ...CASE });
    const snapshot = snapshotWorld(world);
    assert.equal(Object.hasOwn(snapshot, "map"), false, "static map data must be sent separately");
    assert.equal(Object.hasOwn(snapshot, "nav"), false, "only navigation continuation travels");
    const restored = restoreWorld(world.map, snapshot);
    assert.strictEqual(restored.map, world.map);
    assert.notStrictEqual(restored.nav, world.nav);
    assert.throws(
      () =>
        restoreWorld(
          {
            ...world.map,
            passages: [
              {
                points: [
                  [0, 0],
                  [1, 0],
                ],
                width: 2,
              },
            ],
          },
          snapshot,
        ),
      /另一张地图/,
      "passages belong to the static map identity",
    );
  });

  test("a restored snapshot steps like the original under the same commands", async () => {
    const world = createWorld({
      mode: CASE.mode,
      stage: "forest",
      rules: CASE.rules,
      seed: CASE.seed,
      difficulty: CASE.difficulty,
      players: CASE.players,
    });
    const decisions = world.players.map(() => 0);
    while (!riskyState(world)) {
      assert.equal(world.outcome, "playing", "the run ended before the snapshot point");
      world.events.length = 0;
      const commands = commandsFor(world, decisions);
      refill(world);
      stepWorld(world, commands);
    }

    const before = fingerprint(world);
    const snapshot = snapshotWorld(world);
    assert.equal(fingerprint(world), before, "snapshotWorld changed the world");
    const sent = structuredClone(snapshot);

    const commands = [];
    const original = continueRun(world, () => {
      if (world.tick >= STAGE_TICKS || world.outcome !== "playing") return null;
      const batch = commandsFor(world, decisions);
      commands.push(batch);
      return batch;
    });
    assert.deepStrictEqual(snapshot, sent, "the snapshot shares mutable state with the world");

    const restored = await restoreInWorker(sent, commands);
    assert.ok(
      original.samples.length > 10,
      `only ${original.samples.length} samples after the snapshot`,
    );
    const first = original.strict.findIndex((print, i) => print !== restored.strict[i]);
    assert.equal(first, -1, `full state first differs at ${original.strict[first]}`);
    assert.deepStrictEqual(restored.samples, original.samples);
    assert.equal(restored.end, original.end);
  });
} else {
  const { stage, seed, snapshot, commands } = workerData;
  const world = restoreWorld(generateMap(seed, stageDefs[stage].map).map, snapshot);
  parentPort.postMessage(continueRun(world, (call) => commands[call] ?? null));
}
