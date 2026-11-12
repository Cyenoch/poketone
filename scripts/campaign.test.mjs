import assert from "node:assert/strict";
import test from "node:test";
import { MultiplayerRun } from "../src/network/run.ts";
import { pack, unpack } from "../src/network/wire.ts";
import { damageEnemy } from "../src/run/sim/combat.ts";
import { nextField } from "../src/run/sim/content/campaign.ts";
import { STARDUST } from "../src/run/sim/content/params/economy.ts";
import { coopScaling } from "../src/run/sim/content/params/coop.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { landmarkOf } from "../src/run/sim/currentZone.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { mapDigest, restoreWorld, snapshotWorld } from "../src/run/sim/snapshot.ts";
import { currentStats, playerStats, xpForLevel } from "../src/run/sim/stats.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import {
  collectRemainingPickups,
  createWorld,
  isFrozen,
  stepSharedWorld,
  stepWorld,
} from "../src/run/sim/world.ts";
import { enterZone, prepareZone, sweepClearedField } from "../src/run/sim/zones.ts";

const ROUTE = ["forest", "desert", "coast", "glacier", "volcano", "tower"];
const config = {
  stage: "forest",
  seed: 7,
  difficulty: 0,
  players: [{ starter: "charmander" }, { starter: "squirtle" }],
};

function standAtExit(world) {
  const pad = landmarkOf(world);
  Object.assign(world.players[0], { x: pad.x, z: pad.z, inputX: 0, inputZ: 0, vx: 0, vz: 0 });
}

/** Use the real lethal-hit path so repeated hits must not duplicate the guardian's reward. */
function defeatGuardian(world) {
  standAtExit(world);
  stepWorld(world, [
    { t: "interact", player: 0 },
    { t: "interact", player: 0 },
  ]);
  const boss = world.enemies.find((enemy) => enemy.id === world.bossId);
  assert.ok(boss, `${world.stage}: the landmark summons its guardian early`);
  assert.equal(world.enemies.filter((enemy) => enemy.boss).length, 1);
  const hit = {
    owner: world.players[0],
    move: null,
    type: "dark",
    dmg: 1e9,
    crit: -1,
    statusChance: 0,
    knock: 0,
    fromX: 0,
    fromZ: 0,
  };
  const ctx = { world, grid: new EnemyGrid() };
  damageEnemy(ctx, boss, hit);
  assert.ok(boss.hp <= 0);
  assert.equal(world.zone.phase, "cleared");
  const settled = snapshotWorld(world);
  damageEnemy(ctx, boss, hit);
  assert.deepEqual(snapshotWorld(world), settled, "a repeated lethal hit grants nothing twice");
  sweepClearedField(world);
  assert.ok(world.pickups.some((pickup) => pickup.kind === "chest" && pickup.magnet));
}

const rewards = (world) =>
  world.players.map((player) => ({
    xp: Array.from({ length: player.level - 1 }, (_, i) => xpForLevel(i + 1)).reduce(
      (sum, xp) => sum + xp,
      player.xp,
    ),
    dust: player.stardust,
    kills: player.kills,
    chests: player.pending.filter((card) => card.source === "chest").length,
  }));

function carried(world) {
  return structuredClone({
    players: world.players.map((player) => {
      const {
        level,
        stage,
        xp,
        xpNext,
        hp,
        shield,
        moves,
        items,
        dashCooldown,
        dashes,
        rerolls,
        skips,
        banishes,
        banished,
        revives,
        pending,
        stardust,
        kills,
        fx,
        ult,
      } = player;
      return {
        level,
        stage,
        xp,
        xpNext,
        hp,
        shield,
        moves,
        items,
        dashCooldown,
        dashes,
        rerolls,
        skips,
        banishes,
        banished,
        revives,
        pending,
        stardust,
        kills,
        fx,
        charge: ult.charge,
      };
    }),
    partners: world.partners.map(({ id, owner, species, cooldown, guard }) => ({
      id,
      owner,
      species,
      cooldown,
      guard,
    })),
    stations: world.stations.map(({ id, kind, used }) => ({ id, kind, used })),
  });
}

