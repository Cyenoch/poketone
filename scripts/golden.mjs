// Golden replay v2: fixed seeds × starters × difficulties plus scripted cases (co-op, death and revive,
// stations, card rerolls / skips / banishes), each digested as a behavioural projection sampled every
// 10 s of sim time and at the end. A refactor meant to keep behaviour must leave every digest unchanged.
//   bun run golden          compare against scripts/golden.json (exit 1 on any difference)
//   bun run golden --write  record the current digests after an intended behaviour change
//
// What is digested is `project(world)` + `eventFacts(event)` below, never raw state: a pure change of
// state shape (field order, new fields, statuses as a list, content moved between modules) must not move
// a digest, and a change of what happens must. When a refactor changes shape on purpose, adjust only
// those functions (and the status helpers) so they read the same facts from the new shape.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { labBonuses } from "../src/run/lab.ts";
import { starters } from "../src/run/sim/content/lines/index.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { fusionStatus } from "../src/run/sim/fusion.ts";
import { cos, sin } from "../src/run/sim/math.ts";
import { playerStats } from "../src/run/sim/stats.ts";
import { newMoveState } from "../src/run/sim/upgrades.ts";
import { MAX_MOVE_LEVEL } from "../src/run/sim/content/params/cards.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { enterZone, prepareZone } from "../src/run/sim/zones.ts";
import { killEnemy } from "../src/run/sim/combat.ts";
import { EnemyGrid } from "../src/run/sim/grid.ts";
import { GUARDIAN_REFERENCE_SECONDS } from "../src/run/sim/content/params/pacing.ts";

const FILE = new URL("./golden.json", import.meta.url);
/** A whole stage plus 20 s of rampage. */
export const STAGE_TICKS = 18600;
/** One sample every 10 s of sim time (frozen frames do not count). */
export const SAMPLE_EVERY = 300;

// ---------------------------------------------------------------------------------------------------
// Behavioural projection: the explicit list of observable facts the digest covers.

/** Fixed-point numbers: 1e-6 resolution, and -0 reads as 0. */
const q = (v) => Math.round(v * 1e6) + 0;
const byId = (list) => [...list].sort((a, b) => a.id - b.id);
const text = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byKey = (list) => [...list].sort((a, b) => text(a.id, b.id));

/** Seconds left on status `id`, and its power (0 when inactive). */
function status(body, id) {
  const active = body.statuses.find((s) => s.id === id);
  return active ? [active.time, active.power] : [0, 0];
}

/** Active enemy statuses as [id, seconds left, power], in this fixed id order. */
function enemyStatuses(enemy) {
  return [
    ["burn", ...status(enemy, "burn")],
    ["paralysis", ...status(enemy, "paralysis")],
    ["sleep", ...status(enemy, "sleep")],
    ["wet", ...status(enemy, "wet")],
    ["poison", ...status(enemy, "poison")],
    ["hardened", enemy.hardened, 0],
  ]
    .filter(([, left]) => left > 0)
    .map(([id, left, power]) => [id, q(left), q(power)]);
}

/** Active player statuses as [id, seconds left], in this fixed id order. */
function playerStatuses(player) {
  return [
    ["poison", status(player, "poison")[0]],
    ["slow", status(player, "slow")[0]],
  ]
    .filter(([, left]) => left > 0)
    .map(([id, left]) => [id, q(left)]);
}

function projectPlayer(world, player) {
  return {
    id: player.id,
    form: formOf(player).id,
    x: q(player.x),
    z: q(player.z),
    hp: q(player.hp),
    alive: player.alive,
    level: player.level,
    xp: q(player.xp),
    moves: byKey(player.moves).map((m) => [m.id, m.level, q(m.damage)]),
    items: byKey(player.items).map((i) => [i.id, i.level]),
    stardust: q(player.stardust),
    kills: player.kills,
    ult: q(player.ult.charge),
    partners: world.partners.filter((p) => p.owner === player.id).length,
    statuses: playerStatuses(player),
    left: [player.rerolls, player.skips, player.banishes, player.revives],
    banished: [...player.banished].sort(text),
    training: ["dmg", "hp", "speed", "area", "cd"].map((stat) => player.training[stat]),
    tmCase: player.tmCase,
    cards: player.pending.length,
  };
}

function projectEnemy(enemy) {
  return [
    enemy.species,
    q(enemy.x),
    q(enemy.z),
    q(enemy.hp),
    enemy.elite,
    enemy.alpha,
    enemy.boss,
    enemy.phase,
    enemyStatuses(enemy),
  ];
}

