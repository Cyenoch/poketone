import type { Camera } from "three";

/** Trauma lost per second; a full-strength knock settles in under a second. */
const DECAY = 1.3;
/** Camera-plane offset and roll at full trauma. */
const MAX_OFFSET = 0.35;
const MAX_ROLL = 0.012;

/** Two incommensurate sines per axis: smooth, never repeating visibly, no per-frame random buzz. */
function wave(t: number, axis: number): number {
  return Math.sin(t * 23 + axis * 1.7) * 0.6 + Math.sin(t * 37 + axis * 4.1) * 0.4;
}

/**
 * Trauma-model shake: events add trauma (0..1), the felt shake is trauma² so small knocks stay small,
 * and it decays linearly. Applied in the camera's own plane after it has been aimed.
 */
export interface CameraShake {
  add(trauma: number): void;
  /** Advances decay and the shake clock, then nudges the aimed camera. */
  apply(camera: Camera, dt: number): void;
}

export function createCameraShake(): CameraShake {
  let trauma = 0;
  let clock = 0;
  return {
    add(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    apply(camera, dt) {
      if (trauma <= 0) return;
      clock += dt;
      const shake = trauma * trauma;
      camera.translateX(MAX_OFFSET * shake * wave(clock, 0));
      camera.translateY(MAX_OFFSET * shake * wave(clock, 1));
      camera.rotateZ(MAX_ROLL * shake * wave(clock, 2));
      trauma = Math.max(0, trauma - DECAY * dt);
    },
  };
}
