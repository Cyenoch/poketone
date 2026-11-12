// Looks for the forest's zone 2–3 attacks (docs/state-machines/simulation.md): landing circles (burrow, leap,
// Pinsir's slams), gas rings, the healer's pulse, egg bombs, vine beams and Nidoking's fissures and
// stomp. Telegraphs go on the danger layer and fill as their wind-up runs out; the gas ring keeps one
// constant alpha (it is always there) and the heal pulse lives on the player ground layer in green, so
// neither reads as a warning (§1.6).

import { enemies } from "../../sim/content/enemies";
import { FISSURE, STOMP } from "../../sim/content/params/guardian";
import { EGG, AURA, HEAL_PULSE } from "../../sim/content/params/enemy-skills";

import { auraRadius } from "../../sim/skills/aura";

import { LANDING_RESIDUE } from "../../sim/skills/landing";
import { enemyFeet, enemyHeight } from "../../sim/sight";
import { interrupted } from "../../sim/status";
import type { World } from "../../sim/state/world";
import type { Enemy, Hazard } from "../../sim/state/entities";
import { Decal } from "./decals";
import { perFrame, rand, spray, type Fx } from "./fx";
import { danger, fire, grass, poison, stone, water, white } from "./palette";
import { Shape, sprite } from "./sprites";

const dust = sprite({
  shape: Shape.puff,
  life: 0.5,
  grow: 1.6,
  from: stone.light,
  to: stone.dark,
  accent: stone.dark,
  alpha: 0.8,
  drag: 3,
  gravity: -0.6,
});
const ghostMote = sprite({
  shape: Shape.cloud,
  life: 0.5,
  grow: 1.6,
  from: poison.purple,
  to: poison.light,
  accent: poison.deep,
  alpha: 0.3,
  drag: 2,
  gravity: -0.5,
});
const smog = sprite({
  shape: Shape.cloud,
  life: 1.1,
  grow: 1.7,
  from: poison.purple,
  to: poison.deep,
  accent: poison.deep,
  alpha: 0.42,
  drag: 1.5,
  gravity: -0.25,
});
// Faint: a pack of Gastly must not stack into a wall that hides the player.
const gasHalo = sprite({
  shape: Shape.cloud,
  from: poison.purple,
  accent: poison.deep,
  alpha: 0.22,
});
const auraFlame = sprite({
  shape: Shape.flame,
  life: 0.4,
  from: fire.orange,
  to: fire.deep,
  accent: fire.yellow,
  alpha: 0.6,
  gravity: -1,
  grow: 0.3,
});
const egg = sprite({ shape: Shape.ball, from: white, accent: fire.yellow });
const eggHalo = sprite({
  shape: Shape.glow,
  from: fire.yellow,
  accent: white,
  alpha: 0.45,
  add: 0.4,
});
const blastPuff = sprite({
  shape: Shape.puff,
  life: 0.45,
  grow: 1.8,
  from: fire.yellow,
  to: fire.smoke,
  accent: fire.deep,
  alpha: 0.85,
  drag: 3,
  gravity: -0.8,
});
const bubble = sprite({ shape: Shape.bubble, from: water.light, accent: water.foam });
const bubbleHalo = sprite({ shape: Shape.glow, from: water.mid, accent: water.light, alpha: 0.5 });
const shard = sprite({ shape: Shape.shard, from: stone.light, accent: stone.dark });
const vineGlow = sprite({ shape: Shape.glow, from: grass.leaf, accent: grass.light, add: 0.5 });
const mendStar = sprite({
  shape: Shape.star,
  life: 0.6,
  grow: 0.6,
  from: grass.light,
  to: grass.leaf,
  accent: white,
  add: 0.5,
  gravity: -1.2,
});

