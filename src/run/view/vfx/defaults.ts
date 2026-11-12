// Default looks: every archetype's shots and every area kind have one, tinted by the move's element,
// so a move without a bespoke look (vfx.ts look tables) is still drawn. Bespoke looks stay the goal
// for shipped moves (.agents/skills/skill-vfx); these only keep new content visible while it lands.

import type { AreaKind } from "../../sim/archetypes/index";
import type { ElementType } from "../../sim/content/elements";
import type { Archetype } from "../../sim/content/moves";
import { CHEST } from "../../sim/content/params/combat";
import { Decal } from "./decals";
import { perFrame, rand, seedOf, spray, type AreaLook, type Fx, type ShotLook } from "./fx";
import { rgb, type Rgb } from "./gl";
import { electric, fire, grass, poison, powder, stone, water, white, wind } from "./palette";
import { Shape, sprite, type SpriteSpec } from "./sprites";

interface Tint {
  light: Rgb;
  mid: Rgb;
  deep: Rgb;
}

const tints: Record<ElementType, Tint> = {
  normal: { light: white, mid: wind.cream, deep: wind.dust },
  fire: { light: fire.yellow, mid: fire.orange, deep: fire.deep },
  water: { light: water.light, mid: water.mid, deep: water.deep },
  ice: { light: water.foam, mid: rgb("#8fc5e3"), deep: rgb("#48768e") },
  grass: { light: grass.light, mid: grass.leaf, deep: grass.deep },
  electric: { light: white, mid: electric.yellow, deep: electric.gold },
  bug: { light: grass.lime, mid: rgb("#9cc23a"), deep: rgb("#4f6b1c") },
  flying: { light: white, mid: wind.cyan, deep: rgb("#5a8fc4") },
  poison: { light: poison.light, mid: poison.purple, deep: poison.deep },
  rock: { light: stone.light, mid: rgb("#9a8a74"), deep: stone.dark },
  ground: { light: wind.dust, mid: rgb("#b08850"), deep: stone.dark },
  fighting: { light: rgb("#ffd2b8"), mid: rgb("#d0583a"), deep: rgb("#7a2416") },
  psychic: { light: powder.pink, mid: rgb("#ff5fa0"), deep: rgb("#9c1f5c") },
  ghost: { light: powder.lilac, mid: rgb("#7d63c4"), deep: rgb("#2f2257") },
  fairy: { light: white, mid: powder.pink, deep: rgb("#d0609e") },
  steel: { light: rgb("#eef4f8"), mid: rgb("#9fb6c6"), deep: rgb("#4b6476") },
  dragon: { light: rgb("#c2b6ff"), mid: rgb("#6b4cff"), deep: rgb("#2c1a8a") },
};

/** The sprites one tint draws with. */
function kit(t: Tint) {
  return {
    head: sprite({ shape: Shape.ball, from: t.mid, accent: t.deep }),
    halo: sprite({ shape: Shape.glow, from: t.mid, accent: t.light, alpha: 0.5, add: 1 }),
    trail: sprite({
      shape: Shape.glow,
      life: 0.3,
      grow: 0.4,
      from: t.light,
      to: t.mid,
      accent: t.light,
      alpha: 0.7,
      add: 0.8,
      drag: 3,
    }),
    spark: sprite({
      shape: Shape.spark,
      life: 0.3,
      grow: 0.5,
      from: t.light,
      to: t.mid,
      accent: white,
      add: 1,
      gravity: 6,
      drag: 3,
      stretch: 0.03,
    }),
  };
}

function shot(t: Tint): ShotLook {
  const s = kit(t);
  const pop = (spec: SpriteSpec, n: number) => (fx: Fx, x: number, y: number, z: number) =>
    spray(fx, spec, x, y, z, n, 2.2, 1.6, 0.07);
  return {
    fly(fx, p, x, y, z) {
      const r = Math.max(0.12, Math.min(p.radius, 0.5));
      fx.sprites.draw(s.halo, x, y, z, r * 2);
      fx.sprites.draw(s.head, x, y, z, r);
      for (let i = perFrame(fx, 30); i > 0; i--)
        fx.sprites.emit(s.trail, x, y, z, -p.vx * 0.05, rand(0, 0.3), -p.vz * 0.05, r * 0.8);
    },
    hit: pop(s.spark, 8),
    fade: pop(s.trail, 4),
  };
}

/** A wave's band: glows across its width, riding the ground. */
function band(t: Tint): ShotLook {
  const s = kit(t);
  return {
    fly(fx, p, x, y, z) {
      const speed = Math.hypot(p.vx, p.vz) || 1;
      const sideX = -p.vz / speed;
      const sideZ = p.vx / speed;
      for (let i = -2; i <= 2; i++) {
        const o = (i / 2) * p.radius;
        fx.sprites.draw(s.halo, x + sideX * o, y, z + sideZ * o, 0.45);
      }
    },
  };
}

