// Abra line: pink refracted thought-light, concentric waves and sharp crystals. All damaging
// boundaries come from the live area/event; prism accents stay thin and inside the beam.
import { CHEST } from "../../sim/content/params/combat";
import type { UltPulseEvent } from "../../sim/state/events";
import { Decal } from "./decals";
import { perFrame, seedOf, spray, type AreaLook, type Echo, type Fx, type ShotLook } from "./fx";
import { discEdge, groundArc } from "./line-shapes";
import { psychic as colour } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

const shard = sprite({
  shape: Shape.gem,
  life: 0.24,
  grow: 0.15,
  from: colour.pink,
  to: colour.lilac,
  accent: colour.rose,
  drag: 5,
  stretch: -1,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.12,
  grow: 0.15,
  from: colour.light,
  accent: colour.core,
  add: 0.25,
});
const mote = sprite({
  shape: Shape.gem,
  life: 0.18,
  grow: 0.1,
  from: colour.light,
  to: colour.rose,
  accent: colour.pink,
  drag: 5,
});

/** Also draws BLOOM's real sideways projectiles: crystals, never the floral parent's leaves. */
export const confusion: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.18);
  },
  fly(fx, p, x, y, z) {
    fx.sprites.draw(shard, x, y, z, p.radius, 1, p.vx, p.vz, 0, seedOf(p.id));
    const speed = Math.hypot(p.vx, p.vz) || 1;
    for (let i = 0; i <= 4; i++) {
      const d = (i / 4) * Math.min(0.65, speed * 0.035);
      fx.ribbons.point(
        x - (p.vx / speed) * d,
        y + Math.sin(fx.time * 18 + i) * p.radius * 0.12,
        z - (p.vz / speed) * d,
        p.radius * 0.35 * (1 - i / 4),
        colour.pink,
        0.65 * (1 - i / 4),
      );
    }
    fx.ribbons.flush(Ribbon.solid, 0.15);
  },
  hit(fx, x, y, z) {
    spray(fx, mote, x, y, z, 3, 1.4, 0.4, 0.09);
  },
  fade(fx, x, y, z) {
    fx.sprites.emit(mote, x, y, z, 0, 0.2, 0, 0.12);
  },
};

const hypnoDisc = sprite({ shape: Shape.spiral, from: colour.pink, accent: colour.light });
/** Seconds a hypnotic wave takes to roll from the spiral out to the cone's real reach. */
const WAVE_TRAVEL = 0.6;
const RING_POINTS = 36;
const RING_FILL = 0.92;
/** Each hoop is open at the back (fraction of a full turn kept), so successive waves nest instead of crossing. */
const RING_OPEN = 0.74;
const SPIRAL_LIFT = 0.25;

/**
 * Hypnosis: a spinning, inked hypnotic disc in front of the caster sends one hoop per damage tick.
 * Each hoop floats at chest height and grows as it eases down the aim until it fills the real fan's
 * width and reach, then opens from its near side; the disc pulses as each hoop leaves it.
 */
