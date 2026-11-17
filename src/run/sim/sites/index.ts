import { enemies } from "../content/enemies";
import { SITE } from "../content/params/sites";
import { MIN_UPGRADE_RARITY } from "../content/params/cards";
import { sites } from "../content/sites";
import { zoneDef } from "../currentZone";
import type { Ctx } from "../combat";
import type { Enemy, Player, Rarity } from "../state/entities";
import type { Site } from "../state/field";
import type { World } from "../state/world";
import { chance, next, pick } from "../rng";
import { cos, hypot, sin } from "../math";
import { addCircleBlocker } from "../nav/index";
import { MapGenError } from "../mapgen/types";
import { formOf } from "../evolution";
import { announce, berries, finish, inReach, rewardItem, siteSpawnPoint } from "./shared";
import * as honey from "./honey-tree";
import * as balls from "./item-ball";
import * as snorlax from "./snorlax";
import * as fishing from "./fishing";
import * as fossil from "./fossil";
import * as raid from "./raid-den";
import * as spring from "./spring";
import * as egg from "./egg";
import * as glint from "./glint";
import * as ghost from "./ghost";
import * as scope from "./silph-scope";

const rules = {
  "honey-tree": honey,
  "item-ball": balls,
  snorlax,
  fishing,
  fossil,
  "raid-den": raid,
  spring,
  egg,
  glint,
  ghost,
  "silph-scope": scope,
};

export function placeSites(world: World): Site[] {
  const pads = world.map.pads.filter((pad) => pad.tag === "site");
  if (pads.length !== SITE.count)
    throw new MapGenError(
      `交互点需要 ${SITE.count} 块 site 平台，实际为 ${pads.length}（${world.stage}，种子 ${world.seed}）。`,
    );
  const pool = zoneDef(world).sites;
  if (pool.length === 0) throw new Error(`${world.stage}：交互点种类池为空。`);
  const result: Site[] = [];
  const available = [...pool];
  for (let slot = 0; slot < pads.length; slot++) {
    const pad = pads[slot]!;
    // Scope and ghost always coexist on this tower map; neither waits on a random awakening.
    const kind =
      world.stage === "tower" && slot < 2
        ? slot === 0
          ? "ghost"
          : "silph-scope"
        : pick(
            world.rng,
            available.filter((id) => id !== "ghost" && id !== "silph-scope"),
          );
    available.splice(available.indexOf(kind), 1);
    const state =
      world.stage === "tower" && slot < 2
        ? "ready"
        : chance(world.rng, SITE.dormantChance)
          ? "dormant"
          : "ready";
    const make = (x: number, z: number): Site => ({
      id: world.nextId++,
      kind,
      x,
      z,
      radius: SITE.radius[kind],
      state,
      until: 0,
      owner: null,
      data: { progress: 0, uses: 0, enemy: null, lastHurt: 0 },
    });
    if (kind === "item-ball") {
      const count =
        SITE.balls.count[0] +
        Math.floor(next(world.rng) * (SITE.balls.count[1] - SITE.balls.count[0] + 1));
      const traps =
        SITE.balls.traps[0] +
        Math.floor(next(world.rng) * (SITE.balls.traps[1] - SITE.balls.traps[0] + 1));
      const indexes = Array.from({ length: count }, (_, i) => i);
      const hidden = new Set<number>();
      while (hidden.size < traps)
        hidden.add(indexes.splice(Math.floor(next(world.rng) * indexes.length), 1)[0]!);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const site = make(
          pad.x + cos(angle) * SITE.balls.ring,
          pad.z + sin(angle) * SITE.balls.ring,
        );
        site.data.trap = hidden.has(i);
        if (site.data.trap) site.data.species = "voltorb";
        result.push(site);
      }
    } else {
      const site = make(pad.x, pad.z);
      if (kind === "honey-tree")
        site.data.species = pick(world.rng, ["heracross", "pinsir", "munchlax"] as const);
      if (kind === "egg" || kind === "raid-den") {
        const roster = zoneDef(world)
          .roster.map(([, id]) => id)
          .filter(
            (id) =>
              enemies[id].mobility.water !== "swim" &&
              (kind !== "raid-den" || enemies[id].radius <= SITE.raid.maxRadius),
          );
        if (roster.length === 0)
          throw new Error(`${world.stage}：交互点 ${kind} 没有可用的本图物种。`);
        site.data.species = pick(world.rng, roster);
      }
      if (kind === "ghost") site.data.species = "marowak";
      if (kind === "snorlax") site.data.species = "snorlax";
      if (kind === "fossil") site.data.species = "aerodactyl";
      if (kind === "honey-tree" || kind === "snorlax")
        addCircleBlocker(world.nav, site.x, site.z, site.radius);
      result.push(site);
    }
  }
  // Pads are allocated before props and are already apart from buildings and landmarks.
  for (const site of result)
    if (
      world.stations.some(
        (station) =>
          hypot(station.x - site.x, station.z - site.z) <=
          station.radius + site.radius + SITE.reach * 2,
      )
    )
      throw new MapGenError(`${world.stage}：交互点 ${site.id} 与站点重叠。`);
  for (const site of result) {
    const species =
      site.kind === "fishing"
        ? "gyarados"
        : ["honey-tree", "snorlax", "fossil", "raid-den", "ghost"].includes(site.kind)
          ? site.data.species
          : undefined;
    if (
      species &&
      !siteSpawnPoint(
        world,
        site,
        species,
        true,
        site.kind === "raid-den" ? SITE.raid.scale : 1,
        false,
      )
    )
      throw new MapGenError(
        `${world.stage}：交互点 ${site.id}（${site.kind}）周围放不下 ${species}（种子 ${world.seed}）。`,
      );
  }
  return result;
}

