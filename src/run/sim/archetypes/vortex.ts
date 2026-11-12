// Vortices: a whirl on each target in range that pulls the crowd in, ticks, then collapses into a
// `burst` (the reference "pull then explode").

import { VORTEX } from "../content/params/archetypes";
import { pullEnemy, type Ctx } from "../combat";
import { enemies as enemyDefs } from "../content/enemies";
import { moveWithSlope } from "../nav/index";
import { moves } from "../content/moves";
import type { Area } from "../state/entities";
import { acquire, anywhere, area, inDisc, type ArchetypeDef, type Zone } from "./kit";
import { hypot } from "../math";
import { yieldTo } from "../poise";

/** Drags enemies within `VORTEX.pull` radii toward the area's centre, as far as their poise lets them. */
export function pullToward(ctx: Ctx, a: Area, dt: number): void {
  const reach = a.radius * VORTEX.pull;
  ctx.grid.query(a.x, a.z, reach, (enemy) => {
    const give = yieldTo(enemy);
    if (give <= 0 || enemy.hp <= 0) return;
    const dx = a.x - enemy.x;
    const dz = a.z - enemy.z;
    const distance = hypot(dx, dz);
    if (distance < VORTEX.pullStop || distance > reach) return;
    const strength = VORTEX.drag * give * dt;
    // Pull through the shared mover so a vortex can't drag ground enemies over cliffs.
    if (ctx.report) pullEnemy(ctx, enemy, a.x, a.z, strength, VORTEX.pullStop);
    else
      moveWithSlope(
        ctx.world.nav,
        enemyDefs[enemy.species].mobility,
        enemy,
        (dx / distance) * strength,
        (dz / distance) * strength,
      );
  });
}

export const vortexArea: Zone = {
  shape: inDisc,
  reaches: anywhere,
  knock: VORTEX.knock,
  hold: pullToward,
  expire(ctx, a, owner) {
    if (!a.move) return;
    // The collapse hits once; its 0.3 s lifetime only keeps that hit drawn.
    area(
      ctx.world,
      owner,
      moves[a.move],
      { ...a, dmg: a.dmg * VORTEX.burst, dur: 0.3, area: a.radius },
      "burst",
      { x: a.x, z: a.z, radius: a.radius, life: 0.3 },
    );
  },
};

export const vortex: ArchetypeDef = {
  heavy: true,
  windup: VORTEX.delay,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const targets = acquire(world, player, p.count, VORTEX.range);
    if (targets.length === 0) return false;
    for (const target of targets)
      area(world, player, def, p, "vortex", {
        x: target.x,
        z: target.z,
        delay: VORTEX.delay,
        tick: VORTEX.tick,
        life: p.dur + VORTEX.delay,
      });
    return true;
  },
};
