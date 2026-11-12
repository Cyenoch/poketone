import { test } from "node:test";
import assert from "node:assert/strict";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerSession } from "../src/network/session.ts";
import { MultiplayerRun } from "../src/network/run.ts";
import { encode, decode } from "../src/network/codec.ts";
import { createWorld, stepSharedWorld as stepWorld } from "../src/run/sim/world.ts";
import { mapDigest } from "../src/run/sim/snapshot.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { applyEntityDelta, entityDelta, entityState } from "../src/network/delta.ts";

globalThis.__GAME_BUILD__ = "network-test";
const player = { starter: "charmander" };
const connection = (rejoin) => ({
  directPeer() {
    throw new Error("Direct transport disabled for Harbor relay tests.");
  },
  signal: new AbortController().signal,
  rejoin,
});
const config = {
  stage: "forest",
  seed: 7,
  difficulty: 0,
  players: [player, { starter: "squirtle" }],
};
const until = async (condition) => {
  const end = Date.now() + 8000;
  while (!condition()) {
    if (Date.now() > end) throw new Error("等待网络状态超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
async function pair(t) {
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const url = `ws://127.0.0.1:${server.port}/multiplayer`;
  const host = new MultiplayerSession(url, "", player, connection());
  let guest;
  t.after(() => {
    host.close();
    guest?.close();
    server.stop(true);
  });
  await until(() => host.state.room);
  guest = new MultiplayerSession(url, host.state.room.code, config.players[1], connection());
  await until(() => guest.state.mode === "relay" && host.state.canStart);
  return { host, guest, url };
}

test("Harbor 房间 → 房主出发 → 地图、操作与分区同步；客机离开后房主继续", async (t) => {
  const { host, guest } = await pair(t);
  let a, b;
  host.onStart = (settings) => {
    a = new MultiplayerRun(host, settings);
  };
  guest.onStart = (settings) => {
    b = new MultiplayerRun(guest, settings);
  };
  host.start("forest", 0);
  host.start("forest", 0);
  await until(() => a && b);
  const world = createWorld(config);
  world.players[1].faceX = -0;
  const initial = b.initial();
  a.publishMap(world);
  const remote = await initial;
  assert.equal(mapDigest(remote.map), mapDigest(world.map));
  assert(Object.is(remote.players[1].faceX, -0));
  const hostReady = a.ready();
  await b.ready();
  await hostReady;
  await until(() => !b.suspended);
  const rigPlayer = remote.players[1];
  b.submit([{ t: "move", player: 0, x: 1, z: 0 }]);
  let commands = [];
  await until(() => {
    commands = a.submit([]);
    return commands.length;
  });
  assert.equal(commands[0].player, 1, "客机不能控制房主");
  for (let i = 0; i < 10; i++) stepWorld(world, i === 0 ? commands : []);
  a.publish(world, world.events.splice(0), 0.1);
  await until(() => b.apply(remote, 0.1));
  assert.equal(remote.players[1], rigPlayer, "角色模型持有的玩家引用仍有效");
  assert(remote.players[1].x > 1, "自己的展示位置已预测移动");
  assert.equal(remote.players[1].hp, world.players[1].hp, "生命值仍取权威状态");
  assert.equal(remote.tick, world.tick);
  assert.equal(remote.players[0].inputX, 0);

  b.submit([
    { t: "move", player: 1, x: 0, z: 1 },
    { t: "dash", player: 1 },
    { t: "move", player: 1, x: 1, z: 0 },
  ]);
  await until(() => {
    commands = a.submit([]);
    return commands.length;
  });
  stepWorld(world, commands);
  assert.equal(world.players[1].dashX, 0);
  assert.equal(world.players[1].dashZ, 1, "冲刺使用按下时的方向，不能被后来的移动覆盖");

  world.zone.phase = "transitioning";
  enterZone(world, prepareZone(world));
  a.publishMap(world);
  let next;
  await until(() => {
    next = b.takeMap();
    return next;
  });
  assert.equal(next.zone.index, 0);
  assert.equal(next.stage, "desert");
  assert.equal(mapDigest(next.map), mapDigest(world.map));
  b.loading(next);
  await b.ready();
  await a.ready();
  const failures = [];
  b.onError = (error) => failures.push(error.message);
  b.quit();
  b.dispose();
  await until(() => world.players[1].departed && guest.closed);
  assert.equal(world.outcome, "playing", "客机离开不结束房主的对局");
  assert.equal(world.players[1].alive, false);
  assert.deepEqual(
    world.events.filter((event) => event.t === "peer"),
    [{ t: "peer", player: 1, state: "left" }],
  );
  assert.equal(host.state.error, "");
  assert.equal(a.suspended, false);
  assert.deepEqual(failures, [], "主动离开不是联机失败");
  assert.equal(host.state.room.departed.includes(1), true);
});

test("大厅成员离开只移除其席位，房主离开才关闭房间；版本不一致不能加入", async (t) => {
  const { host, guest, url } = await pair(t);
  const code = host.state.room.code;
  guest.close();
  await until(() => host.state.room.players.length === 1);
  assert.equal(host.state.error, "", "成员离开不解散房间");
  assert.equal(host.state.canStart, false);
  const second = new MultiplayerSession(url, code, config.players[1], connection());
  t.after(() => second.close());
  await until(() => second.state.room && host.state.canStart);
  assert.equal(second.state.self, 1);
  const third = new MultiplayerSession(url, code, player, connection());
  t.after(() => third.close());
  await until(() => host.state.room.players.length === 3);
  second.close();
  await until(() => host.state.room.players.length === 2 && third.state.self === 1);
  assert.equal(third.state.room.players[1].starter, "charmander", "后面的席位顺移");
  await until(() => host.state.canStart);
  host.close();
  await until(() => third.state.error);
  assert.match(third.state.error, /房主已离开/);
  const missing = new MultiplayerSession(url, code, player, connection());
  t.after(() => missing.close());
  await until(() => missing.state.error);
  assert.match(missing.state.error, /不存在/);
  const fresh = new MultiplayerSession(url, "", player, connection());
  t.after(() => fresh.close());
  await until(() => fresh.state.room);
  globalThis.__GAME_BUILD__ = "other-build";
  const incompatible = new MultiplayerSession(url, fresh.state.room.code, player, connection());
  t.after(() => incompatible.close());
  await until(() => incompatible.state.error);
  globalThis.__GAME_BUILD__ = "network-test";
  assert.match(incompatible.state.error, /版本不同/);
  assert.equal(fresh.state.room.players.length, 1);
});

test("大厅席位顺移后，留下成员的直连仍归属其新席位", async (t) => {
  const direct = directPeers();
  const { sessions } = await party(t, 3, [direct.factory, undefined, direct.factory]);
  assert.deepEqual(sessions[0].state.peers, { 1: "relay", 2: "direct" });
  const [host, leaving, staying] = sessions;
  leaving.close();
  await until(() => host.state.room.players.length === 2 && staying.state.self === 1);
  for (const peer of direct.peers.filter((peer) => peer.open)) peer.send("P");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(host.state.error, "");
  assert.deepEqual(host.state.peers, { 1: "direct" });
});

test("地图编码保留类型、float32 位与负零，未知数组显式失败", () => {
  const input = {
    heights: new Float32Array([0.1, -0, 17.25]),
    mask: new Uint8Array([0, 255]),
    zero: -0,
  };
  assert.deepEqual(decode(encode(input)), input);
  assert.throws(() => decode('{"$array":"Unknown","bytes":""}'), /数组格式/);
});

test("意外断线只影响断线席位：房主继续，客机重连后续上原地图且不重载", async (t) => {
  const { host, guest } = await pair(t);
  let a, b;
  host.onStart = (settings) => {
    a = new MultiplayerRun(host, settings);
  };
  guest.onStart = (settings) => {
    b = new MultiplayerRun(guest, settings);
  };
  host.start("forest", 0);
  await until(() => a && b);
  const world = createWorld(config);
  a.publishMap(world);
  let remote = await b.initial();
  b.loading(remote);
  await b.ready();
  await a.ready();
  for (const disconnect of [guest, host, guest]) {
    world.players[1].inputX = 1;
    disconnect.socket.close();
    await until(() => b.reconnecting && !host.isReachable(1));
    assert.equal(a.suspended, false, "房主不因一个席位断线暂停");
    assert.equal(world.players[1].inputX, 0, "断线席位不保留按住的方向");
    const tickBefore = world.tick;
    stepWorld(world, a.submit([{ t: "dash", player: 0 }]));
    assert.equal(world.tick, tickBefore + 1, "其他玩家继续推进");
    await until(() => {
      a.publish(world, [], tick);
      return !b.reconnecting;
    });
    assert.equal(b.takeMap(), undefined, "已载入同一地图的客机无需重载");
    assert.equal(b.suspended, false);
    await until(() => {
      a.publish(world, [], tick);
      b.apply(remote, tick);
      return remote.tick === world.tick;
    });
  }
  assert.deepEqual(
    world.events.filter((event) => event.t === "peer").map((event) => event.state),
    ["offline", "online", "offline", "online", "offline", "online"],
  );
  b.dispose();
  await until(() => world.players[1].departed);
  assert.equal(host.state.error, "");
});

test("队友重开客户端用原凭据重返，旧载入确认不能解除新快照等待", async (t) => {
  const { host, guest, url } = await pair(t);
  let a, b, ticket;
  guest.onTicket = (value) => {
    ticket = value;
  };
  host.onStart = (settings) => {
    a = new MultiplayerRun(host, settings);
  };
  guest.onStart = (settings) => {
    b = new MultiplayerRun(guest, settings);
  };
  host.start("forest", 0);
  await until(() => a && b);
  const world = createWorld(config);
  a.publishMap(world);
  const first = await b.initial();
  b.loading(first);
  await b.ready();
  await a.ready();
  b.dispose(false);
  assert(ticket, "退出客户端保留重返凭据");
  await until(() => !host.state.room.online.includes(1));
  assert.equal(a.suspended, false);
  const replacement = new MultiplayerSession(url, ticket.code, player, connection(ticket));
  t.after(() => replacement.close());
  let c;
  replacement.onStart = (settings) => {
    c = new MultiplayerRun(replacement, settings);
  };
  await until(() => c);
  const restored = await c.initial();
  assert.equal(c.player, 1);
  assert.equal(c.config.players[1].starter, "squirtle");
  c.loading(restored);
  // Host changes map while this renderer is warming the preceding snapshot.
  world.zone.phase = "transitioning";
  enterZone(world, prepareZone(world));
  a.publishMap(world);
  let latest;
  await until(() => {
    latest = c.takeMap();
    return latest;
  });
  await c.ready();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(a.suspended, true, "过期 ready 不能让新地图开跑");
  c.loading(latest);
  await c.ready();
  await until(() => !a.suspended && !c.suspended);
  assert.equal(mapDigest(latest.map), mapDigest(world.map));
  host.close();
  await until(() => replacement.state.error);
  assert.match(replacement.state.error, /离开/);
});

test("结算交付期间断线仍能恢复同一终局，不依赖地图准备或渲染", async (t) => {
  const { host, guest } = await pair(t);
  let a, b;
  host.onStart = (settings) => {
    a = new MultiplayerRun(host, settings);
  };
  guest.onStart = (settings) => {
    b = new MultiplayerRun(guest, settings);
  };
  host.start("forest", 0);
  await until(() => a && b);
  const world = createWorld(config);
  a.publishMap(world);
  const remote = await b.initial();
  b.loading(remote);
  await b.ready();
  await a.ready();
  guest.socket.close();
  // Simulate a final host tick before its socket observes the peer's loss.
  stepWorld(world, [{ t: "forfeit" }]);
  a.publish(world, [], 0, true);
  a.dispose();
  await until(() => guest.ended && host.closed);
  assert(b.apply(remote, 0));
  assert.equal(remote.outcome, "defeat");
});

test("离线时离开，重连后仍交付离开，房主继续", async (t) => {
  const { host, guest } = await pair(t);
  let a, b;
  host.onStart = (settings) => {
    a = new MultiplayerRun(host, settings);
  };
  guest.onStart = (settings) => {
    b = new MultiplayerRun(guest, settings);
  };
  host.start("forest", 0);
  await until(() => a && b);
  guest.socket.close();
  b.dispose();
  await until(() => host.state.room.departed.includes(1) && guest.closed);
  assert.equal(host.state.error, "");
  assert.equal(a.suspended, false);
});

test("三人局客机断线中放弃只让自己离开，其余两人继续", async (t) => {
  const { sessions } = await party(t, 3);
  const { runs, worlds } = await startParty(sessions);
  const errors = [];
  for (const run of runs) run.onError = (error) => errors.push(error.message);
  for (const run of runs.slice(1)) await run.ready();
  await until(() => runs.every((run) => !run.suspended));
  sessions[1].socket.close();
  runs[1].quit();
  runs[1].dispose();
  await until(() => sessions[1].closed && worlds[0].players[1].departed);
  assert.equal(worlds[0].outcome, "playing");
  assert.equal(sessions[2].closed, false);
  await until(() => {
    runs[0].publish(worlds[0], [], tick);
    return runs[2].apply(worlds[2], 0);
  });
  assert.equal(worlds[2].players[1].departed, true, "队友看到离开的席位");
  assert.deepEqual(errors, []);
});

test("重返时服务暂时不可达不清除凭据，恢复服务后自动重试", async (t) => {
  const { host, guest, url } = await pair(t);
  let ticket;
  guest.onTicket = (value) => {
    ticket = value;
  };
  host.start("forest", 0);
  await until(() => ticket);
  guest.close(false);
  // Reserve a server's ephemeral port then stop it to produce a real connection refusal.
  const unavailable = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const badUrl = `ws://127.0.0.1:${unavailable.port}/multiplayer`;
  unavailable.stop(true);
  const replacement = new MultiplayerSession(badUrl, ticket.code, player, connection(ticket));
  t.after(() => replacement.close(false));
  const cleared = [];
  replacement.onTicket = (value) => cleared.push(value);
  await until(() => replacement.attempts > 0);
  assert.deepEqual(cleared, []);
  assert.equal(replacement.state.error, "");
  replacement.url = url;
  await until(() => replacement.playing);
  assert.equal(replacement.state.self, 1);
});

/** Ordered/reliable like both production transports, with independently jittered one-way delays. */
function delayedTransport(count = 2) {
  let now = 0;
  let enabled = false;
  let random = 7123;
  const packets = [];
  const sent = [];
  const last = new Map();
  const endpoints = Array.from({ length: count }, (_, self) => ({
    state: { self },
    receive(fn) {
      this.receiver = fn;
      return () => {};
    },
    send(packet, replaceable = false, target) {
      if (this.blocked && replaceable) return false;
      const text = encode(packet);
      // Accepted locally but lost with a path that is about to break.
      if (this.losing) {
        sent.push({ at: now, self, packet: decode(text), lost: true });
        return true;
      }
      sent.push({
        at: now,
        self,
        packet: decode(text),
        bytes: new TextEncoder().encode(text).length,
      });
      const targets =
        target !== undefined ? [target] : self ? [0] : endpoints.slice(1).map((e) => e.state.self);
      for (const target of targets) {
        const copy = decode(text);
        if (!enabled) {
          endpoints[target].receiver(copy, self);
          continue;
        }
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const edge = `${self}:${target}`;
        const due = Math.max(last.get(edge) ?? 0, now + 60 + (random / 2 ** 32) * 30);
        last.set(edge, due);
        packets.push({ due, target, packet: copy, from: self });
      }
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
  return {
    endpoints,
    sent,
    start() {
      enabled = true;
      sent.length = 0;
    },
    advance(ms) {
      now = ms;
      packets.sort((a, b) => a.due - b.due);
      while (packets[0]?.due <= now) {
        const entry = packets.shift();
        endpoints[entry.target].receiver(entry.packet, entry.from);
      }
    },
  };
}

async function memoryRun() {
  const wire = delayedTransport();
  const host = new MultiplayerRun(wire.endpoints[0], config);
  const guest = new MultiplayerRun(wire.endpoints[1], config);
  const world = createWorld(config);
  host.publishMap(world);
  const remote = await guest.initial();
  guest.loading(remote);
  await guest.ready();
  await host.ready();
  return { wire, host, guest, world, remote };
}

const tick = 1 / 30;
const screenX = (world, id, alpha) => {
  const p = world.players[id];
  return p.px + (p.x - p.px) * alpha;
};

test("终局越过直连在途帧时等待可靠屏障，迟到地图与重复终局不重放", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  const oldMap = wire.sent.find((entry) => entry.packet.t === "map").packet;
  wire.start();
  host.publish(world, [{ t: "banner", text: "战斗", tone: "boss", kind: "clear" }], tick, true);
  const oldFrame = wire.sent.find((entry) => entry.packet.t === "frame").packet;
  stepWorld(world, [{ t: "forfeit" }]);
  host.publish(world, [{ t: "banner", text: "终局", tone: "boss", kind: "clear" }], 0, true);
  const terminal = wire.sent.find((entry) => entry.packet.t === "terminal").packet;
  wire.endpoints[1].receiver(structuredClone(terminal), 0); // Independent Harbor route wins the race.
  assert.equal(guest.apply(remote, tick), false);
  assert.equal(remote.outcome, "playing", "the ordered feedback has not arrived yet");
  wire.advance(200); // First arrivals of the reliable frame and barrier, not duplicate frames.
  for (const packet of [oldFrame, oldMap, terminal])
    wire.endpoints[1].receiver(structuredClone(packet), 0);
  const player = remote.players[1];
  assert(guest.apply(remote, 0));
  guest.apply(remote, tick);
  assert.equal(remote.outcome, "defeat");
  assert.equal(remote.players[1], player);
  assert.deepEqual(
    remote.events.filter((event) => event.t === "banner").map((event) => event.text),
    ["战斗", "终局"],
  );
});

test("离线客机收到后图终局时先载入最终场地，再显示一次结果", async () => {
  const { wire, host, guest, remote } = await memoryRun();
  const tower = createWorld({ ...config, stage: "tower" });
  tower.outcome = "victory";
  wire.start();
  host.publish(tower, [], 0, true);
  const terminal = wire.sent.find((entry) => entry.packet.t === "terminal").packet;
  wire.endpoints[1].onPath(0, false);
  wire.endpoints[1].receiver(structuredClone(terminal), 0);
  assert.equal(guest.suspended, true);
  assert.equal(
    guest.apply(remote, tick),
    false,
    "old scene cannot acquire a different map silently",
  );
  assert.equal(remote.stage, "forest");
  const result = guest.takeMap();
  assert.equal(result.stage, "tower");
  assert.equal(result.outcome, "victory");
  guest.loading(result);
  assert.equal(guest.apply(remote, tick), false, "resource warmup is still in progress");
  await guest.ready();
  assert.equal(guest.suspended, false);
  assert.ok(guest.apply(remote, 0));
  assert.equal(remote.stage, "tower");
  assert.equal(remote.outcome, "victory");
  wire.endpoints[1].receiver(structuredClone(terminal), 0);
  assert.equal(guest.takeMap(), undefined);
  assert.equal(guest.apply(remote, tick), false, "duplicate result is not replayed");
});

test("终局已到但可靠屏障断线丢失时，恢复直接交付完整结果", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  wire.start();
  stepWorld(world, [{ t: "forfeit" }]);
  host.publish(world, [], 0, true);
  const terminal = wire.sent.find((entry) => entry.packet.t === "terminal").packet;
  wire.endpoints[1].receiver(terminal, 0);
  assert.equal(guest.apply(remote, tick), false);
  wire.endpoints[1].onPath(0, false);
  assert(guest.apply(remote, 0));
  assert.equal(remote.outcome, "defeat");
});

test("可靠屏障随断开的直连丢失后，终局经新路径到达仍直接交付", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  wire.endpoints[0].losing = true;
  stepWorld(world, [{ t: "forfeit" }]);
  host.publish(world, [], 0, true);
  wire.endpoints[0].losing = false;
  const terminal = wire.sent.find((entry) => entry.packet.t === "terminal").packet;
  wire.endpoints[1].onPath(0, true);
  wire.endpoints[1].receiver(structuredClone(terminal), 0);
  assert(guest.apply(remote, 0));
  assert.equal(remote.outcome, "defeat");
});

test("在途丢失的命中与事件在路径重置后补发，且只结算一次", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { wire, host, guest, world } = await memoryRun();
  const p = world.players[1];
  p.moves[0].cooldown = 0;
  const enemy = spawnEnemy(world, "rattata", p.x, p.z + 2);
  enemy.hp = enemy.maxHp = 1000;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  wire.endpoints[1].losing = true;
  for (
    let i = 0;
    i < 60 && !wire.sent.some((e) => e.lost && e.packet.effects?.some((f) => f.t === "hit"));
    i++
  )
    guest.apply(remote, tick);
  wire.endpoints[1].losing = false;
  assert(
    wire.sent.some((e) => e.lost && e.packet.effects?.some((f) => f.t === "hit")),
    "命中随旧路径丢失",
  );
  assert.equal(enemy.hp, 1000);
  wire.endpoints[0].losing = true;
  host.publish(world, [{ t: "banner", text: "丢失", tone: "info" }], tick, true);
  wire.endpoints[0].losing = false;
  wire.endpoints[1].onPath(0, true);
  wire.endpoints[0].onPath(1, true);
  const hp = enemy.hp;
  assert(hp < 1000, "补发的命中结算");
  host.publish(world, [], tick, true);
  remote.events = [];
  guest.apply(remote, tick);
  for (const entry of wire.sent.filter((e) => !e.lost && e.self === 1 && e.packet.t === "owner"))
    wire.endpoints[0].receiver(structuredClone(entry.packet), 1);
  assert.equal(enemy.hp, hp, "重复补发不再扣血");
  host.publish(world, [], tick, true);
  for (let i = 0; i < 10; i++) guest.apply(remote, tick);
  assert.equal(
    remote.events.filter((event) => event.t === "banner" && event.text === "丢失").length,
    1,
    "丢失的事件补发且只播放一次",
  );
});

test("客机输入同一 tick 移动、转向与冲刺；预测不改变战斗、随机状态或队友", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  wire.start();
  const before = structuredClone({
    rng: remote.rng,
    hp: remote.players[1].hp,
    enemies: remote.enemies,
    other: remote.players[0],
  });
  const x = remote.players[1].x;
  guest.submit([
    { t: "move", player: 1, x: 1, z: 0 },
    { t: "view", player: 1, yaw: 1 },
  ]);
  guest.apply(remote, tick / 2);
  assert(screenX(remote, 1, guest.alpha()) > x, "不等网络回包就能在本地 tick 看到移动");
  const firstX = screenX(remote, 1, guest.alpha());
  guest.apply(remote, tick / 2);
  assert(screenX(remote, 1, guest.alpha()) > firstX, "两个显示帧都必须推进，不能隔帧停住");
  assert.equal(remote.players[1].faceX, 1);
  assert.equal(remote.players[1].viewYaw, 1);
  assert.equal(world.players[1].x, x, "房主尚未收到指令");
  guest.submit([{ t: "dash", player: 1 }]);
  guest.apply(remote, tick);
  assert(remote.players[1].dashTime > 0);
  assert.equal(remote.players[1].dashes, 0);
  assert.equal(
    remote.events.filter((event) => event.t === "dash").length,
    1,
    "本机冲刺立即反馈一次",
  );
  assert.deepEqual(
    {
      rng: remote.rng,
      hp: remote.players[1].hp,
      enemies: remote.enemies,
      other: remote.players[0],
    },
    before,
  );
  // A path reset loses in-flight input: unacknowledged samples go again and apply once.
  wire.endpoints[1].onPath(0, false);
  wire.endpoints[0].onPath(1, false);
  assert.equal(guest.reconnecting, true);
  assert.equal(world.players[1].inputX, 0, "断线期间房主清空该席位方向");
  wire.endpoints[0].onPath(1, true);
  wire.endpoints[1].onPath(0, true);
  wire.advance(200);
  wire.advance(400);
  assert.equal(guest.takeMap(), undefined, "同一地图只续传，不重载");
  assert.equal(guest.reconnecting, false);
  const commands = host.submit([]);
  assert.deepEqual(
    commands.filter((command) => command.t === "move").map((command) => command.x),
    [1],
    "未确认的移动重发且只提交一次",
  );
});

test("主人位置不被旧快照拉回；重复 owner 包不重复冲刺，背压后补全实体与事件", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  guest.submit([
    { t: "move", player: 1, x: 1, z: 0 },
    { t: "dash", player: 1 },
  ]);
  guest.apply(remote, tick);
  const ownerPacket = wire.sent.find((entry) => entry.packet.t === "owner").packet;
  const x = remote.players[1].x;
  wire.endpoints[0].receiver(ownerPacket, 1);
  assert.equal(world.players[1].dashes, 0);
  assert.equal(host.takeEvents().length, 0, "远端事件等待播放时钟");
  world.players[1].x -= 1;
  host.publish(world, [], tick, true);
  guest.apply(remote, 0);
  assert.equal(remote.players[1].x, x, "旧房主位置不能覆盖 owner");
  const baseline = structuredClone(guest.baseline);
  wire.endpoints[0].blocked = true;
  const event = { t: "banner", text: "背压事件", tone: "boss", kind: "clear" };
  world.pickups = [{ id: 999, x: 1, z: 1, kind: "xp", value: 1, magnet: false }];
  host.publish(world, [event], 0.2);
  world.pickups[0].x = 2;
  wire.endpoints[0].blocked = false;
  host.publish(world, [], tick);
  guest.apply(remote, tick);
  for (let i = 0; i < 20; i++) guest.apply(remote, tick);
  assert.equal(remote.events.filter((entry) => entry.text === event.text).length, 1);
  const recoveredFrame = wire.sent.filter((entry) => entry.packet.t === "frame").at(-1).packet;
  assert(recoveredFrame.state.enemies || recoveredFrame.delta, "被跳过的重状态仍然待发送");
  assert.deepEqual(
    recoveredFrame.delta
      ? applyEntityDelta(baseline, recoveredFrame.delta)
      : entityState(recoveredFrame.state),
    host.guests.get(1).baseline,
    "跳过的包不能推进差分基准",
  );
  assert.equal(host.guests.get(1).baseline.pickups[0].x, 2);
});

test("后台连续历史被裁后重定位播放，积压事件按序只播放一次；短抖动仍微调", async () => {
  for (const count of [15, 32, 300]) {
    const { host, guest, world, remote } = await memoryRun();
    for (let i = 1; i <= count; i++) {
      world.pickups = [{ id: 999, x: i, z: 0, kind: "xp", value: 1, magnet: false }];
      host.publish(world, [{ t: "banner", text: `积压${i}`, tone: "boss", kind: "clear" }], tick);
    }
    const before = guest.renderClock;
    guest.apply(remote, tick);
    if (count === 15) {
      assert(guest.renderClock - before < 0.05, "历史完整时不跳时钟");
      continue;
    }
    assert(guest.newestClock - guest.renderClock < 0.2, "历史丢失后立即恢复可播放时间");
    assert(remote.pickups[0].x >= count - 6, "实体与同一时刻事件一起恢复");
    for (let i = 0; i < 30; i++) guest.apply(remote, tick);
    assert.deepEqual(
      remote.events.filter((event) => event.t === "banner").map((event) => event.text),
      Array.from({ length: count }, (_, i) => `积压${i + 1}`),
    );
    if (count === 300) {
      const messages = remote.events.filter((event) => event.t === "banner");
      assert.ok(
        guest.eventAgeMs(messages[0]) > 9000,
        "trimmed playback does not renew old notices",
      );
      assert.ok(guest.eventAgeMs(messages.at(-1)) < 2600, "the newest notice remains eligible");
    }
  }
});

test("通知年龄保留背压与后台积压时间，可靠事件仍按序交付，终局不补播文字", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  const realNow = performance.now.bind(performance);
  let now = 1000;
  performance.now = () => now;
  try {
    const old = { t: "banner", text: "旧冲锋", tone: "danger", kind: "stampede" };
    const recent = { t: "banner", text: "新喷发", tone: "danger", kind: "eruption" };
    const captured = { t: "capture", player: 1, partner: 71, species: "rattata", x: 1, z: 2 };
    wire.endpoints[0].blocked = true;
    host.publish(world, [old, captured], tick);
    for (let i = 0; i < 100; i++) host.publish(world, [], tick);
    wire.endpoints[0].blocked = false;
    host.publish(world, [recent], tick);
    for (let i = 0; i < 120; i++) guest.apply(remote, tick);
    const delivered = remote.events.filter(
      (event) => event.t === "banner" || event.t === "capture",
    );
    assert.deepEqual(
      delivered,
      [old, captured, recent],
      "backpressure preserves reliable order and payloads",
    );
    assert.ok(guest.eventAgeMs(delivered[0]) > 3000, "old danger keeps its authoritative age");
    assert.ok(guest.eventAgeMs(delivered[1]) > 3000, "personal rewards keep the same batch age");
    assert.equal(guest.eventAgeMs(delivered[2]), 0);
    now += 1700;
    assert.equal(
      guest.eventAgeMs(delivered[2]),
      1700,
      "a stalled local renderer still ages notices",
    );
    guest.apply(remote, tick);
    assert.equal(remote.events.filter((event) => event.t === "capture").length, 1);
    host.publish(world, [{ t: "banner", text: "遮挡后过期", tone: "info", kind: "zone" }], tick);
    now += 3000;
    host.publish(world, [], tick);
    for (let i = 0; i < 10; i++) guest.apply(remote, tick);
    const held = remote.events.find((event) => event.text === "遮挡后过期");
    assert.ok(held);
    assert.ok(
      guest.eventAgeMs(held) >= 3000,
      "a new clock anchor cannot rejuvenate a batch already received",
    );
    stepWorld(world, [{ t: "forfeit" }]);
    host.publish(world, [], 0, true);
    guest.apply(remote, 0);
    assert.equal(remote.outcome, "defeat");
    assert.equal(
      guest.eventAgeMs(delivered[2]),
      Infinity,
      "terminal feedback cannot open a new notice",
    );
  } finally {
    performance.now = realNow;
    host.dispose();
    guest.dispose();
  }
});

