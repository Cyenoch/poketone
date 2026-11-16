// Dratini line (skill-vfx): deep indigo bodies, jade wind and gold scales. Gold almond scales (never
// triangles, which read as enemy chevrons) mark every dragon move; Aqua Tail keeps the water palette.

import { CHEST } from "../../sim/content/params/combat";
import { STRIKE } from "../../sim/content/params/archetypes";
import type { UltPulseEvent } from "../../sim/state/events";
import { Decal } from "./decals";
import {
  perFrame,
  rand,
  seedOf,
  skyTop,
  spray,
  type AreaLook,
  type Echo,
  type Fx,
  type ShotLook,
} from "./fx";
import { discEdge, groundArc } from "./line-shapes";
import { dragon, water } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";

const head = sprite({ shape: Shape.ball, from: dragon.teal, accent: dragon.deep });
const halo = sprite({
  shape: Shape.glow,
  from: dragon.teal,
  accent: dragon.light,
  alpha: 0.5,
  add: 1,
});
const scale = sprite({
  shape: Shape.scale,
  life: 0.3,
  grow: 0.2,
  from: dragon.scale,
  to: dragon.teal,
  accent: dragon.deep,
  drag: 4,
  gravity: 2,
  spin: 8,
});
const streak = sprite({
  shape: Shape.spark,
  life: 0.2,
  grow: 0.2,
  from: dragon.light,
  to: dragon.teal,
  accent: dragon.teal,
  alpha: 0.8,
  stretch: 0.04,
  drag: 4,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.14,
  grow: 0.3,
  from: dragon.scale,
  to: dragon.teal,
  accent: dragon.light,
  add: 0.3,
});
const pop = sprite({
  shape: Shape.ring,
  life: 0.2,
  grow: 1.5,
  from: dragon.teal,
  to: dragon.indigo,
  accent: dragon.light,
  add: 0.3,
});
const foam = sprite({
  shape: Shape.drop,
  life: 0.3,
  grow: 0.3,
  from: water.foam,
  to: water.mid,
  accent: water.deep,
  gravity: 7,
  drag: 3,
  stretch: -1,
});
const rubble = sprite({
  shape: Shape.puff,
  life: 0.5,
  grow: 0.8,
  from: dragon.indigo,
  to: dragon.deep,
  accent: dragon.deep,
  alpha: 0.85,
  drag: 3,
  gravity: -0.3,
});

export const dragonBreath: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.3);
    spray(fx, scale, x, y, z, 3, 1.4, 0.6, 0.08);
  },
  fly(fx, p, x, y, z) {
    const speed = Math.hypot(p.vx, p.vz) || 1;
    const r = p.radius * 1.15;
    fx.volumes.orbs.add(
      place(x, y, z, fx.time * 4, r, r, r),
      dragon.scale,
      1,
      dragon.indigo,
      0,
      seedOf(p.id),
    );
    fx.sprites.draw(halo, x, y, z, r * 2.6, 0.7);
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      const d = k * Math.min(1.4, speed * 0.08);
      fx.ribbons.point(
        x - (p.vx / speed) * d,
        y - (p.vy / speed) * d + Math.sin(k * 9 - fx.time * 20) * 0.05 * k,
        z - (p.vz / speed) * d,
        r * 0.9 * (1 - k),
        k < 0.4 ? dragon.teal : dragon.indigo,
        0.9 * (1 - k),
      );
    }
    fx.ribbons.flush(Ribbon.streak, 0.25);
    for (let i = perFrame(fx, 14); i > 0; i--)
      fx.sprites.emit(scale, x, y, z, -p.vx * 0.05, 0.3, -p.vz * 0.05, 0.075);
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.32);
    spray(fx, scale, x, y, z, 5, 1.8, 0.9, 0.08);
  },
  fade(fx, x, y, z) {
    fx.sprites.emit(pop, x, y, z, 0, 0, 0, 0.2);
  },
};

/**
 * One stream of Dragon Tempest (sim/archetypes/tempest): a storm eddy gathers on the caster's rim and
 * draws its lane, then a dragon-pulse core erupts along it inside a widening wind coil, with a jade
 * light at its head where the burst will land. The streams together are the storm, so each one stays
 * thin.
 */
