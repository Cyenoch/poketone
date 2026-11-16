// Ultimates and evolution (skill-vfx). Every ultimate pulse arrives as a `ult-pulse` event whose
// radius / lane is the hitbox, so the primary shape is drawn exactly there; flourishes stay inside it
// and short. Evolution is a light column: a tall, thin, brief beat that never covers the crowd.

import type { Stage } from "../../sim/content/lines/index";
import { CHEST } from "../../sim/content/params/combat";
import type { PlayerId } from "../../sim/state/entities";
import type { UltPulseEvent } from "../../sim/state/events";
import { ultimates, type UltimateId } from "../../sim/content/ultimates";
import { timeline } from "../../sim/ultimates/index";
import { Decal } from "./decals";
import { dracoCast } from "./dragon";
import { lineUltColour, lineUltPulse } from "./lines";
import { flicker, perFrame, rand, skyTop, spray, type Echo, type Fx } from "./fx";
import type { Rgb } from "./gl";
import { groundArc } from "./line-shapes";
import { electric, fire, gold, grass, ink, powder, water, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite, type SpriteSpec } from "./sprites";
import { place } from "./volumes";

const COLUMN_HEIGHT = 6.5;

const riseGold = sprite({
  shape: Shape.spark,
  life: 0.8,
  grow: 0.3,
  from: gold.white,
  to: gold.yellow,
  accent: white,
  add: 1,
  drag: 1.5,
  stretch: 0.05,
});
const flash = sprite({
  shape: Shape.glow,
  life: 0.22,
  grow: 1.6,
  from: white,
  accent: white,
  add: 1,
});
const flame = sprite({
  shape: Shape.flame,
  from: fire.orange,
  to: fire.soot,
  accent: fire.yellow,
  add: 0.3,
});
const rimFlame = sprite({
  shape: Shape.flame,
  life: 0.45,
  grow: 0.4,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.4,
  gravity: -3,
  drag: 2,
});
const leaf = sprite({
  shape: Shape.leaf,
  life: 0.6,
  grow: 0.8,
  from: grass.leaf,
  to: grass.deep,
  accent: grass.light,
  gravity: 4,
  drag: 2,
  spin: 8,
});
const petal = sprite({
  shape: Shape.leaf,
  life: 0.7,
  grow: 0.9,
  from: powder.pink,
  to: powder.lilac,
  accent: white,
  gravity: 1,
  drag: 2.5,
  spin: 6,
});
const spore = sprite({
  shape: Shape.cloud,
  life: 0.8,
  grow: 1.6,
  from: powder.lilac,
  to: powder.mist,
  accent: white,
  alpha: 0.55,
  gravity: -0.4,
  drag: 2,
});
const drop = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.6,
  from: water.light,
  to: water.mid,
  accent: water.foam,
  gravity: 14,
  drag: 0.5,
  stretch: -1,
});
const foam = sprite({
  shape: Shape.puff,
  life: 0.4,
  grow: 1.5,
  from: water.foam,
  to: water.light,
  accent: white,
  alpha: 0.8,
  drag: 3,
});
const cannonJet = sprite({
  shape: Shape.spark,
  from: water.mid,
  accent: water.foam,
  stretch: 0.06,
});
const spark = sprite({
  shape: Shape.spark,
  life: 0.25,
  grow: 0.4,
  from: electric.white,
  to: electric.yellow,
  accent: white,
  add: 1,
  gravity: 6,
  drag: 2,
  stretch: 0.04,
});

const ultColour: Record<UltimateId, readonly [Rgb, Rgb]> = {
  ...lineUltColour,
  "frenzy-plant": [grass.leaf, grass.sun],
  "blast-burn": [fire.orange, fire.core],
  "hydro-cannon": [water.mid, water.foam],
  "volt-tackle": [electric.yellow, electric.white],
};