test("six single-field maps advance through early guardian exits, preserving builds and settling each reward once", () => {
  const world = createWorld({
    ...config,
    players: config.players.map((player) => ({
      ...player,
      lab: { modifiers: [], rules: { rerolls: 3, skips: 3, banishes: 3, revives: 2 } },
    })),
  });
  for (const player of world.players) {
    player.level = 13;
    player.xpNext = xpForLevel(player.level);
    player.hp = 31;
    player.moves[0].level = 3;
    player.moves[0].cooldown = 5;
    player.items.push({ id: "sitrus-berry", level: 1 });
    player.rerolls = player.skips = player.banishes = player.revives = player.id;
    const berry = playerStats(player).triggers.find((trigger) => trigger.def.kind === "healBelow");
    player.fx[berry.key] = 12;
    player.dashes = 0;
    player.dashCooldown = 2;
    player.ult.charge = 0.6;
  }
  world.players[1].shield = 3;
  world.stations.find((station) => station.kind === "bill").used = [0];
  world.partners.push({
    id: world.nextId++,
    owner: 1,
    species: "pidgey",
    x: 0,
    z: 0,
    px: 0,
    pz: 0,
    faceX: 0,
    faceZ: 1,
    cooldown: 4,
    guard: 2,
  });
  const visited = [];
  for (const [index, stage] of ROUTE.entries()) {
    visited.push(world.stage);
    assert.equal(world.stage, stage);
    assert.equal(stageDefs[stage].zones.length, 1, `${stage} is one complete field`);
    assert.deepEqual(world.zone, { index: 0, tick: 0, phase: "active" });
    assert.equal(world.outcome, "playing");
    assert.throws(() => prepareZone(world), /还没有离开/);

    // A restored continuation uses the actual transferred map, including after a map change.
    const received = unpack(pack({ map: world.map, snapshot: snapshotWorld(world) }));
    const restored = restoreWorld(received.map, received.snapshot);
    for (let tick = 0; tick < 12; tick++) {
      const commands = [{ t: "move", player: 1, x: 1, z: 0 }];
      stepWorld(world, commands);
      stepWorld(restored, commands);
    }
    assert.deepEqual(
      snapshotWorld(restored),
      snapshotWorld(world),
      `${stage}: snapshot continuation`,
    );

    const before = rewards(world);
    defeatGuardian(world);
    assert.equal(world.rampage, false, "summoning early permits a fast clear");
    assert.ok(world.zone.tick * TICK < 600);
    assert.equal(world.outcome, "playing", "even a cleared tower waits for its exit");
    world.pickups.push({
      id: world.nextId++,
      kind: "stardust",
      value: 7,
      x: 40,
      z: 40,
      magnet: true,
    });
    const xp = world.pickups.filter((p) => p.kind === "xp").reduce((sum, p) => sum + p.value, 0);
    standAtExit(world);
    stepWorld(world, [
      { t: "interact", player: 0 },
      { t: "interact", player: 0 },
    ]);
    assert.deepEqual(
      rewards(world),
      before.map((reward, player) => ({
        xp: reward.xp + xp * currentStats(world.players[player]).xp * coopScaling(2).xp,
        dust: reward.dust + STARDUST.guardian + 7,
        kills: reward.kills + (player === 0 ? 1 : 0),
        chests: reward.chests + 1,
      })),
      `${stage}: guardian drops and in-flight rewards settle exactly once`,
    );
    assert.equal(world.pickups.length, 0);
    const earned = rewards(world);
    const next = index + 1 < ROUTE.length ? { stage: ROUTE[index + 1], zone: 0 } : null;
    assert.deepEqual(nextField(world), next, `${stage}: only the tower ends the route`);
    if (!next) {
      assert.equal(world.outcome, "victory");
      stepWorld(world, [{ t: "interact", player: 0 }]);
      assert.deepEqual(rewards(world), earned);
      break;
    }
    assert.equal(world.outcome, "playing");
    assert.equal(world.zone.phase, "transitioning");
    assert.ok(isFrozen(world));
    const waiting = snapshotWorld(world);
    stepWorld(world, [
      { t: "dash", player: 0 },
      { t: "interact", player: 0 },
    ]);
    assert.deepEqual(snapshotWorld(world), waiting, "departure freezes clocks and spent resources");
    const prepared = prepareZone(world);
    assert.deepEqual(snapshotWorld(world), waiting, "preparation does not mutate the live world");
    assert.deepEqual({ stage: prepared.stage, zone: prepared.zone }, next);
    const kept = carried(world);
    const identity = [world.seed, world.tick, world.time, world.nextId];
    enterZone(world, prepared);
    assert.deepEqual(
      carried(world),
      kept,
      `${stage}: growth, resources, partners and choices carry`,
    );
    assert.deepEqual([world.seed, world.tick, world.time, world.nextId], identity);
    assert.deepEqual(rewards(world), earned, "installing a map does not repeat rewards");
    assert.equal(isFrozen(world), false, "co-op choices do not block the new map");
    for (const partner of world.partners) {
      const owner = world.players[partner.owner];
      assert.ok(Math.hypot(partner.x - owner.x, partner.z - owner.z) < 3);
    }
  }
  assert.deepEqual(visited, ROUTE);
});

