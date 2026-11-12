import { ENEMY_HAZARD, TELEPORT } from "../content/params/enemy-skills";
import { enemies } from "../content/enemies";
import { bodyFits } from "../nav/index";
import { range } from "../rng";
import { coverHit, lineOfFire } from "../sight";
import { attacksBlocked, interrupted } from "../status";
import { heightAt } from "../terrain";
import { ARENA_HALF, TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { cos, sin, hypot } from "../math";
import { activeCaster, addHazard, chestOf, enter, mouthY, tell, type HazardRule } from "./kit";
import type { SkillDef } from "./index";

/** A finite seeded search: only standable destinations with sight of the target are accepted. */
export function teleportSpot(
  world: World,
  enemy: Enemy,
  target: Player,
  min: number,
  max: number,
): [number, number] | null {
  const turn = range(world.rng, 0, Math.PI * 2);
  for (let i = 0; i < 16; i++) {
    const angle = turn + (i * Math.PI) / 8,
      distance = range(world.rng, min, max);
    const x = target.x + cos(angle) * distance,
      z = target.z + sin(angle) * distance;
    if (Math.abs(x) + enemy.radius > ARENA_HALF || Math.abs(z) + enemy.radius > ARENA_HALF)
      continue;
    if (!bodyFits(world.nav, enemies[enemy.species].mobility, x, z, enemy.radius)) continue;
    const y =
      heightAt(world.map.terrain, x, z) + enemies[enemy.species].height * ENEMY_HAZARD.mouth;
    if (lineOfFire(world, x, y, z, target.x, chestOf(world, target), target.z)) return [x, z];
  }
  return null;
}

export const teleport: SkillDef = {
  range: TELEPORT.range,
  windup: TELEPORT.windup,
  partner: { style: "shot" },
  step(world, enemy, target, _speed, dt, every) {
    if (interrupted(enemy)) {
      enter(enemy, "chase");
      return null;
    }
    enemy.phaseTime += dt;
    if (enemy.phase === "chase") {
      enemy.attackTimer -= dt;
      if (
        enemy.attackTimer > 0 ||
        attacksBlocked(enemy) ||
        hypot(target.x - enemy.x, target.z - enemy.z) > TELEPORT.range
      )
        return null;
      const spot = teleportSpot(world, enemy, target, ...TELEPORT.destination);
      if (!spot) return null;
      enemy.attackTimer = every;
      enter(enemy, "under");
      addHazard(world, {
        kind: "teleport-mark",
        x: spot[0],
        y: heightAt(world.map.terrain, ...spot),
        z: spot[1],
        radius: enemy.radius,
        life: TELEPORT.vanish + 2 * TICK,
        duration: TELEPORT.vanish,
        caster: enemy.id,
      });
      return [0, 0, 0];
    }
    if (enemy.phase === "under" && enemy.phaseTime >= TELEPORT.vanish) {
      const mark = world.hazards.find((h) => h.kind === "teleport-mark" && h.caster === enemy.id);
      if (!mark) {
        enter(enemy, "chase");
        return null;
      }
      enemy.x = enemy.px = mark.x;
      enemy.z = enemy.pz = mark.z;
      mark.life = 0;
      enter(enemy, "windup");
      const dx = target.x - enemy.x,
        dz = target.z - enemy.z,
        d = hypot(dx, dz) || 1;
      enemy.dashX = dx / d;
      enemy.dashZ = dz / d;
      const y = mouthY(world, enemy),
        rise = (chestOf(world, target) - y) / d;
      addHazard(world, {
        kind: "psybeam",
        x: enemy.x,
        y,
        z: enemy.z,
        life: TELEPORT.windup + TELEPORT.active + TICK,
        duration: TELEPORT.duration,
        active: TELEPORT.active,
        radius: TELEPORT.width,
        dmg: enemy.dmg,
        dirX: dx / d,
        dirZ: dz / d,
        rise,
        length: Math.min(
          TELEPORT.length,
          coverHit(world, enemy.x, y, enemy.z, dx / d, dz / d, rise, TELEPORT.length),
        ),
        caster: enemy.id,
      });
      tell(world, enemy, "normal", TELEPORT.windup);
    } else if (enemy.phase === "windup" && enemy.phaseTime >= TELEPORT.duration)
      enter(enemy, "chase");
    return [0, 0, 0];
  },
};

export const hazards = {
  "teleport-mark": {
    update(world, mark) {
      if (!activeCaster(world, mark)) mark.life = 0;
    },
  },
} satisfies Record<string, HazardRule>;