/** Evolution: a column of light on the player, a ring on the ground and motes rising up it. */
export function evolveColumn(fx: Fx, x: number, z: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawColumn, 0.9, x, h, z);
  fx.decals.stamp(Decal.ring, x, z, 1.6, 0.6, gold.yellow, 1, white, 0.8, 0.25, 0.2);
  fx.decals.stamp(Decal.glow, x, z, 1.2, 0.8, gold.yellow, 0.9, white, 1);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(0.2, 0.7);
    fx.sprites.emit(
      riseGold,
      x + Math.cos(a) * d,
      h + rand(0, 1.5),
      z + Math.sin(a) * d,
      0,
      rand(3, 7),
      0,
      rand(0.12, 0.22),
    );
  }
}

function drawColumn(fx: Fx, echo: Echo, t: number): void {
  // Snaps open in the first 10 %, then narrows away instead of fading flat.
  const open = Math.min(1, t / 0.1);
  const width = 0.9 * open * (1 - t) ** 0.6;
  for (let i = 0; i <= 8; i++) {
    const k = i / 8;
    fx.ribbons.point(
      echo.x,
      echo.y + k * COLUMN_HEIGHT * open,
      echo.z,
      width * (1 - 0.6 * k),
      gold.white,
      1 - k * 0.7,
    );
  }
  fx.ribbons.flush(Ribbon.glow, 1);
}

/** Ultimates in table order: an echo carries its ultimate as this index. */
const ULTIMATES = Object.keys(ultimates) as UltimateId[];
/** Rising motes in each ultimate's own two colours. */
const castMote = Object.fromEntries(
  ULTIMATES.map((id) => {
    const [colour, core] = ultColour[id];
    const spec = sprite({
      shape: Shape.spark,
      life: 0.7,
      grow: 0.3,
      from: core,
      to: colour,
      accent: white,
      add: 1,
      drag: 1.6,
      stretch: 0.05,
    });
    return [id, spec];
  }),
) as Record<UltimateId, SpriteSpec>;
/** A line's own flourish on top of the shared cast beat (where its signature starts at the caster). */
const castFlourish: Partial<Record<UltimateId, (fx: Fx, x: number, h: number, z: number) => void>> =
  { "draco-meteor": dracoCast };

const CAST_COLUMN = 9;
/** Ground darkened around the caster while an ultimate plays, so its colours carry over the field. */
const DIM_RADIUS = 9;
const DIM_ALPHA = 0.7;

/**
 * Cast beat: a column of the ultimate's light through the caster, a burst on the ground and motes
 * spiralling up. Vertical and brief, so it never reads as a hitbox; the pulses that follow are.
 */
export function ultCast(fx: Fx, ultimate: UltimateId, x: number, z: number): void {
  const [colour, core] = ultColour[ultimate];
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawCastColumn, 0.6, x, h, z, ULTIMATES.indexOf(ultimate));
  fx.sprites.emit(flash, x, h + CHEST, z, 0, 0, 0, 1.1);
  fx.decals.stamp(Decal.glow, x, z, 2.6, 0.55, colour, 1, core, 1);
  fx.decals.stamp(Decal.ring, x, z, 2.4, 0.4, core, 1, colour, 0.8, 0.22, 0.15);
  const mote = castMote[ultimate];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const d = rand(0.3, 1.1);
    fx.sprites.emit(
      mote,
      x + Math.cos(a) * d,
      h + rand(0.1, 0.8),
      z + Math.sin(a) * d,
      Math.cos(a) * 1.5 - Math.sin(a) * 2,
      rand(5, 10),
      Math.sin(a) * 1.5 + Math.cos(a) * 2,
      rand(0.12, 0.22),
    );
  }
  castFlourish[ultimate]?.(fx, x, h, z);
}

