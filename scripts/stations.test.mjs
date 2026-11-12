import assert from "node:assert/strict";
import test from "node:test";
import { updateAreas, updateMoves, updateProjectiles } from "../src/run/sim/attacks.ts";
import { signatureFusions } from "../src/run/sim/content/fusions.ts";
import { spawnEnemy } from "../src/run/sim/director.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { createRng } from "../src/run/sim/rng.ts";
import { FORGET } from "../src/run/sim/content/params/economy.ts";
import { TICK } from "../src/run/sim/state/world.ts";
import { applyChoice, newMoveState, rarityOdds, rollChoices } from "../src/run/sim/upgrades.ts";
import { MAX_MOVE_LEVEL, RARITY_ODDS } from "../src/run/sim/content/params/cards.ts";
import { createWorld, isFrozen, stepWorld } from "../src/run/sim/world.ts";

const world = (starter = "charmander", seed = 5) =>
  createWorld({ stage: "forest", seed, difficulty: 0, players: [{ starter }] });

const station = (w, kind) => w.stations.find((s) => s.kind === kind);

/** Steps the player into a station's zone and presses interact; returns the dialog that opened. */
function visit(w, kind) {
  const player = w.players[0];
  const s = station(w, kind);
  player.x = player.px = s.x + s.radius + 0.6;
  player.z = player.pz = s.z;
  stepWorld(w, []);
  stepWorld(w, [{ t: "interact", player: 0 }]);
  return player.dialog;
}

test("walking into a station only arms it; the interact command opens it", () => {
  const w = world();
  const player = w.players[0];
  player.moves = [maxed("ember"), maxed("fire-spin")];
  const s = station(w, "hypno");
  player.x = player.px = s.x + s.radius + 0.6;
  player.z = player.pz = s.z;
  for (let i = 0; i < 10; i++) stepWorld(w, []);
  assert.equal(player.dialog, null, "walking past must not freeze the run");
  stepWorld(w, [{ t: "interact", player: 0 }]);
  assert.equal(player.dialog?.station, s.id);
  // Away from every station, interact does nothing.
  stepWorld(w, [{ t: "leave", player: 0, dialog: player.dialog.id }]);
  player.x = player.px = 0;
  player.z = player.pz = 0;
  stepWorld(w, [{ t: "interact", player: 0 }]);
  assert.equal(player.dialog, null);
});

/** Steps out of every zone so the next visit opens a fresh dialog. */
function walkAway(w) {
  const player = w.players[0];
  if (player.dialog) stepWorld(w, [{ t: "leave", player: 0, dialog: player.dialog.id }]);
  player.x = player.px = 0;
  player.z = player.pz = 0;
  stepWorld(w, []);
}

const maxed = (id) => ({ ...newMoveState(id), level: MAX_MOVE_LEVEL });

test("each station stands on its own building pad", () => {
  for (const seed of [5, 11, 4242]) {
    const w = world("charmander", seed);
    const pads = w.map.pads.filter((pad) => pad.tag === "building");
    assert.deepEqual(w.stations.map((s) => s.kind).sort(), ["bill", "hypno"]);
    for (const s of w.stations)
      assert.ok(pads.some((pad) => Math.hypot(pad.x - s.x, pad.z - s.z) < 1e-9));
    assert.notDeepEqual([w.stations[0].x, w.stations[0].z], [w.stations[1].x, w.stations[1].z]);
  }
});

test("Hypno frees a slot, refunds stardust by level and never forgets the last move", () => {
  const w = world();
  const player = w.players[0];
  player.moves = [maxed("ember"), { ...newMoveState("fire-spin"), level: 3 }];
  player.items = [{ id: "life-orb", level: 2 }];
  const dialog = visit(w, "hypno");
  assert.ok(dialog);
  assert.ok(isFrozen(w));
  const time = w.time;
  const stardust = player.stardust;
  const forget = (target) => stepWorld(w, [{ t: "forget", player: 0, dialog: dialog.id, target }]);
  forget({ kind: "move", id: "fire-spin" });
  assert.deepEqual(
    player.moves.map((m) => m.id),
    ["ember"],
  );
  assert.equal(player.stardust - stardust, 3 * FORGET.move);
  // The forgotten move is not offered again.
  assert.ok(player.banished.includes("move:fire-spin"));
  forget({ kind: "move", id: "ember" });
  assert.deepEqual(
    player.moves.map((m) => m.id),
    ["ember"],
  );
  forget({ kind: "item", id: "life-orb" });
  assert.equal(player.items.length, 0);
  assert.equal(player.stardust - stardust, 3 * FORGET.move + 2 * FORGET.item);
  // Usable again: the dialog stays open, and the world stays frozen until the player leaves.
  assert.equal(w.time, time);
  stepWorld(w, [{ t: "leave", player: 0, dialog: dialog.id }]);
  assert.equal(player.dialog, null);
  assert.ok(!isFrozen(w));
});

