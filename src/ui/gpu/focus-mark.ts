import { createBallMark } from "./marks";
import type { UiMotion } from "./motion";

/** CSS cubic-bezier(0.16, 1, 0.3, 1), matching --ease-out rather than a similar preset. */
export function cubicBezier(
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  if (progress <= 0 || progress >= 1) return progress;
  let low = 0,
    high = 1;
  for (let i = 0; i < 20; i++) {
    const t = (low + high) / 2,
      inverse = 1 - t;
    const x = 3 * inverse * inverse * t * x1 + 3 * inverse * t * t * x2 + t * t * t;
    if (x < progress) low = t;
    else high = t;
  }
  const t = (low + high) / 2,
    inverse = 1 - t;
  return 3 * inverse * inverse * t * y1 + 3 * inverse * t * t * y2 + t * t * t;
}

export const uiEaseOut = (progress: number): number => cubicBezier(progress, 0.16, 1, 0.3, 1);
const cssEase = (progress: number): number => cubicBezier(progress, 0.25, 0.1, 0.25, 1);

/** Each command owns its marker: leaving one fades it out in place while the next appears. */
export class FocusMark {
  readonly mesh = createBallMark();
  private readonly transform = { scale: 0.4, rotation: Math.PI / 2 };
  private readonly alpha = { opacity: 0 };
  private readonly motion: UiMotion;
  private readonly invalidate: () => void;
  private focused = false;
  private parentScale = 1;
  private parentOpacity = 1;

  constructor(motion: UiMotion, invalidate: () => void) {
    this.motion = motion;
    this.invalidate = invalidate;
    this.apply();
  }

  setFocused(focused: boolean): void {
    if (focused === this.focused) return;
    this.focused = focused;
    this.motion.animate(
      this.transform,
      { scale: focused ? 1 : 0.4, rotation: focused ? 0 : Math.PI / 2 },
      180,
      this.apply,
      uiEaseOut,
    );
    // CSS's default "ease" for opacity is handled separately from the transform track.
    this.motion.animate(this.alpha, { opacity: focused ? 1 : 0 }, 100, this.apply, cssEase);
  }

  setParentScale(scale: number): void {
    this.parentScale = scale;
    this.apply();
  }

  /** The marker lives outside the UIKit tree, so its control's fade is handed in. */
  setParentOpacity(opacity: number): void {
    if (opacity === this.parentOpacity) return;
    this.parentOpacity = opacity;
    this.apply();
  }

  private readonly apply = (): void => {
    this.mesh.scale.setScalar((this.transform.scale * this.parentScale * 22) / 24);
    this.mesh.rotation.z = this.transform.rotation;
    this.mesh.material.uniforms.alpha!.value = this.alpha.opacity * this.parentOpacity;
    this.invalidate();
  };

  dispose(): void {
    this.motion.cancel(this.transform);
    this.motion.cancel(this.alpha);
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