export const dragonStream: AreaLook = {
  live(fx, a, x, z, charge) {
    const yaw = Math.atan2(a.dirX, a.dirZ);
    const y = fx.ground.heightAt(x, z) + CHEST;
    const seed = seedOf(a.id);
    if (a.delay > 0) {
      fx.decals
        .put(Decal.strip, x, z, a.length, yaw)
        .rect(-0.06, 0, 0.06, a.length * charge)
        .tint(dragon.teal, 0.45 * charge, dragon.light, 0.1)
        .args(0, 0.06, 2);
      groundArc(
        fx,
        x,
        z,
        0.42 * (1 - 0.45 * charge),
        fx.time * 9 + seed,
        Math.PI * 1.4,
        0.15 + 0.45 * charge,
        0.05,
        dragon.light,
        charge,
      );
      fx.sprites.draw(halo, x, y, z, 0.15 + charge * 0.35, 0.6 * charge);
      return;
    }
    const fade = Math.min(1, a.life / 0.14);
    const r = a.radius * fade;
    fx.volumes.beams.add(
      place(x, y, z, yaw, r, r, a.length * Math.hypot(1, a.rise), -Math.atan(a.rise)),
      dragon.teal,
      0.75 * fade,
      dragon.indigo,
      2,
      seed,
    );
    fx.decals
      .put(Decal.strip, x, z, a.length, yaw)
      .rect(-a.radius, 0, a.radius, a.length)
      .tint(dragon.indigo, 0.28 * fade, dragon.teal, 0)
      .args(0, a.radius, 0);
    // Twister's coil laid along the pulse: two strands winding out toward the head.
    for (let strand = 0; strand < 2; strand++) {
      for (let i = 0; i <= 40; i++) {
        const k = i / 40;
        const d = a.length * k;
        const turn = d * 3.2 - fx.time * 16 + strand * Math.PI;
        const coil = a.radius * (0.5 + 0.45 * k);
        const side = Math.sin(turn) * coil;
        fx.ribbons.point(
          x + a.dirX * d + a.dirZ * side,
          y + a.rise * d + Math.cos(turn) * coil,
          z + a.dirZ * d - a.dirX * side,
          0.06 * fade * Math.min(1, k * 6),
          strand ? dragon.light : dragon.scale,
          0.8 * fade,
        );
      }
      fx.ribbons.flush(Ribbon.solid, 0.2);
    }
    const ex = x + a.dirX * a.length;
    const ez = z + a.dirZ * a.length;
    fx.sprites.draw(halo, ex, y + a.rise * a.length, ez, a.radius * 3 * fade, 0.85);
    for (let i = perFrame(fx, 6 * fade); i > 0; i--) {
      const d = Math.random() * a.length;
      fx.sprites.emit(
        scale,
        x + a.dirX * d,
        y + a.rise * d,
        z + a.dirZ * d,
        a.dirX * 2,
        0.3,
        a.dirZ * 2,
        0.08,
      );
    }
  },
  strike(fx, a, x, z) {
    const y = fx.ground.heightAt(x, z) + CHEST;
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.36);
    fx.sprites.emit(pop, x, y, z, 0, 0, 0, a.radius * 0.9);
    spray(fx, scale, x, y, z, 3, 1.4, 0.6, 0.08);
  },
};

