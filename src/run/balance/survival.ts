// Survival as an HP-state process: the HP share is a distribution over `BINS` levels, stepped once a
// second through compound-Poisson damage events (single hits and catches, i.e. geometric runs of
// contact hits), a deterministic heal / poison drift and the lethal saves' charges. What dies is the
// mass that a step pushes to 0 HP; nothing here is a hazard rate. docs/BALANCE.md「生存」.

/** HP levels (share of max HP = level / BINS); level 0 is death. */
export const BINS = 60;
/** Most damage events counted in one step (the i-frame ceiling allows about 3 hits a second). */
const MAX_EVENTS = 12;

/** One kind of damage event: `rate` per second, its damage as a distribution over HP levels. */
export interface DamageEvent {
  rate: number;
  /** `pmf[k]` = P(the event removes k levels); the last entry means "that many or more". */
  pmf: Float64Array;
  /** Catches: a lethal save can be outlasted by the rest of the run of hits (`Save.rescue`). */
  catch?: boolean;
}

/** A lethal save as the process sees it: what it restores, and how often it holds. */
export interface Save {
  /** HP share restored (0 means 1 HP: the lowest level). */
  hp: number;
  /** Chance a save fires when it can. */
  chance: number;
  /** Share of catch deaths it holds (the rest of the catch can still finish the player). */
  rescue: number;
}

export interface HpState {
  /** `layers[u][level]`: probability mass with `u` limited save charges spent. */
  layers: Float64Array[];
  /** Sub-level remainder of the drift, so a deterministic drain lands on its exact second. */
  carry: number;
}

export function createHp(): HpState {
  const first = new Float64Array(BINS + 1);
  first[BINS] = 1;
  return { layers: [first], carry: 0 };
}

export function aliveOf(state: HpState): number {
  let total = 0;
  for (const layer of state.layers) for (let i = 1; i <= BINS; i++) total += layer[i]!;
  return total;
}

/** Mean HP share of the living mass. */
export function hpShare(state: HpState): number {
  let mass = 0;
  let sum = 0;
  for (const layer of state.layers)
    for (let i = 1; i <= BINS; i++) {
      mass += layer[i]!;
      sum += layer[i]! * i;
    }
  return mass > 0 ? sum / mass / BINS : 0;
}

/** Share of the living mass at full HP (where heals overflow). */
export function fullShare(state: HpState): number {
  let full = 0;
  for (const layer of state.layers) full += layer[BINS]!;
  const alive = aliveOf(state);
  return alive > 0 ? full / alive : 0;
}

/** A damage of `share` of max HP as a pmf over levels, split between the two nearest levels. */
export function hitPmf(share: number): Float64Array {
  const pmf = new Float64Array(BINS + 1);
  addSplit(pmf, Math.max(0, share) * BINS, 1);
  return pmf;
}

function addSplit(pmf: Float64Array, levels: number, mass: number) {
  if (levels >= BINS) {
    pmf[BINS]! += mass;
    return;
  }
  const low = Math.floor(levels);
  const frac = levels - low;
  pmf[low]! += mass * (1 - frac);
  pmf[Math.min(BINS, low + 1)]! += mass * frac;
}

/**
 * A catch: N contact hits with N geometric of mean `burst`; `free` of them land on nothing (spare
 * dash charges, a partner's guard), and the first `soak` of its damage goes into the shield.
 */
export function catchPmf(
  hit: number,
  burst: number,
  free: readonly { share: number; hits: number }[],
  soak: number,
): Float64Array {
  const pmf = new Float64Array(BINS + 1);
  const go = 1 - 1 / Math.max(1, burst);
  for (const { share, hits } of free) {
    if (share <= 0) continue;
    for (let n = 1, p = 1 - go; ; n++, p *= go) {
      const landed = Math.max(0, n - hits);
      const damage = Math.max(0, landed * hit - soak);
      addSplit(pmf, damage * BINS, share * p);
      if (damage >= 1 || p < 1e-9) {
        // Every longer catch removes at least as much.
        if (damage >= 1) pmf[BINS]! += (share * p * go) / (1 - go || 1);
        break;
      }
    }
  }
  return pmf;
}

/** Nonzero levels of a pmf. */
function support(pmf: Float64Array): number[] {
  const out: number[] = [];
  for (let k = 0; k <= BINS; k++) if (pmf[k]! > 1e-12) out.push(k);
  return out;
}

/** The rate-weighted mixture of some events' pmfs, and their total rate. */
function mixture(events: readonly DamageEvent[]): { rate: number; pmf: Float64Array } {
  const rate = events.reduce((sum, e) => sum + e.rate, 0);
  const pmf = new Float64Array(BINS + 1);
  if (rate > 0)
    for (const e of events) for (let k = 0; k <= BINS; k++) pmf[k]! += (e.rate / rate) * e.pmf[k]!;
  return { rate, pmf };
}

/**
 * Applies a Poisson(`rate`) number of events drawn from `pmf` to `layer` in place; returns the mass
 * pushed to 0 HP. Independent event streams can be applied one after another: damage only adds up.
 */
function applyEvents(layer: Float64Array, rate: number, pmf: Float64Array): number {
  if (rate <= 0) return 0;
  const supp = support(pmf);
  const out = new Float64Array(BINS + 1);
  let cur = Float64Array.from(layer);
  let curDead = 0;
  let p = Math.exp(-rate);
  let left = 1;
  let dead = 0;
  for (let n = 0; ; n++) {
    for (let i = 1; i <= BINS; i++) out[i]! += p * cur[i]!;
    dead += p * curDead;
    left -= p;
    if (left < 1e-7 || n >= MAX_EVENTS) break;
    const next = new Float64Array(BINS + 1);
    for (let i = 1; i <= BINS; i++) {
      const mass = cur[i]!;
      if (mass === 0) continue;
      for (const k of supp) {
        if (k < i) next[i - k]! += mass * pmf[k]!;
        else curDead += mass * pmf[k]!;
      }
    }
    cur = next;
    p *= rate / (n + 1);
  }
  // The rare remainder (more events than counted) dies.
  if (left > 0) {
    let living = 0;
    for (let i = 1; i <= BINS; i++) living += cur[i]!;
    dead += left * (curDead + living);
  }
  layer.set(out);
  return dead;
}

