// Each map is one field. Its guardian opens the exit to the next map; only the tower exit wins.
// Field assembly and the loading barrier reuse the existing zone lifecycle.

import { revivePlayer } from "./rescue";
import { COOP } from "./content/params/coop";
import { PARTNER_BEHIND } from "./content/params/environment";
import { stageDefs } from "./content/stages/index";
import { atLandmark, zoneDef } from "./currentZone";
import { primeEnemyNav, summonGuardian } from "./director";
import { formOf } from "./evolution";
import { generateMap, MapGenError } from "./mapgen/index";
import { createRng } from "./rng";
import { collectRemainingPickups, furnishMap, isFrozen, spawnX } from "./world";
import type { World } from "./state/world";
import type { Player } from "./state/entities";
import { nextField, STAGE_ROUTE } from "./content/campaign";
import type { StageId } from "./content/stages/index";

/** Fixed stream labels mixed into a zone's seeds (any distinct constants; changing one changes every map). */
const ZONE_STREAM = 0x7a6f6e65;
const SIM_STREAM = 0x73696d00;
/** A zone's map retries this many derived seeds before the stage's map spec counts as broken. */
const FIELD_ATTEMPTS = 8;

/** What interacting at the landmark does now, or null when it does nothing. */
export function landmarkAction(world: World, player: Player): "summon" | "leave" | null {
  if (!player.alive || !atLandmark(world, player)) return null;
  if (world.zone.phase === "active" && world.bossId === null) return "summon";
  if (world.zone.phase === "cleared") return "leave";
  return null;
}

/**
 * Solo finishes its cards before leaving. Co-op carries unspent choices across fields;
 * a station dialog must still close before the team leaves.
 */
export function canLeave(world: World): boolean {
  return world.players.every(
    (player) => (world.players.length > 1 || player.pending.length === 0) && !player.dialog,
  );
}

/**
 * The interact command at the landmark: summons the guardian, or, once it has fallen, leaves the
 * zone. True when the landmark took the command.
 */
export function interactAtLandmark(world: World, player: Player): boolean {
  if (isFrozen(world)) return false;
  const action = landmarkAction(world, player);
  if (action === "summon") {
    summonGuardian(world, player);
    return true;
  }
  if (action !== "leave" || !canLeave(world)) return false;
  collectRemainingPickups(world);
  if (!nextField(world)) world.outcome = "victory";
  else world.zone.phase = "transitioning";
  return true;
}

/**
 * A cleared zone keeps no fight: what is left of the swarm, every shot, area and hazard goes (no
 * kills, no drops). Remaining drops fly to living players through ordinary pickup settlement.
 * Called at the end of each tick; only the shared world advances this in multiplayer.
 */
export function sweepClearedField(world: World): void {
  if (world.zone.phase !== "cleared") return;
  for (const player of world.players)
    if (!player.alive && !player.departed)
      revivePlayer(world, player, COOP.reviveHp, COOP.invulnerable, "team");
  for (const pickup of world.pickups) pickup.magnet = true;
  world.enemies.length = 0;
  world.projectiles.length = 0;
  world.areas.length = 0;
  world.hazards.length = 0;
}

/** A map assembled for `world`'s stage and players, not yet installed (nothing of `world` changes). */
export type Field = Pick<World, "map" | "nav" | "stations">;

/**
 * Generates and furnishes a map from `seed` on a scratch copy of the world, so the live one keeps
 * its map, stations and ids. A seed the map spec cannot fit draws the next derived seed, a fixed
 * part of the generation rule (never the clock); any other error is rethrown.
 */
export function assembleField(world: World, seed: number): Field {
  for (let attempt = 0; ; attempt++) {
    const draw = attempt === 0 ? seed : mixSeed(seed, attempt);
    try {
      const built = generateMap(draw, zoneDef(world).map ?? stageDefs[world.stage].map);
      const scratch: World = { ...world, ...built, stations: [], seed: draw };
      furnishMap(scratch, world.players.length);
      return { ...built, stations: scratch.stations };
    } catch (error) {
      if (!(error instanceof MapGenError) || attempt + 1 >= FIELD_ATTEMPTS) throw error;
    }
  }
}