function drawCastColumn(fx: Fx, echo: Echo, t: number): void {
  const [colour, core] = ultColour[ULTIMATES[echo.a]!];
  // Snaps open in the first 12 %, then narrows away instead of fading flat.
  const open = 1 - (1 - Math.min(1, t / 0.12)) ** 3;
  const width = 1.5 * open * (1 - t) ** 0.7;
  for (const [w, c, a] of [
    [width, colour, 0.85],
    [width * 0.35, core, 1],
  ] as const) {
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      fx.ribbons.point(
        echo.x,
        echo.y + k * CAST_COLUMN * open,
        echo.z,
        w * (1 - 0.55 * k),
        c,
        a * (1 - k * 0.8),
      );
    }
    fx.ribbons.flush(Ribbon.glow, 1);
  }
}

/** The view's record of a cast in progress: it follows its caster until the timeline has played. */
export interface CastAura {
  player: PlayerId;
  ultimate: UltimateId;
  age: number;
  life: number;
}

/** How long a cast plays: its last pulse, with a short tail (instant casts still get a beat). */
export function castAura(player: PlayerId, ultimate: UltimateId, stage: Stage): CastAura {
  const pulses = timeline(ultimate, stage);
  const last = pulses[pulses.length - 1]?.at ?? 0;
  return { player, ultimate, age: 0, life: Math.max(0.9, last + 0.45) };
}

/**
 * While an ultimate plays: the ground around the local caster dims, a sigil turns under them and motes of
 * its colour keep rising, so the whole cast reads as one event from the first frame to the last.
 */
export function drawCastAura(fx: Fx, aura: CastAura, x: number, z: number, mine: boolean): void {
  const [colour, core] = ultColour[aura.ultimate];
  const k = Math.min(1, aura.age / 0.1, (aura.life - aura.age) / 0.35);
  if (k <= 0) return;
  // Only the local caster's field dims: a partner's ultimate must not darken this player's view.
  if (mine) fx.decals.put(Decal.glow, x, z, DIM_RADIUS).tint(ink, DIM_ALPHA * k, ink, 0);
  fx.decals.put(Decal.glow, x, z, 1.9).tint(colour, 0.7 * k, core, 1);
  const spin = fx.time * 2.2;
  for (let i = 0; i < 3; i++) {
    const from = spin + (i * Math.PI * 2) / 3;
    groundArc(fx, x, z, 1.5, from, 1.5, 0.06, 0.16, colour, k);
    groundArc(fx, x, z, 1.05, -from * 1.4, 1.2, 0.06, 0.1, core, k);
  }
  const h = fx.ground.heightAt(x, z);
  const mote = castMote[aura.ultimate];
  for (let i = perFrame(fx, 36 * k); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(0.5, 1.5);
    fx.sprites.emit(
      mote,
      x + Math.cos(a) * d,
      h + 0.1,
      z + Math.sin(a) * d,
      0,
      rand(3, 6),
      0,
      rand(0.08, 0.15),
    );
  }
}

