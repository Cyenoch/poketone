import { PSYBEAM, VINE, PSYBEAM_HEAVY } from "../content/params/enemy-skills";
// Venonat's psybeam and Tangela's vine lash: a thin beam along the locked heading, live for a moment
// after the charge. The vines also slow whoever they catch.

import { statuses } from "../content/statuses";
import { damagePlayer } from "../hurt";
import { formOf, hazardRadius } from "../evolution";
import { coverHit } from "../sight";
import { sustain } from "../status";
import { heightAt } from "../terrain";
import type { World } from "../state/world";
import type { Hazard, Player } from "../state/entities";
import { addHazard, interruptWindup, type HazardRule } from "./kit";
import { telegraph } from "./telegraph";

function beam(
  kind: "psybeam" | "vine" | "ice-beam",
  n: typeof PSYBEAM | typeof VINE | typeof PSYBEAM_HEAVY,
) {
  return telegraph({
    range: n.range,
    windup: n.windup,
    tell: "normal",
    partner: { style: "shot" },
    start(world, enemy, { y, goal, distance }) {
      const rise = (goal - y) / distance;
      const blocked = coverHit(
        world,
        enemy.x,
        y,
        enemy.z,
        enemy.dashX,
        enemy.dashZ,
        rise,
        n.length,
      );
      addHazard(world, {
        kind,
        x: enemy.x,
        y,
        z: enemy.z,
        life: n.windup + n.active,
        radius: n.width,
        dmg: enemy.dmg * n.dmg,
        dirX: enemy.dashX,
        dirZ: enemy.dashZ,
        rise,
        length: Math.min(n.length, blocked),
        caster: enemy.id,
      });
    },
  });
}

export const iceBeam = beam("ice-beam", VINE);
export const psybeam = beam("psybeam", PSYBEAM);
export const vineBind = beam("vine", VINE);
export const psybeamHeavy = beam("psybeam", PSYBEAM_HEAVY);

/** Beam point at horizontal distance `along` lies inside the player's body (with the beam's width). */
export function beamHits(world: World, beam: Hazard, player: Player): boolean {
  const ox = player.x - beam.x;
  const oz = player.z - beam.z;
  const along = ox * beam.dirX + oz * beam.dirZ;
  if (along < 0 || along > beam.length) return false;
  if (Math.abs(ox * beam.dirZ - oz * beam.dirX) > beam.radius + hazardRadius(player)) return false;
  const y = beam.y + beam.rise * along;
  const feet = heightAt(world.map.terrain, player.x, player.z);
  return y >= feet - beam.radius && y <= feet + formOf(player).height + beam.radius;
}

function beamRule(active: number, slows: boolean): HazardRule {
  return {
    update(world, beam) {
      if (beam.life > active) {
        interruptWindup(world, beam);
        return;
      }
      for (const player of world.players)
        if (player.alive && beamHits(world, beam, player) && damagePlayer(world, player, beam.dmg))
          if (slows) sustain(player, "slow", statuses.slow.duration, -1);
    },
  };
}

export const hazards = {
  "ice-beam": beamRule(VINE.active, true),
  psybeam: beamRule(PSYBEAM.active, false),
  vine: beamRule(VINE.active, true),
} satisfies Record<string, HazardRule>;