/** Everything golden digests about a world at one tick. Ids only order lists; they are not digested. */
export function project(world) {
  return {
    tick: world.tick,
    outcome: world.outcome,
    boss: [world.bossId !== null, world.stage, world.zone.index, world.zone.phase, world.rampage],
    players: world.players.map((player) => projectPlayer(world, player)),
    enemies: byId(world.enemies).map(projectEnemy),
    partners: byId(world.partners).map((p) => [p.owner, p.species, q(p.x), q(p.z)]),
    pickups: byId(world.pickups).map((p) => [p.kind, q(p.x), q(p.z), q(p.value)]),
    hazards: byId(world.hazards).map((h) => [h.kind, q(h.x), q(h.z)]),
    projectiles: world.projectiles.length,
    areas: world.areas.length,
    stations: world.stations
      .map((s) => [s.kind, world.players.length === 1 ? s.used.length > 0 : s.used])
      .sort((a, b) => text(a[0], b[0])),
  };
}

/** An event's facts: type + key fields, never display text or entity ids; null for view-only cues. */
export function eventFacts(e) {
  switch (e.t) {
    case "projectile-feedback":
      return null;
    case "hit":
      return [e.t, q(e.x), q(e.z), q(e.amount), e.crit, e.weak];
    case "player-hit":
      return [e.t, e.player, q(e.amount)];
    case "death":
      return [e.t, e.species, e.elite, q(e.x), q(e.z)];
    case "reaction":
      return [e.t, e.reaction, q(e.x), q(e.z)];
    case "banner":
      return [e.t, e.tone];
    case "level":
      return [e.t, e.player, e.level];
    case "pickup":
      return [e.t, e.kind];
    case "cast":
      return [e.t, e.player, e.move];
    case "dash":
    case "revive":
    case "evade":
      return [e.t, e.player];
    case "chain":
      return [e.t, e.type, e.points.map(q), e.lift === undefined ? null : q(e.lift)];
    case "drain":
      return [e.t, e.player, q(e.x), q(e.z)];
    case "impact":
      return [e.t, q(e.x), q(e.y), q(e.z)];
    case "capture":
      return [e.t, e.player, e.species, q(e.x), q(e.z)];
    case "partner-attack":
      return [e.t, e.style, e.type, q(e.x), q(e.z), q(e.tx), q(e.tz)];
    case "partner-guard":
      return [e.t, e.type, q(e.x), q(e.z), q(e.tx), q(e.tz)];
    case "evolve":
      return [e.t, e.player, e.stage, e.form];
    case "ult":
      return [e.t, e.player, e.line, e.stage];
    case "ult-pulse":
      return [
        e.t,
        e.player,
        e.look,
        q(e.x),
        q(e.z),
        q(e.radius),
        q(e.dirX),
        q(e.dirZ),
        q(e.length),
      ];
    case "item-burst":
      return [e.t, e.player, e.look, q(e.x), q(e.z), q(e.radius)];
    case "heal":
      return [e.t, e.player, q(e.share)];
    case "heal-pulse":
      return [e.t, e.enemy, q(e.x), q(e.z), q(e.radius)];
    case "status-built":
      return [e.t, e.status, q(e.x), q(e.z)];
    case "tell":
      // Presentation cue at a wind-up start whose effects (phase, hazards) are already digested.
      return null;
    case "card":
      // Diagnostics record of an accepted card answer, whose effects are already digested.
      return null;
    case "buff":
      // Presentation cue: the buff's timed stats act through hp, movement and damage, all digested.
      return null;
    default:
      throw new Error(`golden: no facts for event "${e.t}"; add it to eventFacts`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Scripted input.

const ALL_LAB = labBonuses({
  dmg: 2,
  hp: 2,
  armor: 1,
  regen: 1,
  crit: 1,
  atkspd: 1,
  area: 1,
  ult: 1,
  spd: 1,
  xp: 1,
  gold: 1,
  magnet: 1,
  luck: 2,
  "slot-move": 1,
  "slot-vit": 1,
  choice4: 1,
  reroll: 2,
  skip: 2,
  banish: 2,
  revive: 1,
  party: 1,
});

/**
 * Answers the front card. Of every 6 decisions the 2nd rerolls, the 3rd banishes and the 4th skips while
 * any are left; the rest pick. Banish comes early so a short mortal run still reaches it.
 */
export function answerCard(player, decision, tick) {
  const card = player.pending[0];
  const base = { player: player.id, card: card.id };
  const slot = decision % 6;
  if (slot === 1 && player.rerolls > 0) return { t: "reroll", ...base };
  if (slot === 3 && player.skips > 0) return { t: "skip", ...base };
  if (slot === 2 && player.banishes > 0)
    return { t: "banish", ...base, index: decision % card.options.length };
  return { t: "pick", ...base, index: tick % card.options.length };
}

function teleportTo(world, player, kind) {
  const station = world.stations.find((s) => s.kind === kind);
  player.x = player.px = station.x + station.radius + 0.6;
  player.z = player.pz = station.z;
}

/**
 * At 1:00: pre-max the signature pair, fuse it at Bill's machine, then forget an item (handed one if
 * none was rolled) and a move at Hypno, and walk back. Yields one frame's extra commands at a time.
 */
function* stationVisit(world, player, seen) {
  const id = player.id;
  while (world.tick < 1800 || player.pending.length > 0) yield [];
  const pair = fusionStatus(player).parts.map((part) => part.id);
  player.moves = [
    ...player.moves.filter((m) => !pair.includes(m.id)).slice(0, 1),
    ...pair.map((move) => ({ ...newMoveState(move), level: MAX_MOVE_LEVEL })),
  ];
  const home = [player.x, player.z];
  teleportTo(world, player, "bill");
  yield [{ t: "interact", player: id }];
  yield [{ t: "fuse", player: id, dialog: player.dialog?.id }];
  if (world.stations.find((s) => s.kind === "bill").used.includes(player.id)) seen.add("fuse");
  // Forgetting an item needs one; a run that has not rolled any by 1:00 is handed one.
  if (player.items.length === 0) player.items.push({ id: "hp-up", level: 1 });
  teleportTo(world, player, "hypno");
  yield [{ t: "interact", player: id }];
  const dialog = player.dialog?.id;
  const items = player.items.length;
  const item = player.items[0];
  if (item) yield [{ t: "forget", player: id, dialog, target: { kind: "item", id: item.id } }];
  if (player.items.length < items) seen.add("forget-item");
  const moves = player.moves.length;
  const move = player.moves.find((m) => !pair.includes(m.id) && m.id !== fusionStatus(player).move);
  if (move) yield [{ t: "forget", player: id, dialog, target: { kind: "move", id: move.id } }];
  if (player.moves.length < moves) seen.add("forget-move");
  yield [{ t: "leave", player: id, dialog }];
  [player.x, player.z] = [player.px, player.pz] = home;
}

/** Steps the player onto the zone's landmark (the guardian's altar, then the exit). */
function toLandmark(world, player) {
  const pad = world.map.pads.find((p) => p.tag === "landmark");
  player.x = player.px = pad.x;
  player.z = player.pz = pad.z;
}

/** Seconds the full run's guardian fights before the script fells it (a scripted bot cannot aim at it). */
const GUARDIAN_FIGHT = 60;

/**
 * The whole run: in each zone the guardian is summoned at the balance model's 8:30 and fights for
 * `GUARDIAN_FIGHT` s, then falls by the combat path (drops, stardust, the cleared field); the zone is
 * left once the cards are answered, and the next one readied the way the host does it, between two
 * ticks. Leaving the last zone wins.
 */
function* campaign(world, player, seen) {
  const id = player.id;
  for (;;) {
    while (world.zone.tick < GUARDIAN_REFERENCE_SECONDS * 30 || player.pending.length > 0) yield [];
    if (world.bossId === null) {
      toLandmark(world, player);
      yield [{ t: "interact", player: id }];
    }
    const until = world.zone.tick + GUARDIAN_FIGHT * 30;
    while (world.zone.phase === "active" && world.zone.tick < until) yield [];
    const guardian = world.enemies.find((enemy) => enemy.id === world.bossId);
    if (guardian) killEnemy({ world, grid: new EnemyGrid() }, guardian, player);
    while (world.zone.phase === "cleared") {
      while (player.pending.length > 0) yield [];
      toLandmark(world, player);
      yield [{ t: "interact", player: id }];
    }
    if (world.zone.phase !== "transitioning") return;
    enterZone(world, prepareZone(world));
    seen.add(`map:${world.stage}`);
  }
}

/** The first poisoning finds the player at 1.5 HP, so the drain runs into its 1 HP floor. */
function* poisonFloor(world, player) {
  while (status(player, "poison")[0] <= 0) yield [];
  player.hp = Math.min(player.hp, 1.5);
}

// ---------------------------------------------------------------------------------------------------
// Cases. `covers` lists what the case must still reach; losing one fails the run (coverage regression),
// so a re-record after a balance change cannot silently stop exercising a path.

const STARTERS = Object.keys(starters);
// Fixed map/build samples keep real evolution and elite capture coverage under the continuing route.
const SEEDS = [61, 11];

/** The solo case that plays the whole six-map run: the scripted line that levels fastest. */
const FULL_RUN = "solo/pikachu/d1/s11";

const CASES = [
  // Kept alive (HP refilled) so every line reaches its first evolution, the guardian (which comes on
  // its own with the final swarm) and rampage. One plays every zone through to the win.
  ...SEEDS.flatMap((baseSeed, s) =>
    STARTERS.map((starter, i) => {
      const difficulty = (i + s) % 3;
      // Durable enemies and adaptive supply move the loot path; keep evolution/capture in real runs.
      const seed = s === 1 && starter === "squirtle" ? 41 : baseSeed;
      const name = `solo/${starter}/d${difficulty}/s${seed}`;
      const full = name === FULL_RUN;
      return {
        name,
        seed,
        difficulty,
        players: [{ starter }],
        refill: true,
        ticks: STAGE_TICKS * 3,
        script: campaign,
        ...(full ? { ticks: 6 * 2 * STAGE_TICKS, script: campaign } : {}),
        ...(["solo/squirtle/d2/s61", "solo/squirtle/d0/s41", "solo/pikachu/d0/s61"].includes(name)
          ? { ticks: 6 * 2 * STAGE_TICKS }
          : {}),
        covers: [
          full ? "evolve:2" : "evolve:1",
          "ult",
          "dash",
          "guardian",
          "capture",
          ...(starter === "pikachu" ? ["reaction:shock"] : []),
          ...(full
            ? ["map:desert", "map:coast", "map:glacier", "map:volcano", "map:tower", "victory"]
            : []),
        ],
      };
    }),
  ),
  {
    name: "coop/charmander+squirtle/d1/s7",
    seed: 7,
    difficulty: 1,
    players: [{ starter: "charmander" }, { starter: "squirtle" }],
    refill: true,
    ticks: 6 * 2 * STAGE_TICKS,
    script: campaign,
    covers: [
      "evolve:2",
      "ult",
      "dash",
      "guardian",
      "capture",
      "reaction:steam",
      "map:desert",
      "map:coast",
      "map:glacier",
      "map:volcano",
      "map:tower",
      "victory",
    ],
  },
  {
    // Mortal, with a broad lab and a loadout: death, revive and the poison floor all run.
    name: "mortal/squirtle/d0/s4242",
    seed: 4242,
    difficulty: 0,
    players: [
      { starter: "squirtle", lab: ALL_LAB, backpack: ["scope-lens", "hp-up"], archive: ["magnet"] },
    ],
    refill: false,
    script: poisonFloor,
    covers: ["reroll", "skip", "banish", "revive", "poison-floor", "defeat"],
  },
  {
    // Player 0 visits both stations while player 1 waits in the frozen world.
    name: "stations/bulbasaur+charmander/d1/s7",
    seed: 7,
    difficulty: 1,
    players: [{ starter: "bulbasaur" }, { starter: "charmander" }],
    refill: true,
    ticks: 9000,
    script: stationVisit,
    covers: ["fuse", "forget-item", "forget-move", "reaction:wildfire"],
  },
];

// ---------------------------------------------------------------------------------------------------
// Replay.

const sha = (text) => createHash("sha256").update(text).digest("hex");

function replay(spec) {
  const world = createWorld({
    stage: "forest",
    seed: spec.seed,
    difficulty: spec.difficulty,
    players: spec.players,
  });
  const ticks = spec.ticks ?? STAGE_TICKS;
  const seen = new Set();
  const decisions = world.players.map(() => 0);
  const scripts = world.players.map((player) =>
    spec.script && player.id === 0 ? spec.script(world, player, seen) : null,
  );
  const samples = [];
  let chain = "";
  let window = createHash("sha256");
  for (let frame = 0; world.tick < ticks && world.outcome === "playing"; frame++) {
    if (frame > ticks * 4) throw new Error(`golden: ${spec.name} stalled at tick ${world.tick}`);
    const commands = [];
    const before = world.players.map((p) => [p.rerolls, p.skips, p.banishes]);
    for (const player of world.players) {
      const angle = world.tick / 120 + player.id * Math.PI;
      commands.push({ t: "move", player: player.id, x: cos(angle), z: sin(angle * 0.7) });
      if (player.pending[0]) commands.push(answerCard(player, decisions[player.id]++, world.tick));
      // Held for 3 s of every 8: the second dash lands exactly when the cooldown ends.
      if (world.tick % 240 < 90) commands.push({ t: "dash", player: player.id });
      if (world.tick % 30 === 0) commands.push({ t: "ult", player: player.id });
      const script = scripts[player.id];
      if (script) {
        const step = script.next();
        if (step.done) scripts[player.id] = null;
        else commands.push(...step.value);
      } else if (player.dialog)
        commands.push({ t: "leave", player: player.id, dialog: player.dialog.id });
      if (spec.refill) player.hp = playerStats(player).maxHp;
    }
    const tick = world.tick;
    stepWorld(world, commands);

    world.players.forEach((p, i) => {
      const [rerolls, skips, banishes] = before[i];
      if (p.rerolls < rerolls) seen.add("reroll");
      if (p.skips < skips) seen.add("skip");
      if (p.banishes < banishes) seen.add("banish");
      if (p.alive && p.hp === 1 && status(p, "poison")[0] > 0) seen.add("poison-floor");
    });
    for (const event of world.events) {
      const facts = eventFacts(event);
      if (facts) window.update(`${JSON.stringify(facts)}\n`);
      if (event.t === "evolve") seen.add(`evolve:${event.stage}`);
      if (event.t === "reaction") seen.add(`reaction:${event.reaction}`);
      if (["ult", "dash", "revive", "capture"].includes(event.t)) seen.add(event.t);
    }
    world.events.length = 0;
    if (world.bossId !== null) seen.add("guardian");
    if (world.tick !== tick && world.tick % SAMPLE_EVERY === 0) {
      const digest = sha(JSON.stringify(project(world)) + window.digest("hex"));
      samples.push(digest.slice(0, 8));
      chain = sha(chain + digest);
      window = createHash("sha256");
    }
  }
  seen.add(world.outcome);
  const end = sha(chain + JSON.stringify(project(world)) + window.digest("hex")).slice(0, 16);
  const missing = spec.covers.filter((feature) => !seen.has(feature));
  return {
    end: `${world.tick} ${world.outcome} ${end}`,
    samples: samples.join(" "),
    missing,
  };
}

const clock = (tick) => {
  const seconds = Math.round(tick / 30);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Where a case first differs from its recording. */
function firstDifference(recorded, current) {
  const was = recorded.samples ? recorded.samples.split(" ") : [];
  const now = current.samples ? current.samples.split(" ") : [];
  const index = now.findIndex((digest, i) => digest !== was[i]);
  if (index >= 0) {
    const tick = (index + 1) * SAMPLE_EVERY;
    return `first differs at sample ${index + 1} (tick ${tick}, ${clock(tick)})`;
  }
  if (now.length !== was.length) return `ends after ${now.length} samples, recorded ${was.length}`;
  return `end differs: ${recorded.end} → ${current.end}`;
}

/** The CLI; importing the module (scripts/snapshot.test.mjs reuses the projection) runs nothing. */
function main() {
  const started = performance.now();
  const results = {};
  let failed = false;
  const coopOnly = process.argv.includes("--coop");
  const cases = coopOnly ? CASES.filter((spec) => spec.players.length > 1) : CASES;
  for (const spec of cases) {
    const result = replay(spec);
    results[spec.name] = { end: result.end, samples: result.samples };
    if (result.missing.length > 0) {
      console.log(`coverage lost ${spec.name}: never reached ${result.missing.join(", ")}`);
      failed = true;
    }
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);

  if (process.argv.includes("--write")) {
    if (failed) process.exit(1);
    const output = coopOnly ? { ...JSON.parse(readFileSync(FILE, "utf8")), ...results } : results;
    writeFileSync(FILE, `${JSON.stringify(output, null, 2)}\n`);
    for (const [name, result] of Object.entries(results)) console.log(`${name}  ${result.end}`);
    console.log(`golden: ${cases.length} replays written (${seconds} s)`);
  } else {
    const recorded = JSON.parse(readFileSync(FILE, "utf8"));
    for (const name of Object.keys(recorded))
      if (!results[name] && !coopOnly) {
        console.log(`missing case ${name} (recorded, no longer replayed)`);
        failed = true;
      }
    for (const [name, result] of Object.entries(results)) {
      const was = recorded[name];
      if (!was) console.log(`new case ${name} (not recorded)`);
      else if (was.end !== result.end || was.samples !== result.samples)
        console.log(`changed ${name}: ${firstDifference(was, result)}`);
      else continue;
      failed = true;
    }
    if (failed) process.exit(1);
    console.log(`golden: ${cases.length} replays unchanged (${seconds} s)`);
  }
}

if (process.argv[1] === import.meta.filename) main();
