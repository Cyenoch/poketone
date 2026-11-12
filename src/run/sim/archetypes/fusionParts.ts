// Parts the signature fusions (bloom, firestorm, sprinkler, rod) play out: shares of the cast's hit,
// ground discs, lanes and the closing burst. Sizes are the reference's at our scale (docs/BALANCE.md
// 招式大小); damage is a share of the cast's hit (openspec/specs/combat-builds/spec.md 融合).

import { damageEnemy, type Ctx, type Hit } from "../combat";
import type { MoveDef } from "../content/moves";
import { MOVE_LIMITS } from "../content/params/moves";
import type { EnemyStatusId } from "../content/statuses";
import { CHEST } from "../content/params/combat";
import { sees, withinStep } from "../sight";
import { heightAt } from "../terrain";
import type { Area, Enemy, Player } from "../state/entities";
import { area } from "./kit";
import { hypot } from "../math";

/** A part's hit: `mul` of the cast's damage, the part's own status chance plus the move's upgrades. */
export function partHit(
  owner: Player,
  def: MoveDef,
  a: Area,
  mul: number,
  chance: number,
  knock: number,
  fromX: number,
  fromZ: number,
  status: EnemyStatusId | undefined = def.status,
): Hit {
  return {
    owner,
    move: def.id,
    type: def.type,
    dmg: a.dmg * mul,
    crit: a.crit,
    status,
    statusChance: withUpgrades(def, a, chance),
    knock,
    fromX,
    fromZ,
  };
}

/** A part's status chance plus the move's status upgrades (`Area.statusChance` carries them). */
const withUpgrades = (def: MoveDef, a: Area, chance: number) =>
  Math.min(MOVE_LIMITS.maxStatusChance, chance + a.statusChance - def.statusChance);

/** Ground disc hit: bodies in reach on the same step, or in sight of its centre (like a burst). */
export function strikeDisc(
  ctx: Ctx,
  x: number,
  z: number,
  radius: number,
  make: () => Hit,
  reachesAll = false,
): void {
  const { world } = ctx;
  const ground = heightAt(world.map.terrain, x, z);
  const targets: Enemy[] = [];
  ctx.grid.query(x, z, radius + 1.4, (enemy) => {
    if (enemy.hp <= 0 || hypot(enemy.x - x, enemy.z - z) > radius + enemy.radius) return;
    if (
      reachesAll ||
      withinStep(world.map.terrain, enemy, ground) ||
      sees(world, x, ground + CHEST, z, enemy)
    )
      targets.push(enemy);
  });
  for (const enemy of targets) damageEnemy(ctx, enemy, make());
}

/** Lane from (x, z) along a unit heading, `half` wide each side, needing a line of fire from chest height. */
export function strikeLane(
  ctx: Ctx,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  length: number,
  half: number,
  make: () => Hit,
): void {
  const { world } = ctx;
  const eye = heightAt(world.map.terrain, x, z) + CHEST;
  const targets: Enemy[] = [];
  ctx.grid.query(x + (dirX * length) / 2, z + (dirZ * length) / 2, length / 2 + 1.4, (enemy) => {
    if (enemy.hp <= 0) return;
    const dx = enemy.x - x;
    const dz = enemy.z - z;
    const along = dx * dirX + dz * dirZ;
    if (along < 0 || along > length) return;
    if (Math.abs(dx * dirZ - dz * dirX) > half + enemy.radius) return;
    if (sees(world, x, eye, z, enemy)) targets.push(enemy);
  });
  for (const enemy of targets) damageEnemy(ctx, enemy, make());
}

/** Spawns the closing burst area (the view draws it as the fusion's finale). */
export function finale(
  ctx: Ctx,
  owner: Player,
  def: MoveDef,
  a: Area,
  radius: number,
  mul: number,
  chance: number,
): void {
  const p = {
    dmg: a.dmg * mul,
    area: radius,
    dur: 0.3, // Visual linger after the single burst hit.
    statusChance: withUpgrades(def, a, chance),
    crit: a.crit,
  };
  area(ctx.world, owner, def, p, "burst", { x: a.x, z: a.z });
}

/** Seconds since the cast. */
export const elapsedOf = (a: Area) => a.maxLife - a.life;
