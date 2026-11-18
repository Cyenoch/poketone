import { trainerKits } from "./content/trainers";
import { TRAINER } from "./content/params/trainers";
import type { Ctx } from "./combat";
import { FIELD_EVENTS, SHINY } from "./content/params/field-events";
import { chance, range } from "./rng";
import { earnStardust } from "./stats";
import { present } from "./team";
import type { Enemy, Player } from "./state/entities";
import { ARENA_HALF, type World } from "./state/world";
import { enemies, type EnemyId } from "./content/enemies";
import { bodyFits, findPath, moveWithSlope } from "./nav/index";
import { hypot } from "./math";

export function outbreakActive(world: World, species: EnemyId): boolean {
  return world.spawn.outbreak?.species === species && world.time < world.spawn.outbreak.until;
}

export function encounterSpecies(world: World): EnemyId {
  const pool = world.spawn.pool;
  const outbreak = world.spawn.outbreak;
  const boosted =
    outbreak && outbreakActive(world, outbreak.species) && pool.includes(outbreak.species);
  let draw = range(world.rng, 0, pool.length + (boosted ? FIELD_EVENTS.outbreak.weight - 1 : 0));
  for (const species of pool) {
    draw -= boosted && species === outbreak.species ? FIELD_EVENTS.outbreak.weight : 1;
    if (draw < 0) return species;
  }
  throw new Error(`encounterSpecies: ${world.stage} 刷怪池为空。`);
}

export function recordEncounter(world: World, enemy: Enemy): void {
  const team = present(world);
  for (const player of team) {
    const entry = (player.dex[enemy.species] ??= { seen: 0, defeated: 0, shiny: 0 });
    entry.seen++;
  }
  if (enemy.elite || enemy.boss || world.spawn.shinySpawned) return;
  if (
    !chance(
      world.rng,
      SHINY.chance *
        (team.some((p) => trainerKits[p.trainer].passive === "naturalist")
          ? TRAINER.naturalist.shiny
          : 1) *
        (outbreakActive(world, enemy.species) ? FIELD_EVENTS.outbreak.shiny : 1),
    )
  )
    return;
  world.spawn.shinySpawned = true;
  enemy.shiny = true;
  enemy.shinyUntil = world.time + SHINY.escape;
  enemy.hp *= SHINY.hp;
  enemy.maxHp *= SHINY.hp;
  world.events.push({
    t: "shiny",
    enemy: enemy.id,
    species: enemy.species,
    x: enemy.x,
    z: enemy.z,
  });
}

/** Apply personal research credit only to the copy banked at settlement. */
export function settlementDex(player: Player): Player["dex"] {
  const dex = structuredClone(player.dex);
  if (trainerKits[player.trainer].passive === "naturalist")
    for (const entry of Object.values(dex))
      entry.seen = Math.round(entry.seen * TRAINER.naturalist.seen);
  return dex;
}

export function recordDefeat(world: World, enemy: Enemy, killer: Player | null): void {
  if (!killer) return;
  const entry = (killer.dex[enemy.species] ??= { seen: 0, defeated: 0, shiny: 0 });
  entry.defeated++;
  if (!enemy.shiny) return;
  entry.shiny++;
  for (const player of present(world)) earnStardust(player, SHINY.stardust);
  world.events.push({ t: "shiny-caught", species: enemy.species, by: killer.id });
}

export function escaping(world: World, enemy: Enemy): boolean {
  return enemy.shiny && enemy.shinyUntil !== null && world.time >= enemy.shinyUntil;
}

function escapeRoute(world: World, enemy: Enemy): Enemy["escape"] {
  const { mobility } = enemies[enemy.species];
  const candidates: { x: number; z: number }[] = [
    { x: -ARENA_HALF, z: enemy.z },
    { x: ARENA_HALF, z: enemy.z },
    { x: enemy.x, z: -ARENA_HALF },
    { x: enemy.x, z: ARENA_HALF },
  ];
  for (let at = -ARENA_HALF; at <= ARENA_HALF; at += SHINY.edgeStep) {
    candidates.push(
      { x: -ARENA_HALF, z: at },
      { x: ARENA_HALF, z: at },
      { x: at, z: -ARENA_HALF },
      { x: at, z: ARENA_HALF },
    );
  }
  const distance = (point: { x: number; z: number }) =>
    (point.x - enemy.x) ** 2 + (point.z - enemy.z) ** 2;
  const edges = candidates
    .filter(
      (point, i) =>
        candidates.findIndex((other) => point.x === other.x && point.z === other.z) === i,
    )
    .filter(({ x, z }) => mobility.flying || bodyFits(world.nav, mobility, x, z, enemy.radius))
    .sort((a, b) => distance(a) - distance(b));
  for (const { x, z } of edges.slice(0, SHINY.pathTries)) {
    const path: number[] = [];
    if (findPath(world.nav, mobility, enemy.x, enemy.z, x, z, path)) return { x, z, path };
  }
  return null;
}

/** Escaping encounters leave without entering the kill/reward path. */
export function updateEncounters(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  if (ctx.report) return;
  if (world.spawn.outbreak && world.time >= world.spawn.outbreak.until) world.spawn.outbreak = null;
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || !escaping(world, enemy)) continue;
    enemy.px = enemy.x;
    enemy.pz = enemy.z;
    enemy.escape ??= escapeRoute(world, enemy);
    if (!enemy.escape) {
      // A sealed field or isolated pool has no departure route: retire without rewards.
      enemy.hp = 0;
      continue;
    }
    const { path } = enemy.escape;
    let travel = enemy.speed * dt;
    while (travel > 0 && path.length > 0) {
      const dx = path[0]! - enemy.x,
        dz = path[1]! - enemy.z;
      const distance = hypot(dx, dz);
      if (distance < 0.01) {
        path.splice(0, 2);
        continue;
      }
      enemy.faceX = dx / distance;
      enemy.faceZ = dz / distance;
      const step = Math.min(travel, distance);
      const x = enemy.x,
        z = enemy.z;
      moveWithSlope(
        world.nav,
        enemies[enemy.species].mobility,
        enemy,
        enemy.faceX * step,
        enemy.faceZ * step,
      );
      travel -= step;
      // A newly blocked cached route ends the departure rather than crossing its blocker.
      if (hypot(enemy.x - x, enemy.z - z) < 1e-8) {
        enemy.hp = 0;
        break;
      }
      if (hypot(path[0]! - enemy.x, path[1]! - enemy.z) < 0.01) path.splice(0, 2);
    }
    if (path.length === 0) enemy.hp = 0;
  }
}
