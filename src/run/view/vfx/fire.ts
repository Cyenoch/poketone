import { Decal } from "./decals";
import { perFrame, rand, reach, seedOf, spray, type AreaLook, type Fx, type ShotLook } from "./fx";
import { fire } from "./palette";
import { Shape, sprite } from "./sprites";
import { place } from "./volumes";

const trail = sprite({
  shape: Shape.flame,
  life: 0.16,
  grow: 0.25,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.5,
  gravity: -3,
  drag: 3,
});
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
const stream = sprite({
  shape: Shape.flame,
  life: 0.5,
  grow: 2.6,
  from: fire.yellow,
  to: fire.deep,
  accent: fire.core,
  add: 0.45,
  gravity: -2.5,
  drag: 1.4,
});
const burningLeaf = sprite({
  shape: Shape.leaf,
  life: 0.7,
  grow: 0.7,
  from: fire.orange,
  to: fire.soot,
  accent: fire.yellow,
  gravity: 3,
  drag: 2,
  spin: 8,
});
const emberSpark = sprite({
  shape: Shape.spark,
  life: 0.55,
  grow: 0.4,
  from: fire.yellow,
  to: fire.orange,
  accent: fire.core,
  add: 1,
  gravity: 7,
  drag: 1,
  stretch: 0.035,
});
const cinder = sprite({
  shape: Shape.glow,
  life: 1,
  grow: 0.3,
  from: fire.orange,
  to: fire.red,
  accent: fire.yellow,
  add: 1,
  gravity: -1.4,
  drag: 0.6,
});
const smoke = sprite({
  shape: Shape.puff,
  life: 0.55,
  grow: 1.45,
  from: fire.ash,
  to: fire.smoke,
  accent: fire.smoke,
  alpha: 0.6,
  gravity: -1.5,
  drag: 2,
  spin: 0.6,
});
const jet = sprite({
  shape: Shape.glow,
  life: 0.22,
  grow: 2.2,
  from: fire.yellow,
  to: fire.orange,
  accent: fire.core,
  alpha: 0.9,
  add: 1,
  drag: 1.4,
});
const halo = sprite({
  shape: Shape.glow,
  from: fire.orange,
  accent: fire.yellow,
  alpha: 0.8,
  add: 1,
});
const core = sprite({
  shape: Shape.spark,
  from: fire.yellow,
  accent: fire.core,
  add: 1,
  stretch: 0.03,
});
const flash = sprite({
  shape: Shape.star,
  life: 0.18,
  grow: 1.7,
  from: fire.yellow,
  to: fire.orange,
  accent: fire.core,
  add: 1,
  spin: 2,
});
const bloom = sprite({
  shape: Shape.glow,
  life: 0.32,
  grow: 1.5,
  from: fire.orange,
  to: fire.red,
  accent: fire.core,
  alpha: 0.7,
  add: 0.6,
});

function rising(
  fx: Fx,
  x: number,
  y: number,
  z: number,
  vx: number,
  vz: number,
  size: number,
  rate: number,
): void {
  for (let i = perFrame(fx, rate); i > 0; i--) {
    fx.sprites.emit(
      trail,
      x + rand(-0.05, 0.05),
      y + rand(-0.05, 0.05),
      z + rand(-0.05, 0.05),
      vx,
      rand(0.2, 0.6),
      vz,
      size * rand(0.6, 0.95),
    );
  }
}

