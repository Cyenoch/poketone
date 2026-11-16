import { Decal } from "./decals";
import type { Fx } from "./fx";
import type { Rgb } from "./gl";
import { Ribbon } from "./ribbons";

/** A solid full-size boundary: instant damage must never read as a growing hitbox. */
export function discEdge(
  fx: Fx,
  x: number,
  z: number,
  radius: number,
  colour: Rgb,
  alpha: number,
): void {
  fx.decals.put(Decal.ring, x, z, radius).tint(colour, alpha, colour, 0.1).args(0, 0.035, 1);
}

/** A low arc contained inside the damage radius, conforming to the ground. */
export function groundArc(
  fx: Fx,
  x: number,
  z: number,
  radius: number,
  from: number,
  sweep: number,
  lift: number,
  width: number,
  colour: Rgb,
  alpha: number,
): void {
  for (let i = 0; i <= 16; i++) {
    const a = from + (sweep * i) / 16;
    const px = x + Math.sin(a) * radius;
    const pz = z + Math.cos(a) * radius;
    fx.ribbons.point(
      px,
      fx.ground.heightAt(px, pz) + lift,
      pz,
      width * Math.sin((Math.PI * i) / 16),
      colour,
      alpha,
    );
  }
  fx.ribbons.flush(Ribbon.streak, 0.1);
}