/** Circle colour by who is coming down: the guardian red, a ghost purple, everyone else dust. */
function landingColour(world: World, hazard: Hazard) {
  const caster = world.enemies.find((enemy) => enemy.id === hazard.caster);
  if (!caster || caster.boss || caster.elite) return { a: danger.red, b: danger.deep };
  if (enemies[caster.species].skill?.kind === "shadow-sneak")
    return { a: poison.purple, b: poison.deep };
  return { a: stone.light, b: stone.dark };
}

/**
 * A landing circle: fills toward the rim until the body arrives (t 0 → 1), then a short ring of dust
 * where it hit. `fresh` is the first frame after the hit (the dust burst).
 */
export function landingHazard(
  fx: Fx,
  world: World,
  hazard: Hazard,
  t: number,
  fresh: boolean,
): void {
  const { a, b } = landingColour(world, hazard);
  const r = hazard.radius;
  if (hazard.dmg > 0) {
    fx.danger
      .put(Decal.telegraph, hazard.x, hazard.z, r, 0, hazard.id * 0.618)
      .tint(a, 0.95, b, 0)
      .args(t);
    return;
  }
  const fade = Math.max(0, hazard.life / LANDING_RESIDUE);
  fx.danger
    .put(Decal.ring, hazard.x, hazard.z, r)
    .tint(a, fade, b, 0)
    .args(1 - fade, 0.25);
  fx.decals
    .put(Decal.cracks, hazard.x, hazard.z, r * 0.8, 0, hazard.id)
    .tint(stone.dark, fade, stone.dark, 0)
    .args(1 - fade);
  if (fresh) spray(fx, dust, hazard.x, hazard.y + 0.1, hazard.z, 10, r * 2.2, 1.2, 0.35);
}

/** Koffing's and Weezing's ring: constant alpha, dimmer while the gas is stopped; slow drifting smog. */
function gasRing(fx: Fx, enemy: Enemy, x: number, z: number, ground: number): void {
  const r = auraRadius(enemy);
  const live = interrupted(enemy) ? 0.35 : 1;
  if (enemy.species === "flareon") {
    fx.danger
      .put(Decal.ring, x, z, r)
      .tint(fire.orange, 0.7 * live, fire.deep, 0)
      .args(0, 0.07, 1);
    fx.danger
      .put(Decal.scorch, x, z, r, 0, enemy.id)
      .tint(fire.soot, 0.5 * live, fire.orange, 0)
      .args(0.3);
    if (live < 1) return;
    for (let i = perFrame(fx, 10); i > 0; i--) {
      const a = rand(0, Math.PI * 2),
        d = rand(0.4, 0.9) * r;
      fx.sprites.emit(
        auraFlame,
        x + Math.cos(a) * d,
        ground + 0.12,
        z + Math.sin(a) * d,
        0,
        0.4,
        0,
        0.18,
      );
    }
    return;
  }
  fx.danger.put(Decal.glow, x, z, r).tint(poison.purple, 0.32 * live, poison.deep, 0);
  fx.danger
    .put(Decal.ring, x, z, r)
    .tint(poison.purple, 0.7 * live, poison.deep, 0)
    .args(0, 0.12, 1);
  if (live < 1) return;
  for (let i = perFrame(fx, 10 * AURA.reach * enemy.radius); i > 0; i--) {
    const angle = rand(0, Math.PI * 2);
    const d = Math.sqrt(Math.random()) * r * 0.85;
    fx.sprites.emit(
      smog,
      x + Math.cos(angle) * d,
      ground + rand(0.1, 0.5),
      z + Math.sin(angle) * d,
      rand(-0.15, 0.15),
      rand(0.05, 0.2),
      rand(-0.15, 0.15),
      rand(0.25, 0.45),
    );
  }
}

