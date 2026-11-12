// 支援队伍: a defeated elite (头目 most often) may join its killer as a partner for the rest of the run.
// Partners follow their owner, fight the swarm (never the guardian: that fight stays the player's) with
// their species' own attack shape and obey the same terrain, nav and cover rules as everything else;
// they never block the player and have no HP. 护主: when the swarm lands a touch on the owner, a ready
// partner shields the owner for a moment. Numbers and reasons:
// openspec/specs/combat-builds/spec.md「研究所」「同伴」, model: docs/BALANCE.md「支援队伍」.

import { currentStats, itemRule } from "./stats";
import { enemies as enemyDefs, type EnemyDef } from "./content/enemies";
import { nearest } from "./archetypes/kit";
import { damageEnemy, findPlayer, type Ctx } from "./combat";
import { enemyScaling } from "./director";
import { zoneClock, zonesOf } from "./content/params/zones";
import { stageDefs } from "./content/stages/index";
import { zoneTime } from "./currentZone";
import { ELITE } from "./content/params/pacing";
import { flowDirection, hasWalkableLine, moveWithSlope, type Direction } from "./nav/index";
import { chance } from "./rng";
import { CHEST, FLYER_HOVER } from "./content/params/combat";
import { sees, withinStep } from "./sight";
import { skills, type SkillDef } from "./skills/index";
import { targetable } from "./status";
import { heightAt } from "./terrain";
import type { Enemy, Partner, Player } from "./state/entities";
import type { PartnerStyle } from "./state/events";
import type { World } from "./state/world";
import { atan2, cos, hypot, sin } from "./math";
import {
  BASE_PARTNER_SLOTS,
  CAPTURE_CHANCE,
  GUARD,
  PARTNER,
  PARTNER_ATTACK,
} from "./content/params/partners";

const TACKLE: SkillDef["partner"] = { style: "tackle" };

/** The species' own attack as its skill names it (`SkillDef.partner`); a species without one tackles. */
function partnerOf(def: EnemyDef): SkillDef["partner"] {
  return def.skill ? skills[def.skill.kind].partner : TACKLE;
}

export function styleOf(def: EnemyDef): PartnerStyle {
  return partnerOf(def).style;
}

/**
 * One hit at full share: the species' alpha contact damage, grown on the swarm's HP curve (without
 * rampage), so a partner caught at 2:30 still clears its share of the crowd at 8:00.
 */
export function partnerHit(world: World, partner: Partner): number {
  // The current zone's swarm curve (openspec/specs/world-progression/spec.md: partner growth reads the zone clock, never the
  // run clock), without the stage's enemyHp: an easier map does not weaken partners.
  const zone = world.zone.index;
  const stage = stageDefs[world.stage];
  const scale =
    enemyScaling(zoneClock(stage, zone, zoneTime(world)), world.difficulty, null).hp *
    zonesOf(stage)[zone]!.hp;
  return enemyDefs[partner.species].dmg * ELITE.dmg * scale;
}

export function partnerSlots(player: Player): number {
  return BASE_PARTNER_SLOTS + (player.lab.rules.partners ?? 0) + itemRule(player, "partners");
}

export function partnersOf(world: World, player: Player): Partner[] {
  return world.partners.filter((partner) => partner.owner === player.id);
}

/** Called when an elite dies: may turn it into `killer`'s partner on the spot. */
export function capture(world: World, elite: Enemy, killer: Player): void {
  if (partnersOf(world, killer).length >= partnerSlots(killer)) return;
  const odds = elite.alpha ? CAPTURE_CHANCE.alpha : CAPTURE_CHANCE.elite;
  // Master Ball: every capture that has a slot succeeds (the roll is still drawn, same rng stream).
  if (!chance(world.rng, itemRule(killer, "capture") > 0 ? 1 : odds)) return;
  const partner: Partner = {
    id: world.nextId++,
    owner: killer.id,
    species: elite.species,
    x: elite.x,
    z: elite.z,
    px: elite.x,
    pz: elite.z,
    faceX: elite.faceX,
    faceZ: elite.faceZ,
    cooldown: PARTNER_ATTACK[styleOf(enemyDefs[elite.species])].every,
    guard: 0,
  };
  world.partners.push(partner);
  const name = enemyDefs[elite.species].name;
  world.events.push(
    {
      t: "capture",
      player: killer.id,
      partner: partner.id,
      species: elite.species,
      x: elite.x,
      z: elite.z,
    },
    { t: "banner", text: `捕获 ${name}！`, tone: "boss", kind: "capture", player: killer.id },
  );
}

