import type { Hazard } from "../../sim/state/entities";
import { Decal } from "./decals";
import { perFrame, rand, spray, type Fx } from "./fx";
import { danger, gold, poison, white, wind } from "./palette";
import { Shape, sprite } from "./sprites";

const hitFlash = sprite({
  shape: Shape.star,
  life: 0.12,
  grow: 1.4,
  from: white,
  accent: white,
  add: 1,
  spin: 2,
});
const chip = sprite({
  shape: Shape.spark,
  life: 0.22,
  grow: 0.4,
  from: white,
  accent: white,
  add: 1,
  gravity: 8,
  drag: 2,
  stretch: 0.04,
});
const critFlash = sprite({
  shape: Shape.star,
  life: 0.22,
  grow: 1.8,
  from: gold.yellow,
  accent: white,
  add: 1,
  spin: 3,
});
const critRing = sprite({
  shape: Shape.ring,
  life: 0.24,
  grow: 2.4,
  from: gold.yellow,
  accent: white,
  add: 0.8,
});
const goldSpark = sprite({
  shape: Shape.spark,
  life: 0.5,
  grow: 0.4,
  from: gold.yellow,
  to: gold.deep,
  accent: white,
  add: 1,
  gravity: 9,
  drag: 1.2,
  stretch: 0.04,
});
const poof = sprite({
  shape: Shape.puff,
  life: 0.55,
  grow: 1.9,
  from: white,
  to: wind.cream,
  accent: wind.dust,
  drag: 4,
  gravity: -1.2,
  spin: 1,
});
const twinkle = sprite({
  shape: Shape.star,
  life: 0.5,
  grow: 0.3,
  from: gold.white,
  accent: white,
  add: 1,
  gravity: -1,
  drag: 2,
  spin: 4,
});
const rise = sprite({
  shape: Shape.star,
  life: 0.9,
  grow: 0.4,
  from: gold.yellow,
  to: gold.white,
  accent: white,
  add: 1,
  gravity: -3.5,
  drag: 1.5,
  spin: 3,
});
const hurt = sprite({
  shape: Shape.star,
  life: 0.2,
  grow: 1.6,
  from: danger.red,
  accent: danger.pale,
  add: 0.6,
  spin: 2,
});
const hurtRing = sprite({
  shape: Shape.ring,
  life: 0.25,
  grow: 2.2,
  from: danger.red,
  accent: danger.pale,
  add: 0.3,
});
const kick = sprite({
  shape: Shape.cloud,
  life: 0.45,
  grow: 1.6,
  from: wind.cream,
  to: wind.dust,
  accent: wind.white,
  alpha: 0.8,
  drag: 4,
  gravity: -0.6,
  spin: 1,
});
const streak = sprite({
  shape: Shape.spark,
  life: 0.2,
  grow: 0.5,
  from: white,
  accent: white,
  alpha: 0.8,
  add: 0.7,
  stretch: 0.05,
});

const spore = sprite({ shape: Shape.ball, from: poison.purple, accent: poison.deep });
const sporeHalo = sprite({
  shape: Shape.glow,
  from: poison.purple,
  accent: poison.light,
  alpha: 0.6,
  add: 0.6,
});
const sporeTrail = sprite({
  shape: Shape.cloud,
  life: 0.45,
  grow: 0.4,
  from: poison.light,
  to: poison.purple,
  accent: poison.deep,
  alpha: 0.6,
});
const blade = sprite({ shape: Shape.crescent, from: danger.pale, accent: danger.red, stretch: -1 });
const bladeHalo = sprite({
  shape: Shape.glow,
  from: danger.red,
  accent: danger.pale,
  alpha: 0.55,
  add: 0.7,
});

/** Generic contact flash; move-specific impacts come from the move's own look. */
export function hit(fx: Fx, x: number, z: number, crit: boolean): void {
  const y = fx.ground.heightAt(x, z) + 0.7;
  if (crit) {
    fx.sprites.emit(critFlash, x, y, z, 0, 0, 0, 0.85);
    fx.sprites.emit(critRing, x, y, z, 0, 0, 0, 0.5);
    spray(fx, goldSpark, x, y, z, 8, 6, 5, 0.1);
    return;
  }
  // Area ticks hit dozens at once: drop optional sparkle when the pool runs hot.
  if (fx.sprites.load > 0.8) return;
  fx.sprites.emit(hitFlash, x, y, z, 0, 0, 0, 0.42);
  spray(fx, chip, x, y, z, 2, 4, 3, 0.07);
}

export function death(fx: Fx, x: number, z: number, elite: boolean): void {
  const y = fx.ground.heightAt(x, z) + 0.45;
  // Kills come in crowds: a small poof each, so dozens of them don't wall off the field.
  spray(fx, poof, x, y, z, elite ? 8 : 3, elite ? 2.6 : 1.8, 1.2, elite ? 0.5 : 0.32);
  spray(fx, twinkle, x, y + 0.3, z, 3, 2, 2, 0.16);
  if (!elite) return;
  spray(fx, goldSpark, x, y, z, 16, 7, 6, 0.12);
  fx.decals.stamp(Decal.ring, x, z, 2.2, 0.5, gold.yellow, 1, gold.white, 0.8, 0.2, 0.2);
}

/**
 * A player fainted: their body bursts into a ring of inked smoke where it stood (the enemy poof, a body
 * bigger), with stars rising off it. Placed over the body's volume at birth, so its first frame already
 * reads: a solo defeat freezes the world on that frame under the result window.
 */