type Factory<T> = (t: Tint) => T;

/** Per archetype, the default look of its shots; null for the archetypes that fire none. */
const shotDefaults: Record<Archetype, Factory<ShotLook> | null> = {
  bolt: shot,
  orb: shot,
  barrage: shot,
  homing: shot,
  drain: shot,
  lob: shot,
  wave: band,
  cone: null,
  vortex: null,
  strike: null,
  beam: null,
  spin: null,
  // Drawn from its `chain` event.
  chain: null,
  smite: null,
  nova: null,
  bloom: null,
  firestorm: null,
  sprinkler: null,
  rod: null,
};

/** A disc on the ground: a charging telegraph while it waits, a glow while it acts, a ring when it strikes. */
function disc(t: Tint, swirl = false): AreaLook {
  const s = kit(t);
  return {
    live(fx, area, x, z, charge) {
      const fade = Math.min(1, area.life / 0.2);
      if (area.delay > 0) {
        fx.decals
          .put(Decal.telegraph, x, z, area.radius, 0, seedOf(area.id))
          .tint(t.mid, 0.9, t.deep, 0.4)
          .args(charge);
        return;
      }
      fx.decals.put(Decal.glow, x, z, area.radius).tint(t.mid, 0.4 * fade, t.light, 0.6);
      if (swirl)
        fx.decals
          .put(Decal.whirl, x, z, area.radius, 0, seedOf(area.id))
          .tint(t.light, 0.7 * fade, t.mid, 0.3);
    },
    strike(fx, area, x, z) {
      const h = fx.ground.heightAt(x, z);
      fx.decals.stamp(Decal.ring, x, z, area.radius, 0.35, t.light, 0.9, t.deep, 0.5, 0.14, 0.3);
      spray(fx, s.spark, x, h + 0.3, z, 10, area.radius * 2, 1.5, 0.08);
    },
  };
}

/** A fan in front of the caster (cones and melee strikes). */
function sector(t: Tint): AreaLook {
  return {
    live(fx, area, x, z) {
      if (area.delay > 0) return;
      const yaw = Math.atan2(area.dirX, area.dirZ);
      const side = area.length * Math.sin(Math.min(area.angle, Math.PI / 2)) + 0.3;
      fx.decals
        .put(Decal.sector, x, z, area.length, yaw, seedOf(area.id))
        .rect(-side, -0.3, side, area.length + 0.3)
        .tint(t.mid, 0.55, t.light, 0.8)
        .args(0, area.angle, 0);
    },
  };
}

/** A lane from the caster's chest along the area's heading (beams). */
function lane(t: Tint): AreaLook {
  const s = kit(t);
  return {
    live(fx, area, x, z, charge) {
      const yaw = Math.atan2(area.dirX, area.dirZ);
      const width = area.delay > 0 ? 0.15 : Math.max(0.2, area.radius);
      fx.decals
        .put(Decal.strip, x, z, area.length, yaw)
        .rect(-width, 0, width, area.length)
        .tint(t.mid, area.delay > 0 ? 0.7 * charge : 0.8, t.light, 1)
        .args(0, width, area.delay > 0 ? 2 : 0);
      if (area.delay > 0) return;
      const y = fx.ground.heightAt(x, z) + CHEST;
      for (let i = perFrame(fx, 40); i > 0; i--) {
        const d = rand(0, area.length);
        fx.sprites.emit(
          s.trail,
          x + area.dirX * d,
          y + area.rise * d,
          z + area.dirZ * d,
          0,
          0.4,
          0,
          width,
        );
      }
    },
  };
}

/** Per area kind, its default look. */
const areaDefaults: Record<AreaKind, Factory<AreaLook>> = {
  cone: sector,
  strike: sector,
  beam: lane,
  bloom: lane,
  spin: disc,
  nova: disc,
  burst: disc,
  smite: disc,
  rod: disc,
  vortex: (t) => disc(t, true),
  firestorm: (t) => disc(t, true),
  sprinkler: (t) => disc(t, true),
};

const shotCache = new Map<string, ShotLook>();
const areaCache = new Map<string, AreaLook>();

export function defaultShotLook(archetype: Archetype, type: ElementType): ShotLook {
  const key = `${archetype}:${type}`;
  let look = shotCache.get(key);
  if (!look) {
    const make = shotDefaults[archetype];
    if (!make) throw new Error(`${archetype} 不发射弹体，没有弹体外观。`);
    look = make(tints[type]);
    shotCache.set(key, look);
  }
  return look;
}

export function defaultAreaLook(kind: AreaKind, type: ElementType): AreaLook {
  const key = `${kind}:${type}`;
  let look = areaCache.get(key);
  if (!look) {
    look = areaDefaults[kind](tints[type]);
    areaCache.set(key, look);
  }
  return look;
}