test("a station waits for queued cards, and forget never changes the kit under one", () => {
  const w = world();
  const player = w.players[0];
  player.moves = [maxed("ember"), maxed("fire-spin")];
  // A level-up on the tick the player walks in queues its card first.
  w.pickups.push({ id: w.nextId++, kind: "xp", x: 0, z: 0, value: player.xpNext, magnet: true });
  const s = station(w, "hypno");
  w.pickups[0].x = player.x = player.px = s.x + s.radius + 0.6;
  w.pickups[0].z = player.z = player.pz = s.z;
  stepWorld(w, []);
  assert.equal(player.pending.length, 1);
  assert.equal(player.dialog, null);
  // Even a forged dialog command does nothing while the card waits.
  player.dialog = { id: 999, station: s.id };
  stepWorld(w, [{ t: "forget", player: 0, dialog: 999, target: { kind: "move", id: "ember" } }]);
  assert.equal(player.moves.length, 2);
});

test("a stale dialog command is ignored", () => {
  const w = world();
  const player = w.players[0];
  player.moves = [maxed("ember"), maxed("fire-spin"), maxed("flamethrower")];
  const first = visit(w, "hypno");
  walkAway(w);
  const second = visit(w, "hypno");
  assert.notEqual(first.id, second.id);
  stepWorld(w, [
    { t: "forget", player: 0, dialog: first.id, target: { kind: "move", id: "ember" } },
  ]);
  assert.equal(player.moves.length, 3);
  // A fuse aimed at Hypno's dialog does nothing either.
  stepWorld(w, [{ t: "fuse", player: 0, dialog: second.id }]);
  assert.equal(player.moves.length, 3);
});

test("Bill's machine fuses only two max-level signature moves, once per run, freeing a slot", () => {
  const w = world("pikachu");
  const player = w.players[0];
  const {
    result: move,
    match: { pair },
  } = signatureFusions.pikachu;
  player.moves = [
    { ...newMoveState("thunder-shock"), level: 5 },
    { ...maxed(pair[0]), mods: { ...maxed(pair[0]).mods, dmg: 0.4, cd: 0.8 } },
    { ...newMoveState(pair[1]), level: MAX_MOVE_LEVEL - 1 },
  ];
  let dialog = visit(w, "bill");
  stepWorld(w, [{ t: "fuse", player: 0, dialog: dialog.id }]);
  assert.equal(player.moves.length, 3, "not ready: one part is below max level");
  walkAway(w);

  player.moves[2] = { ...maxed(pair[1]), mods: { ...maxed(pair[1]).mods, dmg: 0.3, cd: 0.5 } };
  dialog = visit(w, "bill");
  stepWorld(w, [{ t: "fuse", player: 0, dialog: dialog.id }]);
  assert.deepEqual(
    player.moves.map((m) => m.id),
    ["thunder-shock", move],
  );
  const fused = player.moves[1];
  assert.equal(fused.level, 1);
  assert.ok(Math.abs(fused.mods.dmg - 0.7) < 1e-9 && Math.abs(fused.mods.cd - 0.4) < 1e-9);
  assert.equal(player.dialog, null);
  assert.ok(station(w, "bill").used.includes(player.id));

  // The parts live on in the fusion and are not offered as new moves.
  const offered = rollChoices(createRng(2), player, "level").filter((c) => c.kind === "move");
  assert.ok(offered.every((c) => !pair.includes(c.move)));

  // Once per run: the used machine no longer opens.
  walkAway(w);
  assert.equal(visit(w, "bill"), null);
});

test("the TM box raises the move cap to 10 and the fusion star cap by one", () => {
  const w = world();
  const player = w.players[0];
  player.moves = [maxed("ember"), { ...newMoveState("fire-whirl"), level: 5 }];
  const offers = (p) => rollChoices(createRng(1), p, "chest").filter((c) => c.kind === "upgrade");
  assert.equal(offers(player).length, 0, "both at their caps without the box");
  const upgrade = { kind: "upgrade", rarity: 0, rolls: [] };
  assert.throws(() => applyChoice(player, { ...upgrade, move: "ember" }));
  applyChoice(player, { kind: "tm-case" });
  for (let level = MAX_MOVE_LEVEL; level < 10; level++)
    applyChoice(player, { ...upgrade, move: "ember" });
  applyChoice(player, { ...upgrade, move: "fire-whirl" });
  assert.deepEqual(
    player.moves.map((m) => m.level),
    [10, 6],
  );
  assert.throws(() => applyChoice(player, { ...upgrade, move: "ember" }));
  assert.throws(() => applyChoice(player, { ...upgrade, move: "fire-whirl" }));
});