export const ember: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.25);
    spray(fx, flame, x, y, z, 3, 0.8, 0.8, 0.12);
  },
  fly(fx, shot, x, y, z) {
    const r = shot.radius;
    fx.sprites.draw(halo, x, y, z, r * 1.6, 0.6);
    fx.sprites.draw(core, x, y, z, r * 0.8, 1, shot.vx, shot.vz);
    rising(fx, x, y, z, -shot.vx * 0.05, -shot.vz * 0.05, r, 90);
    const floor = fx.ground.heightAt(x, z);
    for (let i = perFrame(fx, 10); i > 0; i--) {
      fx.sprites.emit(
        emberSpark,
        x,
        y,
        z,
        rand(-0.8, 0.8),
        rand(0.3, 1),
        rand(-0.8, 0.8),
        0.05,
        floor,
      );
    }
  },
  hit(fx, x, y, z) {
    fx.sprites.emit(flash, x, y, z, 0, 0, 0, 0.28);
    spray(fx, flame, x, y, z, 5, 1.3, 1.1, 0.13);
    spray(fx, emberSpark, x, y, z, 6, 2, 1.8, 0.045);
    fx.decals.stamp(Decal.scorch, x, z, 0.28, 1, fire.soot, 0.6, fire.orange, 0);
  },
  fade(fx, x, y, z) {
    spray(fx, smoke, x, y, z, 2, 0.3, 0.4, 0.12);
    spray(fx, cinder, x, y, z, 3, 0.5, 0.5, 0.05);
  },
};

export const fireBlast: ShotLook = {
  launch(fx, x, y, z) {
    fx.sprites.emit(bloom, x, y, z, 0, 0, 0, 0.45);
    spray(fx, flame, x, y, z, 6, 1.3, 1, 0.18);
  },
  fly(fx, shot, x, y, z) {
    const r = shot.radius * 1.2;
    fx.volumes.orbs.add(
      place(x, y, z, fx.time * 2, r, r, r),
      fire.yellow,
      1,
      fire.red,
      0,
      seedOf(shot.id),
    );
    fx.sprites.draw(halo, x, y, z, r * 1.8, 0.4);
    fx.decals.put(Decal.glow, x, z, r * 1.5).tint(fire.orange, 0.45, fire.yellow, 1);
    // Flames trail from behind the ball so its inked silhouette stays in front.
    const speed = Math.hypot(shot.vx, shot.vz) || 1;
    const bx = x - (shot.vx / speed) * r * 0.9;
    const bz = z - (shot.vz / speed) * r * 0.9;
    const back = 0.06;
    for (let i = perFrame(fx, 45); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      fx.sprites.emit(
        flame,
        bx + Math.cos(a) * r * 0.5,
        y + rand(-0.15, 0.15),
        bz + Math.sin(a) * r * 0.5,
        -shot.vx * back,
        rand(0.25, 0.9),
        -shot.vz * back,
        r * rand(0.45, 0.7),
      );
    }
    for (let i = perFrame(fx, 5); i > 0; i--) {
      fx.sprites.emit(
        smoke,
        x,
        y + 0.1,
        z,
        -shot.vx * back,
        rand(0.25, 0.6),
        -shot.vz * back,
        r * 0.4,
      );
    }
    for (let i = perFrame(fx, 12); i > 0; i--) {
      fx.sprites.emit(
        emberSpark,
        x,
        y,
        z,
        rand(-1.5, 1.5),
        rand(0.5, 2),
        rand(-1.5, 1.5),
        0.05,
        fx.ground.heightAt(x, z),
      );
    }
  },
  // No hit or fade: the burst area carries the explosion.
};