/** 护主 after a swarm touch landed on `owner` (see `GUARD`); nothing happens while no partner can. */
export function guard(world: World, owner: Player): void {
  let partner: Partner | undefined;
  let best = Infinity;
  for (const candidate of world.partners) {
    if (candidate.owner !== owner.id || candidate.guard > 0) continue;
    const d = hypot(candidate.x - owner.x, candidate.z - owner.z);
    if (d < best && d <= PARTNER.leash && chaseable(world, candidate, owner)) {
      best = d;
      partner = candidate;
    }
  }
  if (!partner) return;
  partner.guard = GUARD.every * currentStats(owner).guardRest;
  owner.invulnerable = Math.max(owner.invulnerable, GUARD.shield);
  world.events.push({
    t: "partner-guard",
    partner: partner.id,
    type: enemyDefs[partner.species].types[0]!,
    x: partner.x,
    z: partner.z,
    tx: owner.x,
    tz: owner.z,
  });
}

export function partnerRadius(partner: Partner): number {
  return enemyDefs[partner.species].radius * PARTNER.scale;
}

const heading: Direction = { x: 0, z: 0 };

export function updatePartners(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  // A kill below may capture a new partner; it starts next tick.
  const count = world.partners.length;
  for (let i = 0; i < count; i++) {
    const partner = world.partners[i]!;
    partner.px = partner.x;
    partner.pz = partner.z;
    const owner = findPlayer(world, partner.owner);
    if (!owner.alive) continue;
    partner.cooldown = Math.max(0, partner.cooldown - dt);
    partner.guard = Math.max(0, partner.guard - dt);
    if (hypot(owner.x - partner.x, owner.z - partner.z) > PARTNER.regroup) {
      partner.x = partner.px = owner.x;
      partner.z = partner.pz = owner.z;
      continue;
    }
    const def = enemyDefs[partner.species];
    const style = styleOf(def);
    const attack = PARTNER_ATTACK[style];
    if (style === "shot") {
      follow(world, partner, owner, slotOf(world, partner), dt);
      const eye = heightAt(world.map.terrain, partner.x, partner.z) + eyeLift(partner);
      const target = nearest(
        world,
        partner.x,
        eye,
        partner.z,
        PARTNER.shotCandidates,
        attack.reach,
      ).find((enemy) => !enemy.boss);
      if (target && leashed(owner, target) && partner.cooldown <= 0) {
        face(partner, target);
        strike(ctx, partner, owner, target, style);
      }
      continue;
    }
    const target = closestInLeash(world, partner, owner);
    const gap = target
      ? hypot(target.x - partner.x, target.z - partner.z) - target.radius - partnerRadius(partner)
      : Infinity;
    if (!target || !chaseable(world, partner, target)) {
      follow(world, partner, owner, slotOf(world, partner), dt);
      continue;
    }
    face(partner, target);
    const stop =
      style === "tackle" ? attack.reach * PARTNER.tackleStop : attack.reach * PARTNER.areaStop;
    if (gap > stop)
      step(world, partner, target.x, target.z, Math.min(gap - stop, PARTNER.speed * dt));
    if (partner.cooldown > 0) continue;
    if (style === "tackle" && gap <= attack.reach) {
      if (withinStep(world.map.terrain, target, heightAt(world.map.terrain, partner.x, partner.z)))
        strike(ctx, partner, owner, target, style);
    } else if ((style === "cloud" || style === "pulse") && gap <= attack.reach)
      cloud(ctx, partner, owner, style);
  }
  separate(world, count);
}

/** Partners chasing the same enemy push apart like the swarm does, so each stays readable. */
function separate(world: World, count: number): void {
  for (let i = 0; i < count; i++) {
    const a = world.partners[i]!;
    for (let j = i + 1; j < count; j++) {
      const b = world.partners[j]!;
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      const minimum = partnerRadius(a) + partnerRadius(b);
      const d = hypot(dx, dz);
      if (d >= minimum) continue;
      // Exactly stacked: split along a fixed axis (no randomness in the step).
      const [ux, uz] = d > 1e-6 ? [dx / d, dz / d] : [1, 0];
      const push = (minimum - d) * 0.5;
      const { mobility: ma } = enemyDefs[a.species];
      const { mobility: mb } = enemyDefs[b.species];
      moveWithSlope(world.nav, ma, a, ux * push, uz * push, partnerRadius(a));
      moveWithSlope(world.nav, mb, b, -ux * push, -uz * push, partnerRadius(b));
    }
  }
}

function eyeLift(partner: Partner): number {
  const def = enemyDefs[partner.species];
  return (
    (def.mobility.flying ? FLYER_HOVER * PARTNER.scale : 0) +
    Math.max(CHEST, def.height * PARTNER.scale * PARTNER.eyeHeight)
  );
}

function slotOf(world: World, partner: Partner): number {
  let index = 0;
  for (const other of world.partners) {
    if (other === partner) break;
    if (other.owner === partner.owner) index++;
  }
  return index;
}

function leashed(owner: Player, enemy: Enemy): boolean {
  return hypot(enemy.x - owner.x, enemy.z - owner.z) <= PARTNER.leash;
}

function closestInLeash(world: World, partner: Partner, owner: Player): Enemy | undefined {
  let best: Enemy | undefined;
  let bestD = Infinity;
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.boss || !targetable(enemy) || !leashed(owner, enemy)) continue;
    const d = (enemy.x - partner.x) ** 2 + (enemy.z - partner.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = enemy;
    }
  }
  return best;
}