export const dragonPulse: AreaLook = {
  live(fx, a, x, z, charge) {
    const yaw = Math.atan2(a.dirX, a.dirZ);
    const y = fx.ground.heightAt(x, z) + CHEST;
    if (a.delay > 0) {
      fx.decals
        .put(Decal.strip, x, z, a.length, yaw)
        .rect(-0.07, 0, 0.07, a.length)
        .tint(dragon.teal, 0.5 * charge, dragon.light, 0.1)
        .args(0, 0.07, 2);
      fx.sprites.draw(head, x, y, z, 0.08 + charge * 0.19, 0.8);
      groundArc(
        fx,
        x,
        z,
        0.55 * (1 - charge * 0.6),
        -charge * 5,
        Math.PI * 1.7,
        0.55,
        0.04,
        dragon.scale,
        charge,
      );
      return;
    }
    const fade = Math.min(1, a.life / 0.14);
    // Use the live length/pitch verbatim: the beam ends where cover clipped the sim lane.
    fx.volumes.beams.add(
      place(
        x,
        y,
        z,
        yaw,
        a.radius * fade,
        a.radius * fade,
        a.length * Math.hypot(1, a.rise),
        -Math.atan(a.rise),
      ),
      dragon.teal,
      0.72 * fade,
      dragon.indigo,
      2,
      seedOf(a.id),
    );
    fx.decals
      .put(Decal.strip, x, z, a.length, yaw)
      .rect(-a.radius, 0, a.radius, a.length)
      .tint(dragon.indigo, 0.3 * fade, dragon.teal, 0)
      .args(0, a.radius, 0);
    for (let strand = -1; strand <= 1; strand += 2) {
      for (let i = 0; i <= 64; i++) {
        const d = (a.length * i) / 64;
        const turn = d * 2.5 - fx.time * 13 + (strand * Math.PI) / 2;
        const side = Math.sin(turn) * a.radius * 0.55;
        fx.ribbons.point(
          x + a.dirX * d + a.dirZ * side,
          y + a.rise * d + Math.cos(turn) * a.radius * 0.55,
          z + a.dirZ * d - a.dirX * side,
          Math.min(0.065, a.radius * 0.12) * fade,
          strand === 1 ? dragon.scale : dragon.light,
          0.65 * fade,
        );
      }
      fx.ribbons.flush(Ribbon.solid, 0.15);
    }
    for (let i = perFrame(fx, 14 * fade); i > 0; i--) {
      const d = Math.random() * a.length;
      fx.sprites.emit(
        scale,
        x + a.dirX * d,
        y + a.rise * d,
        z + a.dirZ * d,
        a.dirX,
        0.1,
        a.dirZ,
        0.075,
      );
    }
  },
  strike(fx, _a, x, z) {
    fx.sprites.emit(flash, x, fx.ground.heightAt(x, z) + CHEST, z, 0, 0, 0, 0.4);
  },
};

/**
 * A jade wind funnel whose top spans `r` (the hitbox), a gold coil inside it and a ground whirl;
 * scales are carried up round it.
 */
function tornado(fx: Fx, x: number, z: number, r: number, fade: number, seed: number): void {
  const h = fx.ground.heightAt(x, z);
  const height = Math.min(1.5, 0.45 + r * 0.6);
  fx.decals.put(Decal.glow, x, z, r * 1.1).tint(dragon.indigo, 0.5 * fade, dragon.deep, 0);
  fx.decals.put(Decal.whirl, x, z, r, 0, seed).tint(dragon.light, 0.8 * fade, dragon.teal, 0);
  fx.volumes.funnels.add(
    place(x, h - 0.05, z, fx.time * 6, r * 0.92, height, r * 0.92),
    dragon.light,
    0.95 * fade,
    dragon.teal,
    1,
    seed * 10,
  );
  fx.volumes.funnels.add(
    place(x, h - 0.05, z, -fx.time * 8, r * 0.45, height * 0.8, r * 0.45),
    dragon.scale,
    0.8 * fade,
    dragon.indigo,
    1,
    seed * 10 + 3,
  );
  for (let i = perFrame(fx, (10 + r * 6) * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const d = r * rand(0.3, 0.8);
    fx.sprites.emit(
      scale,
      x + Math.sin(a) * d,
      h + rand(0.1, 0.4),
      z + Math.cos(a) * d,
      Math.cos(a) * 2.4,
      1.8,
      -Math.sin(a) * 2.4,
      0.085,
    );
  }
}

export const twister: AreaLook = {
  live(fx, a, x, z, charge) {
    if (a.delay > 0) {
      groundArc(
        fx,
        x,
        z,
        a.radius * (1 - 0.5 * charge),
        fx.time * 7,
        Math.PI * 1.6,
        0.12,
        0.08,
        dragon.light,
        charge,
      );
      return;
    }
    const fade = Math.min(1, a.life / 0.2);
    tornado(fx, x, z, a.radius, fade, seedOf(a.id));
    discEdge(fx, x, z, a.radius, dragon.light, 0.7 * fade);
  },
  strike(fx, a, x, z) {
    spray(fx, scale, x, fx.ground.heightAt(x, z) + 0.3, z, 6, a.radius * 1.4, 1.4, 0.085);
  },
};

/** A dragon burst: a jade shockwave to the edge, gold scales thrown out; `b` adds a star trail from the sky. */
function drawDragonBurst(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  fx.decals.put(Decal.glow, e.x, e.z, e.a * 1.1).tint(dragon.teal, 0.55 * fade, dragon.light, 1);
  fx.decals
    .put(Decal.ring, e.x, e.z, e.a)
    .tint(dragon.light, 1 - t, dragon.teal, 0.5)
    .args(t * 0.7, 0.18, 0.4);
  groundArc(
    fx,
    e.x,
    e.z,
    e.a * (0.25 + 0.68 * (1 - (1 - t) ** 3)),
    e.seed + t,
    Math.PI * 1.85,
    0.24,
    0.14 * (1 - t),
    dragon.scale,
    fade,
  );
  if (t < 0.3) fx.sprites.draw(flash, e.x, e.y + 0.4, e.z, Math.min(0.9, e.a * 0.4), 1 - t / 0.3);
}

export const dragonBurst: AreaLook = {
  strike(fx, a, x, z) {
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawDragonBurst, 0.3, x, h, z, a.radius);
    spray(fx, scale, x, h + 0.3, z, 10, a.radius * 2, 1.4, 0.09);
  },
};

