// Ultimates: charged by damage dealt and by time, fired by the `ult` command, then played out as the
// line's pulse timeline (content/ultimates.ts). Every pulse follows the terrain and cover rules of the move
// shapes it resembles (src/run/sim/content/README.md 地形与战斗).

import { damageEnemy, healOwner, pullEnemy, type Ctx, type Hit } from "../combat";
import { starters, type Stage } from "../content/lines/index";
import { yieldTo } from "../poise";
import { next } from "../rng";
import { CHEST } from "../content/params/combat";
import { coverHit, lineOfFire, sees, withinStep } from "../sight";
import { areaGrowth, currentStats, playerStats } from "../stats";
import { targetable } from "../status";
import { heightAt } from "../terrain";
import type { Enemy, Player, UltState } from "../state/entities";
import type { World } from "../state/world";
import { ultimates, type Pulse, type UltimateId } from "../content/ultimates";
import { atan, atan2, cos, hypot, sin } from "../math";
import {
  SPOT_LIFT,
  STRIKE_TRIES,
  ULT_AIM_RANGE,
  ULT_CHARGE,
  ULT_DMG,
  ULT_INVULNERABLE,
  ULT_PULL,
} from "../content/params/ultimates";

const byTime = (tier: readonly Pulse[]) => [...tier].sort((a, b) => a.at - b.at);
const sorted = {} as Record<UltimateId, readonly (readonly Pulse[])[]>;
for (const def of Object.values(ultimates)) sorted[def.id] = def.tiers.map(byTime);
for (const def of Object.values(ultimates))
  if (def.names.length !== def.tiers.length)
    throw new Error(`终极技 ${def.id}: ${def.names.length} 个名称，${def.tiers.length} 档。`);
for (const line of Object.values(starters)) {
  const { tiers } = ultimates[line.ultimate];
  if (tiers.length !== line.stages.length)
    throw new Error(
      `${line.id}: 终极技 ${line.ultimate} 有 ${tiers.length} 档，进化线有 ${line.stages.length} 个阶段。`,
    );
  if (ULT_DMG.tier.length < line.stages.length)
    throw new Error(
      `${line.id}: ULT_DMG.tier 只有 ${ULT_DMG.tier.length} 档，进化线有 ${line.stages.length} 个阶段。`,
    );
}

export function timeline(ultimate: UltimateId, stage: Stage): readonly Pulse[] {
  return sorted[ultimate][stage]!;
}

export function newUltState(): UltState {
  return {
    charge: 0,
    room: ULT_CHARGE.room,
    elapsed: -1,
    next: 0,
    stage: 0,
    x: 0,
    z: 0,
    ax: 0,
    az: 1,
    pathX: 0,
    pathZ: 0,
    crossed: [],
  };
}

export function ultRate(player: Player): number {
  return currentStats(player).ultCharge;
}

/** Damage credit from a hit that removed `removed` HP. Nothing charges while a cast runs. */
export function chargeUltimate(player: Player, enemy: Enemy, removed: number): void {
  const ult = player.ult;
  if (ult.elapsed >= 0 || enemy.maxHp <= 0) return;
  const gain = Math.min(ult.room, (removed / enemy.maxHp) * enemy.xp * ULT_CHARGE.perXp);
  ult.room -= gain;
  ult.charge = Math.min(1, ult.charge + gain * ultRate(player));
}

export function ultDamage(player: Player, stage: Stage): number {
  return ULT_DMG.base * (1 + ULT_DMG.perLevel * (player.level - 1)) * ULT_DMG.tier[stage]!;
}

/** Ultimate sizes grow with the area stat, damped: √areaGrowth (≤ 1.3×). */
export function ultScale(player: Player): number {
  return Math.sqrt(areaGrowth(playerStats(player).area));
}

/** Starts a cast; false when not charged, already casting or down. */
export function fireUltimate(world: World, player: Player): boolean {
  const ult = player.ult;
  if (!player.alive || ult.charge < 1 || ult.elapsed >= 0) return false;
  ult.charge = 0;
  ult.elapsed = 0;
  ult.next = 0;
  ult.stage = player.stage;
  ult.x = ult.pathX = player.x;
  ult.z = ult.pathZ = player.z;
  ult.crossed = [];
  // Aim at the nearest enemy in sight (the cannons start there), else straight ahead.
  const eye = heightAt(world.map.terrain, player.x, player.z) + CHEST;
  const target = nearestVisible(world, player.x, eye, player.z, ULT_AIM_RANGE, []);
  const dx = target ? target.x - player.x : player.faceX;
  const dz = target ? target.z - player.z : player.faceZ;
  const length = hypot(dx, dz) || 1;
  ult.ax = dx / length;
  ult.az = dz / length;
  player.invulnerable = Math.max(player.invulnerable, ULT_INVULNERABLE);
  world.events.push({ t: "ult", player: player.id, line: player.starter, stage: ult.stage });
  return true;
}

