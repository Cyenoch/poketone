// Pledge moves (草之誓约, 火之誓约, 水之誓约) and what two of them combine into (火海, 湿地, 彩虹).
//
// A pledge is a smite: a telegraph of `area.delay` on a disc of `area.radius`, one hit, a short
// linger. Its signature is a pillar that bursts up out of the ground under the target (Thunder, the
// other smite, comes down from the sky), so the telegraph stirs the ground and the strike grows from
// the bottom. The pillar is thin and ≤ 2 m; the ring on the ground is the hitbox.
//
// 火海 and 湿地 are ground fields: flat, see-through, drawn every frame from the area's own `radius`,
// `life` and `maxLife`, so one restored from a snapshot draws the same. Their forming burst plays
// only on a newly made field. 彩虹 is a team buff with no hitbox: an arc where the pledges met and
// three pastel bands round each buffed player while it lasts. Pastel bands only: saturated red and purple
// are enemy danger, and nothing here sits on the danger layer.

import type { Area } from "../../sim/state/entities";
import { Decal } from "./decals";
import { perFrame, rand, reach, seedOf, spray, type AreaLook, type Echo, type Fx } from "./fx";
import { rgb, type Rgb } from "./gl";
import { fire, grass, water, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite, type SpriteSpec } from "./sprites";

const PILLAR_HEIGHT = 2;
const PILLAR_SECONDS = 0.5;
/** A field this young is newly made; an older one was restored and skips the forming burst. */
const FRESH = 0.3;

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

// Murky pond greens, darker and greyer than the grass line and nowhere near poison's violet.
const mud = {
  dark: rgb("#25443f"),
  mid: rgb("#4f7f6a"),
  light: rgb("#a9d6b4"),
  foam: rgb("#e2f2dc"),
};

const flame = sprite({
  shape: Shape.flame,
  life: 0.42,
  grow: 0.35,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
  gravity: -5,
  drag: 2.5,
});
const ember = sprite({
  shape: Shape.spark,
  life: 0.4,
  grow: 0.4,
  from: fire.core,
  to: fire.orange,
  accent: white,
  add: 1,
  gravity: -2,
  drag: 2,
  stretch: 0.03,
});
const ash = sprite({
  shape: Shape.puff,
  life: 0.6,
  grow: 1.6,
  from: fire.ash,
  to: fire.smoke,
  accent: fire.smoke,
  alpha: 0.6,
  gravity: -1.4,
  drag: 2.5,
  spin: 0.6,
});
const droplet = sprite({
  shape: Shape.drop,
  life: 0.5,
  grow: 0.7,
  from: water.light,
  accent: water.deep,
  gravity: 15,
  drag: 0.6,
  stretch: 0.03,
});
const mist = sprite({
  shape: Shape.cloud,
  life: 0.55,
  grow: 1.9,
  from: water.foam,
  to: water.light,
  accent: white,
  alpha: 0.4,
  add: 0.2,
  gravity: -0.6,
  drag: 2,
});
const fizz = sprite({
  shape: Shape.bubble,
  life: 0.35,
  grow: 0.7,
  from: water.light,
  accent: water.dark,
  alpha: 0.9,
  gravity: -2,
  drag: 2,
});
const leafUp = sprite({
  shape: Shape.leaf,
  life: 0.55,
  grow: 0.6,
  from: grass.leaf,
  accent: grass.deep,
  gravity: -1,
  drag: 2.5,
  spin: 10,
});
const leafFall = sprite({
  shape: Shape.leaf,
  life: 1,
  grow: 0.8,
  from: grass.leaf,
  accent: grass.deep,
  gravity: 1.6,
  drag: 3,
  spin: 6,
});
const sprout = sprite({
  shape: Shape.spark,
  life: 0.3,
  grow: 0.4,
  from: grass.light,
  to: grass.leaf,
  accent: white,
  add: 0.5,
  drag: 2,
  stretch: 0.04,
});
const flash = sprite({ shape: Shape.star, life: 0.16, grow: 1.5, from: white, add: 1, spin: 2 });

