// Calibration check for the analytical model (`bun run balance:model`, docs/BALANCE.md): a terrain-aware
// kiting bot plays full runs through the real simulation.
// Usage: [ONLY=<starter>] [PARTY=1] bun run balance [difficulty=0] [seeds=4] (PARTY: lab 支援队伍, 3 partner slots).
// A bot plays worse than a person (naive card picks, short look-ahead), so treat results as a lower
// bound. Per starter it prints clears, the per-minute trace (level, kills, living enemies, HP), each
// move's share of damage, station use and partners: the numbers the model's free factors are fitted against.
// Stations go through the player's own commands: it walks to Bill's machine once the signature pair
// is maxed, and to Hypno to forget its weakest move when the slots are full and a kit or evolution
// move is waiting; partners are automatic.
import { labBonuses } from "../src/run/lab.ts";
import { starterOrder, type StarterId } from "../src/run/sim/content/lines/index.ts";
import { signatureFusions } from "../src/run/sim/content/fusions.ts";
import type { Difficulty } from "../src/run/sim/content/difficulties.ts";
import type { MoveId } from "../src/run/sim/content/moves.ts";
import { fusionStatus } from "../src/run/sim/fusion.ts";
import { findPath, moveWithSlope, steepnessAt } from "../src/run/sim/nav/index.ts";
import { mobilityClasses } from "../src/run/sim/content/mobility.ts";
import { formOf } from "../src/run/sim/evolution.ts";
import { stationHere } from "../src/run/sim/stations.ts";
import { STATION_REACH } from "../src/run/sim/content/params/stations.ts";
import { heightAt } from "../src/run/sim/terrain.ts";
import type { Command } from "../src/run/sim/state/commands.ts";
import type { Player, Station } from "../src/run/sim/state/entities.ts";
import type { World } from "../src/run/sim/state/world.ts";
import { learnable, moveSlots } from "../src/run/sim/upgrades.ts";
import { createWorldFromSeeds, stepWorld } from "../src/run/sim/world.ts";

const MAX_TICKS = 30 * 700;
const DIRECTIONS = 16;
/** Pull toward the next waypoint of an errand: beats candy and distant enemies, not one at arm's reach. */
const ERRAND_PULL = 1.5;
/** Ticks between path refreshes on an errand. */
const REPATH = 15;
/** A move is judged by its damage per second only after this many seconds owned. */
const JUDGE_AFTER = 30;
/** Weak: under this share of the kit's damage per second. */
const WEAK_SHARE = 0.15;

function chooseCard(world: World): Command | null {
  const pending = world.players[0]!.pending[0];
  if (!pending) return null;
  const newMove = pending.options.findIndex((choice) => choice.kind === "move");
  return {
    t: "pick",
    player: 0,
    card: pending.id,
    index: newMove >= 0 ? newMove : world.tick % pending.options.length,
  };
}

/**
 * The weak move to forget: the least damage per second among moves owned long enough to judge, under
 * `WEAK_SHARE` of the kit's, never a fusion part (seconds owned in `owned`).
 */
function weakestMove(world: World, player: Player, owned: Map<MoveId, number>): MoveId | null {
  const {
    result: fusion,
    match: { pair },
  } = signatureFusions[player.starter];
  const dps = (id: MoveId, damage: number) => damage / Math.max(1, world.time - owned.get(id)!);
  const total = player.moves.reduce((sum, state) => sum + dps(state.id, state.damage), 0);
  let weakest: MoveId | null = null;
  let least = WEAK_SHARE * total;
  for (const state of player.moves) {
    if (state.id === fusion || pair.includes(state.id)) continue;
    if (world.time - owned.get(state.id)! < JUDGE_AFTER) continue;
    const own = dps(state.id, state.damage);
    if (own < least) {
      least = own;
      weakest = state.id;
    }
  }
  return weakest;
}

/** The station worth walking to now: Bill's machine once the pair is ready, Hypno to make room. */
function errand(world: World, owned: Map<MoveId, number>): Station | undefined {
  const p = world.players[0]!;
  const bill = world.stations.find((station) => station.kind === "bill")!;
  if (!bill.used && fusionStatus(p).ready) return bill;
  if (
    p.moves.length >= moveSlots(p) &&
    learnable(p).some(({ move }) => !p.banished.includes(`move:${move}`)) &&
    weakestMove(world, p, owned) !== null
  )
    return world.stations.find((station) => station.kind === "hypno");
  return undefined;
}

/** Fuses, or forgets the weakest move, in the dialog open at the station; then leaves. */
function answerDialog(world: World, owned: Map<MoveId, number>): Command[] {
  const p = world.players[0]!;
  const dialog = p.dialog!;
  const station = world.stations.find((s) => s.id === dialog.station)!;
  if (station.kind === "bill") return [{ t: "fuse", player: 0, dialog: dialog.id }];
  const weakest = weakestMove(world, p, owned);
  const leave: Command = { t: "leave", player: 0, dialog: dialog.id };
  return weakest
    ? [{ t: "forget", player: 0, dialog: dialog.id, target: { kind: "move", id: weakest } }, leave]
    : [leave];
}

