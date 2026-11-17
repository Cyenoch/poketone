// Geodude line: tumbling faceted stone, earth fractures and low dust. ROD's target events draw
// aftershocks from the impact point; its search radius must not look like a damaging disc.
import { ROD, WAVE } from "../../sim/content/params/archetypes";
import { CHEST } from "../../sim/content/params/combat";
import type { UltPulseEvent } from "../../sim/state/events";
import { Decal } from "./decals";
import { perFrame, seedOf, spray, type AreaLook, type Echo, type Fx, type ShotLook } from "./fx";
import { discEdge, groundArc } from "./line-shapes";
import { rock } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

const boulder = sprite({ shape: Shape.rock, from: rock.stone, accent: rock.dark });
const chip = sprite({
  shape: Shape.rock,
  life: 0.3,
  grow: 0.2,
  from: rock.light,
  to: rock.dark,
  accent: rock.ink,
  gravity: 12,
  drag: 4,
  spin: 8,
});
const dust = sprite({
  shape: Shape.puff,
  life: 0.28,
  grow: 0.5,
  from: rock.dust,
  to: rock.clay,
  accent: rock.dark,
  alpha: 0.45,
  drag: 4,
});

/** A tapered solid shard rising from the ground, shaded on two faces. */
function pillar(fx: Fx, x: number, z: number, height: number, width: number, fade: number): void {
  const h = fx.ground.heightAt(x, z);
  for (let face = 0; face < 2; face++) {
    const off = face * width * 0.25;
    fx.ribbons.point(
      x + off,
      h + 0.06,
      z,
      width * (face ? 0.42 : 1),
      face ? rock.light : rock.dark,
      fade,
    );
    fx.ribbons.point(
      x + off - width * 0.15,
      h + height * 0.7,
      z,
      width * (face ? 0.3 : 0.7),
      face ? rock.light : rock.stone,
      fade,
    );
    fx.ribbons.point(x - width * 0.3, h + height, z, 0, rock.light, fade);
    fx.ribbons.flush(Ribbon.solid, 0);
  }
}

/** Full damage edge immediately; secondary raised stones settle inside it. b: pillar finale. */
function drawQuake(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  discEdge(fx, e.x, e.z, e.a, rock.dust, 0.8 * fade);
  fx.decals
    .put(Decal.cracks, e.x, e.z, e.a, 0, e.seed)
    .tint(rock.light, 0.8 * fade, rock.ink, 0)
    .args(t, 1);
  const travel = 1 - (1 - t) ** 3;
  for (let i = 0; i < 9; i++) {
    const angle = e.seed + (i / 9) * Math.PI * 2;
    const d = e.a * (0.25 + travel * 0.52);
    const x = e.x + Math.sin(angle) * d;
    const z = e.z + Math.cos(angle) * d;
    const size = Math.min(0.28, e.a * 0.12) * (1 - t);
    if (e.b) pillar(fx, x, z, (0.5 + (i % 3) * 0.3) * (1 - t), size, fade);
    else
      fx.sprites.draw(
        boulder,
        x,
        fx.ground.heightAt(x, z) + size,
        z,
        size,
        fade,
        0,
        0,
        e.seed + i + t * 2,
        i * 0.17,
      );
  }
}

function quake(fx: Fx, x: number, z: number, r: number, pillars = false): void {
  const h = fx.ground.heightAt(x, z);
  fx.echoes.add(drawQuake, 0.28, x, h, z, r, Number(pillars));
  spray(fx, chip, x, h + 0.25, z, pillars ? 10 : 6, r * 1.5, 2, 0.12);
  spray(fx, dust, x, h + 0.15, z, 4, r, 0.3, Math.min(0.32, r * 0.15));
  // The aged cracks shader has lost its hot edge: a short harmless, rimless residue.
  fx.decals.stamp(Decal.cracks, x, z, r * 0.85, 0.65, rock.clay, 0.35, rock.ink, 0, 1);
}

export const rockThrow: ShotLook = {
  launch(fx, x, y, z) {
    spray(fx, dust, x, y, z, 3, 0.6, 0.2, 0.12);
  },
  fly(fx, p, x, y, z) {
    fx.sprites.draw(boulder, x, y, z, p.radius, 1, 0, 0, fx.time * 9 + p.id, seedOf(p.id));
    fx.decals.put(Decal.glow, x, z, p.radius).tint(rock.ink, 0.45, rock.ink, 0);
    for (let i = perFrame(fx, 10); i > 0; i--)
      fx.sprites.emit(dust, x, y, z, -p.vx * 0.05, 0, -p.vz * 0.05, 0.08);
  },
  fade(fx, x, y, z) {
    spray(fx, chip, x, y, z, 3, 0.5, 0.3, 0.07);
  },
};

export const rockBurst: AreaLook = {
  strike(fx, a, x, z) {
    quake(fx, x, z, a.radius);
  },
};