export interface Step {
  events: readonly DamageEvent[];
  /** HP share healed per second (regen, lifesteal, drains, berries, ultimate heals). */
  heal: number;
  /** HP share poison drains per second; the drift never takes the player below `floor` (share; 0: it can kill). */
  poison: number;
  floor: number;
  /** Limited save charges in the order they are spent, and the unlimited chance save (Focus Band). */
  charges: readonly Save[];
  fallback: Save | null;
  /** The fallback is tried before the charges (the sim's trigger order). */
  fallbackFirst?: boolean;
  /**
   * HP-conditional heals (Sitrus Berry): the mass under `below` (share) is lifted by `heal` (share),
   * at most once per `cooldown` seconds of time spent under the line.
   */
  lifts?: readonly { below: number; heal: number; cooldown: number }[];
}

/** Moves every level by `levels`; downward never below `floor` (0: down to death, which removes it). */
function shift(layer: Float64Array, levels: number, floor: number) {
  if (levels === 0) return;
  if (levels > 0) {
    for (let i = BINS; i >= 1; i--) {
      const to = Math.min(BINS, i + levels);
      if (to !== i) {
        layer[to]! += layer[i]!;
        layer[i] = 0;
      }
    }
    return;
  }
  for (let i = 1; i <= BINS; i++) {
    if (i <= floor) continue;
    const to = Math.max(floor, i + levels);
    if (to !== i) {
      if (to >= 1) layer[to]! += layer[i]!;
      layer[i] = 0;
    }
  }
}

/** One second: half the drift, the damage events (with saves on the mass they kill), the other half. */
export function stepHp(state: HpState, step: Step, dt = 1): void {
  const floor = step.floor > 0 ? Math.max(1, Math.ceil(step.floor * BINS)) : 0;
  const drift = ((step.heal - step.poison) * BINS * dt) / 2;
  const half = () => {
    state.carry += drift;
    const levels = Math.trunc(state.carry);
    state.carry -= levels;
    for (const layer of state.layers) shift(layer, levels, floor);
  };
  half();
  const scaled = step.events.map((e) => ({ ...e, rate: e.rate * dt }));
  const hits = mixture(scaled.filter((e) => !e.catch));
  const catches = mixture(scaled.filter((e) => e.catch));
  const next = state.layers;
  const deaths = new Float64Array(next.length);
  /** Of the mass that dies, the part killed inside a catch. */
  const catchDeaths = new Float64Array(next.length);
  for (let u = 0; u < next.length; u++) {
    const plain = applyEvents(next[u]!, hits.rate, hits.pmf);
    const caught = applyEvents(next[u]!, catches.rate, catches.pmf);
    deaths[u] = plain + caught;
    catchDeaths[u] = caught;
  }
  for (let u = 0; u < deaths.length; u++) {
    let dead = deaths[u]!;
    if (dead <= 0) continue;
    const inCatch = catchDeaths[u]! / dead;
    const hold = (save: Save, to: number) => {
      const held = dead * save.chance * (1 - inCatch + inCatch * save.rescue);
      while (next.length <= to) next.push(new Float64Array(BINS + 1));
      next[to]![Math.max(1, Math.round(save.hp * BINS))]! += held;
      dead -= held;
    };
    const charge = step.charges[u];
    if (step.fallback && (step.fallbackFirst || !charge)) hold(step.fallback, u);
    if (charge) hold(charge, u + 1);
  }
  for (const lift of step.lifts ?? []) {
    const line = lift.below * BINS;
    let under = 0;
    let alive = 0;
    for (const layer of next)
      for (let i = 1; i <= BINS; i++) {
        alive += layer[i]!;
        if (i < line) under += layer[i]!;
      }
    if (under <= 0) continue;
    // Ready on crossing the line, unless the time spent under it outlasts one cooldown.
    const q = Math.min(1, alive / (lift.cooldown * under));
    const up = Math.round(lift.heal * BINS);
    for (const layer of next)
      for (let i = Math.ceil(line) - 1; i >= 1; i--) {
        if (i >= line) continue;
        const moved = layer[i]! * q;
        layer[i]! -= moved;
        layer[Math.min(BINS, i + up)]! += moved;
      }
  }
  half();
}

/**
 * Evolution resets per-stage saves: mass that spent `perStage[u]` of its first `u` charges on them
 * gets those charges back.
 */
export function refund(state: HpState, spentPerStage: (u: number) => number): void {
  const next = state.layers.map(() => new Float64Array(BINS + 1));
  state.layers.forEach((layer, u) => {
    const to = u - spentPerStage(u);
    for (let i = 0; i <= BINS; i++) next[to]![i]! += layer[i]!;
  });
  state.layers = next;
}

/** New maximum HP arrives filled; preserve missing HP and the spent-save layer of each survivor. */
export function growHp(state: HpState, before: number, after: number): void {
  if (after === before) return;
  const gained = Math.max(0, after - before);
  state.layers = state.layers.map((layer) => {
    const next = new Float64Array(BINS + 1);
    next[0] = layer[0]!;
    for (let i = 1; i <= BINS; i++)
      addSplit(next, (((i / BINS) * before + gained) / after) * BINS, layer[i]!);
    return next;
  });
  state.carry *= before / after;
}
