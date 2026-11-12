import { present } from "./team";
import { enemies as enemyDefs } from "./content/enemies";
import { typeMultiplier, type ElementType } from "./content/elements";
import { moves, type MoveId } from "./content/moves";
import { PER_STATUS_CAP } from "./content/effects";
import { reactionIds, reactions, type ReactionDef } from "./content/reactions";
import type { EnemyStatusId } from "./content/statuses";
import type { EnemyGrid } from "./grid";
import { capture } from "./partners";
import { staggerFrom, yieldTo } from "./poise";
import { chance, range } from "./rng";
import { currentStats, earnStardust, itemRule, type PlayerStats } from "./stats";
import { BERRY, LOOT, STARDUST } from "./content/params/economy";
import { apply, consume, find, held, inflict, targetable, vulnerability, wake } from "./status";
import type { Enemy, Pickup, Player } from "./state/entities";
import type { World } from "./state/world";
import { HARDEN } from "./content/params/enemy-skills";
import { chargeUltimate } from "./ultimates/index";
import { afterHit, damageTriggers, fire } from "./triggers/index";
import { hypot } from "./math";
import { clearZone } from "./currentZone";
import { moveWithSlope } from "./nav/index";

export interface Ctx {
  world: World;
  grid: EnemyGrid;
  /** When present, only this player's attack entities are advanced. */
  attackOwner?: number;
  /** A remote owner's collision facts; the shared world commits them once. */
  report?: (effect: CombatEffect) => void;
}

export type CombatEffect =
  | { t: "hit"; enemy: number; x: number; z: number; hit: Omit<Hit, "owner"> }
  | { t: "status"; enemy: number; status: EnemyStatusId; time: number; power: number }
  | { t: "pull"; enemy: number; x: number; z: number; step: number; stop: number }
  | { t: "heal"; amount: number };

export function healOwner(ctx: Ctx, player: Player, amount: number): void {
  if (ctx.report) ctx.report({ t: "heal", amount });
  else heal(player, amount);
}

export function statusEnemy(
  ctx: Ctx,
  enemy: Enemy,
  status: EnemyStatusId,
  time: number,
  power: number,
  owner: Player,
): void {
  if (ctx.report) ctx.report({ t: "status", enemy: enemy.id, status, time, power });
  else apply(enemy, status, time, power, owner.id);
}

export function pullEnemy(
  ctx: Ctx,
  enemy: Enemy,
  x: number,
  z: number,
  step: number,
  stop: number,
): void {
  if (ctx.report) {
    ctx.report({ t: "pull", enemy: enemy.id, x, z, step, stop });
    return;
  }
  const dx = x - enemy.x;
  const dz = z - enemy.z;
  const distance = hypot(dx, dz);
  if (distance <= stop) return;
  const move = Math.min(distance - stop, step);
  moveWithSlope(
    ctx.world.nav,
    enemyDefs[enemy.species].mobility,
    enemy,
    (dx / distance) * move,
    (dz / distance) * move,
  );
}

/** Collision has already been decided on the owner's screen; never test host-space range again. */
export function commitCombat(ctx: Ctx, owner: Player, effect: CombatEffect): void {
  if (effect.t === "heal") {
    heal(owner, effect.amount);
    return;
  }
  const enemy = ctx.world.enemies.find((entry) => entry.id === effect.enemy);
  if (!enemy || enemy.hp <= 0 || !targetable(enemy)) return;
  switch (effect.t) {
    case "hit":
      settleDamage(ctx, enemy, { ...effect.hit, owner }, { x: effect.x, z: effect.z }, true);
      break;
    case "status":
      statusEnemy(ctx, enemy, effect.status, effect.time, effect.power, owner);
      break;
    case "pull":
      pullEnemy(ctx, enemy, effect.x, effect.z, effect.step, effect.stop);
      break;
  }
}

export interface Hit {
  owner: Player;
  move: MoveId | null;
  type: ElementType;
  dmg: number;
  crit: number;
  status?: EnemyStatusId;
  statusChance: number;
  knock: number;
  fromX: number;
  fromZ: number;
  /** Reaction follow-ups never chain into further reactions. */
  secondary?: boolean;
  /** Share of the HP removed that heals the owner (drain moves). */
  drain?: number;
}

export function findPlayer(world: World, id: number): Player {
  const player = world.players.find((candidate) => candidate.id === id);
  if (!player) throw new Error(`玩家 ${id} 不存在。`);
  return player;
}