export function updateUltimate(ctx: Ctx, player: Player, dt: number): void {
  const ult = player.ult;
  if (ult.elapsed < 0) {
    ult.room = Math.min(ULT_CHARGE.room, ult.room + ULT_CHARGE.room * dt);
    ult.charge = Math.min(1, ult.charge + ULT_CHARGE.time * ultRate(player) * dt);
    return;
  }
  ult.elapsed += dt;
  const pulses = timeline(starters[player.starter].ultimate, ult.stage);
  while (ult.next < pulses.length && pulses[ult.next]!.at <= ult.elapsed) {
    pulse(ctx, player, pulses[ult.next]!);
    ult.next += 1;
  }
  if (ult.next >= pulses.length) ult.elapsed = -1;
}

function pulse(ctx: Ctx, player: Player, p: Pulse): void {
  const { world } = ctx;
  const ult = player.ult;
  const scale = ultScale(player);
  const radius = p.radius * scale;
  const hit: Hit = {
    owner: player,
    move: null,
    type: ultimates[starters[player.starter].ultimate].type,
    dmg: ultDamage(player, ult.stage) * p.mul,
    crit: 0,
    status: p.status,
    statusChance: p.chance ?? 0,
    knock: p.knock ?? 0,
    fromX: player.x,
    fromZ: player.z,
  };
  const emit = (x: number, z: number, r: number, dirX = 0, dirZ = 0, length = 0) =>
    world.events.push({
      t: "ult-pulse",
      player: player.id,
      look: p.look,
      x,
      z,
      radius: r,
      dirX,
      dirZ,
      length,
    });
  switch (p.kind) {
    case "heal":
      healOwner(ctx, player, playerStats(player).maxHp * (p.heal ?? 0));
      emit(player.x, player.z, radius);
      return;
    case "ring":
      if (p.pull) pull(ctx, player.x, player.z, radius * ULT_PULL.reach, p.pull);
      blast(ctx, hit, player.x, player.z, radius);
      emit(player.x, player.z, radius);
      return;
    case "spots": {
      const count = p.count ?? 1;
      const spread = (p.spread ?? 0) * scale;
      const eye = heightAt(world.map.terrain, ult.x, ult.z) + CHEST;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = ult.x + cos(angle) * spread;
        const z = ult.z + sin(angle) * spread;
        // Spots only land where the cast could reach: not on a terrace or behind a rock.
        if (
          !lineOfFire(world, ult.x, eye, ult.z, x, heightAt(world.map.terrain, x, z) + SPOT_LIFT, z)
        )
          continue;
        blast(ctx, { ...hit, fromX: x, fromZ: z }, x, z, radius);
        emit(x, z, radius);
      }
      return;
    }
    case "lines": {
      const count = p.count ?? 1;
      const base = atan2(ult.az, ult.ax) + (p.turn ?? 0);
      const struck = new Set<Enemy>();
      for (let i = 0; i < count; i++) {
        const angle = base + (i / count) * Math.PI * 2;
        const dirX = cos(angle);
        const dirZ = sin(angle);
        const length = lane(
          ctx,
          hit,
          player.x,
          player.z,
          dirX,
          dirZ,
          (p.length ?? 0) * scale,
          radius,
          struck,
        );
        emit(player.x, player.z, radius, dirX, dirZ, length);
      }
      return;
    }
    case "strike": {
      const eye = heightAt(world.map.terrain, player.x, player.z) + CHEST;
      const picked: Enemy[] = [];
      for (let i = 0; i < (p.count ?? 1); i++) {
        const target = p.toughest
          ? toughestVisible(world, player.x, eye, player.z, p.range ?? 0, picked)
          : randomVisible(world, player.x, eye, player.z, p.range ?? 0, picked);
        if (!target) break;
        picked.push(target);
        // From the sky: no terrain rule inside the strike (like 打雷), but only aimed at what you see.
        for (const enemy of within(ctx, target.x, target.z, radius))
          damageEnemy(ctx, enemy, { ...hit, fromX: target.x, fromZ: target.z });
        emit(target.x, target.z, radius);
      }
      return;
    }
    case "sweep": {
      const length = (p.length ?? 0) * scale;
      const eye = heightAt(world.map.terrain, player.x, player.z) + CHEST;
      const start = atan2(ult.az, ult.ax) + (p.turn ?? 0);
      const arc = p.arc ?? 0;
      for (const enemy of within(ctx, player.x, player.z, length)) {
        const angle = atan2(enemy.z - player.z, enemy.x - player.x);
        const distance = Math.max(0.01, hypot(enemy.x - player.x, enemy.z - player.z));
        // Either beam (opposite) covers the arc, widened by the beam and body half-widths.
        const slack = atan((radius + enemy.radius) / distance);
        const inArc = [0, Math.PI].some((offset) => {
          const d = wrap(angle - (start + offset));
          return d >= -slack && d <= arc + slack;
        });
        if (inArc && sees(world, player.x, eye, player.z, enemy)) damageEnemy(ctx, enemy, hit);
      }
      for (const offset of [0, Math.PI]) {
        const angle = start + arc + offset;
        const dirX = cos(angle);
        const dirZ = sin(angle);
        emit(
          player.x,
          player.z,
          radius,
          dirX,
          dirZ,
          Math.min(length, coverHit(world, player.x, eye, player.z, dirX, dirZ, 0, length)),
        );
      }
      return;
    }
    case "hop": {
      const eye = heightAt(world.map.terrain, ult.pathX, ult.pathZ) + CHEST;
      const crossed = world.enemies.filter((enemy) => ult.crossed.includes(enemy.id));
      const target = nearestVisible(world, ult.pathX, eye, ult.pathZ, p.range ?? 0, crossed);
      if (!target) return;
      ult.crossed.push(target.id);
      const dx = target.x - ult.pathX;
      const dz = target.z - ult.pathZ;
      const length = hypot(dx, dz) || 1;
      emit(ult.pathX, ult.pathZ, radius, dx / length, dz / length, length);
      ult.pathX = target.x;
      ult.pathZ = target.z;
      blast(ctx, { ...hit, fromX: target.x, fromZ: target.z }, target.x, target.z, radius);
      return;
    }
  }
}

