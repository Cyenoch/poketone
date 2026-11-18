import assert from "node:assert/strict";
import test from "node:test";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerSession } from "../src/network/session.ts";
import { MultiplayerRun } from "../src/network/run.ts";
import { bindCoopSettlement } from "../src/run/createRun.ts";
import { emptyProgress, recordRun } from "../src/run/progress.ts";
import { challengePayout } from "../src/run/sim/challenge-result.ts";
import { createWorld, stepSharedWorld } from "../src/run/sim/world.ts";
import { routeTo, selectTestExit } from "./fixtures/route.mjs";

globalThis.__GAME_BUILD__ = "network-test";

const player = { starter: "gastly", trainer: "chengxi", shiny: true };
const mission = (rules, difficulty = 0) => ({
  mode: "expedition",
  stage: "forest",
  difficulty,
  rules,
});

async function until(condition) {
  const end = Date.now() + 8000;
  while (!condition()) {
    assert(Date.now() < end, "等待挑战规则房间同步超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function harbor(t) {
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const url = `ws://127.0.0.1:${server.port}/multiplayer`;
  const lifetime = new AbortController();
  t.after(async () => {
    lifetime.abort();
    await server.shutdown();
  });
  return (code, options) =>
    new MultiplayerSession(url, code, player, {
      directPeer() {
        throw new Error("Use Harbor relay.");
      },
      signal: lifetime.signal,
      ...options,
    });
}

test("Harbor 省略任务时创建普通森林，提供任务时严格校验规则", async (t) => {
  const connect = harbor(t);
  for (const invalid of [
    null,
    { mode: "expedition", stage: "forest", difficulty: 0 },
    mission("nuzlocke"),
    mission(["unknown"]),
    mission(["nuzlocke", "nuzlocke"]),
  ]) {
    const rejected = connect("", { mission: invalid });
    await until(() => rejected.state.error);
    assert.match(rejected.state.error, /冒险设置无效/);
    assert.equal(rejected.state.room, null);
  }

  const host = connect("");
  await until(() => host.state.room);
  assert.deepEqual(host.state.room.mission, mission([]));
});

test("规则组合变化清除所有客机准备，逐席确认最新规则后才可出发", async (t) => {
  const connect = harbor(t);
  const initial = mission(["nuzlocke", "no-items"]);
  const host = connect("", { mission: initial });
  await until(() => host.state.room);
  const guest = connect(host.state.room.code);
  const other = connect(host.state.room.code);
  await until(() => host.state.room.players.length === 3 && host.state.canStart);
  await until(() => guest.state.room?.ready.length === 3 && other.state.room?.ready.length === 3);
  assert.deepEqual(guest.state.room.mission, initial);

  host.mission(initial);
  assert.equal(host.state.canStart, true);
  host.mission(mission(["no-items", "nuzlocke"], 1));
  await until(() => host.state.room.mission.difficulty === 1);
  assert.deepEqual(host.state.room.ready, [0, 1, 2]);
  assert.equal(host.state.canStart, true);

  const before = guest.state.room.missionRevision;
  const updated = mission(["level-cap", "wild-weather"], 1);
  host.mission(mission([], 1));
  host.mission(updated);
  assert.equal(host.state.canStart, false, "房主提交改动后立即禁用出发");
  host.start();
  await until(() =>
    [host, guest, other].every((session) => session.state.room.mission.rules.includes("level-cap")),
  );
  for (const session of [host, guest, other]) {
    assert.deepEqual(session.state.room.mission, updated);
    assert.deepEqual(session.state.room.ready, [0]);
    assert.equal(session.state.mode, "relay");
  }

  const pending = host.state.room;
  guest.signal({ t: "mission-ready", revision: before });
  guest.signal({ t: "transport-ready", peer: 0 });
  await until(() => host.state.room !== pending);
  assert.deepEqual(host.state.room.ready, [0], "旧规则确认和重复传输握手不能恢复准备");

  guest.confirmMission();
  await until(() => host.state.room.ready.includes(guest.state.self));
  assert.equal(host.state.canStart, false, "还在等另一位客机确认");
  other.confirmMission();
  await until(() => host.state.canStart);

  const configs = [];
  for (const session of [host, guest, other]) session.onStart = (config) => configs.push(config);
  let ticket;
  guest.onTicket = (value) => (ticket = value);
  host.start();
  await until(() => configs.length === 3 && ticket);
  const expected = { ...updated, players: [player, player, player] };
  for (const config of configs) assert.deepEqual(config, expected);

  const seat = guest.state.self;
  guest.close(false);
  await until(() => !host.state.room.online.includes(seat));
  const replacement = connect(ticket.code, { rejoin: ticket });
  let resumed;
  replacement.onStart = (config) => (resumed = config);
  await until(() => resumed);
  assert.equal(replacement.state.self, seat);
  assert.deepEqual(resumed, expected);
});

test("Harbor 拒绝客机改规则，也拒绝房主提交不完整或非法的规则更新", async (t) => {
  const connect = harbor(t);
  const initial = mission(["nuzlocke"]);
  const host = connect("", { mission: initial });
  await until(() => host.state.room);
  const guest = connect(host.state.room.code);
  await until(() => host.state.canStart);
  guest.signal({ t: "mission", ...mission(["no-items"]) });
  await until(() => guest.state.error && host.state.room.players.length === 1);
  assert.match(guest.state.error, /只有房主/);
  assert.deepEqual(host.state.room.mission, initial);

  for (const invalid of [
    { mode: "expedition", stage: "forest", difficulty: 0 },
    mission(["__proto__"]),
  ]) {
    const owner = connect("");
    await until(() => owner.state.room);
    owner.signal({ t: "mission", ...invalid });
    await until(() => owner.state.error);
    assert.match(owner.state.error, /冒险设置无效/);
  }
});

test("放弃的客机从房主领取帧间所得；回执前断线只补发本人结果，其余队员继续", async (t) => {
  const connect = harbor(t);
  const host = connect("", { mission: mission(["nuzlocke"]) });
  await until(() => host.state.room);
  const guest = connect(host.state.room.code);
  const mate = connect(host.state.room.code);
  const sessions = [host, guest, mate];
  await until(() => host.state.room.players.length === 3 && host.state.canStart);
  const runs = [];
  sessions.forEach((session, id) => {
    session.onStart = (config) => (runs[id] = new MultiplayerRun(session, config));
  });
  host.start();
  await until(() => runs.filter(Boolean).length === 3);
  const world = createWorld({
    ...runs[0].config,
    stage: "tower",
    route: routeTo("tower"),
    seed: 5,
  });
  runs[0].publishMap(world);
  const worlds = [world, ...(await Promise.all(runs.slice(1).map((run) => run.initial())))];
  const results = [];
  let progress = emptyProgress();
  for (const [id, run] of runs.entries()) {
    run.loading(worlds[id]);
    bindCoopSettlement(run, worlds[id], (result) => {
      results.push({ id, result });
      progress = recordRun(progress, result);
    });
  }
  await Promise.all(runs.map((run) => run.ready()));
  await until(() => runs.every((run) => !run.suspended));

  const seat = guest.state.self;
  world.players[seat].stardust = 40;
  world.players[seat].kills = 7;
  assert.equal(challengePayout(worlds[1], worlds[1].players[seat]).stardust, 0);

  // Lose the first authoritative delivery. The original ticket must still retrieve that snapshot.
  const receive = guest.socket.onmessage;
  let disconnected = false;
  guest.socket.onmessage = (event) => {
    if (!disconnected && JSON.parse(event.data).t === "terminal") {
      disconnected = true;
      guest.socket.close();
    } else if (!disconnected) receive(event);
  };
  runs[1].quit();
  runs[1].quit();
  await until(() => disconnected && world.players[seat].departed);
  assert.deepEqual(results, [], "未收到房主结果，不从旧帧入账");
  stepSharedWorld(world, []);
  runs[0].publish(world, world.events, 0, true);
  await until(() => runs[2].apply(worlds[2], 0));
  assert.equal(worlds[2].tick, world.tick);
  assert.equal(worlds[2].players[seat].departed, true);
  assert.equal(worlds[2].outcome, "playing");

  world.players[0].stardust = 90;
  selectTestExit(world, null);
  runs[0].publish(world, world.events, 0, true);
  await until(() => runs[2].apply(worlds[2], 0));
  assert.equal(worlds[2].outcome, "victory");
  assert.equal(challengePayout(world, world.players[0]).stardust, 117);

  await until(() => guest.closed);
  assert.equal(guest.state.error, "");
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 1);
  assert.equal(results[0].result.outcome, "defeat");
  assert.equal(results[0].result.time, 0, "取离队时刻，不取重连时刻");
  assert.equal(progress.stardust, 52);
  assert.equal(progress.kills, 7);
  assert.deepEqual(progress.badges, []);
  assert.equal(host.state.error || mate.state.error, "");
});

test("local quit before team terminal receipt cannot award the quitting guest badges", async (t) => {
  const connect = harbor(t);
  const host = connect("", { mission: mission(["nuzlocke"], 2) });
  await until(() => host.state.room);
  const guest = connect(host.state.room.code);
  await until(() => host.state.canStart);
  let h, g;
  host.onStart = (c) => (h = new MultiplayerRun(host, c));
  guest.onStart = (c) => (g = new MultiplayerRun(guest, c));
  host.start();
  await until(() => h && g);
  const world = createWorld({ ...h.config, seed: 5, stage: "tower", route: routeTo("tower") });
  h.publishMap(world);
  const remote = await g.initial();
  h.loading(world);
  g.loading(remote);
  let result;
  bindCoopSettlement(h, world, () => {});
  bindCoopSettlement(g, remote, (r) => (result = r));
  await Promise.all([h.ready(), g.ready()]);
  await until(() => !h.suspended && !g.suspended);
  world.players[1].stardust = 40;
  g.quit();
  assert.equal(remote.outcome, "playing");
  const exit = selectTestExit(world, null);
  Object.assign(world.players[0], { x: exit.x, z: exit.z });
  stepSharedWorld(world, [{ t: "interact", player: 0 }]);
  assert.equal(world.outcome, "victory");
  h.publish(world, [], 0, true);
  await until(() => result || guest.state.error || host.state.error || guest.closed);
  assert.ok(result);
  const progress = recordRun(emptyProgress(), result);
  assert.equal(result.stardust, 52);
  assert.equal(result.outcome, "defeat");
  assert.deepEqual(progress.badges, []);
});