test("房主停帧期间在途命中产生的捕获按发生时间过期，可靠事实仍交付一次", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { newMoveState } = await import("../src/run/sim/upgrades.ts");
  const { wire, host, guest, world } = await memoryRun();
  const player = world.players[1];
  player.moves = [newMoveState("thunderbolt")];
  player.moves[0].cooldown = 0;
  player.items.push({ id: "master-ball", level: 1 });
  const enemy = spawnEnemy(world, "rattata", player.x, player.z + 2, true);
  enemy.hp = 1;
  enemy.speed = 0;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  wire.start();
  const realNow = performance.now.bind(performance);
  let now = 1000;
  performance.now = () => now;
  try {
    guest.apply(remote, tick);
    world.paused = true;
    wire.advance(100);
    const captured = world.events.find((event) => event.t === "capture");
    assert.ok(captured, "the in-flight hit settles a real capture while paused");
    now += 5000;
    assert.equal(host.eventAgeMs(captured), 5000);
    host.publish(world, world.events.splice(0), tick, true);
    wire.advance(200);
    for (let i = 0; i < 10; i++) guest.apply(remote, tick);
    const delivered = remote.events.filter((event) => event.t === "capture");
    assert.equal(delivered.length, 1);
    assert.equal(guest.eventAgeMs(delivered[0]), 5000);
  } finally {
    performance.now = realNow;
    host.dispose();
    guest.dispose();
  }
});