/** A gale funnel the size of the strike, flinging streaks out as it unwinds. */
function drawGale(fx: Fx, e: Echo, t: number): void {
  const grow = 1 - (1 - Math.min(1, t / 0.25)) ** 3;
  const fade = 1 - t * t;
  tornado(fx, e.x, e.z, e.a * (0.55 + 0.45 * grow), fade, e.seed);
  discEdge(fx, e.x, e.z, e.a, dragon.light, fade);
  for (let i = perFrame(fx, 40 * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    fx.sprites.emit(
      streak,
      e.x + Math.sin(a) * e.a * 0.5,
      e.y + rand(0.2, 0.9),
      e.z + Math.cos(a) * e.a * 0.5,
      Math.sin(a) * 5 + Math.cos(a) * 3,
      0.4,
      Math.cos(a) * 5 - Math.sin(a) * 3,
      0.16,
    );
  }
}

export const hurricane: AreaLook = {
  live(fx, a, x, z, charge) {
    if (a.delay <= 0) return;
    // 准备: the wind eye tightens over the full disc.
    fx.decals
      .put(Decal.whirl, x, z, a.radius, 0, seedOf(a.id))
      .tint(dragon.light, 0.5 * charge, dragon.teal, 0);
    // A small funnel forms at the eye and grows towards the strike.
    const h = fx.ground.heightAt(x, z);
    const r = a.radius * (0.2 + 0.35 * charge);
    fx.volumes.funnels.add(
      place(x, h - 0.05, z, fx.time * 7, r, 0.4 + 0.6 * charge, r),
      dragon.light,
      0.4 + 0.5 * charge,
      dragon.teal,
      1,
      seedOf(a.id) * 10,
    );
    discEdge(fx, x, z, a.radius, dragon.light, 0.35 + 0.4 * charge);
    for (let i = 0; i < 2; i++)
      groundArc(
        fx,
        x,
        z,
        a.radius * (0.9 - charge * 0.6 - i * 0.12),
        -fx.time * 7 + i * Math.PI,
        Math.PI * 1.2,
        0.15 + 0.4 * charge,
        0.08,
        dragon.teal,
        0.8 * charge,
      );
  },
  strike(fx, a, x, z) {
    fx.echoes.add(drawGale, 0.45, x, fx.ground.heightAt(x, z), z, a.radius);
    dragonBurst.strike!(fx, a, x, z);
  },
};

export const dragonRush: ShotLook = {
  launch(fx, x, y, z) {
    dragonBreath.launch!(fx, x, y, z);
  },
  fly(fx, p, x, y, z) {
    const speed = Math.hypot(p.vx, p.vz) || 1;
    const dx = p.vx / speed;
    const dz = p.vz / speed;
    const fade = Math.min(1, p.life / 0.12);
    const r = p.radius;
    // Radial, feathered ground light under the whole hitbox: no rectangle edge.
    fx.decals.put(Decal.glow, x, z, r * 1.25).tint(dragon.teal, 0.6 * fade, dragon.light, 1);
    // An arched crest across the hitbox's front: jade body, gold leading edge.
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i <= 16; i++) {
        const u = i / 8 - 1;
        const side = u * r * 0.95;
        const front = (1 - u * u) * r * 0.55 - layer * 0.12;
        fx.ribbons.point(
          x + dz * side + dx * front,
          y + 0.15 + (1 - u * u) * 0.25 + layer * 0.05,
          z - dx * side + dz * front,
          (layer ? 0.08 : 0.2) * fade,
          layer ? dragon.scale : dragon.teal,
          (layer ? 1 : 0.85) * fade,
        );
      }
      fx.ribbons.flush(layer ? Ribbon.solid : Ribbon.glow, layer ? 0.2 : 0.4);
    }
    fx.volumes.orbs.add(
      place(x + dx * r * 0.4, y + 0.3, z + dz * r * 0.4, fx.time * 4, 0.3, 0.3, 0.3),
      dragon.scale,
      fade,
      dragon.indigo,
      0,
      seedOf(p.id),
    );
    // Scales peel off the crest and stream back along the path.
    for (let i = perFrame(fx, 30 * fade); i > 0; i--) {
      const side = rand(-1, 1) * r;
      fx.sprites.emit(
        scale,
        x + dz * side,
        y + rand(0.1, 0.5),
        z - dx * side,
        -dx * 3,
        0.8,
        -dz * 3,
        0.1,
      );
    }
  },
  hit(fx, x, y, z) {
    dragonBreath.hit!(fx, x, y, z);
  },
  fade(fx, x, y, z) {
    spray(fx, scale, x, y, z, 6, 1.6, 1, 0.09);
  },
};

