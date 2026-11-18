import { Matrix4 } from "three";

export const DASH_TRAIL = {
  /** Afterimages kept behind the dashing guardian. */
  images: 3,
  /** Game seconds between two afterimages, and how long each one lasts. */
  every: 0.06,
  life: 0.24,
  /** Additive strength of a fresh afterimage. */
  opacity: 0.42,
};

/**
 * The guardian's dash leaves a short trail of pale afterimages of its body: poses sampled along the
 * dash, each fading out on its own. View-only.
 */
export class DashTrail {
  private readonly images = Array.from({ length: DASH_TRAIL.images }, () => ({
    matrix: new Matrix4(),
    age: Infinity,
  }));
  private next = 0;
  private clock = 0;

  /** Called once a frame with the guardian's drawn pose; samples it while it dashes. */
  follow(dashing: boolean, pose: Matrix4, dt: number): void {
    for (const image of this.images) image.age += dt;
    this.clock = dashing ? this.clock + dt : DASH_TRAIL.every;
    if (!dashing || this.clock < DASH_TRAIL.every) return;
    this.clock = 0;
    const image = this.images[this.next]!;
    this.next = (this.next + 1) % this.images.length;
    image.matrix.copy(pose);
    image.age = 0;
  }

  /** An afterimage's additive strength; the newest one still covers the body, so it waits a beat. */
  fade(i: number): number {
    const age = this.images[i]!.age;
    if (age < DASH_TRAIL.every * 0.5) return 0;
    return DASH_TRAIL.opacity * Math.max(0, 1 - age / DASH_TRAIL.life);
  }

  matrix(i: number): Matrix4 {
    return this.images[i]!.matrix;
  }
}
