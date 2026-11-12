/**
 * Seeded lattice noise shared by terrain, wind and the view's scatter/baking. Pure integer hashing,
 * so every peer reproduces the same values (no Math.random).
 */

/** Hash of an integer lattice point in 0..1. With z = 0 it doubles as a 1D hash. */
export function latticeHash(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth 2D value noise in 0..1; with z = 0 it is C1-continuous 1D noise. */
export function valueNoise(seed: number, x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = latticeHash(seed, ix, iz);
  const b = latticeHash(seed, ix + 1, iz);
  const c = latticeHash(seed, ix, iz + 1);
  const d = latticeHash(seed, ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