/**
 * Aqua Tail from its landing frame: the sector floods, a thick water blade sweeps across it over the
 * first 35 % and foam peels off its outer half. `a` is the locked yaw, `b` the reach.
 */
function drawTail(fx: Fx, e: Echo, t: number): void {
  const yaw = e.a;
  const length = e.b;
  const half = STRIKE.angle;
  const fade = (1 - Math.max(0, (t - 0.3) / 0.7)) ** 1.5;
  const side = length * Math.sin(half);
  fx.decals
    .put(Decal.sector, e.x, e.z, length, yaw, e.seed)
    .rect(-side, 0, side, length)
    .tint(water.mid, 0.6 * fade, water.light, 0.2)
    .args(0, half, 0);
  for (let band = 0; band < 2; band++)
    groundArc(
      fx,
      e.x,
      e.z,
      length * (0.55 + band * 0.25),
      yaw - half,
      half * 2,
      0.2,
      length * 0.16 * fade,
      water.mid,
      0.7 * fade,
    );
  groundArc(fx, e.x, e.z, length * 0.96, yaw - half, half * 2, 0.3, 0.2 * fade, water.foam, fade);
  const angle = yaw - half + half * 2 * Math.min(1, t / 0.35);
  for (let i = 0; i <= 12; i++) {
    const k = i / 12;
    const d = length * (0.15 + 0.82 * k);
    const bend = angle - 0.35 * (1 - k);
    fx.ribbons.point(
      e.x + Math.sin(bend) * d,
      e.y + 0.3 + 0.25 * Math.sin(k * Math.PI),
      e.z + Math.cos(bend) * d,
      (0.34 - k * 0.18) * fade,
      k > 0.7 ? water.foam : water.mid,
      fade,
    );
  }
  fx.ribbons.flush(Ribbon.solid, 0.1);
  if (t > 0.4) return;
  for (let i = perFrame(fx, 80); i > 0; i--) {
    const d = length * rand(0.5, 1);
    fx.sprites.emit(
      foam,
      e.x + Math.sin(angle) * d,
      e.y + 0.35,
      e.z + Math.cos(angle) * d,
      Math.cos(angle) * 2,
      2.2,
      -Math.sin(angle) * 2,
      0.09,
    );
  }
}

export const aquaTail: AreaLook = {
  strike(fx, a, x, z) {
    const h = fx.ground.heightAt(x, z);
    fx.echoes.add(drawTail, 0.36, x, h, z, Math.atan2(a.dirX, a.dirZ), a.length);
    spray(
      fx,
      foam,
      x + a.dirX * a.length * 0.7,
      h + 0.35,
      z + a.dirZ * a.length * 0.7,
      10,
      1.6,
      1.4,
      0.1,
    );
  },
};

