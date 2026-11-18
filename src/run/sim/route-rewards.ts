import { routeStep } from "./content/campaign";
import { formDefs } from "./content/lines/index";
import { mobilityClasses } from "./content/mobility";
import { PICKUP } from "./content/params/economy";
import { ROUTE_REWARD } from "./content/params/route";
import { SITE } from "./content/params/sites";
import { STATION_REACH } from "./content/params/stations";
import { rollRouteModifier } from "./content/route";
import { formOf } from "./evolution";
import { MapGenError } from "./mapgen/types";
import { cos, hypot, sin } from "./math";
import { bodyFits, cellAt, routeReach } from "./nav/index";
import { nextCard, queueCard } from "./progression";
import { pick } from "./rng";
import type { Choice, PendingChoice, Pickup, Player } from "./state/entities";
import { ARENA_HALF, type World } from "./state/world";
import { setDrought } from "./weather";
import { currentAbility, playerStats, refreshStats } from "./stats";
import { rollRewardChoices, rewardChoiceEligible } from "./upgrades";

export { rollRewardChoices } from "./upgrades";

/** Only the freshly furnished field belongs to scratch; players still belong to the live world. */
export function prepareRouteField(world: World): void {
  world.modifier = rollRouteModifier(world.rng, routeStep(world));
  const tm = world.modifier === "dark-cave" ? "flash" : world.modifier === "fog" ? "defog" : null;
  const drops: ("chest" | "defog" | "flash")[] = [];
  if (world.marker === "chests") for (let i = 0; i < ROUTE_REWARD.chests; i++) drops.push("chest");
  if (tm) drops.push(tm);
  if (!drops.length && world.marker !== "gengar-deal") return;

  const body = Math.max(...Object.values(formDefs).map((form) => form.radius));
  const ground = mobilityClasses.ground;
  const { nav } = world;
  const home = [nav.grid.home];
  const out = routeReach(nav, ground, home, false),
    back = routeReach(nav, ground, home, true);
  const fits = (x: number, z: number) => {
    const cell = cellAt(nav.grid, x, z);
    return (
      Math.abs(x) + body <= ARENA_HALF &&
      Math.abs(z) + body <= ARENA_HALF &&
      out[cell] === 1 &&
      back[cell] === 1 &&
      bodyFits(nav, ground, x, z, body)
    );
  };
  const fail = (what: string) =>
    new MapGenError(`${world.stage}（种子 ${world.seed}）：没有可往返的${what}位置。`);
  if (world.marker === "gengar-deal") {
    // Keep blockers, clustered item balls and the tower's mandatory scope/ghost pair intact.
    const candidates = world.sites.filter(
      (site) =>
        !["item-ball", "honey-tree", "snorlax", "ghost", "silph-scope"].includes(site.kind) &&
        world.map.pads.some((pad) => pad.tag === "site" && pad.x === site.x && pad.z === site.z) &&
        fits(site.x, site.z) &&
        world.stations.every(
          (s) =>
            hypot(s.x - site.x, s.z - site.z) >
            s.radius + SITE.radius["gengar-deal"] + SITE.reach * 2,
        ),
    );
    if (!candidates.length) throw fail("耿鬼祭坛");
    Object.assign(pick(world.rng, candidates), {
      kind: "gengar-deal",
      radius: SITE.radius["gengar-deal"],
      state: "ready",
      data: { progress: 0, uses: 0, enemy: null, lastHurt: 0, traded: [] },
    });
  }
  // The building centres hold blocking NPCs; distribute loot around their flat outer edges.
  const spots: { x: number; z: number }[] = [];
  const pads = world.map.pads.filter((pad) => pad.tag === "building");
  for (let dir = 0; dir < 16 && spots.length < drops.length; dir++) {
    const angle = dir * (5 / 16) * Math.PI * 2;
    for (const pad of pads) {
      const x = pad.x + cos(angle) * (pad.radius - body),
        z = pad.z + sin(angle) * (pad.radius - body);
      if (
        fits(x, z) &&
        world.stations.every((s) => hypot(s.x - x, s.z - z) > s.radius + body + STATION_REACH) &&
        world.sites.every((s) => hypot(s.x - x, s.z - z) > s.radius + body + SITE.reach) &&
        spots.every((s) => hypot(s.x - x, s.z - z) > 2 * PICKUP.collectDistance)
      )
        spots.push({ x, z });
    }
  }
  if (spots.length < drops.length) throw fail("路线拾取物");
  for (const [i, kind] of drops.entries())
    world.pickups.push({ id: world.nextId++, ...spots[i]!, kind, value: 1, magnet: false });
}

