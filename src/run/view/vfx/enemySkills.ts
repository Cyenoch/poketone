// Looks for the swarm's telegraphed attacks (sim/skills/). Telegraphs go on the danger layer,
// drawn over every player effect; each fills as its wind-up runs out. Dives and rolls reuse the
// guardian's dash lane (common.dashWarnHazard).

import {
  ACID,
  PSYBEAM,
  RADIAL,
  ENEMY_SHOTS,
  STUN_SPORE,
} from "../../sim/content/params/enemy-skills";

import { warnOf, type ShotKind } from "../../sim/skills/shot";

import { enemies } from "../../sim/content/enemies";
import { enemyFeet, enemyHeight } from "../../sim/sight";
import { interrupted } from "../../sim/status";
import type { World } from "../../sim/state/world";
import type { Hazard } from "../../sim/state/entities";
import { Decal } from "./decals";
import { perFrame, rand, type Fx } from "./fx";
import { rgb } from "./gl";
import { danger, electric, fire, gold, poison, powder, stone, water, white } from "./palette";
import { Shape, sprite } from "./sprites";

const acidGreen = poison.light;
const glob = sprite({ shape: Shape.ball, from: poison.purple, accent: poison.deep });
const globHalo = sprite({
  shape: Shape.glow,
  from: acidGreen,
  accent: poison.purple,
  alpha: 0.5,
  add: 0.5,
});
const bubble = sprite({
  shape: Shape.bubble,
  life: 0.6,
  grow: 1.3,
  from: poison.light,
  accent: poison.deep,
  gravity: -1.5,
  alpha: 0.8,
});
const sporeMote = sprite({
  shape: Shape.cloud,
  life: 0.9,
  grow: 1.6,
  from: gold.white,
  to: gold.yellow,
  accent: gold.deep,
  alpha: 0.55,
  drag: 2,
  gravity: -0.4,
});
const beamGlow = sprite({ shape: Shape.glow, from: powder.pink, accent: white, add: 0.8 });
const iceGlow = sprite({ shape: Shape.glow, from: water.light, accent: white, add: 0.55 });
const fireGlow = sprite({ shape: Shape.glow, from: fire.orange, accent: fire.yellow, add: 0.55 });
const ember = sprite({ shape: Shape.flame, from: fire.orange, accent: fire.deep, stretch: -1 });
const spark = sprite({
  shape: Shape.spark,
  from: electric.yellow,
  accent: danger.deep,
  stretch: -1,
});
/**
 * Hitbox-sized shots over dark grass read by value and silhouette, not size: an inked head with a bright
 * core (as wide as the hitbox, longer along the flight), a soft halo, a streak behind it for direction and
 * a ring on the ground beneath.
 */
