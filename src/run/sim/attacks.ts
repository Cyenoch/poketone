// The per-tick move runner: cooldowns and casts through the archetype registry, then every shot and
// area in flight (archetypes/index.ts). Archetype modules never import this file (archetypes/kit.ts).

import { archetypes, areaRules } from "./archetypes/index";
import { chestOf, hitFrom, launchPoint, type MoveParams, type Zone } from "./archetypes/kit";
import { moves } from "./content/moves";
import { damageEnemy, findPlayer, type Ctx } from "./combat";
import { MOVE_LIMITS, MOVE_RETRY } from "./content/params/moves";
import { areaGrowth, currentStats, type PlayerStats } from "./stats";
import { heightAt } from "./terrain";
import type { Area, Enemy, MoveState, Player } from "./state/entities";

export function moveParams(state: MoveState, stats: PlayerStats): MoveParams {
  const def = moves[state.id];
  const { mods } = state;
  return {
    dmg: def.dmg * (1 + mods.dmg),
    cd: Math.max(
      def.fusion ? MOVE_LIMITS.fusionMinCd : MOVE_LIMITS.minCd,
      def.cd * mods.cd * stats.cooldown,
    ),
    count: def.count + mods.count + stats.projectiles,
    area: def.area * areaGrowth((1 + mods.area) * stats.area),
    speed: def.speed * (1 + mods.speed) * stats.projSpeed,
    dur: def.dur * (1 + mods.dur) * stats.duration,
    pierce: def.pierce + mods.pierce + stats.pierce,
    crit: mods.crit,
    statusChance: Math.min(
      MOVE_LIMITS.maxStatusChance,
      (def.statusChance + mods.status) * stats.statusChance,
    ),
  };
}

export function updateMoves(ctx: Ctx, player: Player, dt: number): void {
  const stats = currentStats(player);
  for (const state of player.moves) {
    state.cooldown -= dt;
    if (state.cooldown > 0) continue;
    const params = moveParams(state, stats);
    const def = moves[state.id];
    if (!archetypes[def.archetype].cast(ctx, player, def, params)) {
      // Nothing in range: retry soon instead of wasting the full cooldown.
      state.cooldown = MOVE_RETRY;
      state.waiting = true;
      continue;
    }
    delete state.waiting;
    state.cooldown = params.cd;
    const { windup = 0 } = archetypes[def.archetype];
    ctx.world.events.push({
      t: "cast",
      player: player.id,
      move: def.id,
      windup: typeof windup === "function" ? windup(params) : windup,
    });
  }
}

export function updateProjectiles(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  for (const shot of world.projectiles) {
    if (ctx.attackOwner !== undefined && shot.owner !== ctx.attackOwner && shot.id < 0) continue;
    shot.px = shot.x;
    shot.py = shot.y;
    shot.pz = shot.z;
    if (shot.delay > 0) {
      // Queued shots (bolt, barrage and homing volleys, all chest-high) ride the caster until released.
      shot.delay -= dt;
      const owner = findPlayer(world, shot.owner);
      [shot.x, shot.z] = launchPoint(owner, shot.vx, shot.vz);
      shot.y = chestOf(world.map.terrain, owner);
      shot.px = shot.x;
      shot.py = shot.y;
      shot.pz = shot.z;
      continue;
    }
    const rule = archetypes[shot.archetype].shot;
    if (!rule) throw new Error(`${shot.archetype} 不发射弹体，却有 ${shot.move} 的弹体。`);
    rule.steer?.(ctx, shot, dt);
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    shot.z += shot.vz * dt;
    shot.life -= dt;
    const hitsBefore = shot.hit.length;
    const eventsBefore = world.events.length;
    rule.land(ctx, shot, findPlayer(world, shot.owner), moves[shot.move]);
    const ended = shot.life <= 0;
    const hits = shot.hit.length - hitsBefore;
    if (ended || hits > 0) {
      let terrain = false;
      for (let i = eventsBefore; i < world.events.length; i++) {
        const event = world.events[i]!;
        if (event.t === "impact" && event.id === shot.id) terrain = true;
      }
      const burst = shot.hit[0] === -1;
      world.events.push({
        t: "projectile-feedback",
        id: shot.id,
        tick: world.tick,
        move: shot.move,
        archetype: shot.archetype,
        type: shot.type,
        x: shot.x,
        y: shot.y,
        z: shot.z,
        fromX: shot.px,
        fromY: shot.py,
        fromZ: shot.pz,
        ended,
        reason: terrain ? "terrain" : burst ? "burst" : hits > 0 ? "hit" : "expired",
        hits: burst ? 0 : hits,
      });
    }
  }
  world.projectiles = world.projectiles.filter((shot) => shot.life > 0);
}

export function updateAreas(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  for (const a of world.areas) {
    if (ctx.attackOwner !== undefined && a.owner !== ctx.attackOwner && a.id < 0) continue;
    a.life -= dt;
    const owner = findPlayer(world, a.owner);
    if (a.follow) {
      a.x = owner.x;
      a.z = owner.z;
    }
    const rule = areaRules[a.kind];
    if ("drive" in rule) rule.drive(ctx, a, owner, dt);
    else strikeZone(ctx, a, owner, rule, dt);
  }
  for (const a of world.areas) {
    if (ctx.attackOwner !== undefined && a.owner !== ctx.attackOwner && a.id < 0) continue;
    if (a.life > 0) continue;
    const rule = areaRules[a.kind];
    if ("expire" in rule) rule.expire?.(ctx, a, findPlayer(world, a.owner));
  }
  world.areas = world.areas.filter((a) => a.life > 0);
}

function strikeZone(ctx: Ctx, a: Area, owner: Player, zone: Zone, dt: number): void {
  const { world } = ctx;
  const ground = heightAt(world.map.terrain, a.x, a.z);
  zone.track?.(world, a, ground);
  if (a.delay > 0) {
    a.delay -= dt;
    return;
  }
  zone.hold?.(ctx, a, dt);
  a.tickTimer -= dt;
  if (a.tickTimer > 0 || a.move === null) return;
  a.tickTimer += a.tick;
  const def = moves[a.move];
  const reach = zone.reach ? zone.reach(a) : Math.max(a.radius, a.length);
  const targets: Enemy[] = [];
  ctx.grid.query(a.x, a.z, reach + 1.4, (enemy) => {
    if (enemy.hp > 0 && zone.shape(a, enemy) && zone.reaches(world, a, ground, enemy))
      targets.push(enemy);
  });
  for (const enemy of targets)
    damageEnemy(ctx, enemy, hitFrom(owner, def, a, a.x, a.z, zone.knock));
}