test("背压后房主停帧仍累计消息年龄，不改视觉播放时刻或丢弃可靠事件", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  const realNow = performance.now.bind(performance);
  let now = 1000;
  performance.now = () => now;
  try {
    const danger = { t: "banner", text: "旧冲锋", tone: "danger", kind: "stampede" };
    wire.endpoints[0].blocked = true;
    host.publish(world, [danger], tick);
    now += 5000;
    wire.endpoints[0].blocked = false;
    host.publish(world, [], tick, true);
    guest.apply(remote, tick);
    assert.equal(remote.events.length, 0, "notice age cannot advance visual event delivery");
    for (let i = 0; i < 10; i++) guest.apply(remote, tick);
    assert.deepEqual(remote.events, [danger]);
    assert.equal(guest.eventAgeMs(remote.events[0]), 5000);
    const frame = wire.sent.filter((entry) => entry.packet.t === "frame").at(-1).packet;
    for (const ageMs of [-1, Infinity, NaN]) {
      const invalid = structuredClone(frame);
      invalid.events[0].ageMs = ageMs;
      assert.throws(() => wire.endpoints[1].receiver(invalid, 0), /世界输入确认格式错误/);
    }
  } finally {
    performance.now = realNow;
    host.dispose();
    guest.dispose();
  }
});

