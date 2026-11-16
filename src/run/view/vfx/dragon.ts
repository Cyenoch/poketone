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

/** Dragon Tempest's side shots: thrown gold scales with a short jade streak. */
export const dragonScales: ShotLook = {
  ...dragonBreath,
  fly(fx, p, x, y, z) {
    fx.sprites.draw(halo, x, y, z, p.radius * 2.4, 0.5);
    fx.sprites.draw(scale, x, y, z, p.radius * 1.4, 1, p.vx, p.vz, fx.time * 12, seedOf(p.id));
    fx.sprites.draw(streak, x - p.vx * 0.02, y, z - p.vz * 0.02, p.radius * 0.8, 0.8, p.vx, p.vz);
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

/** One root lane: a feathered jade band to its full reach, a gold streak racing along it. */
function drawDragonLane(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  const half = e.y;
  // The rect is twice the band's half-width so its exponential falloff ends before the edge.
  fx.decals
    .put(Decal.strip, e.x, e.z, e.c, Math.atan2(e.a, e.b))
    .rect(-half * 2, 0, half * 2, e.c)
    .tint(dragon.teal, 0.8 * fade, dragon.light, 0.4)
    .args(0, half, 0);
  const head = Math.min(1, t / 0.4);
  for (let i = 0; i <= 16; i++) {
    const d = e.c * head * (i / 16);
    const px = e.x + e.a * d;
    const pz = e.z + e.b * d;
    fx.ribbons.point(
      px,
      fx.ground.heightAt(px, pz) + 0.3,
      pz,
      half * 0.4 * fade,
      dragon.scale,
      (i / 16) * fade,
    );
  }
  fx.ribbons.flush(Ribbon.streak, 0.3);
}

/** A meteor's last instant: its trail from the sky retracts as the crater flashes. */
function drawMeteor(fx: Fx, e: Echo, t: number): void {
  const fall = Math.min(1, t / 0.18);
  const rise = 5.5 * (1 - fall * 0.85);
  const lean = rise * 0.6;
  const tail = Math.min(1, t / 0.35);
  fx.ribbons.point(
    e.x - Math.sin(fx.viewYaw) * lean,
    e.y + rise,
    e.z - Math.cos(fx.viewYaw) * lean,
    0.06,
    dragon.indigo,
    0,
  );
  fx.ribbons.point(e.x, e.y + 0.3, e.z, e.a * 0.35 * (1 - tail), dragon.scale, 1 - tail);
  fx.ribbons.flush(Ribbon.streak, 0.35);
  if (t < 0.25) {
    const s = e.a * 0.4 * (1 - t / 0.25);
    fx.volumes.orbs.add(
      place(e.x, e.y + s, e.z, 0, s, s, s),
      dragon.scale,
      1,
      dragon.indigo,
      0,
      e.seed,
    );
  }
  drawDragonBurst(fx, e, t);
}

function crater(fx: Fx, x: number, z: number, r: number, life: number): void {
  fx.decals.stamp(Decal.scorch, x, z, r * 0.85, life, dragon.deep, 1.4, dragon.scale, 0, 0, 0);
  fx.decals.stamp(Decal.cracks, x, z, r, life * 0.8, dragon.scale, 1, dragon.deep, 0);
}

export function dracoMeteor(fx: Fx, e: UltPulseEvent): void {
  if (e.look === "roots") {
    // A lane fully blocked by cover arrives with length 0: nothing to draw.
    if (e.length > 0)
      fx.echoes.add(drawDragonLane, 0.4, e.x, e.radius, e.z, e.dirX, e.dirZ, e.length);
    return;
  }
  const h = fx.ground.heightAt(e.x, e.z);
  fx.echoes.add(drawMeteor, e.look === "meteor" ? 0.45 : 0.6, e.x, h, e.z, e.radius);
  crater(fx, e.x, e.z, e.radius, e.look === "meteor" ? 2 : 2.6);
  spray(fx, scale, e.x, h + 0.25, e.z, 10, e.radius * 2, 2, 0.1);
  spray(fx, rubble, e.x, h + 0.2, e.z, 6, e.radius * 1.2, 0.6, 0.3);
}
