/**
 * Global wind as a pure function of the run seed and sim time: every peer and every system (grass,
 * trees, cloud shadows, later projectile drift or flyers) reads the same breeze without storing state.
 */
import { latticeHash, smoothstep, valueNoise } from "./noise";
import { cos, sin } from "./math";

export interface Wind {
  /** Unit vector the wind blows toward, on the ground plane. */
  dirX: number;
  dirZ: number;
  /** Steady breeze, 0 calm … 1 strong. Never fully calm. */
  strength: number;
  /** Swell on top of the breeze, 0 … 1; arrives every few seconds and dies down again. */
  gust: number;
}

export function windAt(seed: number, time: number): Wind {
  // A prevailing direction per run that wanders up to ~70° over a minute or so.
  const heading =
    latticeHash(seed, 0x51ed, 0) * Math.PI * 2 +
    (valueNoise(seed ^ 0x2c1f, time / 40, 0) - 0.5) * 2.4 +
    (valueNoise(seed ^ 0x7a3b, time / 11, 0) - 0.5) * 0.5;
  const strength = 0.3 + 0.45 * valueNoise(seed ^ 0x9e37, time / 23, 0);
  const gust = smoothstep(0.55, 0.9, valueNoise(seed ^ 0x3c6e, time / 4.5, 0));
  return { dirX: sin(heading), dirZ: cos(heading), strength, gust };
}