/** Fire Blast's burst: the 大 of flame burns into the ground and leaves its scorch behind. */
export const fireBlastBurst: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const y = fx.ground.heightAt(x, z) + 0.35;
    // The burning 大 is the primary shape: flames and smoke stay small and close so it reads.
    // It faces the camera as it lands and keeps that yaw, so the scorch stays put as the view moves.
    const yaw = fx.viewYaw + Math.PI;
    fx.decals.stamp(Decal.blast, x, z, r, 1.2, fire.soot, 0.65, fire.orange, 0, 0, 0, yaw);
    fx.decals.stamp(Decal.blast, x, z, r, 0.9, fire.orange, 1, fire.core, 0, 1, 0, yaw);
    fx.decals.stamp(Decal.ring, x, z, r, 0.35, fire.yellow, 0.8, fire.red, 0.6, 0.12, 0.3);
    fx.sprites.emit(bloom, x, y, z, 0, 0, 0, r * 0.55);
    fx.sprites.emit(flash, x, y + 0.2, z, 0, 0, 0, r * 0.45);
    spray(fx, flame, x, y, z, 12, r * 1.4, 1.3, 0.2);
    spray(fx, emberSpark, x, y, z, 18, r * 2, 2.5, 0.05);
    spray(fx, smoke, x, y + 0.2, z, 4, r * 0.8, 0.8, 0.22);
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = r * Math.sqrt(Math.random()) * 0.8;
      fx.sprites.emit(
        stream,
        x + Math.cos(a) * d,
        y - 0.2,
        z + Math.sin(a) * d,
        0,
        rand(1, 2),
        0,
        rand(0.1, 0.15),
      );
    }
  },
};

/** Explosion when Fire Spin's tornado collapses. */
export const fireSpinBurst: AreaLook = {
  strike(fx, area, x, z) {
    const r = area.radius;
    const y = fx.ground.heightAt(x, z) + 0.3;
    fx.decals.stamp(Decal.ring, x, z, r, 0.35, fire.yellow, 0.9, fire.red, 0.7, 0.16, 0.3);
    fx.decals.stamp(Decal.scorch, x, z, r * 0.75, 1.1, fire.soot, 0.65, fire.orange, 0);
    fx.sprites.emit(bloom, x, y, z, 0, 0, 0, r * 0.5);
    spray(fx, flame, x, y, z, 12, r * 2, 1.3, 0.2);
    spray(fx, emberSpark, x, y, z, 16, r * 2, 2.5, 0.05);
    spray(fx, smoke, x, y, z, 4, r * 0.9, 0.6, 0.22);
  },
};

export const fireSpin: AreaLook = {
  live(fx, area, x, z, charge) {
    const r = area.radius;
    const h = fx.ground.heightAt(x, z);
    const fade = Math.min(1, area.life / 0.2);
    const active = area.delay <= 0;
    const intensity = (active ? 1 : charge * 0.6) * fade;
    const seed = seedOf(area.id);
    fx.decals
      .put(Decal.swirl, x, z, r * 1.05, 0, seed)
      .tint(fire.orange, 0.7, fire.yellow, 0.6)
      .args(intensity);
    // Particle size and swirl speed follow the radius (1 at the old 2.4 m vortex).
    const scale = r / 2.4;
    if (active) {
      // Low and see-through: a tall opaque funnel hides the enemies it has trapped.
      const height = 0.3 + r * 0.35;
      fx.volumes.funnels.add(
        place(x, h - 0.1, z, fx.time * 5, r * 0.95, height, r * 0.95),
        fire.yellow,
        fade * 0.75,
        fire.red,
        0,
        seed * 10,
      );
      fx.volumes.funnels.add(
        place(x, h - 0.1, z, -fx.time * 7, r * 0.5, height * 0.7, r * 0.5),
        fire.core,
        fade * 0.7,
        fire.orange,
        0,
        seed * 10 + 3,
      );
    }
    for (let i = perFrame(fx, 26 * intensity * scale); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      const d = r * rand(0.35, 0.95);
      const c = Math.cos(a);
      const s = Math.sin(a);
      fx.sprites.emit(
        flame,
        x + c * d,
        h + rand(0.05, 0.3),
        z + s * d,
        (-s * 4 - c) * scale,
        rand(1, 2),
        (c * 4 - s) * scale,
        rand(0.22, 0.38) * scale,
      );
    }
    for (let i = perFrame(fx, 14 * intensity); i > 0; i--) {
      const a = Math.random() * Math.PI * 2;
      fx.sprites.emit(
        cinder,
        x + Math.cos(a) * r,
        h + 0.1,
        z + Math.sin(a) * r,
        -Math.cos(a) * 0.8,
        rand(0.5, 1.5),
        -Math.sin(a) * 0.8,
        0.06,
      );
    }
  },
};

