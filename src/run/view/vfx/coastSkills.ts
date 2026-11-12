// Looks for the coast's attacks (docs/state-machines/simulation.md): Kingler's Crabhammer circle, Gyarados's
// Hydro Pump band and twisters, Starmie's thunderbolt circles, and Tentacool's translucent jelly.
// Telegraphs go on the danger layer and fill as their wind-up runs out (red: they are the guardians').

import { HYDRO_PUMP, TWISTER } from "../../sim/content/params/guardian";
import { ROCKFALL } from "../../sim/content/params/enemy-skills";
import { enemyFeet, enemyHeight } from "../../sim/sight";
import type { World } from "../../sim/state/world";
import type { Hazard } from "../../sim/state/entities";
import { Decal } from "./decals";
import { perFrame, rand, spray, type Fx } from "./fx";
import { danger, electric, water, white } from "./palette";
import { Shape, sprite } from "./sprites";

const splash = sprite({
  shape: Shape.drop,
  life: 0.5,
  grow: 0.8,
  from: water.light,
  to: water.mid,
  accent: water.dark,
  drag: 1.5,
  gravity: 9,
});
const foam = sprite({
  shape: Shape.cloud,
  life: 0.45,
  grow: 1.5,
  from: water.foam,
  to: water.light,
  accent: water.mid,
  alpha: 0.7,
  drag: 2,
  gravity: -0.4,
});
const spray3 = sprite({
  shape: Shape.cloud,
  life: 0.7,
  grow: 1.4,
  from: water.light,
  to: water.foam,
  accent: water.mid,
  alpha: 0.55,
  drag: 1,
  gravity: -1.2,
});
const bolt = sprite({
  shape: Shape.spark,
  from: electric.yellow,
  accent: electric.white,
  stretch: -1,
});
const boltGlow = sprite({ shape: Shape.glow, from: electric.yellow, accent: white, add: 0.8 });
const jelly = sprite({
  shape: Shape.glow,
  from: water.light,
  accent: water.foam,
  alpha: 0.38,
  add: 0.25,
});
const jellyBubble = sprite({
  shape: Shape.bubble,
  life: 0.9,
  grow: 1.2,
  from: water.foam,
  to: water.light,
  accent: water.mid,
  alpha: 0.6,
  drag: 2,
  gravity: -0.8,
});

/** A guardian's struck circle (Crabhammer, a thunderbolt): red fill while it charges, then a fading rim. */
function strikeRing(fx: Fx, hazard: Hazard, charge: number): number {
  if (hazard.dmg > 0) {
    fx.danger
      .put(Decal.telegraph, hazard.x, hazard.z, hazard.radius, 0, hazard.id * 0.618)
      .tint(danger.red, 0.95, danger.deep, 0)
      .args(charge);
    return -1;
  }
  const fade = Math.max(0, hazard.life / ROCKFALL.residue);
  fx.danger
    .put(Decal.ring, hazard.x, hazard.z, hazard.radius)
    .tint(danger.red, fade, danger.deep, 0)
    .args(1 - fade, 0.22);
  return fade;
}

/** Kingler's claw: the circle in front of it, then a burst of spray where the claw lands. */
export function crabhammerHazard(fx: Fx, hazard: Hazard, charge: number, fresh: boolean): void {
  strikeRing(fx, hazard, charge);
  if (fresh)
    spray(fx, splash, hazard.x, hazard.y + 0.2, hazard.z, 18, hazard.radius * 2.2, 3, 0.18);
}

/** Starmie's thunderbolt: a circle on the player's spot; the bolt drops in its last third. */
export function thunderBoltHazard(fx: Fx, hazard: Hazard, charge: number, fresh: boolean): void {
  const fade = strikeRing(fx, hazard, charge);
  const top = hazard.y + 7;
  if (fade < 0) {
    if (charge > 0.66) fx.sprites.draw(boltGlow, hazard.x, top, hazard.z, 0.4 + charge * 0.4, 0.8);
    return;
  }
  // The strike: a column of sparks from the sky to the circle, fading with the residue.
  for (let i = 0; i < 6; i++) {
    const y = hazard.y + (i / 5) * (top - hazard.y);
    fx.sprites.draw(bolt, hazard.x + rand(-0.12, 0.12), y, hazard.z, 0.6 * fade, fade, 0, 1);
  }
  fx.sprites.draw(boltGlow, hazard.x, hazard.y + 0.3, hazard.z, hazard.radius * fade, fade);
  if (fresh) spray(fx, bolt, hazard.x, hazard.y + 0.1, hazard.z, 10, hazard.radius * 2, 1.5, 0.2);
}

