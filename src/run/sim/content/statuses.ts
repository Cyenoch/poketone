// Status registry. Key order is the order statuses act in each tick (speed factors multiply in this
// order) and the order the view and golden list them; keep it. Runtime state is a sparse
// `ActiveStatus[]` per body, and every rule below runs through `sim/status.ts`.

/** How one status moves its carrier: a speed factor, a full stop, or paralysis' stutter. */
export type StatusMove =
  | { kind: "factor"; factor: number }
  | { kind: "stop" }
  /** Stopped while `sin(time × rate + id) > above`, otherwise slowed to `factor`. */
  | { kind: "stutter"; rate: number; above: number; factor: number };

export interface StatusDef {
  name: string;
  /** Which bodies can carry it; `EnemyStatusId` / `PlayerStatusId` are derived from this. */
  appliesTo: "enemy" | "player" | "both";
  /** Seconds one application lasts when its source names none (a move's hit, the stun spore). */
  duration: number;
  /** A guardian keeps a status for this share of its duration. */
  bossScale?: number;
  /** Reapplying restarts the timer; "max-power" also keeps the stronger of the two powers. */
  stacking: "refresh" | "max-power";
  /** Damage over time on an enemy: power = this share of the applying hit, dealt per second. */
  dotShare?: number;
  /** HP a player loses per second: `dps × (1 + time / ramp)`, never below `DRAIN_FLOOR`. */
  drain?: { dps: number; ramp: number };
  move?: StatusMove;
  /** The hit that lands on a carrier deals this many times its damage and ends the status. */
  wakeBonus?: number;
  /** The carrier cannot start an attack or shoot. */
  blocksAttacks?: true;
  /** Cancels the carrier's wind-ups, lunges and pending hazards, and stops its contact damage. */
  interrupts?: true;
  /** The carrier takes × (1 + this) damage; "power" reads the application's power (a mark's bonus). */
  vulnerable?: number | "power";
  /** Each application adds a charge; at `count` charges the status turns into `into` (chill → freeze). */
  builds?: { count: number; into: string };
  /** The carrier is held (Binding Band's 「被控制」); a stagger counts too (sim/status.ts `held`). */
  control?: true;
}

const table = {
  burn: { name: "灼伤", appliesTo: "enemy", duration: 3, stacking: "max-power", dotShare: 0.3 },
  paralysis: {
    name: "麻痹",
    appliesTo: "enemy",
    duration: 3,
    bossScale: 0.35,
    stacking: "refresh",
    move: { kind: "stutter", rate: 7, above: 0.55, factor: 0.5 },
    blocksAttacks: true,
    control: true,
  },
  sleep: {
    name: "睡眠",
    appliesTo: "enemy",
    duration: 3,
    bossScale: 0.35,
    stacking: "refresh",
    move: { kind: "stop" },
    wakeBonus: 1.8,
    interrupts: true,
    control: true,
  },
  wet: {
    name: "湿润",
    appliesTo: "enemy",
    duration: 5,
    stacking: "refresh",
    move: { kind: "factor", factor: 0.85 },
  },
  /** Enemies: a weaker, longer burn (no move applies it yet). Players: a drain that never kills. */
  poison: {
    name: "中毒",
    appliesTo: "both",
    duration: 5,
    stacking: "max-power",
    dotShare: 0.15,
    drain: { dps: 1.6, ramp: 400 },
  },
  /** Paras' stun spore; walking only, dashes are not slowed. */
  slow: {
    name: "减速",
    appliesTo: "player",
    duration: 1.2,
    stacking: "refresh",
    move: { kind: "factor", factor: 0.6 },
  },
  /** Grip Claw: rooted in place, still attacks (reference 2 s at −65% speed). */
  root: {
    name: "缠根",
    appliesTo: "enemy",
    duration: 2,
    bossScale: 0.35,
    stacking: "refresh",
    move: { kind: "factor", factor: 0.35 },
    control: true,
  },
  /** Snowball and Ice Stone: a little slower; the third charge freezes (reference). */
  chill: {
    name: "冻伤",
    appliesTo: "enemy",
    duration: 4,
    stacking: "refresh",
    move: { kind: "factor", factor: 0.85 },
    builds: { count: 3, into: "freeze" },
  },
  freeze: {
    name: "冰冻",
    appliesTo: "enemy",
    duration: 1.6,
    bossScale: 0.35,
    stacking: "refresh",
    move: { kind: "stop" },
    blocksAttacks: true,
    interrupts: true,
    vulnerable: 0.2,
    control: true,
  },
  /** Griseous Orb: takes more damage from everything (reference +25%, 4 s). */
  curse: { name: "诅咒", appliesTo: "enemy", duration: 4, stacking: "refresh", vulnerable: 0.25 },
  /** Silph Scope: the marked enemy takes +power damage. */
  marked: {
    name: "标记",
    appliesTo: "enemy",
    duration: 6,
    stacking: "max-power",
    vulnerable: "power",
  },
} as const satisfies Record<string, StatusDef>;

for (const [id, def] of Object.entries(table) as [string, StatusDef][])
  if (def.builds && !(def.builds.into in table))
    throw new Error(`${id}: builds.into ${def.builds.into} 不是状态。`);

type Table = typeof table;
export type StatusId = keyof Table;
export type EnemyStatusId = {
  [Id in StatusId]: Table[Id]["appliesTo"] extends "player" ? never : Id;
}[StatusId];
export type PlayerStatusId = {
  [Id in StatusId]: Table[Id]["appliesTo"] extends "enemy" ? never : Id;
}[StatusId];

export const statuses = table;
export const statusIds = Object.keys(table) as StatusId[];
