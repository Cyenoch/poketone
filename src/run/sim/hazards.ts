import { damagePlayer } from "./hurt";
import { formOf, hazardRadius } from "./evolution";
import { stopAtCover } from "./sight";
import { guardianHazards } from "./bosses/hazards";
import { skillHazards } from "./skills/index";
import { interruptWindup, type HazardRule } from "./skills/kit";
import { apply } from "./status";
import { heightAt } from "./terrain";
import type { World } from "./state/world";
import { hypot } from "./math";
import { settlePlayerSurface } from "./surface-effects";

/**
 * Every hazard kind's rule: the skills' (the dash lane and landing circle, shared with the guardians),
 * Air Slash (a plain shot) and the zone 2–3 guardians' (bosses/hazards.ts).
 */
const hazardRules = { ...skillHazards, ...guardianHazards, slash: {} } satisfies Record<
  string,
  HazardRule
>;

export type HazardKind = keyof typeof hazardRules;

export function updateHazards(world: World, dt: number): void {
  // Static lava, burning ground and quicksand (surface-effects.ts).
  for (const player of world.players) if (player.alive) settlePlayerSurface(world, player, dt);
  for (const hazard of world.hazards) {
    const rule: HazardRule = hazardRules[hazard.kind];
    if (hazard.delay && hazard.delay > 0) {
      // Delayed casts are already committed wind-ups, even before their warning appears.
      if (hazard.caster >= 0) interruptWindup(world, hazard);
      hazard.delay -= dt;
      continue;
    }
    hazard.px = hazard.x;
    hazard.py = hazard.y;
    hazard.pz = hazard.z;
    // Semi-implicit: this tick's segment uses the updated vy, which stopAtCover reads as its slope.
    if (rule.gravity) hazard.vy -= rule.gravity * dt;
    hazard.x += hazard.vx * dt;
    hazard.y += hazard.vy * dt;
    hazard.z += hazard.vz * dt;
    hazard.life -= dt;
    if (rule.update) {
      rule.update(world, hazard);
      continue;
    }
    if (hazard.dmg <= 0 || stopAtCover(world, hazard)) continue;
    for (const player of world.players) {
      if (!player.alive) continue;
      if (hypot(player.x - hazard.x, player.z - hazard.z) > hazard.radius + hazardRadius(player))
        continue;
      const feet = heightAt(world.map.terrain, player.x, player.z);
      if (
        hazard.y < feet - hazard.radius ||
        hazard.y > feet + formOf(player).height + hazard.radius
      )
        continue;
      if (damagePlayer(world, player, hazard.dmg)) {
        if (rule.poison) apply(player, "poison", rule.poison, 0, -1);
        if (rule.slow) apply(player, "slow", rule.slow, 0, -1);
        hazard.life = 0;
      }
    }
  }
  world.hazards = world.hazards.filter((hazard) => hazard.life > 0);
}
