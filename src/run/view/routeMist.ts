// The fog map modifier: scene fog pulled in close around the camera and paled, on top of whatever the
// stage and its weather (weather.ts) set. The camera sits about 20.6 units from the player
// (createRunView CAMERA_HEIGHT / CAMERA_BACK), so the player and the nearest threats stay clear
// while the far field goes. Exit columns and cure beacons opt out of fog.
import { Color, type Fog } from "three";

const NEAR = 19;
const FAR = 40;
const MIST = new Color("#e3ebee");

export interface RouteMist {
  /** `on` while the map's modifier is fog; eases in 0.8s and out 1.2s. */
  frame(on: boolean, dt: number): void;
}

export function createRouteMist(fog: Fog): RouteMist {
  let level = 0;
  const tint = new Color();
  // What the fog was before this layer, and what this layer left: a change by anyone else (the
  // weather writes only when its strength moves) becomes the new base.
  const base = { near: fog.near, far: fog.far, color: fog.color.clone() };
  const applied = { near: fog.near, far: fog.far, color: fog.color.clone() };
  return {
    frame(on, dt) {
      if (
        fog.near !== applied.near ||
        fog.far !== applied.far ||
        !fog.color.equals(applied.color)
      ) {
        base.near = fog.near;
        base.far = fog.far;
        base.color.copy(fog.color);
      }
      const next = on ? Math.min(1, level + dt / 0.8) : Math.max(0, level - dt / 1.2);
      if (next === 0 && level === 0) return;
      level = next;
      fog.near = base.near + (Math.min(base.near, NEAR) - base.near) * level;
      fog.far = base.far + (Math.min(base.far, FAR) - base.far) * level;
      tint.copy(MIST).lerp(base.color, 0.5);
      fog.color.copy(base.color).lerp(tint, level);
      applied.near = fog.near;
      applied.far = fog.far;
      applied.color.copy(fog.color);
    },
  };
}