/** Gyarados's Hydro Pump: a wide red lane while it charges, then a water column along it. */
export function hydroPumpHazard(
  fx: Fx,
  hazard: Hazard,
  x: number,
  y: number,
  z: number,
  windup: number,
): void {
  const yaw = Math.atan2(hazard.dirX, hazard.dirZ);
  const w = hazard.radius;
  if (hazard.life > HYDRO_PUMP.active) {
    const charge = 1 - (hazard.life - HYDRO_PUMP.active) / windup;
    fx.danger
      .put(Decal.danger, x, z, hazard.length, yaw)
      .rect(-w, 0, w, hazard.length)
      .tint(danger.red, 0.95, danger.deep, 0)
      .args(charge, w);
    return;
  }
  fx.danger
    .put(Decal.strip, x, z, hazard.length, yaw)
    .rect(-w, 0, w, hazard.length)
    .tint(water.mid, 0.95, water.foam, 1)
    .args(0, w, 1);
  for (let i = perFrame(fx, 60); i > 0; i--) {
    const along = rand(0, hazard.length);
    const side = rand(-w, w) * 0.7;
    fx.sprites.emit(
      foam,
      x + hazard.dirX * along + hazard.dirZ * side,
      y + hazard.rise * along + rand(-0.2, 0.2),
      z + hazard.dirZ * along - hazard.dirX * side,
      hazard.dirX * 3,
      rand(0, 0.6),
      hazard.dirZ * 3,
      rand(0.25, 0.45),
    );
  }
}

/** A twister: a spinning water whirl on the ground with spray rising off it; it bursts on contact. */
export function twisterHazard(fx: Fx, hazard: Hazard, fresh: boolean): void {
  // On the water's surface when it crosses the sea (the sim keeps the bed height).
  const y = fx.ground.heightAt(hazard.x, hazard.z);
  const armed = TWISTER.life - hazard.life >= TWISTER.arm;
  const alpha = hazard.dmg > 0 ? (armed ? 0.9 : 0.5) : Math.max(0, hazard.life / ROCKFALL.residue);
  fx.danger
    .put(Decal.whirl, hazard.x, hazard.z, hazard.radius, -fx.time * 7, hazard.id)
    .tint(water.mid, alpha, danger.red, 0);
  if (hazard.dmg <= 0) {
    if (fresh) spray(fx, splash, hazard.x, y + 0.3, hazard.z, 14, hazard.radius * 2, 3, 0.16);
    return;
  }
  for (let i = perFrame(fx, 16); i > 0; i--) {
    const angle = rand(0, Math.PI * 2);
    const d = hazard.radius * rand(0.3, 0.9);
    fx.sprites.emit(
      spray3,
      hazard.x + Math.cos(angle) * d,
      y + rand(0.1, 0.6),
      hazard.z + Math.sin(angle) * d,
      -Math.sin(angle) * 2.5,
      rand(1, 2.2),
      Math.cos(angle) * 2.5,
      rand(0.2, 0.35),
    );
  }
}

/** Tentacool's body is opaque low poly; the view wraps it in a faint translucent jelly with a few bubbles. */
export function coastBodies(fx: Fx, world: World, alpha: number): void {
  for (const enemy of world.enemies) {
    if (enemy.hp <= 0 || enemy.species !== "tentacool") continue;
    const x = enemy.px + (enemy.x - enemy.px) * alpha;
    const z = enemy.pz + (enemy.z - enemy.pz) * alpha;
    const h = enemyHeight(enemy);
    const y = enemyFeet(world.map.terrain, enemy) + h * 0.55;
    fx.sprites.draw(jelly, x, y, z, h * 0.62);
    for (let i = perFrame(fx, 2); i > 0; i--)
      fx.sprites.emit(
        jellyBubble,
        x + rand(-0.3, 0.3) * h,
        y + rand(-0.2, 0.2) * h,
        z + rand(-0.3, 0.3) * h,
        0,
        rand(0.2, 0.4),
        0,
        h * rand(0.06, 0.1),
      );
  }
}