export function ultPulse(fx: Fx, e: UltPulseEvent, ultimate?: UltimateId): void {
  if (ultimate && lineUltPulse(fx, e, ultimate)) return;
  const { x, z, radius: r } = e;
  const h = fx.ground.heightAt(x, z);
  switch (e.look) {
    case "roots": {
      fx.echoes.add(drawRootLane, 0.6, x, r, z, e.dirX, e.dirZ, e.length);
      fx.echoes.add(drawRoot, 0.6, x, h, z, e.dirX, e.dirZ, e.length);
      along(e, (px, pz) => spray(fx, leaf, px, h + 0.3, pz, 3, 2.5, 4, 0.2));
      const tx = x + e.dirX * e.length;
      const tz = z + e.dirZ * e.length;
      spray(fx, leaf, tx, fx.ground.heightAt(tx, tz) + 0.5, tz, 8, 3.5, 5, 0.22);
      return;
    }
    case "sun":
      fx.decals.stamp(Decal.glow, x, z, r, 0.9, grass.gold, 0.9, grass.sun, 1);
      for (let i = 0; i < 16; i++)
        fx.sprites.emit(
          riseGold,
          x + rand(-0.5, 0.5),
          h + rand(0, 1),
          z + rand(-0.5, 0.5),
          0,
          rand(2, 4),
          0,
          0.15,
        );
      return;
    case "spores":
      fx.decals.stamp(Decal.ring, x, z, r, 0.25, powder.lilac, 0.65, white, 0.25, 0.045, 1);
      spray(fx, spore, x, h + 0.5, z, 14, r * 1.6, 0.6, 0.6);
      return;
    case "petals":
      fx.decals.stamp(Decal.ring, x, z, r, 0.26, powder.pink, 0.75, white, 0.3, 0.045, 1);
      spray(fx, petal, x, h + 0.6, z, 22, r * 2.2, 1.5, 0.22);
      return;
    case "pillar":
      fx.echoes.add(drawFireRelease, 0.28, x, h, z, r, 1);
      fx.echoes.add(drawFirePillar, 0.55, x, h, z, r);
      return;
    case "ring":
      fx.echoes.add(drawFireRelease, 0.42, x, h, z, r, 0.9);
      rim(x, z, r * 0.92, Math.round(r * 5), (px, pz) =>
        fx.sprites.emit(
          rimFlame,
          px,
          fx.ground.heightAt(px, pz) + 0.15,
          pz,
          0,
          rand(1, 2.5),
          0,
          rand(0.28, 0.4),
        ),
      );
      return;
    case "embers":
      fx.echoes.add(drawEmberPatch, 0.28, x, h, z, r);
      return;
    case "crack":
      fx.echoes.add(drawMagmaLane, 0.5, x, r, z, e.dirX, e.dirZ, e.length);
      return;
    case "meteor":
      fx.echoes.add(drawFall, 0.1, x, h, z, 0.18);
      fx.echoes.add(drawFireRelease, 0.24, x, h, z, r, 0.65);
      fx.decals.stamp(Decal.scorch, x, z, r * 0.8, 0.7, fire.soot, 0.45, fire.orange, 0);
      return;
    case "blast":
      fx.echoes.add(drawFireRelease, 0.45, x, h, z, r, 1);
      fx.echoes.add(drawFirePillar, 0.6, x, h, z, 1.6);
      rim(x, z, r * 0.92, Math.round(r * 5), (px, pz) =>
        fx.sprites.emit(
          rimFlame,
          px,
          fx.ground.heightAt(px, pz) + 0.15,
          pz,
          0,
          rand(1.5, 3),
          0,
          rand(0.32, 0.46),
        ),
      );
      fx.decals.stamp(Decal.scorch, x, z, r * 0.85, 1, fire.soot, 0.45, fire.orange, 0);
      return;
    case "whirl":
      fx.decals.stamp(Decal.whirl, x, z, r, 0.3, water.mid, 0.75, water.foam, 0.3);
      fx.echoes.add(drawWaterWall, 0.3, x, h, z, r);
      rim(x, z, r * 0.8, 6, (px, pz, a) =>
        fx.sprites.emit(drop, px, h + 0.4, pz, -Math.sin(a) * 5, 1.5, Math.cos(a) * 5, 0.16),
      );
      return;
    case "wave":
      fx.decals.stamp(Decal.ring, x, z, r, 0.25, water.light, 0.85, water.foam, 0.35, 0.045, 1);
      fx.decals.stamp(Decal.ripple, x, z, r, 0.7, water.mid, 0.6, water.foam, 0.3);
      rim(x, z, r, 22, (px, pz, a) =>
        fx.sprites.emit(
          foam,
          px,
          h + 0.3,
          pz,
          Math.cos(a) * 3,
          rand(0.5, 1.5),
          Math.sin(a) * 3,
          rand(0.22, 0.36),
        ),
      );
      return;
    case "rain":
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * r;
        const px = x + Math.cos(a) * d;
        const pz = z + Math.sin(a) * d;
        fx.sprites.emit(
          drop,
          px,
          fx.ground.heightAt(px, pz) + 4,
          pz,
          0,
          -9,
          0,
          0.12,
          fx.ground.heightAt(px, pz),
        );
      }
      fx.decals.stamp(Decal.ripple, x, z, r, 0.6, water.light, 0.35, water.foam, 0.2);
      return;
    case "cannon":
      fx.echoes.add(drawCannon, 0.16, x, r, z, e.dirX, e.dirZ, e.length);
      return;
    case "storm":
      fx.echoes.add(drawSkyBolt, 0.2, x, h, z, 0.11);
      fx.decals.stamp(Decal.glow, x, z, r * 1.1, 0.2, electric.yellow, 0.9, white, 1);
      fx.decals.stamp(Decal.ring, x, z, r, 0.22, electric.yellow, 0.8, white, 0.4, 0.05, 1);
      spray(fx, spark, x, h + 0.3, z, 6, 4, 3, 0.18);
      return;
    case "bolt":
      fx.echoes.add(drawSkyBolt, 0.34, x, h, z, 0.26);
      fx.sprites.emit(flash, x, h + 0.5, z, 0, 0, 0, r * 0.6);
      fx.decals.stamp(Decal.glow, x, z, r * 1.1, 0.35, electric.yellow, 1, white, 1);
      fx.decals.stamp(Decal.ring, x, z, r, 0.24, electric.yellow, 0.9, white, 0.4, 0.05, 1);
      fx.decals.stamp(Decal.cracks, x, z, r * 0.8, 1.2, electric.gold, 0.6, white, 0.5);
      spray(fx, spark, x, h + 0.4, z, 22, 8, 6, 0.24);
      return;
    case "zigzag":
      fx.echoes.add(drawHop, 0.28, x, h, z, e.dirX, e.dirZ, e.length);
      fx.decals.stamp(
        Decal.ring,
        x + e.dirX * e.length,
        z + e.dirZ * e.length,
        r,
        0.3,
        electric.yellow,
        0.9,
        white,
        0.4,
        0.05,
        1,
      );
      return;
  }
}

