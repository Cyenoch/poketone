// Each map is one field. Only the expedition's final exit wins; tower floors keep going.

import { revivePlayer } from "./rescue";
import { COOP } from "./content/params/coop";
import { BOND_CURE_LEVEL } from "./content/params/bonds";
import { isTowerGuardianFloor } from "./content/params/tower";
import { PARTNER_BEHIND } from "./content/params/environment";
import { stageDefs } from "./content/stages/index";
import { atExit, atLandmark, zoneDef } from "./currentZone";
import { primeEnemyNav, summonGuardian } from "./director";
import { evolveInWorld, formOf, stageFor } from "./evolution";
import { generateMap, MapGenError } from "./mapgen/index";
import { createRng, mixSeed } from "./rng";
import { collectRemainingPickups, furnishMap, isFrozen, spawnX } from "./world";
import { TICK, type World } from "./state/world";
import type { Player } from "./state/entities";
import { nextField, ROUTE_TIERS, STAGE_INDEX } from "./content/campaign";
import { routeModifiers } from "./content/route";
import { prepareRouteField, applyRouteEntry, cancelRouteDeal } from "./route-rewards";
import type { StageId } from "./content/stages/index";
import { scheduleField } from "./field-events";

/** Fixed stream labels mixed into a zone's seeds (any distinct constants; changing one changes every map). */
const ZONE_STREAM = 0x7a6f6e65;
const SIM_STREAM = 0x73696d00;
/** A zone's map retries this many derived seeds before the stage's map spec counts as broken. */
const FIELD_ATTEMPTS = 8;

const TRADE_RANGE = 2.5;
const TRADE_WINDOW = Math.round(5 / TICK);