export function applyRouteEntry(world: World): void {
  if (world.players.some((p) => p.alive && !p.departed && currentAbility(p) === "drought"))
    setDrought(world);
  if (world.marker !== "pokecenter") return;
  for (const player of world.players)
    if (player.alive && !player.departed) {
      player.statuses = [];
      player.hp = playerStats(player).maxHp;
    }
}

export function routeSpawnFactors(world: Pick<World, "marker" | "modifier">): {
  eliteRate: number;
  eliteHp: number;
} {
  const sighting = world.modifier === "boss-sighting";
  return {
    eliteRate:
      (world.marker === "elite-nest" ? ROUTE_REWARD.nestRate : 1) *
      (sighting ? ROUTE_REWARD.sightingRate : 1),
    eliteHp: sighting ? ROUTE_REWARD.sightingHp : 1,
  };
}

export function lightRadius(world: Pick<World, "modifier">, player: Player): number {
  return world.modifier === "dark-cave" ? caveLightRadius(player) : Infinity;
}

export function caveLightRadius(player: Player): number {
  const { types } = formOf(player);
  return types.includes("fire") || types.includes("electric")
    ? ROUTE_REWARD.brightRadius
    : ROUTE_REWARD.lightRadius;
}

export function collectRoutePickup(world: World, pickup: Pickup, player: Player): boolean {
  const { kind, x, z } = pickup;
  if (kind === "trophy") {
    if (pickup.owner !== player.id || player.departed) return false;
    queueCard(world, player, "chest", undefined, {
      kind,
      ...(world.route.length >= 2 ? { megaStones: true } : {}),
    });
  } else if (
    (kind === "flash" && world.modifier === "dark-cave") ||
    (kind === "defog" && world.modifier === "fog")
  )
    world.modifier = null;
  else return false;
  world.events.push({ t: "route", kind, x, z, player: player.id });
  return true;
}

export function pickRouteReward(
  world: World,
  player: Player,
  pending: PendingChoice,
  choice: Choice,
): boolean {
  const offer = pending.offer;
  if (player.pending[0] !== pending || !pending.options.includes(choice)) return false;
  if (!rewardChoiceEligible(world, player, pending, choice)) {
    const kept = offer
      ? pending.options.filter((option) => rewardChoiceEligible(world, player, pending, option))
      : [];
    pending.options = rollRewardChoices(world, player, pending, kept);
    pending.id = world.nextId++;
    if (!pending.options.length) cancelRouteDeal(world, player);
    return false;
  }
  if (offer?.kind === "deal") {
    const site = world.sites.find(
      (s) => s.id === offer.site && s.kind === "gengar-deal" && s.state === "ready",
    );
    if (!site || site.data.traded?.includes(player.id)) return false;
    (site.data.traded ??= []).push(player.id);
    player.tradeHp *= ROUTE_REWARD.tradeHp;
    player.hp = Math.min(player.hp, playerStats(player).maxHp);
    refreshStats();
    world.events.push({ t: "route", kind: "deal", player: player.id, x: site.x, z: site.z });
  }
  return true;
}

export function cancelRouteDeal(world: World, player: Player): boolean {
  if (player.pending[0]?.offer?.kind !== "deal") return false;
  nextCard(world, player);
  return true;
}