/** Gastly's gas body: its model's gas disc vanishes edge-on, so the view wraps it in a cloud. */
function ghostGas(fx: Fx, enemy: Enemy, x: number, y: number, z: number): void {
  const h = enemyHeight(enemy);
  fx.sprites.draw(gasHalo, x, y, z, h * 0.6);
  for (let i = perFrame(fx, 5); i > 0; i--) {
    const angle = rand(0, Math.PI * 2);
    fx.sprites.emit(
      ghostMote,
      x + Math.cos(angle) * h * 0.4,
      y + rand(-0.2, 0.2) * h,
      z + Math.sin(angle) * h * 0.4,
      Math.cos(angle) * 0.25,
      rand(0, 0.2),
      Math.sin(angle) * 0.25,
      h * rand(0.12, 0.2),
    );
  }
}

/** Per-enemy looks that follow the body: gas rings and Gastly's gas. */
export function zoneBodies(fx: Fx, world: World, alpha: number): void {
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue;
    const def = enemies[enemy.species];
    const isAura = def.skill?.kind === "aura" || def.skill?.kind === "fire-aura";
    if (!isAura && enemy.species !== "gastly") continue;
    const x = enemy.px + (enemy.x - enemy.px) * alpha;
    const z = enemy.pz + (enemy.z - enemy.pz) * alpha;
    if (isAura) gasRing(fx, enemy, x, z, fx.ground.heightAt(x, z));
    else ghostGas(fx, enemy, x, enemyFeet(world.map.terrain, enemy) + enemyHeight(enemy) * 0.5, z);
  }
}

/** One heal pulse: a green ring growing out to the healed radius on the player ground layer. */
export interface Mend {
  x: number;
  z: number;
  age: number;
}
export const MEND_SECONDS = 0.55;

export function mendRing(fx: Fx, mend: Mend): void {
  const t = Math.min(1, mend.age / MEND_SECONDS);
  const fade = 1 - t * t;
  fx.decals
    .put(Decal.ring, mend.x, mend.z, HEAL_PULSE.radius)
    .tint(grass.leaf, 0.85 * fade, grass.light, 0.3)
    .args(t, 0.12, 0.15);
  if (mend.age === 0) {
    const y = fx.ground.heightAt(mend.x, mend.z) + 0.6;
    spray(fx, mendStar, mend.x, y, mend.z, 6, 1.2, 1.2, 0.14);
  }
}

/** Exeggcute's egg in flight, with every ring it will blast already marked on the ground. */
export function eggHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const landX = hazard.x + hazard.vx * hazard.life;
  const landZ = hazard.z + hazard.vz * hazard.life;
  fx.danger
    .put(Decal.telegraph, landX, landZ, EGG.blast, 0, hazard.id * 0.618)
    .tint(fire.orange, 0.95, danger.deep, 0)
    .args(1 - hazard.life / EGG.flight);
  fx.sprites.draw(eggHalo, x, y, z, hazard.radius * 2.2);
  fx.sprites.draw(egg, x, y, z, hazard.radius);
}

/** The blast it leaves: a fast orange ring and smoke, gone within a third of a second. */
export function eggBlastHazard(fx: Fx, hazard: Hazard, fresh: boolean): void {
  const fade = Math.max(0, hazard.life / EGG.residue);
  fx.danger
    .put(Decal.ring, hazard.x, hazard.z, hazard.radius)
    .tint(fire.orange, fade, danger.deep, 0)
    .args(1 - fade, 0.3);
  if (fresh)
    spray(fx, blastPuff, hazard.x, hazard.y + 0.2, hazard.z, 9, hazard.radius * 2.4, 1.6, 0.3);
}

/** Tangela's vines: a green lane that fills during the charge, then the lash. */
export function vineHazard(
  fx: Fx,
  hazard: Hazard,
  x: number,
  y: number,
  z: number,
  charge: number,
): void {
  const yaw = Math.atan2(hazard.dirX, hazard.dirZ);
  const w = hazard.radius;
  if (charge < 1) {
    fx.danger
      .put(Decal.danger, x, z, hazard.length, yaw)
      .rect(-w * 1.2, 0, w * 1.2, hazard.length)
      .tint(grass.leaf, 1, grass.deep, 0)
      .args(charge, w);
    return;
  }
  fx.danger
    .put(Decal.strip, x, z, hazard.length, yaw)
    .rect(-w * 1.4, 0, w * 1.4, hazard.length)
    .tint(grass.leaf, 0.95, grass.light, 1)
    .args(0, w, 2);
  const steps = Math.ceil(hazard.length / 0.9);
  for (let i = 0; i <= steps; i++) {
    const along = (i / steps) * hazard.length;
    fx.sprites.draw(
      vineGlow,
      x + hazard.dirX * along,
      y + hazard.rise * along,
      z + hazard.dirZ * along,
      w * 1.4,
      0.7,
    );
  }
}