/** A lane from (x, z): y is its half-width, a, b its heading, c the length cover left it. */
function strip(fx: Fx, echo: Echo, colour: Rgb, edge: Rgb, alpha: number, style: number): void {
  fx.decals
    .put(Decal.strip, echo.x, echo.z, echo.c, Math.atan2(echo.a, echo.b))
    .rect(-echo.y, 0, echo.y, echo.c)
    .tint(colour, alpha, edge, 0.4)
    .args(0, echo.y, style);
}

function drawRootLane(fx: Fx, echo: Echo, t: number): void {
  strip(fx, echo, grass.deep, grass.leaf, 0.55 * (1 - t) ** 2, 1);
}

function drawMagmaLane(fx: Fx, echo: Echo, t: number): void {
  strip(fx, echo, fire.soot, fire.orange, 0.65 * (1 - t) ** 2, 0);
  for (let s = 0.8; s < echo.c; s += 1.2) {
    const x = echo.x + echo.a * s;
    const z = echo.z + echo.b * s;
    fx.sprites.draw(
      flame,
      x,
      fx.ground.heightAt(x, z) + 0.18,
      z,
      0.28 * (1 - t),
      1 - t,
      0,
      0,
      0,
      echo.seed + s,
      t,
    );
  }
}

function along(e: UltPulseEvent, at: (x: number, z: number) => void): void {
  for (let s = 0.8; s < e.length; s += 1.2) at(e.x + e.dirX * s, e.z + e.dirZ * s);
}

function rim(
  x: number,
  z: number,
  r: number,
  n: number,
  at: (x: number, z: number, a: number) => void,
): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1);
    at(x + Math.cos(a) * r, z + Math.sin(a) * r, a);
  }
}

