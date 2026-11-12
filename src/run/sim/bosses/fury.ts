import { FURY_CAST, furyOf, type FuryCast } from "../content/params/guardian";
import { enemies } from "../content/enemies";
import { attacksBlocked } from "../status";
import { atan2, cos, sin } from "../math";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { fallAt, falls, lowHealth, telegraphScale } from "./zone-kit";
import { predictTarget } from "../enemy-aim";

/**
 * Raised guardians (params/guardian.ts `GUARDIAN_FURY`): beside its own attacks a later-map guardian
 * casts ground-circle patterns on a fixed beat. Timer and cast count live on the enemy; the cast
 * waits (timer stays due) while it winds up or dashes. Already pending casts can overlap later native
 * attacks; their locked positions and full warnings preserve the player's chance to escape.
 */
export function furyStep(world: World, boss: Enemy, target: Player, dt: number): void {
  const fury = furyOf(world.stage, world.zone.index);
  if (!fury) return;
  const state = (boss.fury ??= { timer: fury.first, casts: 0 });
  state.timer -= dt;
  if (state.timer > 0 || attacksBlocked(boss)) return;
  if (boss.phase !== "chase" && boss.phase !== "recover") return;
  casts[fury.casts[state.casts % fury.casts.length]!](world, boss, target);
  state.casts += 1;
  state.timer = fury.every * (lowHealth(boss) ? fury.lowEvery : 1);
}

const casts: Record<FuryCast, (world: World, boss: Enemy, target: Player) => void> = {
  rain(world, boss, target) {
    const c = FURY_CAST.rain;
    falls(
      world,
      boss,
      target,
      lowHealth(boss) ? c.lowCount : c.count,
      c.ring,
      c.radius,
      c.windup * telegraphScale(world),
      element(boss),
    );
  },
  barrage(world, boss, target) {
    const c = FURY_CAST.barrage;
    target = predictTarget(world, boss, target, c.windup * telegraphScale(world));
    const count = lowHealth(boss) ? c.lowCount : c.count;
    const heading = atan2(target.z - boss.z, target.x - boss.x);
    for (let i = 0; i < count; i++) {
      const along = (i - (count - 1) / 2) * c.gap;
      fallAt(
        world,
        boss,
        target.x + cos(heading) * along,
        target.z + sin(heading) * along,
        c.radius,
        c.windup * telegraphScale(world),
        element(boss),
        undefined,
        undefined,
        i * c.spacing,
      );
    }
  },
  pincer(world, boss, target) {
    const c = FURY_CAST.pincer;
    const windup = c.windup * telegraphScale(world);
    target = predictTarget(world, boss, target, windup);
    const side = atan2(target.z - boss.z, target.x - boss.x) + Math.PI / 2;
    fallAt(world, boss, target.x, target.z, c.radius, windup, element(boss));
    for (const sign of [-1, 1])
      fallAt(
        world,
        boss,
        target.x + cos(side) * c.side * sign,
        target.z + sin(side) * c.side * sign,
        c.radius,
        windup,
        element(boss),
        undefined,
        undefined,
        c.follow,
      );
  },
};

const element = (boss: Enemy) => enemies[boss.species].types[0]!;