/** A column out of the ground: snaps up in the first 10 %, holds, then narrows away. a = hit radius. */
function column(fx: Fx, echo: Echo, t: number, body: Rgb, core: Rgb, add: number): number {
  const up = easeOut(Math.min(1, t / 0.1));
  const width = echo.a * 0.42 * Math.min(1, (1 - t) / 0.65) ** 0.7;
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      fx.ribbons.point(
        echo.x,
        echo.y + k * PILLAR_HEIGHT * up,
        echo.z,
        (layer ? width * 0.45 : width) * (1 - 0.35 * k),
        layer ? core : body,
        layer ? 1 - k * 0.5 : 0.85 - k * 0.45,
      );
    }
    fx.ribbons.flush(layer ? Ribbon.glow : Ribbon.solid, layer ? 1 : add);
  }
  return up;
}

function drawFirePillar(fx: Fx, echo: Echo, t: number): void {
  const up = column(fx, echo, t, fire.orange, fire.core, 0.5);
  for (let i = perFrame(fx, 60 * (1 - t)); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = echo.a * 0.2;
    fx.sprites.emit(
      flame,
      echo.x + Math.cos(a) * d,
      echo.y + rand(0, PILLAR_HEIGHT * up),
      echo.z + Math.sin(a) * d,
      Math.cos(a),
      rand(1, 3),
      Math.sin(a),
      rand(0.14, 0.22),
    );
  }
}

function drawWaterPillar(fx: Fx, echo: Echo, t: number): void {
  const up = column(fx, echo, t, water.mid, water.foam, 0.15);
  if (t > 0.5) return;
  // The head of the geyser breaks into drops that fall back inside the ring.
  const floor = echo.y;
  for (let i = perFrame(fx, 70); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(0.5, 1) * echo.a * 1.6;
    fx.sprites.emit(
      droplet,
      echo.x,
      echo.y + PILLAR_HEIGHT * up,
      echo.z,
      Math.cos(a) * s,
      rand(1, 3.5),
      Math.sin(a) * s,
      rand(0.06, 0.09),
      floor,
    );
  }
}

/** Two vines wind up a column of pale light. */
function drawGrassPillar(fx: Fx, echo: Echo, t: number): void {
  const up = column(fx, echo, t, grass.leaf, grass.sun, 0.3);
  const thin = (1 - t) ** 0.6;
  for (let vine = 0; vine < 2; vine++) {
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      const a = echo.seed + vine * Math.PI + k * 5 + t * 6;
      const d = echo.a * 0.28 * thin * (1 - 0.4 * k);
      fx.ribbons.point(
        echo.x + Math.cos(a) * d,
        echo.y + k * PILLAR_HEIGHT * up,
        echo.z + Math.sin(a) * d,
        0.07 * thin * (1 - 0.5 * k),
        grass.leaf,
        1,
      );
    }
    fx.ribbons.flush(Ribbon.vine, 0);
  }
  for (let i = perFrame(fx, 36 * (1 - t)); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = echo.a * 0.3;
    fx.sprites.emit(
      leafUp,
      echo.x + Math.cos(a) * d,
      echo.y + rand(0, PILLAR_HEIGHT * up),
      echo.z + Math.sin(a) * d,
      -Math.sin(a) * 2.5,
      rand(1, 3),
      Math.cos(a) * 2.5,
      rand(0.09, 0.13),
    );
  }
}

/** The warning disc, and the ground stirring more as the pillar nears. */
function stir(
  fx: Fx,
  area: Area,
  x: number,
  z: number,
  charge: number,
  rim: Rgb,
  fill: Rgb,
  spec: SpriteSpec,
): void {
  const r = area.radius;
  fx.decals
    .put(Decal.telegraph, x, z, r, 0, seedOf(area.id))
    .tint(rim, 0.95, fill, 0.5)
    .args(charge);
  for (let i = perFrame(fx, 6 + 18 * charge); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = r * 0.6 * Math.sqrt(Math.random()) * (1.2 - charge);
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d;
    fx.sprites.emit(spec, px, fx.ground.heightAt(px, pz) + 0.08, pz, 0, rand(1, 2.5), 0, 0.07);
  }
}

/** Throws `n` particles flat from the centre so they coast to the hit radius over their life. */
function toRim(fx: Fx, spec: SpriteSpec, x: number, y: number, z: number, r: number, n: number) {
  const speed = reach(r, spec.life, spec.drag);
  for (let i = 0; i < n; i++) {
    const a = ((i + Math.random() * 0.5) / n) * Math.PI * 2;
    fx.sprites.emit(spec, x, y, z, Math.cos(a) * speed, rand(0, 0.6), Math.sin(a) * speed, 0.14);
  }
}