test("the TM box comes only from chests, at most once", () => {
  const w = world();
  const player = w.players[0];
  const count = (source) => {
    let found = 0;
    const rng = createRng(7);
    for (let i = 0; i < 400; i++)
      found += rollChoices(rng, player, source).filter((c) => c.kind === "tm-case").length;
    return found;
  };
  assert.equal(count("level"), 0);
  assert.ok(count("chest") > 0);
  player.tmCase = true;
  assert.equal(count("chest"), 0);
});

test("luck shifts upgrade rarity toward the rare tiers", () => {
  assert.deepEqual(
    rarityOdds(0).map((p) => +p.toFixed(9)),
    [...RARITY_ODDS],
  );
  const [common, , epic, legend] = rarityOdds(30);
  assert.ok(common < RARITY_ODDS[0] && epic > RARITY_ODDS[2] && legend > RARITY_ODDS[3]);
  // Through the real roll: the same seed with more luck draws a higher mean rarity.
  const mean = (luck) => {
    const w = world();
    const player = w.players[0];
    player.lab = {
      ...player.lab,
      modifiers: [{ stat: "luck", op: "add", value: luck, source: { kind: "lab" } }],
    };
    const rng = createRng(3);
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += rollChoices(rng, player, "chest")[0].rarity ?? 0;
    return sum / 2000;
  };
  assert.ok(mean(30) > mean(0) + 0.1);
});

test("each fusion casts, damages enemies and ends with its finale", () => {
  for (const { result } of Object.values(signatureFusions)) {
    const w = world();
    const player = w.players[0];
    player.x = player.z = 0;
    const enemies = [3, 5].flatMap((d) =>
      [0, 2].map((a) => {
        const enemy = spawnEnemy(w, "caterpie", Math.cos(a) * d, Math.sin(a) * d);
        enemy.hp = enemy.maxHp = 1e6;
        enemy.speed = 0;
        return enemy;
      }),
    );
    player.moves = [{ ...newMoveState(result), cooldown: 0 }];
    const ctx = { world: w, grid: new EnemyGrid() };
    let finale = false;
    for (let tick = 0; tick < 4 / TICK; tick++) {
      ctx.grid.rebuild(w.enemies);
      updateMoves(ctx, player, TICK);
      updateProjectiles(ctx, TICK);
      updateAreas(ctx, TICK);
      finale ||= w.areas.some((a) => a.kind === "burst" && a.move === result);
      player.moves[0].cooldown = 99;
    }
    assert.ok(
      enemies.some((e) => e.hp < e.maxHp),
      `${result} hit nothing`,
    );
    assert.ok(finale, `${result} had no finale`);
    assert.equal(w.areas.length, 0, `${result} left areas behind`);
  }
});

test("runs with station visits, forgetting and fusing are deterministic", () => {
  const run = () => {
    const w = world("bulbasaur", 11);
    const player = w.players[0];
    const { pair } = signatureFusions.bulbasaur.match;
    player.moves = [maxed("vine-whip"), maxed(pair[0]), maxed(pair[1])];
    player.items = [{ id: "magnet", level: 1 }];
    for (let tick = 0; tick < 1800; tick++) {
      const angle = tick / 90;
      const commands = [{ t: "move", player: 0, x: Math.cos(angle), z: Math.sin(angle) }];
      const card = player.pending[0];
      if (card) commands.push({ t: "pick", player: 0, card: card.id, index: 0 });
      if (tick === 300) visit(w, "hypno");
      if (tick === 600) visit(w, "bill");
      const dialog = player.dialog;
      if (dialog) {
        const at = w.stations.find((s) => s.id === dialog.station);
        commands.push(
          at.kind === "hypno"
            ? { t: "forget", player: 0, dialog: dialog.id, target: { kind: "item", id: "magnet" } }
            : { t: "fuse", player: 0, dialog: dialog.id },
          { t: "leave", player: 0, dialog: dialog.id },
        );
      }
      stepWorld(w, commands);
      w.events.length = 0;
    }
    return JSON.stringify({ players: w.players, enemies: w.enemies, stations: w.stations });
  };
  const a = run();
  assert.equal(a, run());
  assert.ok(JSON.parse(a).players[0].moves.some((m) => m.id === "floral-beam"));
});