export function damageEnemy(ctx: Ctx, enemy: Enemy, hit: Hit): void {
  if (enemy.hp <= 0 || !targetable(enemy)) return;
  if (ctx.report) {
    const { owner: _owner, ...value } = hit;
    ctx.report({ t: "hit", enemy: enemy.id, x: enemy.x, z: enemy.z, hit: value });
    return;
  }
  settleDamage(ctx, enemy, hit, enemy);
}

function settleDamage(
  ctx: Ctx,
  enemy: Enemy,
  hit: Hit,
  contact: { x: number; z: number },
  confirmedContact = false,
): void {
  const { world } = ctx;
  const stats = currentStats(hit.owner);
  const def = enemyDefs[enemy.species];
  const effectiveness = typeMultiplier(hit.type, def.types, enemy.id === world.bossId);
  let amount = hit.dmg * stats.damage * effectiveness * hitFactor(stats, hit, enemy, effectiveness);
  amount *= damageTriggers(ctx, hit.owner, hit, enemy);
  const crit = chance(world.rng, hit.crit + stats.crit);
  if (crit) amount *= stats.critDamage;
  amount *= wake(enemy);

  if (!hit.secondary) amount += react(ctx, enemy, hit, amount);

  if (enemy.hardened > 0) amount *= enemy.hardenDamage ?? HARDEN.damage;
  const removed = Math.min(amount, Math.max(0, enemy.hp));
  enemy.hp -= amount;
  enemy.flash = 0.12;
  const knock = hit.knock * yieldTo(enemy);
  if (knock > 0) {
    const dx = enemy.x - hit.fromX;
    const dz = enemy.z - hit.fromZ;
    const length = hypot(dx, dz) || 1;
    enemy.knockX += (dx / length) * knock;
    enemy.knockZ += (dz / length) * knock;
    staggerFrom(enemy, knock);
  }
  if (hit.status && chance(world.rng, hit.statusChance))
    inflictBy(world, enemy, hit.status, amount, hit.owner);

  const move = hit.move && hit.owner.moves.find((state) => state.id === hit.move);
  if (move) move.damage += amount;
  // The charge reads no HP and the heals no charge, so lifesteal may follow it.
  chargeUltimate(hit.owner, enemy, removed);
  afterHit(ctx, hit, enemy, removed, stats, crit);

  world.events.push({
    t: "hit",
    x: contact.x,
    z: contact.z,
    amount,
    crit,
    weak: effectiveness < 1,
    type: hit.type,
    by: hit.owner.id,
    ...(confirmedContact ? { confirmedContact: true } : {}),
  });
  if (enemy.hp <= 0) killEnemy(ctx, enemy, hit.owner);
}

/**
 * The owner's conditional damage factors that hold for this hit (`PlayerStats.hit`: the move's type,
 * its category, an elite or guardian target, a super-effective hit, a held target, the target's
 * statuses), then the target's own vulnerability (freeze, curse, a mark). 1 when none apply.
 */
function hitFactor(stats: PlayerStats, hit: Hit, enemy: Enemy, effectiveness: number): number {
  const { hit: factors } = stats;
  let factor = factors[hit.type] ?? 1;
  if (hit.move) factor *= factors[moves[hit.move].category] ?? 1;
  if (enemy.elite || enemy.boss) factor *= factors.elite ?? 1;
  if (effectiveness > 1) factor *= factors.superEffective ?? 1;
  if (factors.held !== undefined && held(enemy)) factor *= factors.held;
  if (factors.perStatus !== undefined)
    factor *= 1 + (factors.perStatus - 1) * Math.min(PER_STATUS_CAP, enemy.statuses.length);
  return factor * vulnerability(enemy);
}

/**
 * `owner`'s hit of `amount` inflicts `status` with the owner's duration and status-damage stats; a
 * charge that completes a `builds` status (chill → freeze) is announced for the view and audio.
 */
export function inflictBy(
  world: World,
  enemy: Enemy,
  status: EnemyStatusId,
  amount: number,
  owner: Player,
): void {
  const stats = currentStats(owner);
  const landed = inflict(enemy, status, amount, owner.id, stats.duration, stats.statusDamage);
  if (landed !== status)
    world.events.push({ t: "status-built", status: landed, x: enemy.x, z: enemy.z });
}