/**
 * Installs a field under the living players: map, nav and stations replace the old ones, and each
 * player and partner stands at a spawn of the new map. Stations keep their slot's identity and use
 * (Bill's machine fuses once per run).
 */
export function installField(world: World, field: Field): void {
  const stations = field.stations.map((station, slot) => {
    const old = world.stations[slot];
    return old?.kind === station.kind ? { ...station, id: old.id, used: old.used } : station;
  });
  Object.assign(world, field, { stations });
  world.players.forEach((player, index) => {
    const x = spawnX(index, world.players.length);
    Object.assign(player, { x, z: 0, px: x, pz: 0, vx: 0, vz: 0, inputX: 0, inputZ: 0 });
    player.moving = false;
    player.dashTime = 0;
    player.dialog = null;
    player.rescue = null;
    if (world.players.length > 1) player.choosing = false;
  });
  for (const partner of world.partners) {
    const owner = world.players.find((player) => player.id === partner.owner)!;
    const back = formOf(owner).radius + PARTNER_BEHIND;
    partner.x = partner.px = owner.x - owner.faceX * back;
    partner.z = partner.pz = owner.z - owner.faceZ * back;
  }
}

/** The next zone's field, from the run seed, stage and zone alone (a retry readies the same one). */
export function prepareZone(world: World): Field & { stage: StageId; zone: number } {
  if (world.zone.phase !== "transitioning")
    throw new Error(`区域 ${world.zone.index + 1} 还没有离开，不能准备下一区。`);
  const destination = nextField(world);
  if (!destination) throw new Error("塔顶已是路线终点，不能准备下一关。");
  const { stage, zone } = destination;
  const next = { ...world, stage, zone: { index: zone, tick: 0, phase: "active" as const } };
  return { ...assembleField(next, zoneSeed(next, zone)), stage, zone };
}

/**
 * Commits the prepared next zone between two ticks: its field, a fresh clock, director, guardian and
 * final swarm, and its own gameplay randomness. Players keep everything they earned (level, moves,
 * items, HP, shield, cooldowns, ultimate charge, partners); what belonged to the old field goes.
 * Ticking resumes from the new zone's first tick.
 */
export function enterZone(world: World, prepared: Field & { stage: StageId; zone: number }): void {
  const destination = nextField(world);
  if (
    world.zone.phase !== "transitioning" ||
    prepared.zone !== destination?.zone ||
    prepared.stage !== destination.stage
  )
    throw new Error(`准备的是第 ${prepared.zone + 1} 区，世界在第 ${world.zone.index + 1} 区。`);
  const { zone, stage: stageId, ...field } = prepared;
  world.stage = stageId;
  world.enemies = [];
  world.projectiles = [];
  world.areas = [];
  world.hazards = [];
  // Departure has already settled the old field’s remaining drops.
  world.pickups = [];
  installField(world, field);
  for (const player of world.players) {
    // The old field's afflictions and a cast in flight stay behind; spent charge is not refunded.
    player.statuses = [];
    player.ult.elapsed = -1;
    player.ult.crossed = [];
  }
  world.zone = { index: zone, tick: 0, phase: "active" };
  world.spawn = { credit: 0, pressure: 0.5, pool: [], fired: [], anchor: -1 };
  world.bossId = null;
  world.rampage = false;
  world.rng = createRng(mixSeed(zoneSeed(world, zone), SIM_STREAM));
  const stage = stageDefs[world.stage];
  world.events.push({
    t: "banner",
    text: `${STAGE_ROUTE.indexOf(world.stage) + 1}/6 ${stage.name}`,
    tone: "info",
    kind: "zone",
  });
  primeEnemyNav(world);
}

/** Zone `zone`'s root seed (zone 0 is the run's own map seed). */
function zoneSeed(world: World, zone: number): number {
  const stageSeed =
    world.stage === "forest" ? world.seed : mixSeed(world.seed, STAGE_ROUTE.indexOf(world.stage));
  return zone === 0 ? stageSeed : mixSeed(mixSeed(stageSeed, ZONE_STREAM), zone);
}

/** Murmur3's finaliser over `seed` and `salt`: a fixed integer mix, the same on every engine. */
function mixSeed(seed: number, salt: number): number {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