export const hypnosis: AreaLook = {
  live(fx, a, x, z, charge) {
    const age = Math.max(0, a.maxLife - a.life);
    const end = Math.min(1, Math.max(0, a.life / 0.25));
    const yaw = Math.atan2(a.dirX, a.dirZ);
    const focus = Math.min(0.4, a.length * 0.15);
    const fx0 = x + a.dirX * focus;
    const fz0 = z + a.dirZ * focus;
    const top = fx.ground.heightAt(fx0, fz0) + CHEST + SPIRAL_LIFT;
    // Waves leave on the damage ticks: tickTimer counts down to the next one.
    const since = charge < 1 ? 0 : Math.max(0, a.tick - a.tickTimer);
    let size: number;
    if (charge < 1) size = 0.08 + charge * 0.14;
    else {
      // Cast pop with a small overshoot, then a kick each time a wave leaves the disc.
      const t = Math.min(1, age / 0.14);
      const pop = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
      size = 0.24 * pop * (1 + 0.14 * Math.exp(-since * 16)) * (0.25 + 0.75 * end);
    }
    fx.sprites.draw(hypnoDisc, fx0, top, fz0, size, 1, 0, 0, -fx.time * 7);
    if (charge < 1 || a.delay > 0 || a.life <= 0 || a.tick <= 0) return;
    // A hoop of radius r centred c down the aim stays in the fan while r ≤ c·sin(angle) and in reach
    // while c + r ≤ length.
    const sin = Math.sin(a.angle) * RING_FILL;
    const last = (a.length - 0.02) / (1 + sin);
    for (let j = 0; j * a.tick + since < WAVE_TRAVEL; j++) {
      const elapsed = j * a.tick + since;
      if (elapsed > age + 1e-6) break;
      const p = elapsed / WAVE_TRAVEL;
      const ease = 1 - (1 - p) ** 2;
      const c = focus + (last - focus) * ease;
      const r = c * Math.sin(a.angle) * RING_FILL;
      // Over the last third of travel the hoop shortens toward its leading edge, which breaks last on
      // the targets; the area's own end closes every hoop the same way.
      const span = RING_OPEN * Math.min(1, (1 - p) / 0.35) * end;
      if (span <= 0.015) continue;
      const appear = Math.min(1, p * 8);
      const launch = Math.round((age - elapsed) / a.tick);
      const tint = launch % 2 ? colour.lilac : colour.pink;
      const y0 = CHEST + SPIRAL_LIFT * (1 - ease);
      const width = (0.08 - 0.03 * ease) * appear;
      const cx = x + a.dirX * c;
      const cz = z + a.dirZ * c;
      for (let layer = 0; layer < 3; layer++) {
        for (let k = 0; k <= RING_POINTS; k++) {
          const v = (k / RING_POINTS) * 2 - 1;
          const turn = yaw + v * span * Math.PI;
          const px = cx + Math.sin(turn) * r;
          const pz = cz + Math.cos(turn) * r;
          const taper = Math.min(1, (1 - Math.abs(v)) * 4);
          const y = fx.ground.heightAt(px, pz) + y0;
          if (layer === 0)
            fx.ribbons.point(px, y, pz, (width + 0.03 * appear) * taper, colour.ink, 0.7);
          else if (layer === 1) fx.ribbons.point(px, y, pz, width * taper, tint, 1);
          else fx.ribbons.point(px, y, pz, width * 0.3 * taper, colour.core, 0.85);
        }
        fx.ribbons.flush(Ribbon.solid, 0);
      }
    }
  },
};

/** Full clipped lane, pitched at the sim's rise; narrow helical strands give Psybeam its prism. */
function beam(
  fx: Fx,
  x: number,
  z: number,
  dx: number,
  dz: number,
  rise: number,
  length: number,
  radius: number,
  fade: number,
  prism: boolean,
): void {
  if (length <= 0) return;
  const y = fx.ground.heightAt(x, z) + CHEST;
  fx.decals
    .put(Decal.strip, x, z, length, Math.atan2(dx, dz))
    .rect(-radius, 0, radius, length)
    .tint(colour.rose, 0.24 * fade, colour.light, 0)
    .args(0, radius, 1);
  for (let strand = 0; strand < 3; strand++) {
    const tint =
      strand === 0
        ? colour.pink
        : prism
          ? strand === 1
            ? colour.lemon
            : colour.mint
          : colour.light;
    for (let i = 0; i <= 32; i++) {
      const d = (i / 32) * length;
      const angle = d * 3 - fx.time * 12 + strand * Math.PI;
      const turn = strand === 0 ? 0 : radius * 0.62;
      const side = Math.cos(angle) * turn;
      fx.ribbons.point(
        x + dx * d + dz * side,
        y + rise * d + Math.sin(angle) * turn,
        z + dz * d - dx * side,
        radius * (strand === 0 ? 0.7 : 0.15) * fade,
        tint,
        (strand === 0 ? 0.85 : 0.65) * fade,
      );
    }
    fx.ribbons.flush(Ribbon.solid, strand === 0 ? 0 : 0.15);
  }
}

export const psybeam: AreaLook = {
  live(fx, a, x, z, charge) {
    if (charge < 1) {
      beam(fx, x, z, a.dirX, a.dirZ, a.rise, a.length, a.radius * 0.12, 0.25 + charge * 0.4, false);
      fx.sprites.draw(
        shard,
        x,
        fx.ground.heightAt(x, z) + CHEST,
        z,
        0.08 + charge * 0.16,
        0.8,
        0,
        0,
        fx.time * 3,
      );
      return;
    }
    beam(
      fx,
      x,
      z,
      a.dirX,
      a.dirZ,
      a.rise,
      a.length,
      a.radius,
      Math.min(1, a.life / 0.15),
      a.move === "psybeam",
    );
  },
  strike(fx, _a, x, z) {
    fx.sprites.emit(flash, x, fx.ground.heightAt(x, z) + CHEST, z, 0, 0, 0, 0.3);
  },
};