/** Element reactions (content/reactions.ts, first match wins) return extra damage for the triggering hit. */
function react(ctx: Ctx, enemy: Enemy, hit: Hit, amount: number): number {
  for (const id of reactionIds) {
    const def: ReactionDef = reactions[id];
    if (hit.type !== def.trigger) continue;
    const primed = find(enemy, def.primed);
    if (!primed) continue;
    const { power, time } = primed;
    if (def.consume) consume(enemy, def.primed);
    ctx.world.events.push({ t: "reaction", x: enemy.x, z: enemy.z, reaction: id });
    const { effect } = def;
    if (effect.kind === "spread") {
      ctx.grid.query(enemy.x, enemy.z, effect.radius, (other) => {
        if (other === enemy || other.hp <= 0) return;
        if (hypot(other.x - enemy.x, other.z - enemy.z) > effect.radius) return;
        apply(other, def.primed, effect.time, power, hit.owner.id);
      });
      return amount * def.bonus;
    }
    const stored = effect.kind === "detonate" ? power * time : 0;
    const share = amount * effect.share;
    splash(ctx, enemy, effect.radius, effect.limit, {
      ...hit,
      dmg: (effect.kind === "detonate" ? share + stored : share) / currentStats(hit.owner).damage,
      secondary: true,
    });
    return effect.kind === "detonate" ? amount * def.bonus + stored : amount * def.bonus;
  }
  return 0;
}

function splash(ctx: Ctx, center: Enemy, radius: number, limit: number, hit: Hit): void {
  const targets: Enemy[] = [];
  ctx.grid.query(center.x, center.z, radius, (other) => {
    if (other === center || other.hp <= 0 || targets.length >= limit) return;
    if (hypot(other.x - center.x, other.z - center.z) <= radius) targets.push(other);
  });
  for (const target of targets) damageEnemy(ctx, target, { ...hit, status: undefined, knock: 0 });
}

/** Heals by `amount` × the healing stat, up to max HP; returns the overheal (what did not fit). */
/**
 * Heals by `amount` × the healing stat, up to max HP; returns the overheal (what did not fit), which
 * Fresh Water stores (up to its cap) and Enigma Berry turns into shield.
 */
export function heal(player: Player, amount: number): number {
  if (!player.alive) return 0;
  const stats = currentStats(player);
  const raw = player.hp + amount * stats.healing;
  player.hp = Math.min(stats.maxHp, raw);
  const over = raw - player.hp;
  if (over > 0)
    for (const { key, def } of stats.triggers) {
      if (def.kind === "overhealStore")
        player.fx[key] = Math.min(def.cap * stats.maxHp, (player.fx[key] ?? 0) + over);
      else if (def.kind === "overhealShield")
        player.shield = Math.min(stats.shield, player.shield + over);
    }
  return over;
}

/** A null killer is an environmental death: base loot and zone rewards, no personal credit. */
export function killEnemy(ctx: Ctx, enemy: Enemy, killer: Player | null): void {
  const { world } = ctx;
  if (killer) killer.kills += 1;
  world.events.push({
    t: "death",
    x: enemy.x,
    z: enemy.z,
    species: enemy.species,
    elite: enemy.elite || enemy.boss,
  });
  dropLoot(world, enemy, killer);
  if (killer) {
    if (enemy.elite) capture(world, enemy, killer);
    fire(ctx, killer, "kill", { enemy });
  }
  if (enemy.boss) {
    // The guardian bonus is immediate; existing field drops fly to the team after the clear.
    for (const player of present(world)) earnStardust(player, STARDUST.guardian);
    clearZone(world);
    world.events.push({ t: "banner", text: "守卫倒下了！", tone: "boss", kind: "clear" });
  }
}

function dropLoot(world: World, enemy: Enemy, killer: Player | null): void {
  const add = (kind: Pickup["kind"], value: number, spread: number) =>
    world.pickups.push({
      id: world.nextId++,
      kind,
      value,
      x: enemy.x + range(world.rng, -spread, spread),
      z: enemy.z + range(world.rng, -spread, spread),
      magnet: false,
    });
  if (enemy.elite || enemy.boss) {
    add("chest", 1, LOOT.chestSpread);
    for (let i = 0; i < LOOT.eliteXpCount; i++)
      add("xp", Math.ceil(enemy.xp / LOOT.eliteXpCount), LOOT.eliteXpSpread);
    if (!enemy.boss) add("stardust", STARDUST.elite, LOOT.eliteStardustSpread);
  } else {
    add("xp", enemy.xp, LOOT.xpSpread);
    if (chance(world.rng, STARDUST.ordinary.chance))
      add("stardust", STARDUST.ordinary.value, LOOT.stardustSpread);
  }
  // Poké Radar: the killer's items raise the berry chance by a share.
  if (chance(world.rng, BERRY.chance * (1 + (killer ? itemRule(killer, "berries") : 0))))
    add("berry", BERRY.heal, LOOT.berrySpread);
}
