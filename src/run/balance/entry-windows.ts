// Entry pace report (tune-map-entry-pace): the first two minutes of each later map beside the last
// two minutes of the map before. Windows are alive-weighted means over the samples that played both.
// `capacity / incoming` alone says little about felt pressure, so each window also carries the
// crowd on the field, the damage actually landed, the share of max HP lost and the window survival.

/** One simulated second of a build sample in a zone. */
export interface EntryProbe {
  /** Seconds into the zone. */
  tz: number;
  alive: number;
  /** HP share of the living. */
  frac: number;
  /** Living plus walking-in enemies, and the live cap they fill. */
  living: number;
  elites: number;
  stockHp: number;
  cap: number;
  /** Offered/admitted swarm HP per second, and player-only clearing at a full crowd. */
  incoming: number;
  admitted: number;
  capacity: number;
  /** Adaptive spawn multiplier. */
  spawnScale: number;
  /** Mean swarm enemy HP now (existing ordinary stock uses this aggregate approximation too). */
  hp: number;
  /** HP share per second landed on the player (after dodges, blocks, shields; incl. poison). */
  landed: number;
  /** Hit streams after profile dodges/armor, before shields/guards: swarm and guardian separately. */
  swarmRaw: number;
  guardianRaw: number;
  /** Extra site encounters/traps and weather, before shields and protection. */
  fieldRaw: number;
  partnerDps: number;
}

export const ENTRY_WINDOW = 120;

/** One window of probes, with the survival at its ends (run-wide probabilities). */
export interface WindowSample {
  probes: readonly EntryProbe[];
  aliveStart: number;
  aliveEnd: number;
  /** Actual seconds observed in this map; no samples from the next map are borrowed. */
  seconds: number;
  /** Full requested window observed, or death resolved its survival outcome. */
  resolved: boolean;
  complete: boolean;
}

export interface EntryWindow {
  /** Build count, full windows, and summed alive probability at the window start. */
  samples: number;
  complete: number;
  weight: number;
  seconds: number;
  /** Mean living stock as a share of the live cap, and the seconds the build needs to clear it. */
  fill: number;
  living: number;
  elites: number;
  stockHp: number;
  backlog: number;
  /** Offered/admitted swarm HP/s, player-only clearing, and clearing/supply (not felt pressure). */
  incoming: number;
  admitted: number;
  capacity: number;
  pressure: number;
  /** Damage landed per second as a share of max HP, and expected share lost over the window. */
  landed: number;
  lost: number;
  swarmRaw: number;
  guardianRaw: number;
  fieldRaw: number;
  /** Mean HP share and conditional survival (null if any window was censored by an early exit). */
  frac: number;
  survive: number | null;
  spawnScale: number;
  hp: number;
  partnerDps: number;
}

const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0);

/** Alive-weighted window statistics; null when no sample has a probe in it. */
export function windowOf(parts: readonly WindowSample[]): EntryWindow | null {
  const samples = parts.filter((part) => part.aliveStart > 0);
  if (samples.length === 0) return null;
  const probes = samples.flatMap((part) => part.probes);
  const weight = total(probes.map((probe) => probe.alive));
  if (weight === 0) return null;
  const mean = (value: (probe: EntryProbe) => number) =>
    total(probes.map((probe) => probe.alive * value(probe))) / weight;
  const incoming = mean((probe) => probe.incoming);
  const capacity = mean((probe) => probe.capacity);
  const landed = mean((probe) => probe.landed);
  const startAlive = total(samples.map((part) => part.aliveStart));
  return {
    samples: samples.length,
    complete: samples.filter((part) => part.complete).length,
    weight: startAlive,
    seconds: total(samples.map((part) => part.aliveStart * part.seconds)) / startAlive,
    fill: mean((probe) => probe.living / probe.cap),
    living: mean((probe) => probe.living),
    elites: mean((probe) => probe.elites),
    stockHp: mean((probe) => probe.stockHp),
    backlog: mean((probe) => probe.stockHp / Math.max(1e-9, probe.capacity + probe.partnerDps)),
    incoming,
    admitted: mean((probe) => probe.admitted),
    capacity,
    pressure: capacity / incoming,
    landed,
    lost: total(probes.map((probe) => probe.alive * probe.landed)) / startAlive,
    swarmRaw: mean((probe) => probe.swarmRaw),
    guardianRaw: mean((probe) => probe.guardianRaw),
    fieldRaw: mean((probe) => probe.fieldRaw),
    frac: mean((probe) => probe.frac),
    survive: samples.every((part) => part.resolved)
      ? total(samples.map((part) => part.aliveEnd)) / startAlive
      : null,
    spawnScale: mean((probe) => probe.spawnScale),
    hp: mean((probe) => probe.hp),
    partnerDps: mean((probe) => probe.partnerDps),
  };
}

/**
 * Per later map: its first two minutes, the previous map's last two minutes before leaving (the
 * guardian fight included) and its two minutes before the guardian was summoned (swarm only).
 */
export interface EntryComparison {
  /** Zero-based field index of the later map (1 is the second map). */
  field: number;
  entry: EntryWindow | null;
  exit: EntryWindow | null;
  preSummon: EntryWindow | null;
}
