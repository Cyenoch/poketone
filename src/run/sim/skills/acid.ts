import { ENEMY_HAZARD, ACID, EGG } from "../content/params/enemy-skills";
// Ekans' acid: a lob onto the spot the target stands on at the spit, leaving a poison pool. Exeggcute's
// egg bomb is the same lob, but it blasts its ring once on landing and leaves nothing; Exeggutor throws
// three at once, one on the target and one to each side.

import { damageFromHazard } from "./kit";
import { sustain } from "../status";
import { lineOfFire, stopAtCover } from "../sight";
import { heightAt } from "../terrain";
import type { World } from "../state/world";
import type { Enemy, Hazard, Player } from "../state/entities";
import { hypot } from "../math";
import { predictTarget } from "../enemy-aim";
import { addHazard, chestOf, inPatch, mouthY, type HazardRule } from "./kit";
import { telegraph } from "./telegraph";

/** A lob from (x, y, z) that lands on (toX, toZ) after its kind's flight time. */
function lob(
  world: World,
  kind: "acid" | "egg",
  x: number,
  y: number,
  z: number,
  toX: number,
  toZ: number,
  dmg: number,
  source: number,
): void {
  const ground = heightAt(world.map.terrain, toX, toZ);
  const look = kind === "acid" ? ACID : EGG;
  const t = look.flight;
  addHazard(world, {
    kind,
    x,
    y,
    z,
    vx: (toX - x) / t,
    vy: (ground - y + 0.5 * look.gravity * t * t) / t,
    vz: (toZ - z) / t,
    life: t,
    radius: look.radius,
    dmg,
    source,
  });
}

/** An acid glob that splashes and pools where it lands (Nidoking's Toxic Spikes throw these too). */
export function lobAcid(
  world: World,
  x: number,
  y: number,
  z: number,
  toX: number,
  toZ: number,
  dmg: number,
  source: number,
): void {
  lob(world, "acid", x, y, z, toX, toZ, dmg, source);
}

/** The glob's flight time is the telegraph (the landing ring). */
function spit(world: World, enemy: Enemy, target: Player): void {
  target = predictTarget(world, enemy, target, ACID.flight);
  lobAcid(
    world,
    enemy.x,
    mouthY(world, enemy),
    enemy.z,
    target.x,
    target.z,
    enemy.dmg * ACID.splash,
    enemy.id,
  );
}

function eggs(spots: 1 | 3) {
  return (world: World, enemy: Enemy, target: Player) => {
    target = predictTarget(world, enemy, target, EGG.flight);
    const y = mouthY(world, enemy);
    const dmg = enemy.dmg * EGG.damage;
    const dx = target.x - enemy.x;
    const dz = target.z - enemy.z;
    const distance = hypot(dx, dz) || 1;
    // Sideways from the line to the target.
    const sx = (-dz / distance) * EGG.side;
    const sz = (dx / distance) * EGG.side;
    lob(world, "egg", enemy.x, y, enemy.z, target.x, target.z, dmg, enemy.id);
    if (spots === 3) {
      lob(world, "egg", enemy.x, y, enemy.z, target.x + sx, target.z + sz, dmg, enemy.id);
      lob(world, "egg", enemy.x, y, enemy.z, target.x - sx, target.z - sz, dmg, enemy.id);
    }
  };
}

export const acid = telegraph({
  range: ACID.range,
  windup: ACID.windup,
  tell: "normal",
  partner: { style: "shot" },
  release: spit,
});

export const eggBomb = telegraph({
  range: EGG.range,
  windup: EGG.windup,
  tell: "normal",
  partner: { style: "shot" },
  release: eggs(1),
});

export const eggBarrage = telegraph({
  range: EGG.range,
  windup: EGG.windup,
  tell: "normal",
  partner: { style: "shot" },
  release: eggs(3),
});

function land(world: World, glob: Hazard): void {
  glob.life = 0;
  const ground = heightAt(world.map.terrain, glob.x, glob.z);
  const pool = addHazard(world, {
    kind: "acid-pool",
    x: glob.x,
    y: ground,
    z: glob.z,
    life: ACID.poolLife,
    radius: ACID.pool,
  });
  for (const player of world.players)
    if (inPatch(world, pool, player, ground) && damageFromHazard(world, player, glob))
      sustain(player, "poison", ACID.poison, -1);
}

/** The egg's blast: every player inside its ring, on its level and in sight of its centre, once. */
function blast(world: World, egg: Hazard): void {
  egg.life = 0;
  const ground = heightAt(world.map.terrain, egg.x, egg.z);
  const ring = addHazard(world, {
    kind: "egg-blast",
    x: egg.x,
    y: ground,
    z: egg.z,
    life: EGG.residue,
    radius: EGG.blast,
  });
  for (const player of world.players)
    if (
      inPatch(world, ring, player, ground) &&
      lineOfFire(
        world,
        ring.x,
        ground + ENEMY_HAZARD.groundSight,
        ring.z,
        player.x,
        chestOf(world, player),
        player.z,
      )
    )
      damageFromHazard(world, player, egg);
}

export const hazards = {
  acid: {
    gravity: ACID.gravity,
    update(world, glob) {
      if (stopAtCover(world, glob) || glob.life <= 0) land(world, glob);
    },
  },
  egg: {
    gravity: EGG.gravity,
    update(world, egg) {
      if (stopAtCover(world, egg) || egg.life <= 0) blast(world, egg);
    },
  },
  // Residue only: the blast hit on landing.
  "egg-blast": { update() {} },
  "acid-pool": {
    update(world, pool) {
      for (const player of world.players)
        if (inPatch(world, pool, player, pool.y)) sustain(player, "poison", ACID.poison, -1);
    },
  },
} satisfies Record<string, HazardRule>;
