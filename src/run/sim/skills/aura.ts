import { AURA } from "../content/params/enemy-skills";
// Koffing's and Weezing's smog (and Tentacool's sting ring on the water): a gas ring always around the body. No wind-up and no tell: the ring
// is its own warning. Players inside it are hurt and poisoned every `EnemyDef.skill.every` seconds;
// sleep or a stagger stops the gas for as long as it lasts.

import { damagePlayer } from "../hurt";
import { interrupted, sustain } from "../status";
import { standingHeight } from "../sight";
import type { Enemy } from "../state/entities";
import { inCircle } from "./kit";
import type { SkillDef } from "./index";

export const auraRadius = (enemy: Enemy) => AURA.reach * enemy.radius;

function auraSkill(poison: boolean): SkillDef {
  return {
    range: AURA.range,
    partner: { style: "cloud" },
    step(world, enemy, _target, _speed, dt, every) {
      if (interrupted(enemy)) return null;
      enemy.attackTimer -= dt;
      if (enemy.attackTimer > 0) return null;
      enemy.attackTimer += every;
      // Tentacool's ring floats on the water it swims in.
      const ground = standingHeight(world.map.terrain, enemy.species, enemy.x, enemy.z);
      const radius = auraRadius(enemy);
      for (const player of world.players)
        if (
          inCircle(world, enemy.x, enemy.z, radius, player, ground) &&
          damagePlayer(world, player, enemy.dmg * AURA.dmg)
        )
          if (poison) sustain(player, "poison", AURA.poison, -1);
      return null;
    },
  };
}

export const aura = auraSkill(true);
export const fireAura = auraSkill(false);