/** Uneven crystal fragments break from the impact centre. b: inward pull; c: thin sky column. */
function drawBurst(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  discEdge(fx, e.x, e.z, e.a, colour.pink, 0.85 * fade);
  fx.decals.put(Decal.glow, e.x, e.z, e.a).tint(colour.rose, 0.25 * fade, colour.light, 0.1);
  const open = 1 - (1 - t) ** 3;
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.39996 + e.seed;
    const spread = 0.65 + seedOf(i + 7) * 0.35;
    const d = e.a * spread * (e.b ? 0.78 * (1 - open) : 0.25 + 0.53 * open);
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    fx.sprites.draw(
      shard,
      e.x + dx * d,
      e.y + 0.3,
      e.z + dz * d,
      Math.min(0.35, e.a * 0.16) * spread * (1 - t),
      fade,
      dx,
      dz,
    );
  }
  if (t < 0.25) fx.sprites.draw(flash, e.x, e.y + 0.4, e.z, Math.min(0.5, e.a * 0.25), 1 - t * 4);
  if (e.c) {
    const lean = 2 * (1 - t);
    fx.ribbons.point(
      e.x - Math.sin(fx.viewYaw) * lean,
      e.y + 5 * (1 - t),
      e.z - Math.cos(fx.viewYaw) * lean,
      0.03,
      colour.lilac,
      0,
    );
    fx.ribbons.point(e.x, e.y + 0.15, e.z, Math.min(0.35, e.a * 0.2) * (1 - t), colour.light, fade);
    fx.ribbons.flush(Ribbon.solid, 0.2);
  }
}

function burst(fx: Fx, x: number, z: number, r: number, pull = false, column = false): void {
  fx.echoes.add(drawBurst, 0.28, x, fx.ground.heightAt(x, z), z, r, Number(pull), Number(column));
}

export const psychic: AreaLook = {
  live(fx, a, x, z, charge) {
    if (charge >= 1) return;
    const future = a.move === "future-sight";
    discEdge(fx, x, z, a.radius, colour.pink, 0.45 + charge * 0.4);
    // A pink tint that deepens with the charge, so the warned zone is psychic colour, not a grey outline.
    fx.decals
      .put(Decal.glow, x, z, a.radius)
      .tint(colour.rose, 0.12 + charge * 0.25, colour.pink, 0.4);
    const r = a.radius * (0.8 - charge * 0.6);
    groundArc(fx, x, z, r, fx.time * 2, Math.PI * 2, 0.12, 0.07, colour.pink, 0.7);
    if (future) {
      // Four aligned crystals form the long-lived prophecy seal; its centre tightens until impact.
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        fx.sprites.draw(
          shard,
          x + Math.sin(angle) * a.radius * 0.6,
          fx.ground.heightAt(x, z) + 0.12 + charge * 0.25,
          z + Math.cos(angle) * a.radius * 0.6,
          0.13 + charge * 0.08,
          0.8,
          0,
          0,
          angle,
        );
      }
    }
  },
  strike(fx, a, x, z) {
    burst(fx, x, z, a.radius, false, a.move === "future-sight");
    // The release: a pink ring at the full edge and crystal shards thrown to it.
    const r = a.radius;
    fx.decals.stamp(Decal.glow, x, z, r, 0.25, colour.rose, 0.35, colour.light, 0.6);
    fx.decals.stamp(Decal.ring, x, z, r, 0.3, colour.pink, 0.9, colour.light, 0.5, 0.06, 1);
    spray(
      fx,
      shatter,
      x,
      fx.ground.heightAt(x, z) + 0.4,
      z,
      Math.round(r * 4) + 2,
      r * 2.2,
      2,
      0.12,
    );
  },
};

export const psystrike: AreaLook = {
  live(fx, a, x, z, charge) {
    psybeam.live!(fx, a, x, z, charge);
    if (charge < 1) return;
    // The sim emits every damaging side shard. Only tiny, short motes decorate the beam here.
    for (let i = perFrame(fx, 10 * Math.min(1, a.life / 0.15)); i > 0; i--) {
      const d = Math.random() * a.length;
      fx.sprites.emit(
        mote,
        x + a.dirX * d,
        fx.ground.heightAt(x, z) + CHEST + a.rise * d,
        z + a.dirZ * d,
        0,
        0.2,
        0,
        0.08,
      );
    }
  },
  strike(fx, a, x, z) {
    psybeam.strike!(fx, a, x, z);
  },
};

export const psystrikeBurst: AreaLook = {
  strike(fx, a, x, z) {
    burst(fx, x, z, a.radius);
  },
};