test("恢复快照保留可靠事实但不重播通知，房主待交付消息跨恢复不重置年龄", async () => {
  const { wire, host, guest, world } = await memoryRun();
  const realNow = performance.now.bind(performance);
  let now = 1000;
  performance.now = () => now;
  try {
    const pending = { t: "banner", text: "恢复前冲锋", tone: "danger", kind: "stampede" };
    world.events.push(pending);
    // A reopened client holds no map: the host sends this guest a fresh one, nobody else waits.
    wire.endpoints[0].receiver({ t: "hello", revision: 0, ready: false }, 1);
    assert.equal(host.suspended, false);
    const recovered = guest.takeMap();
    guest.loading(recovered);
    host.publish(world, world.events.splice(0), tick);
    now += 3000;
    await guest.ready();
    assert.equal(guest.suspended, false);
    host.publish(world, [], tick, true);
    for (let i = 0; i < 10; i++) guest.apply(recovered, tick);
    assert.deepEqual(recovered.events, [pending], "载入期间的事实在首帧交付一次");
    assert.ok(guest.eventAgeMs(recovered.events[0]) >= 3000, "载入期间的等待计入通知年龄");

    const snapshot = structuredClone(
      wire.sent.filter((entry) => entry.packet.t === "map").at(-1).packet,
    );
    snapshot.snapshot.events = [pending, { t: "revive", player: 1 }];
    wire.endpoints[1].receiver(snapshot, 0);
    const restored = guest.takeMap();
    assert.deepEqual(
      restored.events,
      snapshot.snapshot.events,
      "restoration retains reliable event payloads",
    );
    for (const event of restored.events)
      assert.equal(
        guest.eventAgeMs(event),
        Infinity,
        "untimed restored feedback cannot become a fresh notice",
      );
  } finally {
    performance.now = realNow;
    host.dispose();
    guest.dispose();
  }
});

test("owner 的终极技、弹体和范围攻击缺字段在修改世界前拒绝，合法同序号仍可提交", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { newMoveState } = await import("../src/run/sim/upgrades.ts");
  const { ownerState } = await import("../src/network/owner.ts");
  const { wire, host, guest, world } = await memoryRun();
  const player = world.players[1];
  player.moves = [newMoveState("water-gun"), newMoveState("rapid-spin")];
  for (const move of player.moves) move.cooldown = 0;
  const enemy = spawnEnemy(world, "rattata", player.x, player.z + 3);
  enemy.hp = enemy.maxHp = 1000;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  wire.start();
  guest.apply(remote, tick);
  const packet = wire.sent.find((entry) => entry.packet.t === "owner").packet;
  assert(packet.projectiles.length && packet.areas.length, "使用真实技能 runner 的实体");
  const before = ownerState(player);
  for (const corrupt of [
    (copy) => (copy.state.ult = {}),
    (copy) => (copy.state.ult.stage = 999),
    (copy) => (copy.state.ult.next = -1),
    (copy) => (copy.state.ult.crossed = null),
    (copy) => delete copy.projectiles[0].hit,
    (copy) => delete copy.projectiles[0].vy,
    (copy) => (copy.projectiles[0].archetype = "cone"),
    (copy) => delete copy.areas[0].tickTimer,
    (copy) => (copy.areas[0].kind = "unknown"),
    (copy) => (copy.areas[0].owner = 99),
    (copy) =>
      copy.events.push({ t: "banner", kind: "fusion", tone: "boss", player: 1, text: "伪造融合" }),
    (copy) =>
      copy.events.push({ t: "capture", player: 1, partner: 3, species: "rattata", x: 0, z: 0 }),
    (copy) => copy.events.push({ t: "evolve", player: 1, stage: 1, form: "charmeleon" }),
    (copy) => copy.events.push({ t: "revive", player: 1 }),
    (copy) => copy.events.push({ t: "down", player: 999 }),
  ]) {
    const invalid = structuredClone(packet);
    corrupt(invalid);
    assert.throws(() => wire.endpoints[0].receiver(invalid, 1), /玩家/);
    assert.deepEqual(ownerState(player), before);
    assert.equal(world.projectiles.length, 0);
    assert.equal(world.areas.length, 0);
    assert.equal(enemy.hp, 1000);
  }
  wire.endpoints[0].receiver(packet, 1);
  assert(world.projectiles.some((shot) => shot.owner === 1));
  assert(world.areas.some((area) => area.owner === 1));
  assert.doesNotThrow(() => host.step(world, []));
});

test("真实吸血命中的可选字段先校验，非法包不能污染 HP 或消耗序号", async () => {
  const { OwnerSimulation } = await import("../src/network/owner.ts");
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { newMoveState } = await import("../src/run/sim/upgrades.ts");
  const { snapshotWorld } = await import("../src/run/sim/snapshot.ts");
  const { wire, host, world } = await memoryRun();
  const player = world.players[1];
  player.moves = [newMoveState("giga-drain")];
  player.moves[0].cooldown = 0;
  const enemy = spawnEnemy(world, "rattata", player.x, player.z + 1);
  enemy.hp = enemy.maxHp = 1000;
  const owner = new OwnerSimulation(world, 1, -2e12);
  let frame;
  for (let i = 0; i < 120; i++) {
    owner.advance(world, [], tick, false);
    frame = decode(encode(owner.frame()));
    if (frame.effects.some((effect) => effect.t === "hit")) break;
  }
  assert(frame.effects.find((effect) => effect.t === "hit").hit.drain > 0);
  const packet = {
    t: "owner",
    revision: host.revision,
    sequence: 1,
    grantAck: 0,
    eventAck: -1,
    life: 0,
    ...frame,
  };
  const hp = player.hp;
  for (const field of ["drain", "secondary"]) {
    const bad = structuredClone(packet);
    bad.effects.find((effect) => effect.t === "hit").hit[field] = "invalid";
    assert.throws(() => wire.endpoints[0].receiver(bad, 1), /命中数据/);
    assert.equal(player.hp, hp);
    assert.equal(enemy.hp, 1000);
  }
  wire.endpoints[0].receiver(packet, 1);
  assert(enemy.hp < 1000);
  assert(Number.isFinite(player.hp));
  assert.doesNotThrow(() => snapshotWorld(world));
});

test("150±30ms RTT 下远端快照单调插值，不因抖动或追帧瞬移；房主平滑显示客机", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  wire.start();
  let nextTick = 0;
  let previous = world.players[0].x;
  let previousHostGuest = world.players[1].x;
  let maxStep = 0;
  let maxHostStep = 0;
  let walkingFrames = 0;
  guest.submit([{ t: "move", player: 1, x: 1, z: 0 }]);
  for (let ms = 0; ms <= 2400; ms += 1000 / 60) {
    wire.advance(ms);
    if (ms + 1e-6 >= nextTick) {
      stepWorld(world, host.submit([{ t: "move", player: 0, x: 1, z: 0 }]));
      nextTick += 1000 / 30;
    }
    host.publish(world, world.events.splice(0), 1 / 60);
    guest.apply(remote, 1 / 60);
    const x = screenX(remote, 0, guest.alpha());
    assert(x >= previous - 1e-9, `远端倒退 ${previous} -> ${x}`);
    assert(x <= world.players[0].x + 1e-9, "不能外推超过权威位置");
    maxStep = Math.max(maxStep, x - previous);
    previous = x;
    const authoritative = structuredClone(world.players[1]);
    const speeds = host.presentHost(world);
    const hostX = screenX(world, 1, 1);
    assert.equal(screenX(world, 1, 0.25), hostX, "已采样的客机坐标不能再次按房主 tick 插值");
    if (hostX > previousHostGuest + 1e-6) {
      assert(speeds.get(1) > 0.1, "客机移动时必须向跑步动画提供非零展示速度");
      walkingFrames++;
    }
    assert(hostX >= previousHostGuest - 1e-9);
    maxHostStep = Math.max(maxHostStep, hostX - previousHostGuest);
    previousHostGuest = hostX;
    host.restoreHost(world);
    assert.deepEqual(world.players[1], authoritative, "绘制后完整恢复房主结算使用的玩家状态");
  }
  assert(previous > 2, "必须实际播放移动，不能停在原地冒充平滑");
  assert(maxStep < 0.16, `快照插值最大单帧位移 ${maxStep}`);
  assert(maxHostStep < 0.16, `房主看到客机最大单帧位移 ${maxHostStep}`);
  assert(walkingFrames > 60, "持续移动必须持续播放跑步动画");
  host.publish(world, [], 0.5);
  const stoppedSpeeds = host.presentHost(world);
  assert.equal(stoppedSpeeds.get(1), 0, "超过最新快照后停止跑步，不无限外推");
  host.restoreHost(world);
  console.log(
    `interpolation: guest remote max/frame=${maxStep.toFixed(4)}, host remote=${maxHostStep.toFixed(4)}`,
  );
});