export const rollout: ShotLook = {
  launch(fx, x, y, z) {
    rockThrow.launch!(fx, x, y, z);
  },
  fly(fx, p, x, _y, z) {
    const speed = Math.hypot(p.vx, p.vz) || 1;
    const dx = p.vx / speed;
    const dz = p.vz / speed;
    const fade = Math.min(1, p.life / 0.12);
    // A row of rolling rocks spans the actual band; a giant sphere would imply a deep round hitbox.
    const count = Math.max(3, Math.min(9, Math.ceil(p.radius * 2.5)));
    const size = Math.min(WAVE.depth, p.radius / count);
    fx.decals
      .put(
        Decal.strip,
        x - dx * WAVE.depth,
        z - dz * WAVE.depth,
        WAVE.depth * 2,
        Math.atan2(dx, dz),
      )
      .rect(-p.radius, 0, p.radius, WAVE.depth * 2)
      .tint(rock.dark, 0.6 * fade, rock.dust, 0)
      .args(0, p.radius, 1);
    for (let i = 0; i < count; i++) {
      const side = -p.radius + ((i + 0.5) / count) * p.radius * 2;
      const px = x + dz * side;
      const pz = z - dx * side;
      fx.sprites.draw(
        boulder,
        px,
        fx.ground.heightAt(px, pz) + size,
        pz,
        size * fade,
        1,
        0,
        0,
        (-(p.dur - p.life) * speed) / size + i,
        seedOf(p.id + i),
      );
    }
    for (let i = perFrame(fx, 18 * fade); i > 0; i--) {
      const side = (Math.random() * 2 - 1) * p.radius * 0.8;
      const px = x + dz * side - dx * WAVE.depth;
      const pz = z - dx * side - dz * WAVE.depth;
      fx.sprites.emit(
        dust,
        px,
        fx.ground.heightAt(px, pz) + 0.15,
        pz,
        -dx * 0.6,
        0.2,
        -dz * 0.6,
        0.18,
      );
    }
  },
  hit(fx, x, y, z) {
    spray(fx, chip, x, y, z, 2, 0.8, 0.4, 0.08);
  },
  fade(fx, x, y, z) {
    rockThrow.fade!(fx, x, y, z);
  },
};

export const magnitude: AreaLook = {
  live(fx, a, x, z) {
    if (a.delay > 0) return;
    const fade = Math.min(1, a.life / 0.15);
    const phase = a.tick > 0 && a.tickTimer > 0 ? 1 - Math.min(1, a.tickTimer / a.tick) : 0;
    discEdge(fx, x, z, a.radius, rock.dust, 0.5 * fade);
    fx.decals
      .put(Decal.cracks, x, z, a.radius, 0, seedOf(a.id))
      .tint(rock.light, 0.65 * fade, rock.ink, 0)
      .args(phase * 0.8, 1);
    groundArc(
      fx,
      x,
      z,
      a.radius * (0.15 + 0.8 * phase),
      0,
      Math.PI * 2,
      0.08,
      0.1 * (1 - phase),
      rock.dust,
      0.7 * (1 - phase) * fade,
    );
  },
  strike(fx, a, x, z) {
    spray(fx, dust, x, fx.ground.heightAt(x, z) + 0.15, z, 5, a.radius, 0.3, 0.2);
  },
};

export const rockSlide: AreaLook = {
  live(fx, a, x, z, charge) {
    if (charge >= 1) return;
    discEdge(fx, x, z, a.radius, rock.light, 0.35 + charge * 0.25);
    const fall = Math.max(0, 1 - a.delay / 0.22);
    const height = 0.25 + 4 * (1 - fall * fall);
    for (let i = 0; i < 3; i++) {
      const angle = i * 2.094 + seedOf(a.id);
      const px = x + Math.sin(angle) * a.radius * 0.4;
      const pz = z + Math.cos(angle) * a.radius * 0.4;
      fx.sprites.draw(
        boulder,
        px,
        fx.ground.heightAt(px, pz) + height,
        pz,
        Math.min(0.4, a.radius * 0.3),
        0.4 + charge * 0.6,
        0,
        0,
        charge * 3 + i,
        seedOf(a.id + i),
      );
    }
  },
  strike(fx, a, x, z) {
    rockBurst.strike!(fx, a, x, z);
  },
};

export const earthquake: AreaLook = rockBurst;

export const stoneEdge: AreaLook = {
  live(fx, a, x, z) {
    if (a.delay > 0) return;
    const fade = Math.min(1, a.life / 0.12);
    const yaw = Math.atan2(a.dirX, a.dirZ);
    groundArc(fx, x, z, a.length, yaw - a.angle, a.angle * 2, 0.06, 0.06, rock.dust, fade);
    for (let row = 0; row < 2; row++) {
      const d = a.length * (row ? 0.78 : 0.38);
      for (let i = 0; i < 5; i++) {
        const angle = yaw + ((i / 4) * 2 - 1) * a.angle * 0.85;
        pillar(
          fx,
          x + Math.sin(angle) * d,
          z + Math.cos(angle) * d,
          (row ? 0.9 : 0.5) * fade,
          Math.min(0.22, a.length * 0.07) * fade,
          fade,
        );
      }
    }
  },
  strike(fx, _a, x, z) {
    spray(fx, chip, x, fx.ground.heightAt(x, z) + 0.2, z, 4, 1, 1.3, 0.08);
  },
};