const firePledge: AreaLook = {
  live(fx, area, x, z, charge) {
    if (area.delay > 0) stir(fx, area, x, z, charge, fire.yellow, fire.orange, ember);
  },
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawFirePillar, PILLAR_SECONDS, x, h, z, r);
    fx.sprites.emit(flash, x, h + 0.4, z, 0, 0, 0, r * 0.4);
    fx.decals.stamp(Decal.ring, x, z, r, 0.28, fire.yellow, 0.9, fire.orange, 0.4, 0.06, 0.3);
    fx.decals.stamp(Decal.glow, x, z, r * 0.9, 0.3, fire.orange, 0.45, fire.yellow, 1);
    fx.decals.stamp(Decal.scorch, x, z, r * 0.7, 1.2, fire.soot, 0.55, fire.orange, 0);
    toRim(fx, flame, x, h + 0.2, z, r, 12);
    spray(fx, ash, x, h + 0.3, z, 3, r * 0.6, 0.6, 0.16);
  },
};

const waterPledge: AreaLook = {
  live(fx, area, x, z, charge) {
    if (area.delay > 0) stir(fx, area, x, z, charge, water.light, water.mid, fizz);
  },
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawWaterPillar, PILLAR_SECONDS, x, h, z, r);
    fx.sprites.emit(flash, x, h + 0.4, z, 0, 0, 0, r * 0.35);
    fx.decals.stamp(Decal.ring, x, z, r, 0.28, water.foam, 0.9, water.light, 0.4, 0.06, 0.3);
    fx.decals.stamp(Decal.ripple, x, z, r * 0.95, 0.8, water.foam, 0.7, water.light, 0.3);
    spray(fx, mist, x, h + 0.3, z, 4, r * 0.7, 0.5, 0.2);
  },
};

const grassPledge: AreaLook = {
  live(fx, area, x, z, charge) {
    if (area.delay > 0) stir(fx, area, x, z, charge, grass.lime, grass.leaf, sprout);
  },
  strike(fx, area, x, z) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawGrassPillar, PILLAR_SECONDS, x, h, z, r);
    fx.sprites.emit(flash, x, h + 0.4, z, 0, 0, 0, r * 0.35);
    fx.decals.stamp(Decal.ring, x, z, r, 0.28, grass.light, 0.9, grass.leaf, 0.3, 0.06, 0.3);
    fx.decals.stamp(Decal.glow, x, z, r * 0.9, 0.45, grass.leaf, 0.4, grass.light, 0.6);
    toRim(fx, leafUp, x, h + 0.2, z, r, 10);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * rand(0.2, 0.8);
      fx.sprites.emit(
        leafFall,
        x + Math.cos(a) * d,
        h + rand(0.8, PILLAR_HEIGHT),
        z + Math.sin(a) * d,
        rand(-0.5, 0.5),
        0.5,
        rand(-0.5, 0.5),
        0.1,
        h,
      );
    }
  },
};

/** The three pledge pillars, by the move that casts them. */
export const pledgePillars = {
  "grass-pledge": grassPledge,
  "fire-pledge": firePledge,
  "water-pledge": waterPledge,
} satisfies Record<string, AreaLook>;

const fresh = (area: Area) => area.maxLife - area.life < FRESH;
/** Grows in over the first 0.3 s. */
const opening = (area: Area) => easeOut(Math.min(1, (area.maxLife - area.life) / 0.3));
/** Erodes over the last 0.6 s. */
const ending = (area: Area) => Math.min(1, area.life / 0.6) ** 2;

/** Yields a random point inside the disc into `spot`. */
const spot = { x: 0, z: 0 };
function inDisc(x: number, z: number, r: number): void {
  const a = Math.random() * Math.PI * 2;
  const d = r * Math.sqrt(Math.random());
  spot.x = x + Math.cos(a) * d;
  spot.z = z + Math.sin(a) * d;
}

const lowFlame = sprite({
  shape: Shape.flame,
  life: 0.45,
  grow: 0.4,
  from: fire.yellow,
  to: fire.orange,
  accent: fire.core,
  add: 0.5,
  gravity: -2.2,
  drag: 2.5,
});