/** Route to the near edge of the station's zone (its body blocks the nav, so not to its centre). */
function pathToStation(world: World, station: Station, out: number[]): boolean {
  const p = world.players[0]!;
  const dx = p.x - station.x;
  const dz = p.z - station.z;
  const d = Math.hypot(dx, dz) || 1;
  const edge = station.radius + formOf(p).radius + STATION_REACH / 2;
  const x = station.x + (dx / d) * edge;
  const z = station.z + (dz / d) * edge;
  return findPath(world.nav, mobilityClasses.ground, p.x, p.z, x, z, out);
}

/** Scores 16 headings: away from enemies and hazards, toward candy and the errand's next waypoint, never into walls. */
function chooseHeading(world: World, waypoint: [number, number] | null): [number, number] {
  const p = world.players[0]!;
  const near = world.enemies.filter((e) => Math.hypot(e.x - p.x, e.z - p.z) < (e.boss ? 16 : 10));
  const candy = world.pickups.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) < 12);
  const here = heightAt(world.map.terrain, p.x, p.z);
  let best = -Infinity;
  let heading: [number, number] = [0, 0];
  for (let k = 0; k < DIRECTIONS; k++) {
    const angle = (k / DIRECTIONS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const nx = p.x + dx * 2;
    const nz = p.z + dz * 2;
    let score = 0;
    for (const e of near) {
      const d = Math.hypot(e.x - nx, e.z - nz);
      score -= (e.boss ? 5 : e.elite ? 8 : 2) / (d * d + 0.2);
      if (e.boss && d > 6 && d < 13) score += 0.4;
    }
    for (const h of world.hazards) score -= 6 / (Math.hypot(h.x - nx, h.z - nz) ** 2 + 0.2);
    for (const c of candy)
      score += (c.kind === "chest" ? 3 : 0.3) / (Math.hypot(c.x - nx, c.z - nz) + 1);
    if (waypoint) {
      const wx = waypoint[0] - p.x;
      const wz = waypoint[1] - p.z;
      score += (ERRAND_PULL * (dx * wx + dz * wz)) / (Math.hypot(wx, wz) || 1);
    }
    // Corners are death traps for a kiter: push back toward the middle well before the wall.
    score -= ((Math.max(0, Math.abs(nx) - 28) + Math.max(0, Math.abs(nz) - 28)) / 8) ** 2;
    const probe = { x: p.x, z: p.z };
    moveWithSlope(world.nav, mobilityClasses.ground, probe, dx * 0.4, dz * 0.4);
    if (Math.hypot(probe.x - p.x, probe.z - p.z) < 0.2) score -= 50;
    for (const reach of [1, 2, 4]) {
      const fx = p.x + dx * reach;
      const fz = p.z + dz * reach;
      if (
        heightAt(world.map.terrain, fx, fz) - here > 0.3 &&
        steepnessAt(world.nav.grid, fx, fz) > mobilityClasses.ground.climb
      ) {
        score -= 6 / reach;
        break;
      }
    }
    if (score > best) {
      best = score;
      heading = [dx, dz];
    }
  }
  return heading;
}