/** Flyers go straight; walkers only charge along a line they could walk. */
function chaseable(world: World, partner: Partner, target: { x: number; z: number }): boolean {
  const { mobility } = enemyDefs[partner.species];
  return (
    mobility.flying ||
    hasWalkableLine(world.nav, mobility, partner.x, partner.z, target.x, target.z)
  );
}

function face(partner: Partner, target: { x: number; z: number }): void {
  const dx = target.x - partner.x;
  const dz = target.z - partner.z;
  const length = hypot(dx, dz);
  if (length === 0) return;
  partner.faceX = dx / length;
  partner.faceZ = dz / length;
}

/** Walks toward its slot behind the owner; around terrain along the walkers' flow field to the players. */
function follow(world: World, partner: Partner, owner: Player, slot: number, dt: number): void {
  const angle = atan2(-owner.faceX, -owner.faceZ) + (slot - 1) * PARTNER.spread;
  const hx = owner.x + sin(angle) * PARTNER.follow;
  const hz = owner.z + cos(angle) * PARTNER.follow;
  const distance = hypot(hx - partner.x, hz - partner.z);
  if (distance < PARTNER.followStop) return;
  const { mobility } = enemyDefs[partner.species];
  const stride = Math.min(distance, PARTNER.speed * dt);
  if (
    !mobility.flying &&
    !hasWalkableLine(world.nav, mobility, partner.x, partner.z, owner.x, owner.z) &&
    flowDirection(world.nav, mobility, partner.x, partner.z, heading)
  ) {
    move(world, partner, heading.x * stride, heading.z * stride);
    return;
  }
  step(world, partner, hx, hz, stride);
}

function step(world: World, partner: Partner, tx: number, tz: number, stride: number): void {
  const dx = tx - partner.x;
  const dz = tz - partner.z;
  const length = hypot(dx, dz);
  if (length === 0) return;
  move(world, partner, (dx / length) * stride, (dz / length) * stride);
}

function move(world: World, partner: Partner, dx: number, dz: number): void {
  if (dx === 0 && dz === 0) return;
  const length = hypot(dx, dz);
  partner.faceX = dx / length;
  partner.faceZ = dz / length;
  const { mobility } = enemyDefs[partner.species];
  moveWithSlope(world.nav, mobility, partner, dx, dz, partnerRadius(partner));
}

function strike(
  ctx: Ctx,
  partner: Partner,
  owner: Player,
  target: Enemy,
  style: PartnerStyle,
): void {
  const def = enemyDefs[partner.species];
  partner.cooldown = PARTNER_ATTACK[style].every / currentStats(owner).partnerRate;
  ctx.world.events.push({
    t: "partner-attack",
    partner: partner.id,
    style,
    type: def.types[0]!,
    x: partner.x,
    z: partner.z,
    tx: target.x,
    tz: target.z,
  });
  damageEnemy(ctx, target, {
    owner,
    move: null,
    type: def.types[0]!,
    dmg:
      partnerHit(ctx.world, partner) *
      PARTNER_ATTACK[style].dmg *
      currentStats(owner).partnerDamage,
    crit: 0,
    statusChance: 0,
    knock: style === "tackle" ? PARTNER.tackleKnock : PARTNER.shotKnock,
    fromX: partner.x,
    fromZ: partner.z,
  });
}

/** Paras' spores around itself: every enemy in reach on its level is hit and paralysed. */
function cloud(ctx: Ctx, partner: Partner, owner: Player, style: "cloud" | "pulse"): void {
  const { world } = ctx;
  const def = enemyDefs[partner.species];
  const { reach, dmg, every } = PARTNER_ATTACK[style];
  partner.cooldown = every / currentStats(owner).partnerRate;
  const ground = heightAt(world.map.terrain, partner.x, partner.z);
  world.events.push({
    t: "partner-attack",
    partner: partner.id,
    style,
    type: def.types[0]!,
    x: partner.x,
    z: partner.z,
    tx: partner.x,
    tz: partner.z,
  });
  const struck: Enemy[] = [];
  ctx.grid.query(partner.x, partner.z, reach + 1.4, (enemy) => {
    if (enemy.hp <= 0 || enemy.boss) return;
    if (hypot(enemy.x - partner.x, enemy.z - partner.z) > reach + enemy.radius) return;
    if (style === "pulse" && !sees(world, partner.x, ground + PARTNER.pulseLift, partner.z, enemy))
      return;
    if (withinStep(world.map.terrain, enemy, ground)) struck.push(enemy);
  });
  for (const enemy of struck)
    damageEnemy(ctx, enemy, {
      owner,
      move: null,
      type: def.types[0]!,
      dmg: partnerHit(world, partner) * dmg * currentStats(owner).partnerDamage,
      crit: 0,
      status: partnerOf(def).status,
      statusChance: PARTNER.areaStatusChance,
      knock: 0,
      fromX: partner.x,
      fromZ: partner.z,
    });
}
