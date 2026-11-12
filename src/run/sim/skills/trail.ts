import { ENEMY_HAZARD } from "../content/params/enemy-skills";
import { TRAIL } from "../content/params/late-zones";
import { formOf } from "../evolution";
import { hypot } from "../math";
import { interrupted } from "../status";
import { sampleSurface } from "../surface";
import { heightAt } from "../terrain";
import type { Enemy, Player } from "../state/entities";
import type { World } from "../state/world";
import { addHazard } from "./kit";
import type { SkillDef } from "./index";

/** Moving sludge leaves bounded pools; the guardian's pools are wider and last longer. */
export function sludgeTrail(world: World, enemy: Enemy, guardian = false): void {
  const pools = world.hazards.filter(
    (h) => h.kind === "acid-pool" && h.caster === enemy.id && h.life > 0,
  );
  const last = pools.at(-1);
  if (last && hypot(enemy.x - last.x, enemy.z - last.z) < TRAIL.spacing) return;
  if (!guardian && pools.length >= TRAIL.pools) pools[0]!.life = 0;
  addHazard(world, {
    kind: "acid-pool",
    x: enemy.x,
    y: heightAt(world.map.terrain, enemy.x, enemy.z),
    z: enemy.z,
    life: guardian ? TRAIL.guardianLife : TRAIL.life,
    radius: guardian || enemy.elite ? TRAIL.wideRadius : TRAIL.radius,
    caster: enemy.id,
  });
}

export const trail: SkillDef = {
  range: TRAIL.range,
  partner: { style: "cloud" },
  step(world, enemy, _target, speed, dt, every) {
    if (interrupted(enemy) || speed <= 0) return null;
    enemy.attackTimer -= dt;
    if (enemy.attackTimer <= 0) {
      enemy.attackTimer += every;
      sludgeTrail(world, enemy);
    }
    return null;
  },
};

/** Static lakes and Dewgong's temporary strips share only the player's inertia rule. */
export function onIce(world: Pick<World, "map" | "hazards">, player: Player): boolean {
  if (formOf(player).types.includes("flying")) return false;
  if (sampleSurface(world.map.terrain.surface, player.x, player.z).kind === "ice-slick")
    return true;
  return world.hazards.some((h) => {
    if (h.kind !== "ice-trail" || h.life <= 0) return false;
    const dx = player.x - h.x,
      dz = player.z - h.z;
    const along = Math.max(0, Math.min(h.length, dx * h.dirX + dz * h.dirZ));
    const x = h.x + h.dirX * along,
      z = h.z + h.dirZ * along;
    return (
      hypot(player.x - x, player.z - z) <= h.radius &&
      Math.abs(
        heightAt(world.map.terrain, player.x, player.z) - heightAt(world.map.terrain, x, z),
      ) <= ENEMY_HAZARD.level
    );
  });
}