async function measureLatency() {
  const { wire, host, guest, world, remote } = await memoryRun();
  const client = guest;
  wire.start();
  const presses = Array.from({ length: 12 }, (_, i) => 250 + i * 600 + (i % 5) * 7);
  const measured = [[], []];
  let request = 0,
    release = Infinity,
    direction = 0;
  let mark;
  let nextFrame = 1000 / 60;
  let accumulator = 0,
    publishTime = 0;
  let commands = [];
  for (let ms = 0; ms <= 7600; ms++) {
    wire.advance(ms);
    if (ms === presses[request]) {
      direction = request % 2 ? -1 : 1;
      release = ms + 200;
      mark = {
        at: ms,
        direction,
        start: [screenX(world, 0, accumulator / tick), screenX(remote, 1, client.alpha())],
        done: [false, false],
      };
      commands.push({ t: "move", player: 0, x: direction, z: 0 });
      client.submit([{ t: "move", player: 1, x: direction, z: 0 }]);
      request++;
    }
    if (ms === release) {
      direction = 0;
      commands.push({ t: "move", player: 0, x: 0, z: 0 });
      client.submit([{ t: "move", player: 1, x: 0, z: 0 }]);
    }
    if (ms + 1e-6 < nextFrame) continue;
    nextFrame += 1000 / 60;
    accumulator += 1 / 60;
    while (accumulator + 1e-9 >= tick) {
      stepWorld(world, host.submit(commands));
      commands = [];
      accumulator = Math.max(0, accumulator - tick);
    }
    publishTime += 1 / 60;
    if (publishTime > 0) {
      host.publish(world, world.events.splice(0), publishTime);
      publishTime = 0;
    }
    client.apply(remote, 1 / 60);
    if (!mark) continue;
    const screen = [screenX(world, 0, accumulator / tick), screenX(remote, 1, client.alpha())];
    for (const id of [0, 1]) {
      if (!mark.done[id] && mark.direction * (screen[id] - mark.start[id]) > 0.001) {
        measured[id].push(ms - mark.at);
        mark.done[id] = true;
      }
    }
  }
  assert.equal(measured[0].length, presses.length);
  assert.equal(measured[1].length, presses.length);
  const summarize = (values) => ({
    mean: +(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1),
    min: Math.min(...values),
    max: Math.max(...values),
  });
  const frames = wire.sent.filter((entry) => entry.self === 0 && entry.packet.t === "frame");
  const full = frames.filter((entry) => entry.packet.state.enemies);
  const deltas = frames.filter((entry) => entry.packet.delta);
  const light = frames.filter((entry) => !entry.packet.state.enemies && !entry.packet.delta);
  const budget = {
    frames: frames.length,
    full: full.length,
    deltas: deltas.length,
    maxFullBytes: Math.max(...full.map((entry) => entry.bytes)),
    maxPlayerBytes: light.length ? Math.max(...light.map((entry) => entry.bytes)) : 0,
    maxDeltaBytes: deltas.length ? Math.max(...deltas.map((entry) => entry.bytes)) : 0,
    bytesPerSecond: Math.round(frames.reduce((sum, entry) => sum + entry.bytes, 0) / 7.6),
  };
  return { host: summarize(measured[0]), guest: summarize(measured[1]), budget };
}

// One-off before/after measurement (results recorded in docs/MULTIPLAYER.md), not a daily gate:
//   NETWORK_BENCH=1 bun test --timeout=0 -t 延迟基准 ./scripts/network.test.mjs
test(
  "延迟基准：同一 60Hz 画面/30Hz 模拟与 150±30ms RTT，测量本机权威运动",
  { skip: !process.env.NETWORK_BENCH },
  async () => {
    const after = await measureLatency();
    console.log(
      `latency-ms (12 presses, first >0.001 world-unit rendered displacement): ${JSON.stringify({ after })}`,
    );
  },
);

test("实体差分保留生成、删除、顺序、可选字段清除及负零，基准快照不被修改", () => {
  const empty = {
    players: [],
    enemies: [],
    projectiles: [],
    partners: [],
    hazards: [],
    pickups: [],
    areas: [],
  };
  const before = {
    ...empty,
    projectiles: [
      { id: 4, x: 1, y: 1, z: 0, status: "burn", hit: [2] },
      { id: 5, x: 2, y: 2, z: 1 },
    ],
  };
  const after = {
    ...empty,
    projectiles: [
      { id: 6, x: 0, y: 0, z: 0 },
      { id: 4, x: -0, y: 2, z: 0, status: undefined, hit: [2, 3] },
    ],
  };
  const unchanged = structuredClone(before);
  const patches = decode(encode(entityDelta(before, after)));
  const result = applyEntityDelta(before, patches);
  assert.deepEqual(result, decode(encode(after)));
  assert(Object.is(result.projectiles[1].x, -0));
  assert.deepEqual(before, unchanged, "插值缓冲仍引用以前的实体状态");
});

test("房主隐藏但连接正常时，客机有界预测并保留最新输入，恢复后继续收敛", async () => {
  const { host, guest, world, remote } = await memoryRun();
  for (let i = 0; i < 600; i++) {
    guest.submit([{ t: "move", player: 1, x: 1, z: i % 2 ? 0.1 : 0 }]);
    guest.apply(remote, tick);
  }
  assert(remote.players[1].x < world.players[1].x + 3, "无权威更新时不能一直走离房主");
  guest.submit([{ t: "move", player: 1, x: 0, z: 0 }]);
  for (let i = 0; i < 60; i++) {
    stepWorld(world, host.submit([]));
    host.publish(world, world.events.splice(0), tick);
    guest.apply(remote, tick);
  }
  assert(Math.abs(remote.players[1].x - world.players[1].x) < 1e-5);
  assert.equal(world.players[1].inputX, 0, "停止指令在隐藏期间仍可靠提交");
});