test("every map waits 600 local seconds for forced guardians and keeps playing in rampage", () => {
  for (const stage of ROUTE) {
    const world = createWorld({ ...config, stage });
    world.time = 3600;
    world.zone.tick = Math.round(600 / TICK) - 2;
    stepWorld(world, []);
    assert.equal(world.rampage, false, `${stage}: the cumulative run clock cannot force rampage`);
    assert.equal(world.bossId, null, `${stage}: no forced guardian before 600 seconds`);
    stepWorld(world, []);
    assert.equal(world.rampage, true, `${stage}: rampage begins at 600 local seconds`);
    const boss = world.bossId;
    assert.ok(world.enemies.some((enemy) => enemy.id === boss && enemy.boss));
    stepWorld(world, []);
    assert.equal(world.bossId, boss);
    assert.equal(world.enemies.filter((enemy) => enemy.boss).length, 1);
    assert.equal(
      world.outcome,
      "playing",
      `${stage}: 600 seconds is not a forced victory or defeat`,
    );
    assert.ok(world.zone.tick * TICK > 600);
  }
});

test("a solo exit waits for earned choices before preparing the next map", () => {
  const world = createWorld({ ...config, players: [config.players[0]] });
  defeatGuardian(world);
  collectRemainingPickups(world);
  assert.ok(world.players[0].pending.length > 0);
  standAtExit(world);
  stepWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.zone.phase, "cleared");
  assert.throws(() => prepareZone(world), /还没有离开/);
  for (let tries = 0; tries < 50 && world.players[0].pending.length; tries++) {
    const card = world.players[0].pending[0];
    stepWorld(world, [{ t: "pick", player: 0, card: card.id, index: 0 }]);
  }
  assert.equal(world.players[0].pending.length, 0);
  standAtExit(world);
  stepWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.zone.phase, "transitioning");
  enterZone(world, prepareZone(world));
  assert.equal(world.stage, "desert");
  assert.equal(world.outcome, "playing");
});

/** Same session seam as network.test.mjs, with synchronous encoded delivery and explicit ready calls. */
function encodedSessions(count) {
  const packets = [];
  const sessions = Array.from({ length: count }, (_, self) => ({
    state: { self },
    receive(receiver) {
      this.receiver = receiver;
      return () => {
        this.receiver = undefined;
      };
    },
    send(packet, _replaceable = false, target) {
      const text = pack(packet);
      packets.push({ self, packet: unpack(text) });
      const targets =
        target !== undefined ? [target] : self ? [0] : sessions.slice(1).map((s) => s.state.self);
      for (const id of targets) sessions[id].receiver(unpack(text), self);
      return true;
    },
    finish(packet) {
      if (packet) this.send(packet);
    },
    isReachable() {
      return true;
    },
    close() {},
    fail(error) {
      throw error;
    },
  }));
  return { sessions, packets };
}