export const flamethrower: AreaLook = {
  live(fx, area, x, z) {
    const length = area.length;
    const fade = Math.min(1, area.life / 0.25);
    const yaw = Math.atan2(area.dirX, area.dirZ);
    const h = fx.ground.heightAt(x, z);
    const mouthX = x + area.dirX * 0.55;
    const mouthZ = z + area.dirZ * 0.55;
    const y = h + 0.65;
    const side = length * Math.sin(Math.min(area.angle, Math.PI / 2)) + 0.3;
    fx.decals
      .put(Decal.sector, x, z, length, yaw, seedOf(area.id))
      .rect(-side, -0.3, side, length + 0.3)
      .tint(fire.orange, 0.5 * fade, fire.yellow, 0.85)
      .args(0, area.angle, 0);
    fx.sprites.draw(halo, mouthX, y, mouthZ, 0.32, fade);
    const scale = length / 6;
    const speed = reach(length * 0.95, stream.life, stream.drag);
    for (let i = perFrame(fx, 70 * fade); i > 0; i--) {
      const spread = rand(-1, 1) * area.angle * 0.85;
      const c = Math.cos(spread);
      const s = Math.sin(spread);
      const dx = area.dirX * c - area.dirZ * s;
      const dz = area.dirX * s + area.dirZ * c;
      const v = speed * rand(0.8, 1.05);
      fx.sprites.emit(
        stream,
        mouthX,
        y + rand(-0.05, 0.05),
        mouthZ,
        dx * v,
        rand(0.15, 0.6),
        dz * v,
        rand(0.17, 0.25) * scale,
      );
    }
    for (let i = perFrame(fx, 40 * fade); i > 0; i--) {
      const spread = rand(-1, 1) * area.angle * 0.3;
      const v = speed * rand(0.9, 1.1);
      fx.sprites.emit(
        jet,
        mouthX,
        y,
        mouthZ,
        (area.dirX + Math.sin(spread) * area.dirZ) * v,
        0,
        (area.dirZ - Math.sin(spread) * area.dirX) * v,
        0.22 * scale,
      );
    }
    for (let i = perFrame(fx, 22 * fade); i > 0; i--) {
      const v = speed * rand(0.6, 1.1);
      const spread = rand(-1, 1) * area.angle;
      fx.sprites.emit(
        emberSpark,
        mouthX,
        y,
        mouthZ,
        (area.dirX + Math.sin(spread) * area.dirZ) * v,
        rand(0.5, 1.5),
        (area.dirZ - Math.sin(spread) * area.dirX) * v,
        0.05,
        h,
      );
    }
    for (let i = perFrame(fx, 3 * fade); i > 0; i--) {
      const d = length * rand(0.6, 0.9);
      fx.sprites.emit(
        smoke,
        x + area.dirX * d,
        y + 0.25,
        z + area.dirZ * d,
        area.dirX,
        rand(0.5, 1),
        area.dirZ,
        0.32 * scale,
      );
    }
  },
};

/** 蔓延燃烧: the burn leaps outward on burning leaves, in a ring of flame. */
export function spreadBurn(fx: Fx, x: number, y: number, z: number): void {
  // Reactions fire often: the ring shows the 2.8 m spread, quieter than a move's impact.
  fx.decals.stamp(Decal.ring, x, z, 2.8, 0.4, fire.orange, 0.6, fire.red, 0.4, 0.14, 0.3);
  // The grass that carried it: burning leaves flung out to the ring, charring as they fly.
  spray(fx, burningLeaf, x, y, z, 7, reach(2.4, burningLeaf.life, burningLeaf.drag), 2.5, 0.16);
  spray(fx, flame, x, y, z, 6, 5, 1.5, 0.3);
  spray(fx, emberSpark, x, y, z, 6, 5, 4, 0.07);
}