test("客机救援/倒地恢复保留按住方向，主动选卡不暂停队友", async (t) => {
  const { host, guest } = await pair(t);
  let a, b;
  host.onStart = (settings) => {
    a = new MultiplayerRun(host, settings);
  };
  guest.onStart = (settings) => {
    b = new MultiplayerRun(guest, settings);
  };
  host.start("forest", 0);
  await until(() => a && b);
  const world = createWorld(config);
  const initial = b.initial();
  a.publishMap(world);
  const remote = await initial;
  const ready = a.ready();
  await b.ready();
  await ready;
  await until(() => !b.suspended);
  const send = async (commands) => {
    b.submit(commands);
    let received;
    await until(() => {
      received = a.submit([]);
      return received.length > 0;
    });
    stepWorld(world, received);
  };
  const [down, rescuer] = world.players;
  down.alive = false;
  down.hp = 0;
  const move = { t: "move", player: 1, x: 1, z: 0 };
  await send([move]);
  await send([{ t: "interact", player: 1 }, move]);
  assert.equal(rescuer.rescue, null, "按住方向不能站定救援，不能因客机方向去重而绕过");
  down.alive = true;
  down.hp = 50;
  rescuer.alive = false;
  rescuer.hp = 0;
  await send([{ ...move, x: -1 }]);
  const x = rescuer.x;
  rescuer.revives = 1;
  stepWorld(world, []);
  b.submit([{ ...move, x: -1 }]);
  for (let i = 0; i < 15; i++) {
    a.step(world, a.submit([]));
    a.publish(world, world.events.splice(0), tick, true);
    await until(() => b.apply(remote, tick));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(rescuer.x < x, "倒地时改变的方向，复活后不必松开重按");
  world.pickups.push({
    id: world.nextId++,
    kind: "chest",
    x: down.x,
    z: down.z,
    value: 1,
    magnet: true,
  });
  stepWorld(world, []);
  await send([{ t: "choices", player: 1, open: true }]);
  assert.equal(rescuer.choosing, true);
  const previousTick = world.tick;
  stepWorld(world, []);
  assert.equal(world.tick, previousTick + 1);
  a.publish(world, world.events.splice(0), 0.1);
  await until(() => b.apply(remote, 0.1));
  assert.equal(remote.players[1].pending.length, 1);
  await send([{ t: "choices", player: 1, open: false }]);
  assert.equal(rescuer.pending.length, 1);
});

async function party(t, count, factories = []) {
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const url = `ws://127.0.0.1:${server.port}/multiplayer`;
  const sessions = [];
  t.after(() => {
    sessions.forEach((session) => session.close(false));
    server.stop(true);
  });
  for (let id = 0; id < count; id++) {
    const session = new MultiplayerSession(url, sessions[0]?.state.room.code ?? "", player, {
      ...connection(),
      ...(factories[id] ? { directPeer: factories[id] } : {}),
    });
    sessions.push(session);
    await until(() => session.state.room && sessions[0].state.room.players.length === id + 1);
    if (id) await until(() => sessions[0].state.canStart);
  }
  return { sessions, url, server };
}

async function startParty(sessions) {
  const runs = [];
  sessions.forEach((session, id) => {
    session.onStart = (settings) => {
      runs[id] = new MultiplayerRun(session, settings);
    };
  });
  sessions[0].start("forest", 0);
  await until(() => runs.filter(Boolean).length === sessions.length);
  const world = createWorld({ ...runs[0].config, seed: 7 });
  runs[0].publishMap(world);
  const worlds = [world, ...(await Promise.all(runs.slice(1).map((run) => run.initial())))];
  for (let id = 1; id < runs.length; id++) runs[id].loading(worlds[id]);
  return { runs, worlds, world };
}

for (const count of [3, 4])
  test(`${count} 人房间按连接分配身份，全员载入后同步输入、换区，一人离开其余继续`, async (t) => {
    const { sessions, url } = await party(t, count);
    assert.deepEqual(
      sessions.map((session) => session.state.self),
      Array.from({ length: count }, (_, i) => i),
    );
    assert.equal(sessions[0].state.canStart, true);
    assert(sessions.slice(1).every((session) => !session.state.canStart));
    assert.deepEqual(
      sessions[0].state.room.ready,
      Array.from({ length: count }, (_, i) => i),
    );
    if (count === 4) {
      const fifth = new MultiplayerSession(url, sessions[0].state.room.code, player, connection());
      t.after(() => fifth.close(false));
      await until(() => fifth.state.error);
      assert.equal(fifth.state.errorCode, "full");
      assert.equal(sessions[0].state.room.players.length, 4);
    }
    const { runs, worlds, world } = await startParty(sessions);
    const host = runs[0];
    for (let id = 1; id < count - 1; id++) await runs[id].ready();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(host.suspended, "还差最后一人不能推进模拟");
    assert(
      runs.every((run) => !run.reconnecting),
      "首次载入等待不是断线重连",
    );
    assert.deepEqual(host.submit([{ t: "dash", player: 0 }]), []);
    await runs.at(-1).ready();
    await until(() => runs.every((run) => !run.suspended));
    for (const run of runs.slice(1))
      run.submit([{ t: "move", player: 0, x: 1, z: run.player / 4 }]);
    const received = [];
    await until(() => {
      received.push(...host.submit([]));
      return received.length === count - 1;
    });
    assert.deepEqual(
      received.map((command) => command.player).sort((a, b) => a - b),
      Array.from({ length: count - 1 }, (_, i) => i + 1),
    );
    stepWorld(world, received);
    host.publish(world, world.events.splice(0), 0.1);
    for (let id = 1; id < count; id++) {
      await until(() => runs[id].apply(worlds[id], 0));
      assert.equal(worlds[id].tick, world.tick);
      assert.equal(worlds[id].players.length, count);
      assert.equal(received.find((command) => command.player === id).z, id / 4);
    }
    assert.equal(world.players[0].inputX, 0, "伪造 player:0 不可控制房主");
    world.zone.phase = "transitioning";
    enterZone(world, prepareZone(world));
    host.publishMap(world);
    for (let id = 1; id < count; id++) {
      let next;
      await until(() => (next = runs[id].takeMap()));
      assert.equal(mapDigest(next.map), mapDigest(world.map));
      assert.equal(next.players.length, count);
      runs[id].loading(next);
      await runs[id].ready();
    }
    await until(() => runs.every((run) => !run.suspended));
    runs.at(-1).quit();
    runs.at(-1).dispose();
    await until(() => sessions.at(-1).closed && world.players.at(-1).departed);
    assert.equal(world.outcome, "playing", "一人离开不结束对局");
    stepWorld(world, [{ t: "forfeit" }]);
    host.publish(world, [], 0, true);
    for (let id = 1; id < count - 1; id++) {
      await until(() => runs[id].apply(worlds[id], 0));
      assert.equal(worlds[id].outcome, "defeat");
    }
  });

test("四人局断线与刷新只影响该席位，其余玩家不暂停", async (t) => {
  const { sessions, url } = await party(t, 4);
  const tickets = [];
  sessions.forEach((session, id) => {
    session.onTicket = (ticket) => {
      tickets[id] = ticket;
    };
  });
  const { runs, world } = await startParty(sessions);
  for (const run of runs.slice(1)) await run.ready();
  await until(() => runs.every((run) => !run.suspended));
  const publish = () => runs[0].publish(world, [], tick);
  sessions[3].socket.close();
  await until(() => runs[3].reconnecting);
  assert(!runs[1].reconnecting && !runs[2].reconnecting && !runs[0].suspended);
  await until(() => {
    publish();
    return !runs[3].reconnecting;
  });
  assert(
    runs.every((run) => !run.takeMap()),
    "重连续上原地图",
  );
  sessions[0].socket.close();
  await until(() => runs.slice(1).every((run) => run.reconnecting));
  await until(() => {
    publish();
    return runs.every((run) => !run.reconnecting);
  });
  for (const id of [2, 3]) {
    runs[id].dispose(false);
    await until(() => !sessions[0].state.room.online.includes(id));
    assert(tickets[id]);
    const replacement = new MultiplayerSession(
      url,
      tickets[id].code,
      player,
      connection(tickets[id]),
    );
    sessions[id] = replacement;
    replacement.onStart = (settings) => {
      runs[id] = new MultiplayerRun(replacement, settings);
    };
    await until(() => runs[id].session === replacement);
    assert.equal(replacement.state.self, id);
    let map;
    await until(() => (map = runs[id].takeMap()));
    assert.equal(mapDigest(map.map), mapDigest(world.map));
    assert(
      runs.every((run, other) => other === id || !run.suspended),
      "只有重开的席位载入",
    );
    runs[id].loading(map);
    await runs[id].ready();
    await until(() => !runs[id].suspended);
    for (let other = 1; other < 4; other++)
      if (other !== id) assert.equal(runs[other].takeMap(), undefined);
  }
});

/** Fake only the platform peer provider; negotiation still traverses real Harbor sockets. */
function directPeers() {
  let next = 0;
  const offers = new Map();
  const peers = [];
  const factory = ({ initiator }, events) => {
    const peer = {
      events,
      open: false,
      bufferedAmount: 0,
      other: null,
      closed: false,
      async accept(signal) {
        if (signal.description?.type !== "offer") return;
        const host = offers.get(signal.description.sdp);
        if (!host || host.closed) throw new Error("Missing offer");
        host.other = peer;
        peer.other = host;
        peer.open = host.open = true;
        queueMicrotask(() => {
          host.events.opened();
          peer.events.opened();
        });
      },
      send(text) {
        if (!peer.open || !peer.other?.open) throw new Error("Peer closed");
        const other = peer.other;
        queueMicrotask(() => {
          if (other.open) other.events.message(text);
        });
      },
      close() {
        peer.closed = true;
        peer.open = false;
        if (peer.other?.open) {
          peer.other.open = false;
          queueMicrotask(() => peer.other.events.disconnected());
        }
      },
    };
    peers.push(peer);
    if (initiator) {
      const sdp = String(++next);
      offers.set(sdp, peer);
      queueMicrotask(() => events.signal({ description: { type: "offer", sdp } }));
    }
    return peer;
  };
  return { factory, peers };
}

test("四人多 peer 混合传输，独立输入确认、分片、背压差分与直连故障恢复", async (t) => {
  const direct = directPeers();
  const { sessions } = await party(t, 4, [
    direct.factory,
    direct.factory,
    undefined,
    direct.factory,
  ]);
  assert.deepEqual(sessions[0].state.peers, { 1: "direct", 2: "relay", 3: "direct" });
  assert.equal(sessions[0].state.mode, "relay");
  const { runs, worlds, world } = await startParty(sessions);
  for (let id = 1; id < 4; id++) {
    assert.equal(mapDigest(worlds[id].map), mapDigest(world.map), "完整地图跨多片传输");
    await runs[id].ready();
  }
  await until(() => runs.every((run) => !run.suspended));
  // Different sequences on every link must be acknowledged to the matching guest only.
  for (let id = 1; id < 4; id++) {
    for (let sample = 0; sample < id; sample++)
      runs[id].submit([{ t: "view", player: 0, yaw: sample + id }]);
  }
  const commands = [];
  await until(() => {
    commands.push(...runs[0].submit([]));
    return new Set(commands.map((command) => command.player)).size === 3;
  });
  stepWorld(world, commands);
  runs[0].publish(world, [], 0.1);
  for (let id = 1; id < 4; id++) await until(() => runs[id].apply(worlds[id], 0));
  assert(sessions.every((session) => !session.state.error));
  const slow = sessions[0].links.get(3).peer;
  slow.bufferedAmount = 300 * 1024;
  const marker = { t: "banner", text: "只补慢客机", tone: "boss", kind: "clear" };
  world.pickups = [{ id: 909, kind: "xp", x: 1, z: 1, value: 1, magnet: false }];
  runs[0].publish(world, [marker], 0.1);
  for (const id of [1, 2]) await until(() => runs[id].apply(worlds[id], 0));
  assert.equal(runs[3].apply(worlds[3], 0), false);
  world.pickups[0].x = 2;
  slow.bufferedAmount = 0;
  runs[0].publish(world, [], 0.1);
  for (const id of [1, 2, 3]) await until(() => runs[id].apply(worlds[id], 0));
  for (const id of [1, 2, 3]) {
    for (let i = 0; i < 20; i++) runs[id].apply(worlds[id], tick);
    assert.equal(worlds[id].events.filter((event) => event.text === marker.text).length, 1);
    assert.deepEqual(runs[id].baseline.pickups, world.pickups, "每个客机使用自己的已发送差分基准");
  }
  slow.events.disconnected(); // The host's side of this one link fails.
  await until(() => sessions[0].state.peers[3] === "relay" && sessions[3].state.mode === "relay");
  assert(
    runs.every((run) => !run.suspended && !run.reconnecting),
    "直连故障只回落该链路",
  );
  assert.deepEqual(sessions[0].state.peers, { 1: "direct", 2: "relay", 3: "relay" });
  world.pickups[0].x = 3;
  runs[0].publish(world, [], 0.1);
  await until(() => runs[3].apply(worlds[3], 0));
  assert.deepEqual(runs[3].baseline.pickups, world.pickups, "回落后发送完整状态");
});

test("Harbor 拒绝客机向其他客机路由消息", async (t) => {
  const { sessions } = await party(t, 4);
  sessions[1].signal({ t: "relay", to: 3, epoch: 0, data: encode({ t: "quit" }) });
  await until(() => sessions[1].state.error);
  assert.match(sessions[1].state.error, /目标席位/);
});

test("新地图已排队时终局替代它，正式 apply/takeMap 顺序不会恢复 playing", async (t) => {
  const { sessions } = await party(t, 3);
  const { runs, worlds, world } = await startParty(sessions);
  for (const run of runs.slice(1)) await run.ready();
  await until(() => runs.every((run) => !run.suspended));
  world.zone.phase = "transitioning";
  enterZone(world, prepareZone(world));
  runs[0].publishMap(world);
  await until(() => runs[1].map && runs[2].map);
  stepWorld(world, [{ t: "forfeit" }]);
  runs[0].publish(world, [], 0, true);
  await until(() => sessions[1].ended);
  assert.equal(runs[1].apply(worlds[1], 0), false, "跨图终局等待场景载入");
  const terminalMap = runs[1].takeMap();
  assert.equal(terminalMap.stage, "desert");
  assert.equal(terminalMap.outcome, "defeat", "终局替代排队中的 playing 快照");
  runs[1].loading(terminalMap);
  Object.assign(worlds[1], terminalMap);
  await runs[1].ready();
  assert(runs[1].apply(worlds[1], 0));
  assert.equal(runs[1].takeMap(), undefined);
  assert.equal(runs[1].apply(worlds[1], tick), false);
  assert.equal(worlds[1].outcome, "defeat");
});

test("已交付席位返回后释放连接，缺席终局的保留期限独立于房主连接", async (t) => {
  const { sessions, url, server } = await party(t, 3);
  let ticket;
  sessions[2].onTicket = (value) => {
    if (value) ticket = value;
  };
  const { runs, world } = await startParty(sessions);
  for (const run of runs.slice(1)) await run.ready();
  await until(() => runs.every((run) => !run.suspended));
  runs[2].dispose(false);
  await until(() => !sessions[0].state.room.online.includes(2));
  const timer = globalThis.setTimeout;
  let expire;
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 10 * 60 * 1000) expire = () => callback(...args);
    return timer(callback, delay, ...args);
  };
  try {
    stepWorld(world, [{ t: "forfeit" }]);
    runs[0].publish(world, [], 0, true);
    await until(() => sessions[1].ended);
  } finally {
    globalThis.setTimeout = timer;
  }
  assert(expire, "the terminal has a deadline while the host is still online");
  runs[0].dispose();
  runs[1].dispose();
  await until(() => sessions[0].closed && sessions[1].closed && server.pendingWebSockets === 0);
  expire();
  const late = new MultiplayerSession(url, ticket.code, player, connection(ticket));
  t.after(() => late.close(false));
  await until(() => late.state.error);
  assert.match(late.state.error, /原对局已结束/);
});

