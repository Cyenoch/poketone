import { ENEMY_HAZARD, RADIAL } from "../content/params/enemy-skills";
import { SING_SLOW } from "../content/params/late-zones";
// Voltorb's discharge and Electrode's self-destruct (and the coast's Magneton, Electabuzz and Dragonair
// rings): the whole circle is marked, then hits once.

import { sustain } from "../status";
import { damagePlayer } from "../hurt";
import { lineOfFire } from "../sight";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Hazard } from "../state/entities";
import { activeCaster, addHazard, chestOf, inPatch, type HazardRule } from "./kit";
import { telegraph, type TelegraphSpec } from "./telegraph";

type RadialKind = keyof typeof RADIAL;

function radial(kind: RadialKind, look: Pick<TelegraphSpec, "tell" | "partner">) {
  const pulse = RADIAL[kind];
  return telegraph({
    range: pulse.range,
    windup: pulse.windup,
    ...look,
    start(world, enemy) {
      addHazard(world, {
        kind,
        x: enemy.x,
        y: heightAt(world.map.terrain, enemy.x, enemy.z),
        z: enemy.z,
        // Hazards are integrated later in the same tick that announces this wind-up.
        life: pulse.windup + pulse.active + TICK,
        radius: pulse.radius,
        dmg: enemy.dmg * pulse.damage,
        caster: enemy.id,
      });
    },
  });
}

export const sing = radial("sing", { tell: "normal", partner: { style: "pulse" } });
export const singWide = radial("sing-wide", { tell: "normal", partner: { style: "pulse" } });
export const dragonPulse = radial("dragon-pulse", { tell: "normal", partner: { style: "pulse" } });
export const discharge = radial("discharge", {
  tell: "normal",
  partner: { style: "pulse", status: "paralysis" },
});
export const selfDestruct = radial("self-destruct", {
  tell: "danger",
  partner: { style: "pulse" },
});
export const dischargeWide = radial("discharge-wide", {
  tell: "normal",
  partner: { style: "pulse", status: "paralysis" },
});
export const dischargeQuick = radial("discharge-quick", {
  tell: "normal",
  partner: { style: "pulse", status: "paralysis" },
});
export const dragonRage = radial("dragon-rage", { tell: "normal", partner: { style: "pulse" } });

/**
 * The ring follows its caster and dies with it (or when it falls asleep); `active` seconds before its
 * end it hits once, then `after` runs (Nidoking's stomp uses this rule too, bosses/hazards.ts).
 */
export function radialRule(
  active: number,
  after?: (world: World, caster: Enemy) => void,
  slow = 0,
): HazardRule {
  return {
    update(world, ring) {
      if (ring.dmg <= 0) return;
      const caster = activeCaster(world, ring);
      if (!caster) {
        ring.life = 0;
        return;
      }
      ring.x = caster.x;
      ring.y = heightAt(world.map.terrain, caster.x, caster.z);
      ring.z = caster.z;
      if (ring.life > active) return;
      hitInside(world, ring, slow);
      ring.dmg = 0;
      after?.(world, caster);
    },
  };
}

/** Every player inside the ring, on its level and in sight of its centre, takes the hit once. */
function hitInside(world: World, ring: Hazard, slow: number): void {
  for (const player of world.players)
    if (
      inPatch(world, ring, player, ring.y) &&
      lineOfFire(
        world,
        ring.x,
        ring.y + ENEMY_HAZARD.groundSight,
        ring.z,
        player.x,
        chestOf(world, player),
        player.z,
      )
    )
      if (damagePlayer(world, player, ring.dmg) && slow) sustain(player, "slow", slow, -1);
}

export const hazards = {
  sing: radialRule(RADIAL.sing.active, undefined, SING_SLOW),
  "sing-wide": radialRule(RADIAL["sing-wide"].active, undefined, SING_SLOW),
  "dragon-pulse": radialRule(RADIAL["dragon-pulse"].active),
  discharge: radialRule(RADIAL.discharge.active),
  "discharge-wide": radialRule(RADIAL["discharge-wide"].active),
  "discharge-quick": radialRule(RADIAL["discharge-quick"].active),
  "dragon-rage": radialRule(RADIAL["dragon-rage"].active),
  "self-destruct": radialRule(RADIAL["self-destruct"].active, (world, caster) => {
    caster.hp = 0;
    // Self-destruction removes the enemy without granting kills, loot or captures.
    world.events.push({
      t: "death",
      x: caster.x,
      z: caster.z,
      species: caster.species,
      elite: caster.elite,
    });
  }),
} satisfies Record<string, HazardRule>;
