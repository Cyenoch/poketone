import { ROCKFALL } from "../content/params/enemy-skills";
// Rhydon's rockfall (docs/state-machines/simulation.md`rockfall`): circles on the target's spot and around
// it fill while the caster holds still, then each takes one falling rock. Rocks come from above, so no
// cover stops them; a caster killed or put to sleep first calls them off. Aerodactyl's Rock Slide
// drops the same circles while it keeps flying (bosses/aerodactyl.ts).

import { damagePlayer } from "../hurt";
import { range } from "../rng";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy } from "../state/entities";
import { cos, sin } from "../math";
import { addHazard, inPatch, interruptWindup, type HazardRule } from "./kit";
import { telegraph } from "./telegraph";

/**
 * Circles of `radius` on (x, z) and `count − 1` more evenly around it at `ring`, turned by a seeded
 * angle; each rock lands after `seconds` for `dmg`.
 */
export function dropRocks(
  world: World,
  caster: Enemy,
  x: number,
  z: number,
  count: number,
  ring: number,
  radius: number,
  dmg: number,
  seconds: number,
): void {
  const turn = range(world.rng, 0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const angle = turn + (i / (count - 1)) * Math.PI * 2;
    const rx = i === 0 ? x : x + cos(angle) * ring;
    const rz = i === 0 ? z : z + sin(angle) * ring;
    addHazard(world, {
      kind: "rockfall",
      x: rx,
      y: heightAt(world.map.terrain, rx, rz),
      z: rz,
      // Integrated later in the tick that starts the wind-up.
      life: seconds + ROCKFALL.residue + TICK,
      radius,
      dmg,
      caster: caster.id,
    });
  }
}

export const rockfall = telegraph({
  range: ROCKFALL.range,
  windup: ROCKFALL.windup,
  tell: "normal",
  partner: { style: "pulse" },
  // The heading and distance it locked are the target's spot at the start of the wind-up.
  start(world, enemy, { distance }) {
    dropRocks(
      world,
      enemy,
      enemy.x + enemy.dashX * distance,
      enemy.z + enemy.dashZ * distance,
      ROCKFALL.spots,
      ROCKFALL.ring,
      ROCKFALL.radius * enemy.scale,
      enemy.dmg * ROCKFALL.damage,
      ROCKFALL.windup,
    );
  },
});

/**
 * A marked ground circle that stays where it was put and strikes once, `ROCKFALL.residue` seconds
 * before its end; its caster's death or sleep calls it off first. Kingler's Crabhammer and Starmie's
 * thunderbolts are the same rule (bosses/hazards.ts).
 */
export const strikeCircle: HazardRule = {
  update(world, circle) {
    if (circle.dmg <= 0) return;
    if (circle.life > ROCKFALL.residue) {
      interruptWindup(world, circle);
      return;
    }
    for (const player of world.players)
      if (inPatch(world, circle, player, circle.y)) damagePlayer(world, player, circle.dmg);
    circle.dmg = 0;
  },
};

export const hazards = { rockfall: strikeCircle } satisfies Record<string, HazardRule>;