export const tectonicRage: AreaLook = {
  live(fx, a, x, z, charge) {
    const h = fx.ground.heightAt(x, z);
    const fade = Math.min(1, a.life / 0.15);
    if (charge < 1) {
      const fromX = x - a.dirX * a.length;
      const fromZ = z - a.dirZ * a.length;
      const fromY = fx.ground.heightAt(fromX, fromZ) + CHEST;
      fx.sprites.draw(
        boulder,
        fromX + a.dirX * a.length * charge,
        fromY + (h + 0.35 - fromY) * charge + Math.sin(charge * Math.PI) * ROD.height,
        fromZ + a.dirZ * a.length * charge,
        0.55,
        1,
        0,
        0,
        charge * 5,
        seedOf(a.id),
      );
      return;
    }
    // Embedded stone marks the origin. Only the emitted chain points show damaging aftershocks.
    fx.sprites.draw(boulder, x, h + 0.2, z, 0.55 * fade, 1, 0, 0, seedOf(a.id), seedOf(a.id));
    fx.decals
      .put(Decal.cracks, x, z, 0.8, 0, seedOf(a.id))
      .tint(rock.clay, 0.5 * fade, rock.ink, 0)
      .args(0.5, 1);
  },
  strike(fx, _a, x, z) {
    spray(fx, chip, x, fx.ground.heightAt(x, z) + 0.2, z, 8, 2, 2.5, 0.14);
  },
};

export const tectonicBurst: AreaLook = {
  strike(fx, a, x, z) {
    quake(fx, x, z, a.radius, true);
  },
};

function drawAftershocks(fx: Fx, e: Echo, t: number): void {
  const ax = e.points[0]!;
  const az = e.points[1]!;
  const fade = (1 - t) ** 2;
  // ROD selects nearest targets around its origin, rather than jumping from one target to the next.
  for (let i = 2; i < e.points.length; i += 2) {
    const bx = e.points[i]!;
    const bz = e.points[i + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const distance = Math.hypot(dx, dz) || 1;
    for (let j = 0; j <= 8; j++) {
      const k = j / 8;
      const jag = Math.sin(j * 13.7 + e.seed + i) * 0.13 * Math.sin(k * Math.PI);
      const x = ax + dx * k + (dz / distance) * jag;
      const z = az + dz * k - (dx / distance) * jag;
      fx.ribbons.point(x, fx.ground.heightAt(x, z) + 0.07, z, 0.07 * (1 - t), rock.dark, fade);
    }
    fx.ribbons.flush(Ribbon.solid, 0);
    pillar(fx, bx, bz, 0.45 * (1 - t), 0.15 * (1 - t), fade);
  }
}

export function aftershocks(fx: Fx, points: readonly number[]): void {
  if (points.length < 4) return;
  fx.echoes.add(drawAftershocks, 0.22, 0, 0, 0, 0, 0, 0, points);
}

/** The event is already a hit: the vertical stroke ends at the rubble immediately. */
function drawRockImpact(fx: Fx, e: Echo, t: number): void {
  const fade = (1 - t) ** 2;
  fx.ribbons.point(
    e.x - Math.sin(fx.viewYaw),
    e.y + 4 * (1 - t),
    e.z - Math.cos(fx.viewYaw),
    0.06,
    rock.dust,
    0,
  );
  fx.ribbons.point(e.x, e.y + 0.3, e.z, 0.25 * (1 - t), rock.light, 0.55 * fade);
  fx.ribbons.flush(Ribbon.solid, 0);
  fx.sprites.draw(boulder, e.x, e.y + 0.22, e.z, 0.4 * (1 - t), fade, 0, 0, e.seed, e.seed);
}

export function rockslideQuake(fx: Fx, e: UltPulseEvent): void {
  quake(fx, e.x, e.z, e.radius, e.look === "blast");
  if (e.look === "meteor")
    fx.echoes.add(drawRockImpact, 0.18, e.x, fx.ground.heightAt(e.x, e.z), e.z);
}

/** A grounded cast cue; the actual ring/strike events carry the ultimate's hitboxes. */
export function rockCast(fx: Fx, x: number, z: number): void {
  const h = fx.ground.heightAt(x, z);
  spray(fx, chip, x, h + 0.2, z, 12, 1.8, 3, 0.15);
  spray(fx, dust, x, h + 0.12, z, 6, 1.2, 0.4, 0.25);
}

export function rockAura(fx: Fx, x: number, z: number, fade: number): void {
  fx.decals
    .put(Decal.cracks, x, z, 1.3)
    .tint(rock.clay, 0.55 * fade, rock.ink, 0)
    .args(0.4, 1);
  for (let i = perFrame(fx, 8 * fade); i > 0; i--) {
    const a = Math.random() * Math.PI * 2;
    const px = x + Math.sin(a) * 0.8;
    const pz = z + Math.cos(a) * 0.8;
    fx.sprites.emit(dust, px, fx.ground.heightAt(px, pz) + 0.1, pz, 0, 0.2, 0, 0.15);
  }
}