// Draco Meteor (ultimate): an orb shot into the sky at the cast, jade serpents racing out along the
// lanes, then meteors slamming down from the sky onto their discs. Every ground shape is the hitbox.

const mote = sprite({
  shape: Shape.spark,
  life: 0.55,
  grow: 0.3,
  from: dragon.light,
  to: dragon.teal,
  accent: dragon.scale,
  add: 1,
  gravity: 6,
  drag: 1.5,
  stretch: 0.05,
});
const starburst = sprite({
  shape: Shape.star,
  life: 0.3,
  grow: 1.4,
  from: dragon.light,
  to: dragon.teal,
  accent: dragon.scale,
  add: 1,
});

const SKY_ORB = 7.5;

/** The cast: a dragon-fire orb climbs into the sky behind the caster and bursts where the meteors come from. */
export function dracoCast(fx: Fx, x: number, h: number, z: number): void {
  fx.echoes.add(drawSkyOrb, 0.55, x, h, z);
  spray(fx, scale, x, h + CHEST, z, 14, 4, 4, 0.12);
}

function drawSkyOrb(fx: Fx, e: Echo, t: number): void {
  const [tx, rise, tz] = skyTop(fx, e.x, e.z, SKY_ORB);
  const climb = 1 - (1 - Math.min(1, t / 0.55)) ** 2;
  const px = e.x + (tx - e.x) * climb;
  const py = e.y + CHEST + (rise - CHEST) * climb;
  const pz = e.z + (tz - e.z) * climb;
  if (t < 0.55) {
    const s = 0.5 + 0.15 * climb;
    fx.volumes.orbs.add(place(px, py, pz, 0, s, s, s), dragon.teal, 1, dragon.indigo, 0, e.seed);
    const lag = Math.max(0, climb - 0.35);
    fx.ribbons.point(
      e.x + (tx - e.x) * lag,
      e.y + CHEST + (rise - CHEST) * lag,
      e.z + (tz - e.z) * lag,
      0.05,
      dragon.indigo,
      0,
    );
    fx.ribbons.point(px, py, pz, 0.45, dragon.teal, 1);
    fx.ribbons.flush(Ribbon.streak, 0.6);
    return;
  }
  // The burst: a jade star that opens and goes, the meteors' source.
  const k = (t - 0.55) / 0.45;
  fx.sprites.draw(halo, px, py, pz, 1.2 + 1.6 * k, 1 - k);
  fx.sprites.draw(starburst, px, py, pz, 1.4 * (1 - k * 0.5), 1 - k * k, 0, 0, 0, e.seed, k);
}

/** One lane: a jade band over its full reach at once (the hitbox), a serpent of light racing along it. */
function drawDragonLane(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  const half = e.y;
  // The rect is twice the band's half-width so its exponential falloff ends before the edge.
  fx.decals
    .put(Decal.strip, e.x, e.z, e.c, Math.atan2(e.a, e.b))
    .rect(-half * 2, 0, half * 2, e.c)
    .tint(dragon.teal, fade, dragon.light, 1)
    .args(0, half, 0);
  const run = 1 - (1 - Math.min(1, t / 0.3)) ** 2;
  const front = e.c * run;
  const tail = Math.max(0, front - 3.5);
  for (const [width, colour, add] of [
    [0.5, dragon.teal, 1],
    [0.16, dragon.scale, 0.6],
  ] as const) {
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      const d = tail + (front - tail) * k;
      const weave = Math.sin(d * 1.8 - t * 18 + e.seed) * half * 0.7;
      const px = e.x + e.a * d - e.b * weave;
      const pz = e.z + e.b * d + e.a * weave;
      fx.ribbons.point(
        px,
        fx.ground.heightAt(px, pz) + 0.45 + 0.25 * Math.sin(d * 1.3 + e.seed),
        pz,
        width * Math.sin(k * Math.PI * 0.5 + 0.15) * fade,
        colour,
        k * fade,
      );
    }
    fx.ribbons.flush(Ribbon.glow, add);
  }
  const hx = e.x + e.a * front;
  const hz = e.z + e.b * front;
  const hy = fx.ground.heightAt(hx, hz) + 0.5;
  fx.sprites.draw(halo, hx, hy, hz, 0.7 * fade, fade);
  // The serpent reaches the lane's end: a star flash there.
  if (t > 0.3 && t < 0.55) {
    const k = (t - 0.3) / 0.25;
    fx.sprites.draw(starburst, hx, hy, hz, 0.9 * (1 - k * 0.4), 1 - k, 0, 0, 0, e.seed, k);
  }
}