/** 火海: the ground burns inside `area.radius` until the area ends. */
const seaOfFire: AreaLook = {
  live(fx, area, x, z) {
    const end = ending(area);
    const r = area.radius * opening(area);
    const seed = seedOf(area.id);
    fx.decals
      .put(Decal.scorch, x, z, r * 0.92, seed * 6, seed)
      .tint(fire.soot, end, fire.orange, 0)
      .args(0.25);
    // Two half discs of running heat; one fan would show its seam behind.
    for (let half = 0; half < 2; half++)
      fx.decals
        .put(Decal.sector, x, z, r, seed * 6 + half * Math.PI, seed + half)
        .tint(fire.red, 0.85 * end, fire.yellow, 0.25)
        .args(0, Math.PI / 2 + 0.055, 0);
    fx.decals
      .put(Decal.ring, x, z, r)
      .tint(fire.yellow, 0.7 * end, fire.orange, 0.3)
      .args(0, 0.045, 1);
    const crowded = fx.sprites.load > 0.8 ? 0.4 : 1;
    for (let i = perFrame(fx, r * r * 8 * end * crowded); i > 0; i--) {
      inDisc(x, z, r * 0.92);
      fx.sprites.emit(
        lowFlame,
        spot.x,
        fx.ground.heightAt(spot.x, spot.z) + 0.1,
        spot.z,
        0,
        rand(0.4, 1),
        0,
        rand(0.16, 0.26),
      );
    }
    if (perFrame(fx, 1.5 * end * crowded)) {
      inDisc(x, z, r * 0.7);
      fx.sprites.emit(
        ash,
        spot.x,
        fx.ground.heightAt(spot.x, spot.z) + 0.3,
        spot.z,
        0,
        0.6,
        0,
        0.14,
      );
    }
  },
  strike(fx, area, x, z) {
    if (!fresh(area)) return;
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.decals.stamp(Decal.ring, x, z, r, 0.4, fire.core, 0.95, fire.yellow, 0.6, 0.08, 0.2);
    fx.decals.stamp(Decal.glow, x, z, r, 0.35, fire.orange, 0.5, fire.yellow, 1);
    fx.sprites.emit(flash, x, h + 0.4, z, 0, 0, 0, r * 0.3);
    toRim(fx, flame, x, h + 0.2, z, r, 16);
    toRim(fx, ember, x, h + 0.3, z, r, 10);
  },
};

const mudBubble = sprite({
  shape: Shape.bubble,
  life: 0.7,
  grow: 1.3,
  from: mud.light,
  accent: mud.dark,
  alpha: 0.85,
  gravity: -0.5,
  drag: 2,
});
const mudDrop = sprite({
  shape: Shape.drop,
  life: 0.45,
  grow: 0.7,
  from: mud.mid,
  accent: mud.dark,
  gravity: 14,
  drag: 0.6,
  stretch: 0.03,
});

/** 湿地: a murky pool inside `area.radius` that slows what stands in it. */
const swamp: AreaLook = {
  live(fx, area, x, z) {
    const end = ending(area);
    const r = area.radius * opening(area);
    const seed = seedOf(area.id);
    fx.decals
      .put(Decal.scorch, x, z, r * 0.92, seed * 6, seed)
      .tint(mud.dark, 0.95 * end, mud.light, 0)
      .args(0.5);
    // Slow rings: still water, not a spreading shock.
    fx.decals
      .put(Decal.ripple, x, z, r * 0.9)
      .tint(mud.light, 0.3 * end, mud.mid, 0.1)
      .args((fx.time * 0.3 + seed) % 1);
    fx.decals
      .put(Decal.ring, x, z, r)
      .tint(mud.light, 0.7 * end, mud.mid, 0.1)
      .args(0, 0.045, 1);
    for (let i = perFrame(fx, r * r * 1.4 * end); i > 0; i--) {
      inDisc(x, z, r * 0.85);
      fx.sprites.emit(
        mudBubble,
        spot.x,
        fx.ground.heightAt(spot.x, spot.z) + 0.06,
        spot.z,
        0,
        0.25,
        0,
        rand(0.05, 0.09),
      );
    }
  },
  strike(fx, area, x, z) {
    if (!fresh(area)) return;
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    fx.decals.stamp(Decal.ring, x, z, r, 0.4, mud.foam, 0.9, mud.light, 0.3, 0.08, 0.2);
    fx.decals.stamp(Decal.ripple, x, z, r, 0.7, mud.foam, 0.7, mud.light, 0.2);
    toRim(fx, mudDrop, x, h + 0.25, z, r, 14);
    toRim(fx, sprout, x, h + 0.2, z, r, 8);
  },
};

