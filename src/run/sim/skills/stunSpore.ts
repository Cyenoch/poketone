import { ENEMY_HAZARD, STUN_SPORE } from "../content/params/enemy-skills";
// Paras' stun spore: a cloud that arms at the end of the wind-up and slows the players it can see.

import { statuses } from "../content/statuses";
import { lineOfFire } from "../sight";
import { sustain } from "../status";
import { heightAt } from "../terrain";
import { chestOf, inPatch, interruptWindup, addHazard, type HazardRule } from "./kit";
import { telegraph } from "./telegraph";

export const stunSpore = telegraph({
  range: STUN_SPORE.range,
  windup: STUN_SPORE.windup,
  // Red: the slow holds the player in the swarm, so getting caught costs more than one hit.
  tell: "danger",
  partner: { style: "cloud", status: "paralysis" },
  start(world, enemy) {
    addHazard(world, {
      kind: "stun-spore",
      x: enemy.x,
      y: heightAt(world.map.terrain, enemy.x, enemy.z) + ENEMY_HAZARD.groundSight,
      z: enemy.z,
      life: STUN_SPORE.windup + STUN_SPORE.active,
      radius: STUN_SPORE.radius * enemy.scale,
      caster: enemy.id,
    });
  },
});

export const hazards = {
  "stun-spore": {
    update(world, cloud) {
      if (cloud.life > STUN_SPORE.active) {
        interruptWindup(world, cloud);
        return;
      }
      for (const player of world.players) {
        if (!inPatch(world, cloud, player, cloud.y - ENEMY_HAZARD.groundSight)) continue;
        // The cloud stays behind cover like a spray: only players it can see are slowed.
        if (
          lineOfFire(world, cloud.x, cloud.y, cloud.z, player.x, chestOf(world, player), player.z)
        )
          sustain(player, "slow", statuses.slow.duration, -1);
      }
    },
  },
} satisfies Record<string, HazardRule>;