const wrap = (angle: number) => {
  const turn = Math.PI * 2;
  return ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI;
};

/** Living enemies whose body overlaps the disc. */
function within(ctx: Ctx, x: number, z: number, radius: number): Enemy[] {
  const found: Enemy[] = [];
  ctx.grid.query(x, z, radius + 1.4, (enemy) => {
    if (enemy.hp > 0 && hypot(enemy.x - x, enemy.z - z) <= radius + enemy.radius) found.push(enemy);
  });
  return found;
}

/** A disc on the ground: like a burst, it reaches enemies within a step of its centre or in sight of it. */
function blast(ctx: Ctx, hit: Hit, x: number, z: number, radius: number): void {
  const { world } = ctx;
  const ground = heightAt(world.map.terrain, x, z);
  for (const enemy of within(ctx, x, z, radius)) {
    if (withinStep(world.map.terrain, enemy, ground) || sees(world, x, ground + CHEST, z, enemy))
      damageEnemy(ctx, enemy, hit);
  }
}

/** A lane from (x, z): cut where terrain or a solid prop stands in the way; returns its length. */
function lane(
  ctx: Ctx,
  hit: Hit,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  reach: number,
  radius: number,
  struck: Set<Enemy>,
): number {
  const { world } = ctx;
  const eye = heightAt(world.map.terrain, x, z) + CHEST;
  const length = Math.min(reach, coverHit(world, x, eye, z, dirX, dirZ, 0, reach));
  for (const enemy of within(
    ctx,
    x + (dirX * length) / 2,
    z + (dirZ * length) / 2,
    length / 2 + radius,
  )) {
    if (struck.has(enemy)) continue;
    const ox = enemy.x - x;
    const oz = enemy.z - z;
    const along = ox * dirX + oz * dirZ;
    if (along < 0 || along > length + enemy.radius) continue;
    if (Math.abs(ox * dirZ - oz * dirX) > radius + enemy.radius) continue;
    struck.add(enemy);
    damageEnemy(ctx, enemy, hit);
  }
  return length;
}

function pull(ctx: Ctx, x: number, z: number, reach: number, step: number): void {
  for (const enemy of within(ctx, x, z, reach)) {
    const give = yieldTo(enemy);
    if (give <= 0) continue;
    const dx = x - enemy.x;
    const dz = z - enemy.z;
    const distance = hypot(dx, dz);
    if (distance < ULT_PULL.stop) continue;
    pullEnemy(ctx, enemy, x, z, step * give, ULT_PULL.stop);
  }
}

function candidates(
  world: World,
  x: number,
  z: number,
  range: number,
  skip: readonly Enemy[],
): Enemy[] {
  return world.enemies.filter(
    (enemy) =>
      enemy.hp > 0 &&
      targetable(enemy) &&
      !skip.includes(enemy) &&
      (enemy.x - x) ** 2 + (enemy.z - z) ** 2 <= range * range,
  );
}

function nearestVisible(
  world: World,
  x: number,
  y: number,
  z: number,
  range: number,
  skip: readonly Enemy[],
) {
  const sortedByDistance = candidates(world, x, z, range, skip).sort(
    (a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2),
  );
  return sortedByDistance.find((enemy) => sees(world, x, y, z, enemy));
}

function toughestVisible(
  world: World,
  x: number,
  y: number,
  z: number,
  range: number,
  skip: readonly Enemy[],
) {
  return candidates(world, x, z, range, skip)
    .sort((a, b) => b.hp - a.hp)
    .find((enemy) => sees(world, x, y, z, enemy));
}

function randomVisible(
  world: World,
  x: number,
  y: number,
  z: number,
  range: number,
  skip: readonly Enemy[],
) {
  const pool = candidates(world, x, z, range, skip);
  for (let i = 0; i < STRIKE_TRIES && pool.length > 0; i++) {
    const [enemy] = pool.splice(Math.floor(next(world.rng) * pool.length), 1);
    if (enemy && sees(world, x, y, z, enemy)) return enemy;
  }
  return undefined;
}
