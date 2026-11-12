import { ENEMY_HAZARD, LUNGE, PECK, FLAME_TRAIL } from "../content/params/enemy-skills";
import { FIRE_PUNCHES, FIRE_PUNCH_GAP } from "../content/params/late-zones";
// Spearow's dive, Geodude's roll, Growlithe's flame charge and Nidorino's horn attack: a locked lane,
// then a dash along it. The desert adds Doduo's and Dodrio's pecks (2 / 3 dashes in a row), the longer
// charges of Tauros, Rhyhorn and Kabutops, and Rapidash's charge that leaves burning ground behind; the
// coast adds Kabuto's short dash and Seaking's charge at the shore.

import { hazardRadius } from "../evolution";
import { damagePlayer } from "../hurt";
import { HURT_TICKS } from "../content/params/environment";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Hazard, Player } from "../state/entities";
import { activeCaster, addHazard, type HazardRule } from "./kit";
import { telegraph, type Lunge, type TelegraphSpec } from "./telegraph";

type LungeNumbers = (typeof LUNGE)[keyof typeof LUNGE];

function lunge(
  numbers: LungeNumbers,
  extra: Pick<TelegraphSpec, "walk"> & Pick<Lunge, "stopsAtCover" | "repeat"> & { trail?: true },
) {
  const { range, windup, speed, time, recover } = numbers;
  return telegraph({
    range,
    windup,
    tell: "normal",
    partner: { style: "tackle" },
    walk: extra.walk,
    lunge: { speed, time, recover, stopsAtCover: extra.stopsAtCover, repeat: extra.repeat },
    // The boss's lane telegraph, at this species' width and reach.
    start(world, enemy) {
      if (extra.trail) layTrail(world, enemy, windup + time);
      addHazard(world, {
        kind: "dash-warn",
        x: enemy.x,
        y: 0,
        z: enemy.z,
        // This tick also integrates the hazard; the wind-up → dash transition tick still holds still.
        // A follow-up peck starts part way into the wind-up, so its lane shows for the rest of it.
        life: windup - enemy.phaseTime + 2 * TICK,
        radius: enemy.radius,
        dirX: enemy.dashX,
        dirZ: enemy.dashZ,
        length: speed * time,
        caster: enemy.id,
      });
    },
  });
}

export const bellySlide = lunge(LUNGE["belly-slide"], { walk: true });
export const firePunch = lunge(LUNGE["fire-punch"], {
  walk: true,
  repeat: { count: FIRE_PUNCHES, gap: FIRE_PUNCH_GAP },
});
export const dive = lunge(LUNGE.dive, { stopsAtCover: true });
export const roll = lunge(LUNGE.roll, { walk: true });
export const flameCharge = lunge(LUNGE["flame-charge"], { walk: true });
export const hornAttack = lunge(LUNGE["horn-attack"], { walk: true });
export const doublePeck = lunge(LUNGE["double-peck"], { walk: true, repeat: PECK["double-peck"] });
export const triplePeck = lunge(LUNGE["triple-peck"], { walk: true, repeat: PECK["triple-peck"] });
export const takeDown = lunge(LUNGE["take-down"], { walk: true });
export const hornRush = lunge(LUNGE["horn-rush"], { walk: true });
export const razorDash = lunge(LUNGE["razor-dash"], { walk: true });
export const flameTrail = lunge(LUNGE["flame-trail"], { walk: true, trail: true });
export const aquaJet = lunge(LUNGE["aqua-jet"], { walk: true });
// A swimmer has no walkable line onto the beach; the mover stops its charge at the waterline.
export const megahorn = lunge(LUNGE.megahorn, {});

/** The trail starts under the caster and grows behind it while it charges (`flame-trail` rule). */
function layTrail(world: World, enemy: Enemy, seconds: number): void {
  addHazard(world, {
    kind: "flame-trail",
    x: enemy.x,
    y: heightAt(world.map.terrain, enemy.x, enemy.z),
    z: enemy.z,
    // The rule lights it when the charge ends; this only bounds a trail whose caster vanished.
    life: seconds + 1,
    radius: FLAME_TRAIL.width,
    dmg: enemy.dmg * FLAME_TRAIL.damage,
    dirX: enemy.dashX,
    dirZ: enemy.dashZ,
    caster: enemy.id,
  });
}

/** Swaps the laid trail for the burning one; nothing burns if the charge never left. */
function ignite(world: World, trail: Hazard): void {
  trail.life = 0;
  if (trail.length <= 0) return;
  addHazard(world, { ...trail, kind: "burning-trail", life: FLAME_TRAIL.life, caster: -1 });
}

/** True for a living player on the burning strip, on its level. */
function onTrail(world: World, trail: Hazard, player: Player): boolean {
  if (!player.alive) return false;
  const ox = player.x - trail.x;
  const oz = player.z - trail.z;
  const along = ox * trail.dirX + oz * trail.dirZ;
  if (along < 0 || along > trail.length) return false;
  if (Math.abs(ox * trail.dirZ - oz * trail.dirX) > trail.radius + hazardRadius(player))
    return false;
  const ground = heightAt(
    world.map.terrain,
    trail.x + trail.dirX * along,
    trail.z + trail.dirZ * along,
  );
  return Math.abs(heightAt(world.map.terrain, player.x, player.z) - ground) <= ENEMY_HAZARD.level;
}

/** A swarm lane follows its caster (knockback moves it) and dies with it; the guardian's stays put. */
export function followCaster(world: World, hazard: Hazard): void {
  if (hazard.caster < 0) return;
  const caster = activeCaster(world, hazard);
  if (!caster) hazard.life = 0;
  else {
    hazard.x = caster.x;
    hazard.z = caster.z;
  }
}

export const hazards = {
  "dash-warn": { update: followCaster },
  "flame-trail": {
    update(world, trail) {
      const caster = activeCaster(world, trail);
      if (caster?.phase === "windup") {
        trail.x = caster.x;
        trail.y = heightAt(world.map.terrain, caster.x, caster.z);
        trail.z = caster.z;
      } else if (caster?.phase === "dash")
        trail.length = Math.max(
          0,
          (caster.x - trail.x) * trail.dirX + (caster.z - trail.z) * trail.dirZ,
        );
      else ignite(world, trail);
    },
  },
  "burning-trail": {
    update(world, trail) {
      if (world.tick % HURT_TICKS !== 0) return;
      for (const player of world.players)
        if (onTrail(world, trail, player)) damagePlayer(world, player, trail.dmg);
    },
  },
} satisfies Record<string, HazardRule>;
