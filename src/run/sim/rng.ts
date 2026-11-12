/** Seeded mulberry32. The simulation never calls Math.random, so a host can replay or audit a run. */
export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

export function next(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * next(rng);
}

export function chance(rng: Rng, probability: number): boolean {
  return next(rng) < probability;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(next(rng) * items.length)];
  if (item === undefined) throw new Error("不能从空列表中抽取。");
  return item;
}