/** Nidoking's fissure: a red ground lane filling outward, then a crack with dust along it. */
export function fissureHazard(fx: Fx, hazard: Hazard, charge: number): void {
  const yaw = Math.atan2(hazard.dirX, hazard.dirZ);
  const w = hazard.radius;
  if (hazard.life > FISSURE.active) {
    fx.danger
      .put(Decal.danger, hazard.x, hazard.z, hazard.length, yaw)
      .rect(-w * 1.1, 0, w * 1.1, hazard.length)
      .tint(danger.red, 1, danger.deep, 0)
      .args(charge, w);
    return;
  }
  const fade = Math.max(0, hazard.life / FISSURE.active);
  fx.danger
    .put(Decal.strip, hazard.x, hazard.z, hazard.length, yaw)
    .rect(-w, 0, w, hazard.length)
    .tint(stone.dark, fade, danger.red, 0)
    .args(0, w, 2);
  for (let i = perFrame(fx, 40); i > 0; i--) {
    const along = rand(0, hazard.length);
    const dx = hazard.x + hazard.dirX * along;
    const dz = hazard.z + hazard.dirZ * along;
    fx.sprites.emit(dust, dx, fx.ground.heightAt(dx, dz) + 0.1, dz, 0, rand(0.6, 1.4), 0, 0.3);
  }
}

/** Nidoking's stomp: its whole circle fills red, then one ring of dust. */
export function stompHazard(fx: Fx, hazard: Hazard, charge: number, fresh: boolean): void {
  if (hazard.dmg > 0) {
    fx.danger
      .put(Decal.telegraph, hazard.x, hazard.z, hazard.radius, 0, hazard.id * 0.618)
      .tint(danger.red, 0.95, danger.deep, 0)
      .args(charge);
    return;
  }
  const fade = Math.max(0, hazard.life / STOMP.active);
  fx.danger
    .put(Decal.ring, hazard.x, hazard.z, hazard.radius)
    .tint(danger.red, fade, danger.deep, 0)
    .args(1 - fade, 0.2);
  if (fresh) spray(fx, dust, hazard.x, hazard.y + 0.1, hazard.z, 14, hazard.radius * 2, 1.4, 0.4);
}

/** Pinsir's rock shard: a tumbling stone with its lane painted ahead (the Air Slash read, in stone). */
export function shardHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const yaw = Math.atan2(hazard.vx, hazard.vz);
  const w = hazard.radius;
  fx.danger
    .put(Decal.danger, x, z, 1, yaw)
    .rect(-w * 1.1, -0.2, w * 1.1, 1.1)
    .tint(danger.red, 0.5, danger.deep, 0)
    .args(1, w);
  fx.sprites.draw(shard, x, y, z, w * 1.5, 1, hazard.vx, hazard.vz, 6, hazard.id);
}

/** Poliwag's bubble: the spore's read (slow ball, ring beneath) in water colours, without the poison purple. */
export function bubbleHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  fx.danger
    .put(Decal.ring, x, z, hazard.radius * 1.6)
    .tint(water.mid, 0.9, water.dark, 0)
    .args(0, 0.3, 1);
  fx.sprites.draw(bubbleHalo, x, y, z, hazard.radius * 2.2);
  fx.sprites.draw(bubble, x, y, z, hazard.radius * 1.3);
}