/** The ground fields two pledges leave, by combination. */
export const pledgeFields = {
  "sea-of-fire": seaOfFire,
  swamp,
} satisfies Record<string, AreaLook>;

/** Pastel bands, outermost first: coral, amber, lemon, mint, sky, lilac. */
const BANDS = [
  rgb("#ffa08c"),
  rgb("#ffcf7a"),
  rgb("#fff3a6"),
  rgb("#b4f0a0"),
  rgb("#a8dcff"),
  rgb("#cdbcff"),
] as const;
const glints = BANDS.map((from) =>
  sprite({
    shape: Shape.star,
    life: 0.5,
    grow: 0.4,
    from,
    to: white,
    accent: white,
    add: 0.7,
    drag: 2,
    spin: 3,
  }),
);
const RAINBOW_SECONDS = 1.3;
const ARC_POINTS = 14;

/** The arc sweeps over from one foot, holds, then leaves from that same foot. a = half span, b = yaw. */
function drawRainbow(fx: Fx, echo: Echo, t: number): void {
  const head = easeOut(Math.min(1, t / 0.3)) * Math.PI;
  const tail = t > 0.65 ? ((t - 0.65) / 0.35) ** 2 * Math.PI : 0;
  const rx = Math.cos(echo.b);
  const rz = -Math.sin(echo.b);
  for (let band = 0; band < BANDS.length; band++) {
    const r = echo.a * (1 - band * 0.075);
    for (let i = 0; i <= ARC_POINTS; i++) {
      const angle = tail + ((head - tail) * i) / ARC_POINTS;
      const out = -Math.cos(angle) * r;
      fx.ribbons.point(
        echo.x + rx * out,
        echo.y + Math.sin(angle) * r,
        echo.z + rz * out,
        echo.a * 0.04,
        BANDS[band]!,
        0.9,
      );
    }
    fx.ribbons.flush(Ribbon.solid, 0.3);
  }
}

/**
 * 彩虹 formed at (x, z), the midpoint of the two pledges: an arc of half-width `span` facing the
 * camera. The buff itself has no area; `rainbowAura` marks who carries it.
 */
export function rainbowBurst(fx: Fx, x: number, z: number, span: number): void {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawRainbow, RAINBOW_SECONDS, x, h, z, span, fx.viewYaw);
  fx.decals.stamp(Decal.ring, x, z, span, 0.4, white, 0.85, BANDS[2], 0.6, 0.06, 0.2);
  fx.sprites.emit(flash, x, h + 0.4, z, 0, 0, 0, span * 0.25);
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = rand(1.5, 3);
    fx.sprites.emit(
      glints[i % glints.length]!,
      x,
      h + 0.4,
      z,
      Math.cos(a) * s,
      rand(2, 4),
      Math.sin(a) * s,
      rand(0.08, 0.12),
    );
  }
}

/** Outer radius of each aura band, outermost first, and the band it takes from `BANDS`. */
const AURA = [1.3, 1.19, 1.08] as const;
const AURA_BANDS = [1, 3, 4] as const;

/**
 * 彩虹 on one buffed player this frame: three pastel bands (amber, mint, sky) round the feet and
 * glints rising off them. The bands lie outside the seat ring (0.87 m, `player-rings.ts`) whatever
 * the form's size, and no seat colour is a striped band, so the two cannot be mistaken. `remaining`
 * seconds of the buff fade it out; `seed` keeps teammates out of step.
 */
export function rainbowAura(fx: Fx, x: number, z: number, remaining: number, seed: number): void {
  if (remaining <= 0) return;
  const fade = Math.min(1, remaining / 0.5);
  const breath = 0.85 + 0.15 * Math.sin(fx.time * 3 + seed * 6);
  for (let i = 0; i < AURA.length; i++)
    fx.decals
      .put(Decal.ring, x, z, AURA[i]!)
      .tint(BANDS[AURA_BANDS[i]!]!, fade * breath, white, 0.2)
      .args(0, 0.065, 1);
  for (let i = perFrame(fx, 7 * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(AURA[2], AURA[0]);
    fx.sprites.emit(
      glints[Math.floor(Math.random() * glints.length)]!,
      x + Math.cos(a) * d,
      fx.ground.heightAt(x, z) + rand(0.1, 0.5),
      z + Math.sin(a) * d,
      0,
      rand(0.8, 1.6),
      0,
      rand(0.08, 0.12),
    );
  }
}