const sting = {
  color: poison.purple,
  rim: poison.deep,
  head: sprite({ shape: Shape.needle, from: poison.purple, accent: poison.light, stretch: -1 }),
  headSize: 2.8,
  halo: globHalo,
  streak: sprite({
    shape: Shape.spark,
    from: poison.purple,
    accent: poison.light,
    stretch: 0.07,
  }),
};
const shotLooks = {
  icicle: {
    color: water.light,
    rim: water.dark,
    head: sprite({ shape: Shape.needle, from: water.foam, accent: water.mid, stretch: -1 }),
    headSize: 2.8,
    halo: sprite({ shape: Shape.glow, from: water.light, accent: white, alpha: 0.3 }),
    streak: sprite({ shape: Shape.spark, from: water.light, accent: white, stretch: 0.07 }),
  },
  flamethrower: {
    color: fire.orange,
    rim: fire.deep,
    head: sprite({ shape: Shape.flame, from: fire.orange, accent: fire.core, add: 0.4 }),
    headSize: 1.5,
    halo: sprite({ shape: Shape.glow, from: fire.orange, accent: fire.yellow, alpha: 0.4 }),
    streak: sprite({ shape: Shape.spark, from: fire.orange, accent: fire.yellow, stretch: 0.07 }),
  },
  "poison-sting": sting,
  ember: {
    color: fire.orange,
    rim: danger.deep,
    // Upright: the flame burns up while the streak carries the heading.
    head: sprite({ shape: Shape.flame, from: fire.orange, accent: fire.core, add: 0.6 }),
    headSize: 1.4,
    halo: sprite({
      shape: Shape.glow,
      from: fire.orange,
      accent: fire.yellow,
      alpha: 0.5,
      add: 0.6,
    }),
    streak: sprite({ shape: Shape.spark, from: fire.orange, accent: fire.yellow, stretch: 0.07 }),
  },
  "thunder-shock": {
    color: electric.yellow,
    rim: danger.deep,
    head: sprite({
      shape: Shape.spark,
      from: electric.yellow,
      accent: electric.white,
      stretch: -1,
    }),
    headSize: 2.2,
    halo: sprite({
      shape: Shape.glow,
      from: electric.yellow,
      accent: electric.white,
      alpha: 0.5,
      add: 0.6,
    }),
    streak: sprite({
      shape: Shape.spark,
      from: electric.yellow,
      accent: electric.white,
      stretch: 0.07,
    }),
  },
  // Nidorina's fan shares the sting's look.
  "poison-fan": sting,
  // Meowth's coin: a gold disc, its glint the streak.
  "pay-day": {
    color: gold.yellow,
    rim: gold.deep,
    head: sprite({ shape: Shape.ball, from: gold.yellow, accent: gold.white }),
    headSize: 1.2,
    halo: sprite({
      shape: Shape.glow,
      from: gold.yellow,
      accent: gold.white,
      alpha: 0.5,
      add: 0.6,
    }),
    streak: sprite({ shape: Shape.spark, from: gold.yellow, accent: gold.white, stretch: 0.07 }),
  },
  // Omastar's spikes: stone needles.
  "spike-cannon": {
    color: stone.light,
    rim: danger.deep,
    head: sprite({ shape: Shape.needle, from: stone.light, accent: white, stretch: -1 }),
    headSize: 2.8,
    halo: sprite({ shape: Shape.glow, from: stone.light, accent: white, alpha: 0.4, add: 0.4 }),
    streak: sprite({ shape: Shape.spark, from: stone.light, accent: white, stretch: 0.07 }),
  },
  // Seadra's water gun: a fat water drop with a foam streak.
  "water-gun": {
    color: water.mid,
    rim: water.dark,
    head: sprite({ shape: Shape.ball, from: water.light, accent: water.foam }),
    headSize: 1.3,
    halo: sprite({ shape: Shape.glow, from: water.mid, accent: water.light, alpha: 0.5, add: 0.5 }),
    streak: sprite({ shape: Shape.spark, from: water.light, accent: water.foam, stretch: 0.07 }),
  },
  // Jolteon's pins: thin yellow needles.
  "pin-missile": {
    color: electric.yellow,
    rim: danger.deep,
    head: sprite({ shape: Shape.needle, from: electric.yellow, accent: white, stretch: -1 }),
    headSize: 2.8,
    halo: sprite({
      shape: Shape.glow,
      from: electric.yellow,
      accent: white,
      alpha: 0.4,
      add: 0.5,
    }),
    streak: sprite({ shape: Shape.spark, from: electric.yellow, accent: white, stretch: 0.07 }),
  },
} satisfies Record<ShotKind, unknown>;

/** The shot each wind-up lane fires. */
const shotOfWarn = Object.fromEntries(
  Object.entries(warnOf).map(([shot, warn]) => [warn, shot]),
) as Record<(typeof warnOf)[ShotKind], ShotKind>;

const shell = sprite({ shape: Shape.ring, from: stone.light, accent: white, alpha: 0.6 });
const shellShield = sprite({ shape: Shape.bubble, from: water.light, accent: white, alpha: 0.36 });
const shellFlash = sprite({ shape: Shape.star, from: white, accent: water.light, alpha: 0.7 });

/** Fixed lanes match the heading locked by the caster at the beginning of its wind-up. */
export function shotWarn(fx: Fx, hazard: Hazard, x: number, z: number): void {
  const casterKind = shotOfWarn[hazard.kind as keyof typeof shotOfWarn];
  const color = shotLooks[casterKind].color;
  const charge = 1 - hazard.life / ENEMY_SHOTS[casterKind].windup;
  const w = hazard.radius;
  fx.danger
    .put(Decal.danger, x, z, hazard.length, Math.atan2(hazard.dirX, hazard.dirZ))
    .rect(-w, 0, w, hazard.length)
    .tint(color, 0.9, danger.deep, 0)
    .args(charge, w);
}

export function shotHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const kind = hazard.kind as keyof typeof ENEMY_SHOTS;
  const look = shotLooks[kind];
  const r = hazard.radius;
  // The streak sits half a metre behind the head and grows out of the mouth over its first 0.15 s.
  const back = 0.5 / (Math.hypot(hazard.vx, hazard.vz) || 1);
  const tail = Math.min(1, (ENEMY_SHOTS[kind].life - hazard.life) / 0.15);
  fx.danger
    .put(Decal.ring, x, z, r * 1.6)
    .tint(look.color, 0.9, look.rim, 0)
    .args(0, 0.3, 1);
  fx.sprites.draw(look.halo, x, y, z, r * 2.6);
  fx.sprites.draw(
    look.streak,
    x - hazard.vx * back,
    y,
    z - hazard.vz * back,
    r * 0.6,
    tail,
    hazard.vx,
    hazard.vz,
  );
  fx.sprites.draw(look.head, x, y, z, r * look.headSize, 1, hazard.vx, hazard.vz);
}