test("Harbor 保留终局直到漏收席位恢复并确认，已收到的事件不重复", async (t) => {
  const { sessions } = await party(t, 4);
  const { runs, world, worlds } = await startParty(sessions);
  for (const run of runs.slice(1)) await run.ready();
  await until(() => runs.every((run) => !run.suspended));
  const receive = sessions[3].socket.onmessage;
  let dropped = false;
  sessions[3].socket.onmessage = (event) => {
    if (JSON.parse(event.data).t === "terminal" && !dropped) {
      dropped = true;
      return;
    }
    receive(event);
  };
  stepWorld(world, [{ t: "forfeit" }]);
  const event = { t: "banner", text: "终局", tone: "boss", kind: "clear" };
  runs[0].publish(world, [event], 0, true);
  runs[0].dispose();
  await until(() => sessions[1].ended && sessions[2].ended);
  assert.equal(sessions[3].ended, false);
  await until(() => sessions[0].closed); // Harbor owns the pending result; the lobby owns no old socket.
  sessions[3].socket.close();
  await until(() => sessions.every((session) => session.closed));
  for (let id = 1; id < runs.length; id++) {
    assert(runs[id].apply(worlds[id], 0));
    assert.equal(worlds[id].outcome, "defeat");
    runs[id].apply(worlds[id], tick);
    assert.equal(worlds[id].events.filter((entry) => entry.text === "终局").length, 1);
  }
  assert(sessions.every((session) => session.ended));
});

test("三人延迟下客机连续移动逐显示帧推进", async () => {
  const settings = { ...config, players: [player, player, player] };
  const wire = delayedTransport(3);
  const runs = wire.endpoints.map((endpoint) => new MultiplayerRun(endpoint, settings));
  const world = createWorld(settings);
  runs[0].publishMap(world);
  const worlds = [world];
  for (let id = 1; id < 3; id++) {
    worlds[id] = await runs[id].initial();
    runs[id].loading(worlds[id]);
    await runs[id].ready();
  }
  await runs[0].ready();
  wire.start();
  for (let id = 1; id < 3; id++) runs[id].submit([{ t: "move", player: id, x: 1, z: 0 }]);
  const measures = [1, 2].map(() => ({
    steps: [],
    remoteOriginErrors: [],
    playbackLags: [],
  }));
  let nextTick = 0;
  const previous = worlds.map((w, id) => w.players[id].x);
  for (let ms = 0; ms < 2100; ms += 1000 / 60) {
    wire.advance(ms);
    if (ms + 1e-6 >= nextTick) {
      stepWorld(world, runs[0].submit([{ t: "move", player: 0, x: 1, z: 0 }]));
      nextTick += 1000 / 30;
      // A player-centred authoritative visual cue, independent of combat targeting/RNG.
      if (ms > 500)
        for (const p of world.players.slice(0, 1))
          world.events.push({
            t: "ult-pulse",
            player: p.id,
            look: "ring",
            x: p.x,
            z: p.z,
            radius: 2,
            dirX: 0,
            dirZ: 0,
            length: 0,
          });
    }
    runs[0].publish(world, world.events.splice(0), 1 / 60);
    for (let id = 1; id < 3; id++) {
      runs[id].apply(worlds[id], 1 / 60);
      const x = screenX(worlds[id], id, runs[id].alpha());
      if (ms > 500) {
        const measure = measures[id - 1];
        measure.steps.push(x - previous[id]);
        // Diagnostics only; the assertions below protect rendered behaviour, not these internals.

        measure.playbackLags.push(runs[id].newestClock - runs[id].renderClock);
      }
      previous[id] = x;
      for (const event of worlds[id].events.splice(0)) {
        if (event.t !== "ult-pulse" || event.look !== "ring") continue;
        const errors = measures[id - 1].remoteOriginErrors;
        errors.push(
          Math.hypot(
            event.x - worlds[id].players[event.player].x,
            event.z - worlds[id].players[event.player].z,
          ),
        );
      }
    }
  }
  const metrics = measures.map((m) => ({
    frames: m.steps.length,
    stalledOrReverse: m.steps.filter((x) => x <= 0).length,
    minStep: Math.min(...m.steps),
    maxStep: Math.max(...m.steps),
    maxRemoteOriginError: Math.max(...m.remoteOriginErrors),

    playbackLagMs: [Math.min(...m.playbackLags) * 1000, Math.max(...m.playbackLags) * 1000],
  }));
  console.log("three-player-continuity", JSON.stringify(metrics));
  for (const m of metrics) {
    assert.equal(m.stalledOrReverse, 0, "持续向前移动的客机不能隔帧停住或倒退");
    assert(m.maxStep < 0.12, "不能把隔帧位移积累成跳步");
  }
});

test("本机施法与碰撞立即反馈，房主按目标ID结算一次且不重复模拟客机攻击", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { newMoveState } = await import("../src/run/sim/upgrades.ts");
  const { wire, host, guest, world } = await memoryRun();
  const p = world.players[1];
  p.moves = [newMoveState("thunderbolt")];
  p.moves[0].cooldown = 0;
  const enemy = spawnEnemy(world, "rattata", p.x, p.z + 2);
  enemy.hp = enemy.maxHp = 1000;
  enemy.speed = 0;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  wire.start();
  const hp = enemy.hp;
  guest.apply(remote, tick);
  assert(remote.events.some((event) => event.t === "cast" && event.player === 1));
  assert(
    remote.events.some((event) => event.t === "contact" && event.by === 1),
    "命中立即反馈，不等往返",
  );
  assert.equal(enemy.hp, hp, "房主尚未收到命中");
  assert.equal(remote.enemies[0].hp, hp, "客机不提交共享HP");
  const packet = wire.sent.find((entry) => entry.packet.t === "owner").packet;
  assert(packet.effects.some((effect) => effect.t === "hit"));
  enemy.x += 30;
  world.paused = true;
  wire.advance(100);
  assert(enemy.hp < hp, "暂停前已发出的命中不能丢失，敌人离开旧位置仍按目标结算");
  const after = enemy.hp;
  wire.endpoints[0].receiver(packet, 1);
  assert.equal(enemy.hp, after, "重复可靠包不能重复伤害");
  remote.events = [];
  host.publish(world, world.events.splice(0), tick);
  wire.advance(200);
  guest.apply(remote, 0);
  assert.equal(
    remote.events.filter((event) => event.t === "hit" && event.confirmedContact).length,
    1,
    "本机数字在确认到达后立即显示，不再等待远端插值缓冲",
  );
  remote.events = [];
  guest.apply(remote, 0);
  assert(!remote.events.some((event) => event.t === "hit"), "确认数字只显示一次");
  world.paused = false;
  host.step(world, host.submit([]));
  assert(
    !world.events.some((event) => event.t === "cast" && event.player === 1),
    "房主不重复跑客机技能",
  );
  assert(!world.projectiles.some((shot) => shot.owner === 1 && shot.id >= 0));
});

test("客机AOE多目标、多段区域和必杀沿用技能runner；死亡奖励与触发链只由房主提交", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { newMoveState } = await import("../src/run/sim/upgrades.ts");
  const { wire, host, guest, world } = await memoryRun();
  const p = world.players[1];
  p.moves = [newMoveState("rapid-spin")];
  p.moves[0].cooldown = 0;
  p.ult.charge = 1;
  const enemies = [0, 1].map((i) => {
    const enemy = spawnEnemy(world, "rattata", p.x + i * 0.3, p.z + 1);
    enemy.hp = enemy.maxHp = 10000;
    return enemy;
  });
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.submit([{ t: "ult", player: 1 }]);
  for (let i = 0; i < 12; i++) {
    guest.apply(remote, tick);
    host.publish(world, world.events.splice(0), tick);
  }
  const owners = wire.sent
    .filter((entry) => entry.packet.t === "owner")
    .map((entry) => entry.packet);
  const hits = owners.flatMap((packet) => packet.effects).filter((effect) => effect.t === "hit");
  assert(
    enemies.every((enemy) => hits.filter((hit) => hit.enemy === enemy.id).length > 1),
    "每个目标收到多个真实碰撞段",
  );
  assert(enemies.every((enemy) => enemy.hp < enemy.maxHp));
  assert.equal(
    remote.events.filter((event) => event.t === "ult" && event.player === 1).length,
    1,
    "必杀echo不重播",
  );
  const before = enemies.map((enemy) => enemy.hp);
  for (const packet of owners) wire.endpoints[0].receiver(packet, 1);
  assert.deepEqual(
    enemies.map((enemy) => enemy.hp),
    before,
    "重复包不合并掉多段，也不再扣血",
  );
  // Accept a later genuine collision as a kill, then reject its duplicate after loot is committed.
  const packet = structuredClone(
    owners.find((packet) => packet.effects.some((effect) => effect.t === "hit")),
  );
  packet.sequence = owners.at(-1).sequence + 1;
  packet.effects = [packet.effects.find((effect) => effect.t === "hit")];
  const target = enemies.find((enemy) => enemy.id === packet.effects[0].enemy);
  target.hp = 1;
  const kills = p.kills;
  wire.endpoints[0].receiver(packet, 1);
  const loot = structuredClone(world.pickups);
  assert.equal(p.kills, kills + 1);
  assert(loot.length > 0);
  wire.endpoints[0].receiver(packet, 1);
  assert.equal(p.kills, kills + 1);
  assert.deepEqual(world.pickups, loot);
});