/** A meteor slams down from the sky onto its disc: the streak collapses into the ground as it flashes. */
function drawMeteor(fx: Fx, e: Echo, t: number): void {
  const [tx, rise, tz] = skyTop(fx, e.x, e.z, 10);
  const drop = 1 - (1 - Math.min(1, t / 0.22)) ** 2;
  if (drop < 1) {
    const top = drop;
    for (const [width, colour] of [
      [Math.min(1.1, e.a * 0.6), dragon.teal],
      [Math.min(0.35, e.a * 0.2), dragon.light],
    ] as const) {
      fx.ribbons.point(
        tx + (e.x - tx) * top,
        rise + (e.y - rise) * top,
        tz + (e.z - tz) * top,
        width * 0.3,
        colour,
        0.2,
      );
      fx.ribbons.point(e.x, e.y + 0.2, e.z, width * (1 - drop * 0.6), colour, 1 - drop * 0.5);
      fx.ribbons.flush(Ribbon.glow, 1);
    }
  }
  if (t < 0.22) {
    const s = e.a * 0.45 * (1 - t / 0.22);
    fx.volumes.orbs.add(
      place(e.x, e.y + s * 0.6, e.z, 0, s, s, s),
      dragon.teal,
      1,
      dragon.indigo,
      0,
      e.seed,
    );
  }
  if (t < 0.35) {
    const k = t / 0.35;
    fx.sprites.draw(
      starburst,
      e.x,
      e.y + 0.5,
      e.z,
      Math.min(1.8, e.a * 0.95) * (1 - k * 0.3),
      1 - k * k,
      0,
      0,
      0,
      e.seed,
      k,
    );
  }
  fx.decals
    .put(Decal.ring, e.x, e.z, e.a)
    .tint(dragon.light, (1 - t) * 0.9, dragon.indigo, 0.8)
    .args(Math.min(1, t * 1.6), 0.28, 0.25);
  drawDragonBurst(fx, e, t);
}

function crater(fx: Fx, x: number, z: number, r: number, life: number): void {
  fx.decals.stamp(Decal.scorch, x, z, r * 0.9, life, dragon.deep, 1.6, dragon.teal, 0, 0, 0);
  fx.decals.stamp(Decal.cracks, x, z, r, life * 0.8, dragon.scale, 1, dragon.deep, 0);
}

export function dracoMeteor(fx: Fx, e: UltPulseEvent): void {
  if (e.look === "roots") {
    // A lane fully blocked by cover arrives with length 0: nothing to draw.
    if (e.length <= 0) return;
    fx.echoes.add(drawDragonLane, 0.55, e.x, e.radius, e.z, e.dirX, e.dirZ, e.length);
    const tx = e.x + e.dirX * e.length;
    const tz = e.z + e.dirZ * e.length;
    spray(fx, scale, tx, fx.ground.heightAt(tx, tz) + 0.4, tz, 6, 3, 2.5, 0.1);
    return;
  }
  const big = e.look !== "meteor";
  const h = fx.ground.heightAt(e.x, e.z);
  fx.echoes.add(drawMeteor, big ? 0.7 : 0.55, e.x, h, e.z, e.radius);
  crater(fx, e.x, e.z, e.radius, big ? 2.6 : 2);
  spray(fx, scale, e.x, h + 0.25, e.z, big ? 18 : 12, e.radius * 2.2, 2.5, 0.11);
  spray(fx, mote, e.x, h + 0.2, e.z, big ? 22 : 14, e.radius * 1.2, 8, 0.12);
  spray(fx, rubble, e.x, h + 0.2, e.z, big ? 10 : 6, e.radius * 1.2, 0.6, 0.3);
}