/** Roots erupt across the instant-hit lane, then sink: a dark vine and a light one twist round it. */
function drawRoot(fx: Fx, echo: Echo, t: number): void {
  const reach = echo.c;
  const rise = 1 - (1 - Math.min(1, t / 0.15)) ** 2;
  const sink = t < 0.6 ? 0 : (t - 0.6) / 0.4;
  const up = rise * (1 - sink);
  for (const [phase, width, colour] of [
    [0, 0.26, grass.deep],
    [Math.PI, 0.15, grass.leaf],
  ] as const) {
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      const s = reach * k;
      const twist = Math.sin(k * Math.PI * 4 + echo.seed + phase) * 0.22;
      const px = echo.x + echo.a * s - echo.b * twist;
      const pz = echo.z + echo.b * s + echo.a * twist;
      const arch = Math.sin(k * Math.PI * 3 + echo.seed) * 0.18 + 0.45;
      fx.ribbons.point(
        px,
        fx.ground.heightAt(px, pz) + arch * up,
        pz,
        width * (1 - 0.5 * k),
        colour,
        1 - sink,
      );
    }
    fx.ribbons.flush(Ribbon.vine, 0);
  }
}

/** Blast Burn's eruption at the caster: a fire funnel bursting up out of the pillar disc; a: radius. */
function drawFirePillar(fx: Fx, echo: Echo, t: number): void {
  const grow = 1 - (1 - Math.min(1, t / 0.2)) ** 3;
  const fade = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
  const r = echo.a * (0.6 + 0.4 * grow);
  fx.volumes.funnels.add(
    place(echo.x, echo.y, echo.z, echo.seed, r, 3.4 * grow * (1 - 0.3 * t), r),
    fire.yellow,
    fade,
    fire.orange,
    0,
    echo.seed,
  );
}

/** Hydro Cannon's pull: a water wall turning on the disc's edge for one beat; a: radius. */
function drawWaterWall(fx: Fx, echo: Echo, t: number): void {
  const fade = Math.min(1, t / 0.2) * (1 - t);
  fx.volumes.whirls.add(
    // The whirl volume conforms to the terrain itself: y is a lift, not a height.
    place(echo.x, 0.05, echo.z, echo.seed, echo.a, 1.1, echo.a),
    water.foam,
    fade,
    water.mid,
    0,
    echo.seed,
  );
}

/** Instant disc hit: its full edge is visible at impact; low fire tongues tear outward inside it. */
function drawFireRelease(fx: Fx, echo: Echo, t: number): void {
  const r = echo.a;
  const fade = (1 - t) ** 2;
  fx.decals
    .put(Decal.sector, echo.x, echo.z, r, 0, echo.seed)
    .tint(fire.orange, 0.6 * echo.b * fade, fire.yellow, 0.15)
    .args(t, Math.PI, 0);
  fx.decals
    .put(Decal.ring, echo.x, echo.z, r)
    .tint(fire.orange, 0.8 * fade, fire.yellow, 0.2)
    .args(t, 0.035, 1);
  const open = 1 - (1 - t) ** 3;
  const count = r < 2 ? 7 : 11;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.sin(i * 7.13 + echo.seed) * 0.18;
    const width = Math.min(0.75, r * 0.3) * (1 - t) * (0.8 + 0.2 * Math.sin(i * 4.1));
    const tip = 0.72 + 0.12 * Math.sin(i * 2.4 + echo.seed);
    for (let j = 0; j < 4; j++) {
      const k = j / 3;
      const d = r * (0.24 + 0.38 * open + k * (tip - 0.24 - 0.24 * open));
      const bend = Math.sin(k * Math.PI) * Math.sin(i * 5.3 + echo.seed) * width;
      const x = echo.x + Math.cos(angle) * d - Math.sin(angle) * bend;
      const z = echo.z + Math.sin(angle) * d + Math.cos(angle) * bend;
      fx.ribbons.point(
        x,
        fx.ground.heightAt(x, z) + 0.12 + Math.sin(k * Math.PI) * 0.35 * (1 - t),
        z,
        width * (j === 0 ? 0.45 : j === 1 ? 1 : j === 2 ? 0.5 : 0),
        j === 1 ? fire.yellow : fire.orange,
        fade * echo.b,
      );
    }
    fx.ribbons.flush(Ribbon.glow, 0.3);
  }
}