const electricRing = (kind: keyof typeof RADIAL) =>
  kind === "discharge" || kind === "discharge-wide" || kind === "discharge-quick";
/** Dragonair's ring: dragon violet-blue, not a warning red. */
const dragon = rgb("#7a5cff");
const dragonSpark = sprite({ shape: Shape.spark, from: dragon, accent: white, stretch: -1 });
const songNote = sprite({ shape: Shape.note, from: powder.pink, accent: powder.mist });

/** The whole circle is marked before the single hit; the active rim collapses without flashing. */
export function radialHazard(fx: Fx, hazard: Hazard, x: number, z: number): void {
  const kind = hazard.kind as keyof typeof RADIAL;
  const pulse = RADIAL[kind];
  const charging = hazard.life > pulse.active;
  const charge = 1 - (hazard.life - pulse.active) / pulse.windup;
  const singing = kind === "sing" || kind === "sing-wide";
  const dragonKind = kind === "dragon-rage" || kind === "dragon-pulse";
  const color = singing
    ? powder.pink
    : electricRing(kind)
      ? electric.yellow
      : dragonKind
        ? dragon
        : danger.red;
  if (charging) {
    fx.danger
      .put(Decal.telegraph, x, z, hazard.radius, 0, hazard.id * 0.618)
      .tint(color, 0.95, danger.deep, 0)
      .args(charge);
    if (singing)
      for (let i = 0; i < 3; i++) {
        const a = fx.time * 0.8 + (i * Math.PI * 2) / 3;
        fx.sprites.draw(
          songNote,
          x + Math.cos(a) * hazard.radius * 0.55,
          fx.ground.heightAt(x, z) + 0.7 + Math.sin(a * 2) * 0.15,
          z + Math.sin(a) * hazard.radius * 0.55,
          0.24,
          0.75,
        );
      }
    return;
  }
  const fade = Math.max(0, hazard.life / pulse.active);
  fx.danger.put(Decal.ring, x, z, hazard.radius).tint(color, fade, danger.deep, 0).args(0, 0.2);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    fx.sprites.draw(
      singing ? songNote : electricRing(kind) ? spark : dragonKind ? dragonSpark : ember,
      x + Math.cos(a) * hazard.radius * (1 - fade * 0.3),
      fx.ground.heightAt(x, z) + 0.4,
      z + Math.sin(a) * hazard.radius * (1 - fade * 0.3),
      0.12 * fade,
      fade,
      Math.cos(a),
      Math.sin(a),
    );
  }
}

/** Harden changes the body read; Flame Charge (and Rapidash's trail) keeps a flame on its dashing caster. */
export function skillBodies(fx: Fx, world: World, alpha: number): void {
  for (const enemy of world.enemies) {
    const kind = enemies[enemy.species].skill?.kind;
    if (enemy.hp <= 0) continue;
    // The shell is the damage reduction itself, so it shows while hardened even when a stagger or
    // sleep interrupts the enemy; only the wind-up and the dash belong to an uninterrupted skill.
    const acting = !interrupted(enemy);
    const x = enemy.px + (enemy.x - enemy.px) * alpha;
    const z = enemy.pz + (enemy.z - enemy.pz) * alpha;
    const y = enemyFeet(world.map.terrain, enemy) + enemyHeight(enemy) * 0.5;
    if (enemy.hardened > 0 || (acting && kind === "harden" && enemy.phase === "windup")) {
      const guardianShield = enemy.species === "cloyster" || enemy.species === "mr-mime";
      fx.sprites.draw(
        guardianShield ? shellShield : shell,
        x,
        y,
        z,
        enemyHeight(enemy) * 0.58,
        0.7,
      );
      if (enemy.species === "cloyster" && enemy.hardened > 2.3)
        fx.sprites.draw(
          shellFlash,
          x,
          y,
          z,
          enemyHeight(enemy) * 0.48,
          Math.min(1, (enemy.hardened - 2.3) / 0.2),
        );
    }
    if (
      acting &&
      (kind === "flame-charge" || kind === "flame-trail" || kind === "fire-punch") &&
      enemy.phase === "dash"
    )
      fx.sprites.draw(ember, x, y, z, enemyHeight(enemy) * 0.5, 0.8, enemy.dashX, enemy.dashZ);
  }
}