/** Explicit interactions only; pickup sites are handled in the shared tick. */
export function siteHere(world: World, player: Player): Site | null {
  if (!player.alive || player.departed) return null;
  return (
    world.sites.find(
      (site) =>
        (site.state === "ready" ||
          (site.state === "busy" &&
            site.owner === player.id &&
            (site.kind === "fishing" || site.kind === "fossil") &&
            site.data.enemy === null)) &&
        sites[site.kind].interact !== "pickup" &&
        (site.kind !== "egg" || !player.egg) &&
        inReach(site, player),
    ) ?? null
  );
}

export function interactSite(world: World, player: Player): boolean {
  if (player.dialog || player.rescue || player.pending.length > 0) return false;
  const site = siteHere(world, player);
  if (!site) return false;
  if (site.state === "busy") {
    site.state = "ready";
    site.until = 0;
    if (site.kind === "fishing") site.data.progress = 0;
    announce(world, site, "cancel");
    site.owner = null;
  } else rules[site.kind].interact(world, site, player);
  return true;
}

export function updateSites(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  // Trap damage precedes channels, regardless of placement order.
  for (const site of world.sites)
    if (site.kind === "item-ball" && site.state === "busy") balls.update(world, site);
  for (const site of world.sites) {
    if (site.state === "ready" && sites[site.kind].interact === "pickup") {
      const reach = site.data.trap ? SITE.balls.trigger : site.radius + SITE.pickup;
      const player = world.players.find(
        (entry) =>
          entry.alive &&
          !entry.departed &&
          hypot(entry.x - site.x, entry.z - site.z) <= reach + formOf(entry).radius,
      );
      if (player) rules[site.kind].interact(world, site, player);
    } else if (site.state === "busy") {
      if (
        site.data.enemy !== null &&
        !world.enemies.some((enemy) => enemy.id === site.data.enemy)
      ) {
        finish(world, site);
        continue;
      }
      switch (site.kind) {
        case "honey-tree":
          honey.update(world, site);
          break;
        case "snorlax":
          snorlax.update(world, site);
          break;
        case "fishing":
          fishing.update(world, site, dt);
          break;
        case "fossil":
          fossil.update(world, site, dt);
          break;
        case "raid-den":
          raid.update(world, site);
          break;
        case "ghost":
          ghost.update(world, site);
          break;
      }
    }
  }
  egg.update(world);
}

/** Overrides the one ordinary loot chest; XP/stardust remain combat's responsibility. */
export function settleSiteKill(
  ctx: Ctx,
  enemy: Enemy,
  killer: Player | null,
): { chest: Rarity | null } | undefined {
  if (enemy.site === null) return undefined;
  const { world } = ctx;
  const site = world.sites.find((entry) => entry.id === enemy.site);
  if (!site || site.state !== "busy" || site.data.enemy !== enemy.id) return { chest: null };
  if (site.kind === "fishing") {
    if (enemy.species === "magikarp")
      world.pickups.push({
        id: world.nextId++,
        kind: "stardust",
        x: enemy.x,
        z: enemy.z,
        value: SITE.rewards.fishStardust,
        magnet: false,
      });
    fishing.reset(world, site);
    return { chest: enemy.species === "magikarp" ? null : MIN_UPGRADE_RARITY.chest };
  }
  const chest =
    site.kind === "snorlax"
      ? null
      : site.kind === "raid-den" || site.kind === "ghost"
        ? 3
        : MIN_UPGRADE_RARITY.chest;
  finish(world, site);
  if (site.kind === "snorlax") {
    const recipient =
      killer ?? world.players.find((player) => player.id === site.owner && !player.departed);
    if (recipient) rewardItem(world, recipient, "leftovers");
    else berries(world, enemy, SITE.rewards.fullBagBerries);
  }
  return { chest };
}