function inTradeRange(a: Player, b: Player): boolean {
  return (
    a !== b &&
    a.alive &&
    b.alive &&
    !a.departed &&
    !b.departed &&
    (a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= TRADE_RANGE ** 2
  );
}

export function expireTrades(world: World): void {
  for (const player of world.players) {
    const request = player.tradeRequest;
    if (!request) continue;
    const peer = world.players.find((p) => p.id === request.target);
    if (world.tick > request.expiresAtTick || !peer || !inTradeRange(player, peer))
      player.tradeRequest = null;
  }
}

/** What interacting would do about a trade now, for the prompt: accept, offer, or wait on one's own offer. */
export function tradeAction(
  world: World,
  player: Player,
  present?: (id: number) => boolean,
): "trade-accept" | "trade-wait" | "trade" | null {
  if (world.players.length < 2) return null;
  const ready = (p: Player) => stageFor(p, "trade") > stageFor(p);
  let offer = false;
  for (const peer of world.players) {
    if (
      !inTradeRange(player, peer) ||
      present?.(peer.id) === false ||
      !(ready(player) || ready(peer))
    )
      continue;
    if (peer.tradeRequest?.target === player.id && peer.tradeRequest.expiresAtTick >= world.tick)
      return "trade-accept";
    offer = true;
  }
  if (!offer) return null;
  return player.tradeRequest ? "trade-wait" : "trade";
}

/** Accept an incoming request first; otherwise offer to the nearest eligible teammate. */
export function interactTrade(
  world: World,
  player: Player,
  present?: (id: number) => boolean,
): boolean {
  if (world.players.length < 2) return false;
  const ready = (p: Player) => stageFor(p, "trade") > stageFor(p);
  let nearest: Player | undefined;
  let distance = Infinity;
  for (const peer of world.players) {
    if (
      !inTradeRange(player, peer) ||
      present?.(peer.id) === false ||
      !(ready(player) || ready(peer))
    )
      continue;
    if (peer.tradeRequest?.target === player.id && peer.tradeRequest.expiresAtTick >= world.tick) {
      peer.tradeRequest = player.tradeRequest = null;
      for (const recipient of [player, peer])
        if (ready(recipient)) evolveInWorld(world, recipient, "trade");
      return true;
    }
    const d = (player.x - peer.x) ** 2 + (player.z - peer.z) ** 2;
    if (d < distance) {
      nearest = peer;
      distance = d;
    }
  }
  if (!nearest) return false;
  player.tradeRequest = { target: nearest.id, expiresAtTick: world.tick + TRADE_WINDOW };
  return true;
}

/** What interacting here does now: summon at the landmark, leave at the exit, or null. */
export function zoneAction(world: World, player: Player): "summon" | "leave" | null {
  if (!player.alive || world.outcome !== "playing" || world.zone.leaving !== null) return null;
  if (
    world.mode === "expedition" &&
    world.zone.phase === "active" &&
    world.bossId === null &&
    atLandmark(world, player)
  )
    return "summon";
  if (world.zone.phase === "cleared" && atExit(world, player) !== null) return "leave";
  return null;
}

/**
 * Solo finishes its cards before leaving. Co-op carries unspent choices across fields;
 * a station dialog must still close before the team leaves.
 */
export function canLeave(world: World, isSeatPresent?: (id: number) => boolean): boolean {
  return world.players.every(
    (player) =>
      player.departed ||
      isSeatPresent?.(player.id) === false ||
      ((world.players.length > 1 || player.pending.length === 0) && !player.dialog),
  );
}

/**
 * The interact command at the landmark summons the guardian; at the exit it opened by falling, it
 * leaves the zone. True when either took the command.
 */
export function interactInZone(
  world: World,
  player: Player,
  isSeatPresent?: (id: number) => boolean,
): boolean {
  if (isFrozen(world)) return false;
  const action = zoneAction(world, player);
  if (action === "summon") {
    summonGuardian(world, player);
    return true;
  }
  if (action !== "leave" || !canLeave(world, isSeatPresent)) return false;
  const index = atExit(world, player)!;
  const exit = world.zone.exits[index]!;
  if (exit.to === null && (world.mode !== "expedition" || world.stage !== "tower"))
    throw new Error(`关卡 ${world.stage} 的出口 ${index} 缺少目标。`);
  if (exit.to === null) {
    collectRemainingPickups(world);
    let waiting = false;
    for (const seat of world.players) {
      if (
        seat.departed ||
        isSeatPresent?.(seat.id) === false ||
        (!seat.alive && world.rules.includes("nuzlocke"))
      )
        continue;
      if (
        world.players.length === 1
          ? seat.pending.length > 0
          : seat.pending.some((card) => card.offer?.kind === "trophy")
      ) {
        waiting = true;
        if (seat === player) seat.choosing = true;
      }
    }
    if (waiting) return true;
  }
  for (const seat of world.players) cancelRouteDeal(world, seat);
  world.zone.leaving = index;
  world.events.push({ t: "route", kind: "exit", player: player.id, x: exit.x, z: exit.z });
  if (exit.to === null) world.outcome = "victory";
  else {
    collectRemainingPickups(world);
    world.zone.phase = "transitioning";
  }
  return true;
}

/**
 * A cleared zone keeps no fight: what is left of the swarm, every shot, area and hazard goes (no
 * kills, no drops). Remaining drops fly to living players through ordinary pickup settlement.
 * Called at the end of each tick; only the shared world advances this in multiplayer.
 */
export function sweepClearedField(world: World): void {
  if (world.zone.phase !== "cleared") return;
  // Only a felled guardian revives: a timed tower floor opens its exit without one.
  if (
    !world.rules.includes("nuzlocke") &&
    (world.mode !== "tower" || isTowerGuardianFloor(world.route.length))
  )
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
export type Field = Pick<
  World,
  "map" | "nav" | "stations" | "sites" | "pickups" | "modifier" | "rng" | "nextId"
>;
export type PreparedZone = Field &
  Pick<World, "stage" | "route" | "marker"> & { zone: number; leaving: number };

/**
 * Generates and furnishes a map from `seed` on a scratch copy of the world, so the live one keeps
 * its map, stations and ids. A seed the map spec cannot fit draws the next derived seed, a fixed
 * part of the generation rule (never the clock); any other error is rethrown.
 */
export function withFieldSeed<T>(seed: number, build: (draw: number) => T): T {
  for (let attempt = 0; ; attempt++) {
    const draw = attempt === 0 ? seed : mixSeed(seed, attempt);
    try {
      return build(draw);
    } catch (error) {
      if (!(error instanceof MapGenError) || attempt + 1 >= FIELD_ATTEMPTS) throw error;
    }
  }
}

export function fieldRng(draw: number) {
  return createRng(mixSeed(draw, SIM_STREAM));
}

export function assembleField(world: World, seed: number): Field {
  const scratch = withFieldSeed(seed, (draw): World => {
    const built = generateMap(draw, zoneDef(world).map ?? stageDefs[world.stage].map);
    const next: World = {
      ...world,
      ...built,
      stations: [],
      sites: [],
      pickups: [],
      modifier: null,
      events: [],
      seed: draw,
      rng: fieldRng(draw),
    };
    furnishMap(next, world.players.length);
    return next;
  });
  // A marked exit must never change which terrain seed was accepted for its destination.
  if (scratch.mode === "expedition") prepareRouteField(scratch);
  const { map, nav, stations, sites, pickups, modifier, rng, nextId } = scratch;
  return { map, nav, stations, sites, pickups, modifier, rng, nextId };
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
    if (player.egg) Object.assign(player.egg, { x, z: 0 });
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
    partner.target = null;
    partner.returning = false;
  }
}

/** The next zone's field, from the run seed, stage and zone alone (a retry readies the same one). */
export function prepareZone(world: World): PreparedZone {
  const { leaving } = world.zone;
  if (world.zone.phase !== "transitioning" || leaving === null)
    throw new Error(`区域 ${world.zone.index + 1} 还没有离开，不能准备下一区。`);
  const destination = nextField(world);
  if (!destination) throw new Error("所选出口没有下一关。");
  const { stage, zone } = destination;
  const route = [...world.route, stage];
  const marker = world.zone.exits[leaving]!.marker;
  const next: World = {
    ...world,
    stage,
    route,
    marker,
    modifier: null,
    zone: { index: zone, tick: 0, phase: "active", exits: [], leaving: null, schedule: [] },
  };
  const seed =
    world.mode === "tower" ? mixSeed(world.seed, route.length) : zoneSeed(world.seed, stage, zone);
  return {
    ...assembleField(next, seed),
    stage,
    zone,
    route,
    marker,
    leaving,
  };
}

/**
 * Commits the prepared next zone between two ticks: its field, a fresh clock, director, guardian and
 * final swarm, and its own gameplay randomness. Players keep everything they earned (level, moves,
 * items, HP, shield, cooldowns, ultimate charge, partners); what belonged to the old field goes.
 * Ticking resumes from the new zone's first tick.
 */
export function enterZone(world: World, prepared: PreparedZone): void {
  const destination = nextField(world);
  if (
    world.zone.phase !== "transitioning" ||
    world.zone.leaving !== prepared.leaving ||
    world.zone.exits[prepared.leaving]?.marker !== prepared.marker ||
    prepared.route.length !== world.route.length + 1 ||
    prepared.zone !== destination?.zone ||
    prepared.stage !== destination.stage
  )
    throw new Error(`准备的是第 ${prepared.zone + 1} 区，世界在第 ${world.zone.index + 1} 区。`);
  const { zone, stage: stageId, route, marker, leaving: _leaving, ...field } = prepared;
  world.stage = stageId;
  world.route = route;
  world.marker = marker;
  world.enemies = [];
  world.projectiles = [];
  world.areas = [];
  world.hazards = [];
  installField(world, field);
  for (const player of world.players) {
    // The old field's afflictions and a cast in flight stay behind; spent charge is not refunded.
    player.statuses = [];
    player.bondCure = player.bond >= BOND_CURE_LEVEL;
    player.tradeRequest = null;
    player.ult.elapsed = -1;
    player.ult.protection = 0;
    player.ult.crossed = [];
  }
  world.zone = { index: zone, tick: 0, phase: "active", exits: [], leaving: null, schedule: [] };
  world.spawn = {
    credit: 0,
    pressure: 0.5,
    pool: [],
    fired: [],
    anchor: -1,
    outbreak: null,
    shinySpawned: false,
  };
  world.weather = null;
  world.weatherSetAt = 0;
  world.pledgeHits = [];
  world.rainbowUntil = 0;
  world.silphScope = false;
  world.bossId = null;
  world.rampage = false;
  applyRouteEntry(world);
  scheduleField(world);
  const stage = stageDefs[world.stage];
  const progress =
    world.mode === "tower" ? `第 ${route.length} 层` : `${route.length}/${ROUTE_TIERS.length}`;
  world.events.push({
    t: "banner",
    text: `${progress} ${stage.name}${world.modifier ? ` · ${routeModifiers[world.modifier].name}` : ""}`,
    tone: "info",
    kind: "zone",
  });
  primeEnemyNav(world);
  if (world.mode === "tower" && isTowerGuardianFloor(route.length)) summonGuardian(world, null);
}

/** The forest keeps the run seed; all other maps use their stable identity. */
export function zoneSeed(seed: number, stage: StageId, zone: number = 0): number {
  const stageSeed = stage === "forest" ? seed : mixSeed(seed, STAGE_INDEX[stage]);
  return zone === 0 ? stageSeed : mixSeed(mixSeed(stageSeed, ZONE_STREAM), zone);
}