/** Ekans' glob in flight, with the ring it will splash into already marked on the ground. */
export function acidHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const landX = hazard.x + hazard.vx * hazard.life;
  const landZ = hazard.z + hazard.vz * hazard.life;
  fx.danger
    .put(Decal.telegraph, landX, landZ, ACID.pool, 0, hazard.id * 0.618)
    .tint(poison.purple, 0.9, poison.light, 0.3)
    .args(1 - hazard.life / ACID.flight);
  fx.sprites.draw(globHalo, x, y, z, hazard.radius * 2.2);
  fx.sprites.draw(glob, x, y, z, hazard.radius);
}

/** The pool it leaves: the same ring, held full, fading over its last second. */
export function acidPoolHazard(fx: Fx, hazard: Hazard, x: number, z: number): void {
  const fade = Math.min(1, hazard.life);
  // The landing ring stays, full, for as long as the pool poisons.
  fx.danger
    .put(Decal.telegraph, x, z, hazard.radius, 0, hazard.id * 0.618)
    .tint(poison.purple, 0.75 * fade, poison.light, 0.3)
    .args(1);
  fx.danger
    .put(Decal.glow, x, z, hazard.radius * 1.1)
    .tint(poison.purple, 0.7 * fade, poison.deep, 0);
  for (let i = perFrame(fx, 5); i > 0; i--) {
    const a = rand(0, Math.PI * 2);
    const d = rand(0, hazard.radius * 0.8);
    const bx = x + Math.cos(a) * d;
    const bz = z + Math.sin(a) * d;
    fx.sprites.emit(bubble, bx, fx.ground.heightAt(bx, bz) + 0.05, bz, 0, 0.6, 0, 0.12);
  }
}

/** Paras' cloud: a filling gold ring while it swells, then drifting spores over the slowed area. */
export function stunSporeHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const r = hazard.radius;
  if (hazard.life > STUN_SPORE.active) {
    const charge = 1 - (hazard.life - STUN_SPORE.active) / STUN_SPORE.windup;
    fx.danger
      .put(Decal.telegraph, x, z, r, 0, hazard.id * 0.618)
      .tint(gold.yellow, 0.9, gold.white, 0.4)
      .args(charge);
    return;
  }
  const fade = Math.min(1, hazard.life * 2);
  fx.danger.put(Decal.glow, x, z, r).tint(gold.yellow, 0.45 * fade, gold.white, 0.3);
  for (let i = perFrame(fx, 24); i > 0; i--) {
    const a = rand(0, Math.PI * 2);
    const d = Math.sqrt(Math.random()) * r * 0.9;
    fx.sprites.emit(
      sporeMote,
      x + Math.cos(a) * d,
      y + rand(-0.3, 0.6),
      z + Math.sin(a) * d,
      rand(-0.2, 0.2),
      rand(0, 0.3),
      rand(-0.2, 0.2),
      rand(0.25, 0.4),
    );
  }
}

/** Venonat's psybeam: its lane fills toward the far end during the charge, then the beam flashes. */
/** `windup`: the beam's full wind-up (Venonat's or Golduck's), from its first-seen life. */
export function psybeamHazard(
  fx: Fx,
  hazard: Hazard,
  x: number,
  y: number,
  z: number,
  windup: number,
): void {
  const yaw = Math.atan2(hazard.dirX, hazard.dirZ);
  const w = hazard.radius;
  const icy = hazard.kind === "ice-beam";
  const active = hazard.active ?? PSYBEAM.active;
  const color =
    hazard.element === "fire"
      ? fire.orange
      : icy || hazard.element === "ice"
        ? water.light
        : powder.pink;
  const glow =
    hazard.element === "fire" ? fireGlow : icy || hazard.element === "ice" ? iceGlow : beamGlow;
  if (hazard.life > active) {
    const charge = 1 - (hazard.life - active) / windup;
    fx.danger
      .put(Decal.danger, x, z, hazard.length, yaw)
      .rect(-w * 1.2, 0, w * 1.2, hazard.length)
      .tint(color, 1, poison.deep, 0)
      .args(charge, w);
    fx.sprites.draw(glow, x, y, z, 0.15 + charge * 0.3, 0.9);
    return;
  }
  fx.danger
    .put(Decal.strip, x, z, hazard.length, yaw)
    .rect(-w * 1.4, 0, w * 1.4, hazard.length)
    .tint(color, 0.95, white, 1)
    .args(0, w, 0);
  const steps = Math.ceil(hazard.length / 0.8);
  for (let i = 0; i <= steps; i++) {
    const along = (i / steps) * hazard.length;
    fx.sprites.draw(
      glow,
      x + hazard.dirX * along,
      y + hazard.rise * along,
      z + hazard.dirZ * along,
      w * 1.6,
      0.8,
    );
  }
}