export function faint(fx: Fx, x: number, z: number, radius: number, height: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.decals.stamp(Decal.ring, x, z, radius * 3, 0.6, white, 0.9, wind.cream, 0.5, 0.18, 0.4);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
    const d = radius * rand(0.3, 0.9);
    const up = height * rand(0.15, 0.85);
    fx.sprites.emit(
      poof,
      x + Math.cos(a) * d,
      h + up,
      z + Math.sin(a) * d,
      Math.cos(a) * rand(1, 2),
      rand(0.3, 1),
      Math.sin(a) * rand(1, 2),
      Math.max(0.35, height * 0.35) * rand(0.85, 1.15),
      h,
    );
  }
  for (let i = 0; i < 5; i++) {
    const a = rand(0, Math.PI * 2);
    fx.sprites.emit(
      twinkle,
      x + Math.cos(a) * radius * 0.6,
      h + height * rand(0.8, 1.2),
      z + Math.sin(a) * radius * 0.6,
      Math.cos(a) * 0.6,
      rand(1.5, 2.5),
      Math.sin(a) * 0.6,
      rand(0.16, 0.22),
    );
  }
}

export function dash(fx: Fx, x: number, z: number, dirX: number, dirZ: number): void {
  const h = fx.ground.heightAt(x, z);
  for (let i = 0; i < 5; i++) {
    fx.sprites.emit(
      kick,
      x - dirX * 0.3 + rand(-0.3, 0.3),
      h + 0.15,
      z - dirZ * 0.3 + rand(-0.3, 0.3),
      -dirX * rand(1, 3),
      rand(0.3, 1),
      -dirZ * rand(1, 3),
      rand(0.25, 0.4),
      h,
    );
  }
  for (let i = 0; i < 6; i++) {
    fx.sprites.emit(
      streak,
      x + rand(-0.4, 0.4),
      h + rand(0.2, 1),
      z + rand(-0.4, 0.4),
      -dirX * 10,
      0,
      -dirZ * 10,
      0.12,
    );
  }
}

export function levelUp(fx: Fx, x: number, z: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.decals.stamp(Decal.ring, x, z, 2.4, 0.7, gold.yellow, 1, gold.white, 0.8, 0.2, 0.1);
  fx.decals.stamp(Decal.glow, x, z, 1.8, 0.6, gold.yellow, 0.8, gold.white, 1);
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(0.3, 1.2);
    fx.sprites.emit(
      rise,
      x + Math.cos(a) * d,
      h + rand(0.1, 0.8),
      z + Math.sin(a) * d,
      Math.cos(a) * 0.5,
      rand(1.5, 3.5),
      Math.sin(a) * 0.5,
      rand(0.14, 0.26),
    );
  }
}

export function playerHurt(fx: Fx, x: number, z: number): void {
  const y = fx.ground.heightAt(x, z) + 0.7;
  fx.sprites.emit(hurt, x, y, z, 0, 0, 0, 0.8);
  fx.sprites.emit(hurtRing, x, y, z, 0, 0, 0, 0.6);
}

/** Enemy spore: inked purple glob with a ground marker so its line is readable among player effects. */
export function sporeHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const pulse = 1 + 0.12 * Math.sin(fx.time * 10 + hazard.id);
  fx.danger
    .put(Decal.ring, x, z, hazard.radius * 1.6)
    .tint(poison.purple, 0.9, poison.deep, 0)
    .args(0, 0.3, 1);
  fx.sprites.draw(sporeHalo, x, y, z, hazard.radius * 2.2 * pulse);
  fx.sprites.draw(spore, x, y, z, hazard.radius * 1.3);
  for (let i = perFrame(fx, 10); i > 0; i--)
    fx.sprites.emit(sporeTrail, x, y, z, rand(-0.15, 0.15), rand(0, 0.2), rand(-0.15, 0.15), 0.08);
}

/** Scyther's Air Slash: a red-rimmed blade with its lane painted ahead of it. */
export function slashHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const yaw = Math.atan2(hazard.vx, hazard.vz);
  const w = hazard.radius;
  fx.danger
    .put(Decal.danger, x, z, 1, yaw)
    .rect(-w * 1.1, -0.2, w * 1.1, 1.1)
    .tint(danger.red, 0.5, danger.deep, 0)
    .args(1, w);
  fx.sprites.draw(bladeHalo, x, y, z, w * 2.4);
  fx.sprites.draw(blade, x, y, z, w * 1.6, 1, hazard.vx, hazard.vz);
}

/**
 * The guardian's Air Slash wind-up: one lane per blade from where it stands, as wide as the blade and as
 * long as it flies (`reach`), filling outward as the wind-up runs out (t 0 → 1). Cover may stop a blade
 * sooner; like the dash lane, the marker shows the full flight.
 */
export function airSlashWarn(
  fx: Fx,
  x: number,
  z: number,
  blades: number,
  width: number,
  reach: number,
  t: number,
): void {
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI * 2;
    fx.danger
      .put(Decal.danger, x, z, reach, Math.atan2(Math.cos(angle), Math.sin(angle)))
      .rect(-width * 1.1, 0, width * 1.1, reach + 0.3)
      .tint(danger.red, 0.9, danger.deep, 0)
      .args(t, width);
  }
}

/** A shot or hazard that flew into the terrain: a puff of dirt on the slope. */
export function impact(fx: Fx, x: number, y: number, z: number): void {
  spray(fx, kick, x, y + 0.1, z, 4, 1.6, 1.2, 0.3);
}

/** Boss dash lane: fills toward the far end as the wind-up runs out (t 0 → 1). */
export function dashWarnHazard(fx: Fx, hazard: Hazard, x: number, z: number, t: number): void {
  const w = hazard.radius;
  fx.danger
    .put(Decal.danger, x, z, hazard.length, Math.atan2(hazard.dirX, hazard.dirZ))
    .rect(-w * 1.1, -0.3, w * 1.1, hazard.length + 0.3)
    .tint(danger.red, 1, danger.deep, 0)
    .args(t, w);
}