test("encoded network maps carry the six-field campaign through current-map ready barriers and one terminal result", async (t) => {
  const settings = { ...config, players: [...config.players, { starter: "bulbasaur" }] };
  const world = createWorld(settings);
  const { sessions, packets } = encodedSessions(settings.players.length);
  const runs = sessions.map((session) => new MultiplayerRun(session, settings));
  t.after(() => runs.forEach((run) => run.dispose(false)));
  const [host, ...guests] = runs;
  let oldReady = [];
  let remotes;
  for (const stage of ROUTE) {
    assert.equal(world.stage, stage);
    host.publishMap(world);
    remotes = await Promise.all(guests.map((guest) => guest.initial()));
    assert.ok(
      runs.every((run) => run.suspended),
      `${stage}: online seats must load the new map`,
    );
    for (const [index, remote] of remotes.entries()) {
      assert.equal(remote.stage, stage);
      assert.equal(remote.outcome, "playing");
      assert.equal(mapDigest(remote.map), mapDigest(world.map));
      assert.deepEqual(snapshotWorld(remote), { ...snapshotWorld(world), events: [] });
      guests[index].loading(remote);
    }
    for (const { self, packet } of oldReady) sessions[self].send(packet);
    assert.equal(host.suspended, true, "previous-map acknowledgements cannot unlock this map");
    assert.deepEqual(host.submit([{ t: "dash", player: 0 }]), []);
    await guests[0].ready();
    assert.equal(host.suspended, true, "one online seat is still loading");
    await guests[1].ready();
    assert.ok(runs.every((run) => !run.suspended));
    await host.ready();
    oldReady = packets.filter(({ packet }) => packet.t === "ready").slice(-guests.length);
    const guestX = remotes[0].players[1].x;
    guests[0].submit([{ t: "move", player: 0, x: 1, z: 0 }]);
    const commands = host.submit([]);
    assert.deepEqual(commands, [{ t: "move", player: 1, x: 1, z: 0 }]);
    stepSharedWorld(world, commands);
    host.publish(world, world.events.splice(0), TICK, true);
    for (const [index, guest] of guests.entries()) {
      const remote = remotes[index];
      assert.equal(guest.apply(remote, TICK), true, `${stage}: frames resume after map readiness`);
      assert.equal(remote.stage, stage);
      assert.equal(remote.tick, world.tick);
      assert.deepEqual(remote.zone, world.zone);
      assert.deepEqual(rewards(remote), rewards(world));
    }
    assert.ok(remotes[0].players[1].x > guestX, `${stage}: the guest's owned movement resumes`);
    assert.equal(packets.filter(({ packet }) => packet.t === "terminal").length, 0);
    defeatGuardian(world);
    standAtExit(world);
    stepWorld(world, [{ t: "interact", player: 0 }]);
    if (stage !== "tower") {
      assert.equal(world.zone.phase, "transitioning");
      assert.equal(world.outcome, "playing");
      enterZone(world, prepareZone(world));
    }
  }
  assert.equal(world.outcome, "victory");
  host.publish(world, world.events.splice(0), 0, true);
  const terminal = packets.filter(({ packet }) => packet.t === "terminal");
  assert.equal(terminal.length, 1);
  for (const [index, guest] of guests.entries()) {
    const remote = remotes[index];
    assert.equal(guest.apply(remote, 0), true);
    assert.equal(remote.stage, "tower");
    assert.equal(remote.outcome, "victory");
    assert.deepEqual(rewards(remote), rewards(world));
    const final = snapshotWorld(remote);
    sessions[index + 1].receiver(unpack(pack(terminal[0].packet)), 0);
    assert.equal(guest.apply(remote, 0), false);
    assert.deepEqual(
      snapshotWorld(remote),
      final,
      "duplicate terminal delivery does not replay rewards",
    );
  }
});