/** One damage tick at a burning spot; ends before the next tick, without floating fireballs. */
function drawEmberPatch(fx: Fx, echo: Echo, t: number): void {
  fx.decals
    .put(Decal.scorch, echo.x, echo.z, echo.a, 0, echo.seed)
    .tint(fire.soot, 0.6, fire.orange, 0)
    .args(t);
  for (let i = 0; i < 2; i++) {
    const angle = echo.seed + i * Math.PI;
    const x = echo.x + Math.cos(angle) * echo.a * 0.35;
    const z = echo.z + Math.sin(angle) * echo.a * 0.35;
    fx.sprites.draw(
      flame,
      x,
      fx.ground.heightAt(x, z) + 0.14,
      z,
      0.22 * (1 - t * 0.8),
      0.7 * (1 - t),
      0,
      0,
      0,
      echo.seed + i,
      t,
    );
  }
}

/** A fireball's last metres down onto (x, z); a: streak width. */
function drawFall(fx: Fx, echo: Echo, t: number): void {
  const top = echo.y + 5 * (1 - t);
  fx.ribbons.point(echo.x + 1.2, top + 2.5, echo.z - 0.6, echo.a * 0.3, fire.yellow, 0.4);
  fx.ribbons.point(echo.x, echo.y + 0.3, echo.z, echo.a, fire.core, 1 - t);
  fx.ribbons.flush(Ribbon.streak, 1);
}

/** Bolt from the sky; a: width. */
function drawSkyBolt(fx: Fx, echo: Echo, t: number): void {
  const alpha = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
  const [tx, rise, tz] = skyTop(fx, echo.x, echo.z, 9);
  fx.ribbons.bolt(
    tx + 0.8,
    echo.y + rise,
    tz - 0.4,
    echo.x,
    echo.y + 0.1,
    echo.z,
    flicker(fx, echo.seed, 24),
    echo.a,
    electric.yellow,
    alpha,
    1,
  );
}

/** Zig-zag hop from (x, z) along (a, b) for c metres. */
function drawHop(fx: Fx, echo: Echo, t: number): void {
  const alpha = 1 - t * t;
  const bx = echo.x + echo.a * echo.c;
  const bz = echo.z + echo.b * echo.c;
  fx.ribbons.bolt(
    echo.x,
    echo.y + 0.8,
    echo.z,
    bx,
    fx.ground.heightAt(bx, bz) + 0.7,
    bz,
    flicker(fx, echo.seed, 20),
    0.14,
    electric.yellow,
    alpha,
    1,
  );
}

/** One cannon beam; y: half-width, a, b: heading, c: length. Each tick's beam is drawn briefly. */
function drawCannon(fx: Fx, echo: Echo, t: number): void {
  strip(fx, echo, water.deep, water.foam, 0.8 * (1 - t) ** 2, 1);
  const w = echo.y * 0.7 * (1 - t * 0.5);
  fx.volumes.beams.add(
    place(
      echo.x,
      fx.ground.heightAt(echo.x, echo.z) + 0.6,
      echo.z,
      Math.atan2(echo.a, echo.b),
      w,
      w,
      echo.c,
    ),
    water.light,
    1 - t,
    water.deep,
    2,
    echo.seed,
  );
  // Eight short jets share the existing sprite batch and replace each tick's lingering drops.
  const step = echo.c / 8;
  for (let i = 0; i < 8; i++) {
    const d = (i + 0.5) * step;
    const px = echo.x + echo.a * d;
    const pz = echo.z + echo.b * d;
    fx.sprites.draw(
      cannonJet,
      px,
      fx.ground.heightAt(px, pz) + 0.4,
      pz,
      echo.y * 0.45 * (1 - t),
      0.8 * (1 - t),
      echo.a * step * 3,
      echo.b * step * 3,
    );
  }
}