const shatter = sprite({
  shape: Shape.gem,
  life: 0.3,
  grow: 0.2,
  from: colour.light,
  to: colour.pink,
  accent: colour.rose,
  drag: 6,
  stretch: -1,
});
const castFlash = sprite({
  shape: Shape.star,
  life: 0.14,
  grow: 1.4,
  from: colour.pink,
  accent: colour.core,
  add: 0.8,
  spin: 2,
});

/** Seconds a crystal takes for one jump; the links stay `LINGER` after it lands. */
const HOP = 0.035;
const LINGER = 0.2;

/**
 * Psyshock along the exact chain points: a pink crystal leaps target to target, each jump a straight
 * refracted link (a soft pink glow round a pale core) that shrinks away after it lands; each landing
 * shatters into gems over a small ring. HOP per jump, so it reads as jumping while the hits land at once.
 */
function drawRefraction(fx: Fx, e: Echo, t: number): void {
  const elapsed = t * e.life;
  const before = elapsed - fx.dt;
  for (let i = 2, hop = 0; i < e.points.length; i += 2, hop++) {
    const start = hop * HOP;
    const local = Math.min(1, (elapsed - start) / HOP);
    if (local <= 0) break;
    const ax = e.points[i - 2]!;
    const az = e.points[i - 1]!;
    const bx = e.points[i]!;
    const bz = e.points[i + 1]!;
    const ay = fx.ground.heightAt(ax, az) + CHEST;
    const by = fx.ground.heightAt(bx, bz) + CHEST;
    const hx = ax + (bx - ax) * local;
    const hy = ay + (by - ay) * local;
    const hz = az + (bz - az) * local;
    const k = 1 - Math.max(0, Math.min(1, (elapsed - start - HOP) / LINGER));
    const fade = k * k;
    for (let layer = 0; layer < 2; layer++) {
      const width = layer ? 0.045 : 0.16;
      const tint = layer ? colour.core : colour.pink;
      fx.ribbons.point(ax, ay, az, width * 0.5 * k, tint, fade * 0.6);
      fx.ribbons.point(hx, hy, hz, width * k, tint, fade);
      fx.ribbons.flush(layer ? Ribbon.solid : Ribbon.glow, layer ? 0.3 : 0.8);
    }
    if (local < 1) {
      fx.sprites.draw(shard, hx, hy, hz, 0.22, 1, bx - ax, bz - az);
      continue;
    }
    if (before < start + HOP) {
      fx.sprites.emit(flash, bx, by, bz, 0, 0, 0, 0.3);
      fx.decals.stamp(
        Decal.ring,
        bx,
        bz,
        0.6,
        0.25,
        colour.pink,
        0.8,
        colour.light,
        0.5,
        0.12,
        0.3,
      );
      for (let j = 0; j < 4; j++) {
        const a = (j / 4) * Math.PI * 2 + hop;
        fx.sprites.emit(shatter, bx, by, bz, Math.cos(a) * 2.2, 0.6, Math.sin(a) * 2.2, 0.13);
      }
    }
  }
}

export function psyshock(fx: Fx, points: readonly number[]): void {
  if (points.length < 4) return;
  const x = points[0]!;
  const z = points[1]!;
  fx.sprites.emit(castFlash, x, fx.ground.heightAt(x, z) + CHEST, z, 0, 0, 0, 0.3);
  fx.echoes.add(drawRefraction, (points.length / 2 - 1) * HOP + LINGER, 0, 0, 0, 0, 0, 0, points);
}

function drawMindLane(fx: Fx, e: Echo, t: number): void {
  beam(fx, e.x, e.z, e.a, e.b, 0, e.c, e.y, (1 - t) ** 2, false);
}

export function psychicField(fx: Fx, e: UltPulseEvent): void {
  if (e.look === "roots") {
    fx.echoes.add(drawMindLane, 0.24, e.x, e.radius, e.z, e.dirX, e.dirZ, e.length);
    return;
  }
  const r = e.radius;
  const h = fx.ground.heightAt(e.x, e.z);
  burst(fx, e.x, e.z, r, e.look === "ring", e.look === "meteor");
  // The landing: a psychic-pink wash over the whole field, its edge held and shards thrown to it.
  fx.sprites.emit(castFlash, e.x, h + CHEST, e.z, 0, 0, 0, Math.min(1.6, r * 0.35));
  fx.decals.stamp(Decal.glow, e.x, e.z, r, 0.5, colour.rose, 0.5, colour.light, 0.8);
  fx.decals.stamp(Decal.ring, e.x, e.z, r, 0.55, colour.pink, 1, colour.light, 0.6, 0.08, 1);
  spray(fx, shatter, e.x, h + 0.4, e.z, Math.round(r * 5) + 4, r * 2.4, 2.5, 0.15);
}