function playRun(starter: StarterId, difficulty: Difficulty, seed: number, party: boolean) {
  let next = seed;
  const lab = party ? labBonuses({ party: 1 }) : undefined;
  const world = createWorldFromSeeds(
    { stage: "forest", difficulty, players: [{ starter, lab }] },
    () => next++,
  );
  /** Second each move was learned, for its damage per second. */
  const owned = new Map<MoveId, number>();
  const path: number[] = [];
  let goal: Station | undefined;
  let forgets = 0;
  let fusedAt: number | null = null;
  let guards = 0;
  let worstTick = 0;
  const levels: number[] = [];
  const kills: number[] = [];
  const living: number[] = [];
  const hp: number[] = [];
  const partners: number[] = [];
  for (let i = 0; i < MAX_TICKS && world.outcome === "playing"; i++) {
    const p = world.players[0]!;
    if (world.time >= (levels.length + 1) * 60) {
      levels.push(p.level);
      kills.push(p.kills);
      living.push(world.enemies.length);
      partners.push(world.partners.length);
      hp.push(p.hp);
    }
    for (const state of p.moves) if (!owned.has(state.id)) owned.set(state.id, world.time);
    const commands: Command[] = [];
    const card = chooseCard(world);
    if (card) commands.push(card);
    if (p.dialog) {
      const answer = answerDialog(world, owned);
      if (answer[0]!.t === "forget") forgets++;
      if (answer[0]!.t === "fuse") fusedAt = world.time;
      commands.push(...answer);
      goal = undefined;
    } else {
      const wanted = errand(world, owned);
      if (wanted !== goal || (wanted && i % REPATH === 0)) {
        goal = wanted;
        if (goal && !pathToStation(world, goal, path)) path.length = 0;
      }
      if (goal && stationHere(world, p) === goal) commands.push({ t: "interact", player: 0 });
    }
    // Waypoints within a step are reached and dropped; the path ends on the zone's edge.
    while (path.length > 2 && Math.hypot(path[0]! - p.x, path[1]! - p.z) <= 1) path.splice(0, 2);
    const waypoint: [number, number] | null = goal && path.length ? [path[0]!, path[1]!] : null;
    const [x, z] = chooseHeading(world, waypoint);
    commands.push({ t: "move", player: 0, x, z });
    if (world.enemies.some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 1.4))
      commands.push({ t: "dash", player: 0 });
    // Fires the ultimate the moment it is full, like the balance model assumes.
    if (p.ult.charge >= 1) commands.push({ t: "ult", player: 0 });
    const start = performance.now();
    stepWorld(world, commands);
    worstTick = Math.max(worstTick, performance.now() - start);
    guards += world.events.filter((e) => e.t === "partner-guard").length;
    world.events.length = 0;
  }
  const p = world.players[0]!;
  const boss = world.enemies.find((e) => e.boss);
  return {
    outcome: world.outcome,
    time: Math.round(world.time),
    level: p.level,
    reachedBoss: world.spawn.fired.includes("boss"),
    bossHpLeft: boss ? boss.hp / boss.maxHp : 0,
    levels,
    kills,
    living,
    hp,
    partners,
    endPartners: world.partners.length,
    guards,
    forgets,
    fusedAt,
    damage: p.moves.map((m) => [m.id, m.damage] as const),
    worstTick,
  };
}

/** Mean of the i-th sample over the runs still alive at that minute, as "m:value" pairs. */
function perMinute(series: number[][]): string {
  const out: string[] = [];
  for (let m = 0; ; m++) {
    const alive = series.map((s) => s[m]).filter((v) => v !== undefined);
    if (alive.length === 0) return out.join(" ");
    out.push(`${m + 1}:${(alive.reduce((a, b) => a + b, 0) / alive.length).toFixed(1)}`);
  }
}

const difficulty = Number(process.argv[2] ?? 0) as Difficulty;
const seeds = Number(process.argv[3] ?? 4);
const only = process.env.ONLY;
const party = process.env.PARTY === "1";
for (const starter of starterOrder.filter((id) => !only || id === only)) {
  const runs = Array.from({ length: seeds }, (_, i) =>
    playRun(starter, difficulty, 1000 + i * 7919, party),
  );
  const wins = runs.filter((r) => r.outcome === "victory").length;
  const boss = runs.filter((r) => r.reachedBoss).length;
  const survival = Math.round(runs.reduce((sum, r) => sum + r.time, 0) / runs.length);
  const worst = Math.max(...runs.map((r) => r.worstTick)).toFixed(1);
  console.log(
    `${starter.padEnd(10)} clears ${wins}/${seeds}  reached boss ${boss}/${seeds}  mean survival ${survival}s  worst tick ${worst} ms`,
  );
  const ends = runs.map((r) =>
    r.outcome === "victory"
      ? `win@${r.time}`
      : r.reachedBoss
        ? `died@${r.time}(boss ${Math.round(r.bossHpLeft * 100)}%)`
        : `died@${r.time}`,
  );
  console.log(`  runs   ${ends.join(" ")}`);
  console.log(`  level  ${perMinute(runs.map((r) => r.levels))}`);
  console.log(`  kills  ${perMinute(runs.map((r) => r.kills))}`);
  console.log(`  living ${perMinute(runs.map((r) => r.living))}`);
  console.log(`  hp     ${perMinute(runs.map((r) => r.hp))}`);
  console.log(`  party  ${perMinute(runs.map((r) => r.partners))}`);
  const fused = runs.filter((r) => r.fusedAt !== null);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  console.log(
    `  errands fused ${fused.length}/${seeds}${fused.length ? ` @${Math.round(mean(fused.map((r) => r.fusedAt!)))}s` : ""}  forgets ${mean(runs.map((r) => r.forgets)).toFixed(2)}/run  partners at the end ${mean(runs.map((r) => r.endPartners)).toFixed(2)} (3: ${runs.filter((r) => r.endPartners >= 3).length}/${seeds})  guards ${mean(runs.map((r) => r.guards)).toFixed(1)}/run`,
  );
  const damage = new Map<string, number>();
  for (const r of runs) for (const [id, d] of r.damage) damage.set(id, (damage.get(id) ?? 0) + d);
  const total = [...damage.values()].reduce((a, b) => a + b, 0) || 1;
  console.log(
    `  damage ${[...damage].map(([id, d]) => `${id} ${Math.round((d / total) * 100)}%`).join(", ")}`,
  );
}