test("owner攻击ID跨完整恢复继续递增；旧revision与倒地前包不能覆盖新生命周期", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { wire, host, guest, world } = await memoryRun();
  spawnEnemy(world, "rattata", world.players[1].x, 2);
  world.players[1].moves[0].cooldown = 0;
  host.publishMap(world);
  let remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.apply(remote, tick);
  const before = wire.sent.filter((entry) => entry.packet.t === "owner").at(-1).packet;
  assert(before.projectiles.length > 0);
  const id = before.projectiles[0].id;
  world.projectiles = [];
  world.players[1].moves[0].cooldown = 0;
  host.publishMap(world);
  remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.apply(remote, tick);
  const next = wire.sent.filter((entry) => entry.packet.t === "owner").at(-1).packet;
  assert(next.projectiles[0].id > id, "已消失攻击ID不能复用");
  const state = structuredClone(world.players[1]);
  wire.endpoints[0].receiver(before, 1);
  assert.deepEqual(world.players[1], state, "旧地图包不能复活旧攻击");
  world.players[1].alive = false;
  world.players[1].hp = 0;
  host.publish(world, [], tick);
  const stale = structuredClone(next);
  stale.sequence++;
  stale.state.x += 10;
  wire.endpoints[0].receiver(stale, 1);
  assert.equal(world.players[1].x, state.x);
  guest.apply(remote, tick);
  assert.equal(remote.players[1].alive, false);
  assert.equal(remote.players[1].hp, 0);
});

test("同tick致死后个人复活重置owner必杀", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { host, guest, world } = await memoryRun();
  const p = world.players[1];
  p.revives = 1;
  p.hp = 1;
  p.invulnerable = 0;
  p.ult.charge = 1;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.submit([{ t: "ult", player: 1 }]);
  guest.apply(remote, tick);
  assert(remote.players[1].ult.elapsed >= 0);
  p.invulnerable = 0;
  const enemy = spawnEnemy(world, "rattata", p.x, p.z);
  enemy.dmg = 1000;
  enemy.x = p.x;
  enemy.z = p.z;
  host.step(world, []);
  assert(p.alive && p.revives === 0, "同tick确实经历致死与个人复活");
  host.publish(world, world.events.splice(0), tick);
  guest.apply(remote, 0);
  assert.equal(remote.players[1].ult.elapsed, -1, "复活不能继续死亡前的必杀");
});

test("同tick倒地后清区救回重置owner必杀，不接收旧生命回写", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { apply } = await import("../src/run/sim/status.ts");
  const { wire, host, guest, world } = await memoryRun();
  const p = world.players[1];
  Object.assign(p, { hp: 1, invulnerable: 0, revives: 0 });
  p.ult.charge = 1;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.submit([{ t: "ult", player: 1 }]);
  guest.apply(remote, tick);
  assert(remote.players[1].ult.elapsed >= 0);
  const stale = structuredClone(
    wire.sent.filter((entry) => entry.packet.t === "owner").at(-1).packet,
  );
  stale.sequence += 10;
  p.invulnerable = 0;
  const enemy = spawnEnemy(world, "rattata", p.x, p.z);
  Object.assign(enemy, { dmg: 1000, x: p.x, z: p.z });
  // Contact knocks the guest out before the later guardian DoT death clears the zone this tick.
  const guardian = spawnEnemy(world, "scyther", p.x + 8, p.z);
  world.bossId = guardian.id;
  guardian.hp = 1;
  apply(guardian, "burn", 1, 1000, 0);
  host.step(world, []);
  assert.equal(world.zone.phase, "cleared");
  assert(p.alive && p.revives === 0);
  assert(world.events.some((e) => e.t === "down" && e.player === 1));
  assert(world.events.some((e) => e.t === "revive" && e.player === 1));
  assert.equal(p.ult.elapsed, -1);
  host.publish(world, world.events.splice(0), tick);
  wire.endpoints[0].receiver(stale, 1);
  assert.equal(p.ult.elapsed, -1, "old life cannot resume an interrupted ultimate on the host");
  guest.apply(remote, 0);
  assert.equal(
    remote.players[1].ult.elapsed,
    -1,
    "owner resets despite alive being true in both frames",
  );
});

test("复活道具挡住致死伤害时仍是同一生命，保留owner进行中的必杀", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { host, guest, world } = await memoryRun();
  const p = world.players[1];
  Object.assign(p, { hp: 1, invulnerable: 0, revives: 0 });
  p.items.push({ id: "revive", level: 1 });
  p.ult.charge = 1;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.submit([{ t: "ult", player: 1 }]);
  guest.apply(remote, tick);
  p.invulnerable = 0;
  const enemy = spawnEnemy(world, "rattata", p.x, p.z);
  enemy.dmg = 1000;
  host.step(world, []);
  assert(p.alive && world.events.some((event) => event.t === "revive" && event.item === "revive"));
  host.publish(world, world.events.splice(0), tick);
  guest.apply(remote, 0);
  assert(remote.players[1].ult.elapsed >= 0, "an item save preserves the active life and its cast");
});

test("倒地后已发射弹体继续飞行并命中，不再生成新攻击", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { wire, host, guest, world } = await memoryRun();
  const p = world.players[1];
  p.moves[0].cooldown = 0;
  const enemy = spawnEnemy(world, "rattata", p.x, p.z + 4);
  enemy.hp = enemy.maxHp = 1000;
  host.publishMap(world);
  const remote = guest.takeMap();
  guest.loading(remote);
  await guest.ready();
  guest.apply(remote, tick);
  assert(remote.projectiles.length > 0);
  p.alive = false;
  p.hp = 0;
  host.publish(world, [], tick);
  remote.events = [];
  for (let i = 0; i < 30; i++) {
    guest.apply(remote, tick);
    host.publish(world, world.events.splice(0), tick);
  }
  assert(enemy.hp < 1000, "倒地前弹体仍有真实伤害");
  assert(!remote.events.some((event) => event.t === "cast"));
  assert.equal(remote.projectiles.filter((shot) => shot.id < 0).length, 0);
  assert(
    wire.sent.some(
      (entry) =>
        entry.packet.t === "owner" && entry.packet.effects.some((effect) => effect.t === "hit"),
    ),
  );
});

test("救援中冲刺和必杀立即取消读条，旧快照不能恢复读条或吞掉必杀", async () => {
  for (const action of ["dash", "ult"]) {
    const { wire, host, guest, world } = await memoryRun();
    const p = world.players[1];
    p.rescue = { target: 0, elapsed: 0 };
    p.ult.charge = 1;
    host.publishMap(world);
    const remote = guest.takeMap();
    guest.loading(remote);
    await guest.ready();
    wire.start();
    guest.submit([{ t: action, player: 1 }]);
    guest.apply(remote, tick);
    assert.equal(remote.players[1].rescue, null);
    host.publish(world, [], tick);
    wire.advance(100);
    guest.apply(remote, 0);
    assert.equal(p.rescue, null, "房主接到取消救援事实");
    assert.equal(remote.players[1].rescue, null, "在途旧快照不能恢复已取消读条");
    if (action === "ult") assert(remote.players[1].ult.elapsed >= 0, "必杀继续运行");
    else assert(remote.players[1].dashTime > 0, "冲刺正常继续");
  }
});

test("房主开始救援后在途冲刺不能恢复无敌，客机按房主时间计算未受伤时长", async () => {
  const { wire, host, guest, world, remote } = await memoryRun();
  const p = world.players[1];
  wire.start();
  guest.submit([{ t: "dash", player: 1 }]);
  guest.apply(remote, tick);
  p.rescue = { target: 0, elapsed: 0 };
  wire.advance(100);
  assert.equal(p.dashTime, 0, "未取消新读条的旧冲刺不能写回无敌");
  p.rescue = null;
  p.items = [{ id: "metronome", level: 1 }];
  world.time = 100;
  p.lastHurt = 99;
  host.publish(world, [], tick);
  wire.advance(200);
  guest.apply(remote, tick);
  const { playerStats } = await import("../src/run/sim/stats.ts");
  const trigger = playerStats(remote.players[1]).triggers.find(
    (entry) => entry.def.measure === "unhurt",
  );
  assert(Math.abs(remote.players[1].fx[trigger.key] - (1 + tick)) < 1e-8);
});

test("房主按当前目标状态拒绝钻地命中，牵引收敛于中心而不会穿过", async () => {
  const { spawnEnemy } = await import("../src/run/sim/director.ts");
  const { commitCombat } = await import("../src/run/sim/combat.ts");
  const { EnemyGrid } = await import("../src/run/sim/grid.ts");
  const { world } = await memoryRun();
  const p = world.players[1];
  const enemy = spawnEnemy(world, "rattata", p.x, p.z + 1);
  const ctx = { world, grid: new EnemyGrid() };
  ctx.grid.rebuild(world.enemies);
  const pull = { t: "pull", enemy: enemy.id, x: enemy.x, z: enemy.z + 0.35, step: 0.1, stop: 0.3 };
  for (let i = 0; i < 20; i++) commitCombat(ctx, p, pull);
  assert(Math.abs(Math.hypot(enemy.x - pull.x, enemy.z - pull.z) - 0.3) < 1e-8);
  enemy.phase = "under";
  const hp = enemy.hp;
  commitCombat(ctx, p, {
    t: "hit",
    enemy: enemy.id,
    x: enemy.x,
    z: enemy.z,
    hit: {
      move: null,
      type: "normal",
      dmg: 10000,
      crit: 0,
      statusChance: 0,
      knock: 0,
      fromX: p.x,
      fromZ: p.z,
    },
  });
  assert.equal(enemy.hp, hp);
  assert.equal(p.kills, 0);
});

test("客机冰迹上持续滑行，显示帧预览不改写已模拟位置", async () => {
  const { OwnerSimulation } = await import("../src/network/owner.ts");
  const { addHazard } = await import("../src/run/sim/skills/kit.ts");
  const { TICK } = await import("../src/run/sim/state/world.ts");
  const world = createWorld(config);
  const p = world.players[1];
  p.moves = [];
  addHazard(world, {
    kind: "ice-trail",
    x: p.x - 2,
    y: 0,
    z: p.z,
    radius: 2,
    dirX: 1,
    dirZ: 0,
    length: 6,
    life: 8,
  });
  const owner = new OwnerSimulation(world, 1, -1000000);
  owner.advance(world, [{ t: "move", player: 1, x: 1, z: 0 }], TICK, false);
  assert(owner.player.vx > 0);
  owner.advance(world, [{ t: "move", player: 1, x: 0, z: 0 }], TICK, false);
  assert(owner.player.vx > 0, "releasing movement on ice retains momentum");
  const x = owner.player.x;
  owner.advance(world, [], TICK / 2, false);
  owner.present(world);
  assert(world.players[1].x > x, "fractional display frames advance through the same ice context");
  assert.equal(owner.player.x, x, "presentation does not consume simulation movement");
});
