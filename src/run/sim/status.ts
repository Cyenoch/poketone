// Status rules over the registry (content/statuses.ts). Bodies carry a sparse `ActiveStatus[]`; an
// entry exists only while it has time left. Callers keep the per-tick order: read `dotRate` /
// `drainRate` / `stopped` before `decay` (they act on the tick a status was alive at the start of),
// and `slowed` after it (slows act on what is left).

import {
  statusIds,
  statuses,
  type EnemyStatusId,
  type StatusDef,
  type StatusId,
} from "./content/statuses";
import type { ActiveStatus, Enemy } from "./state/entities";
import { sin } from "./math";
import { staggered } from "./poise";

interface Holder<Id extends StatusId> {
  statuses: ActiveStatus<Id>[];
}

const def = (id: StatusId): StatusDef => statuses[id];

export function find<Id extends StatusId>(
  holder: Holder<Id>,
  id: NoInfer<Id>,
): ActiveStatus<Id> | undefined {
  return holder.statuses.find((status) => status.id === id);
}

export function has<Id extends StatusId>(holder: Holder<Id>, id: NoInfer<Id>): boolean {
  return holder.statuses.some((status) => status.id === id);
}

/**
 * Applies `time` seconds at `power` under the status' stacking rule; a `builds` status also counts a
 * charge per application (`inflict` turns it into its `into` status at `count`).
 */
export function apply<Id extends StatusId>(
  holder: Holder<Id>,
  id: NoInfer<Id>,
  time: number,
  power: number,
  source: number,
): void {
  const { builds, stacking } = def(id);
  const active = find(holder, id);
  if (!active) {
    holder.statuses.push(
      builds ? { id, time, power, source, stacks: 1 } : { id, time, power, source },
    );
    return;
  }
  active.time = time;
  active.source = source;
  if (stacking === "max-power") active.power = Math.max(active.power, power);
  if (builds) active.stacks = (active.stacks ?? 1) + 1;
}

/** Damage factor on hits against `holder` from its statuses (freeze, curse, a mark). */
export function vulnerability(holder: Holder<StatusId>): number {
  let factor = 1;
  for (const status of holder.statuses) {
    const bonus = def(status.id).vulnerable;
    if (bonus !== undefined) factor *= 1 + (bonus === "power" ? status.power : bonus);
  }
  return factor;
}

/** Keeps at least `time` seconds (standing in a pool or cloud); power is untouched. */
export function sustain<Id extends StatusId>(
  holder: Holder<Id>,
  id: NoInfer<Id>,
  time: number,
  source: number,
): void {
  const active = find(holder, id);
  if (active) active.time = Math.max(active.time, time);
  else holder.statuses.push({ id, time, power: 0, source });
}

/**
 * A hit of `amount` damage applies `id` and returns the status that landed (a full `builds` status
 * turns into its `into`): its duration (scaled on a guardian, then by the source's
 * duration stat) and DoT share (scaled by the source's status damage stat).
 */
export function inflict(
  enemy: Enemy,
  id: EnemyStatusId,
  amount: number,
  source: number,
  duration = 1,
  power = 1,
): EnemyStatusId {
  const d = def(id);
  const time = d.duration * (enemy.boss ? (d.bossScale ?? 1) : 1) * duration;
  apply(enemy, id, time, d.dotShare ? amount * d.dotShare * power : 0, source);
  if (d.builds && (find(enemy, id)?.stacks ?? 0) >= d.builds.count) {
    consume(enemy, id);
    return inflict(enemy, d.builds.into as EnemyStatusId, amount, source, duration, power);
  }
  return id;
}

/** Removes `id` and returns what it was, or undefined when it was not active. */
export function consume<Id extends StatusId>(
  holder: Holder<Id>,
  id: NoInfer<Id>,
): ActiveStatus<Id> | undefined {
  const index = holder.statuses.findIndex((status) => status.id === id);
  if (index < 0) return undefined;
  return holder.statuses.splice(index, 1)[0];
}

/** Counts every timer down by `dt` and drops the ones that ran out. */
export function decay(holder: Holder<StatusId>, dt: number): void {
  let kept = 0;
  for (const status of holder.statuses) {
    status.time -= dt;
    if (status.time > 0) holder.statuses[kept++] = status;
  }
  holder.statuses.length = kept;
}

/** Enemy damage per second from DoT statuses (burn, poison). */
export function dotRate(holder: Holder<StatusId>): number {
  let rate = 0;
  for (const id of statusIds) {
    if (!def(id).dotShare) continue;
    const active = find(holder, id);
    if (active) rate += active.power;
  }
  return rate;
}

/**
 * The source credited with a DoT kill (-1 for the environment): the latest applier of the strongest
 * DoT, registry order on a tie. Read before `decay`, like `dotRate`, so its last tick still counts.
 */
export function dotSource(holder: Holder<StatusId>): number {
  let best: ActiveStatus | undefined;
  for (const id of statusIds) {
    if (!def(id).dotShare) continue;
    const active = find(holder, id);
    if (active && (!best || active.power > best.power)) best = active;
  }
  if (!best) throw new Error("dotSource: no DoT status is active.");
  return best.source;
}

export function drainAt(status: StatusDef, time: number): number {
  return status.drain ? status.drain.dps * (1 + time / status.drain.ramp) : 0;
}

/** Player HP lost per second to drain statuses at `time`. */
export function drainRate(holder: Holder<StatusId>, time: number): number {
  let rate = 0;
  for (const id of statusIds) if (def(id).drain && has(holder, id)) rate += drainAt(def(id), time);
  return rate;
}

/** `speed` after every active speed factor and stutter, in registry order (stops are `stopped`). */
export function slowed(holder: Holder<StatusId>, speed: number, time: number, id: number): number {
  for (const status of statusIds) {
    const move = def(status).move;
    if (!move || move.kind === "stop" || !has(holder, status)) continue;
    if (move.kind === "factor") speed *= move.factor;
    else speed *= sin(time * move.rate + id) > move.above ? 0 : move.factor;
  }
  return speed;
}

const flagged = (holder: Holder<StatusId>, test: (status: StatusDef) => boolean | undefined) =>
  holder.statuses.some((status) => test(def(status.id)));

/** A status holds the body in place (sleep). */
export const stopped = (holder: Holder<StatusId>) =>
  flagged(holder, (status) => status.move?.kind === "stop");
/** The body cannot start an attack or shoot (paralysis). */
export const attacksBlocked = (holder: Holder<StatusId>) =>
  flagged(holder, (status) => status.blocksAttacks);
/** Held in place or helpless (Binding Band): a `control` status or a stagger. */
export const held = (enemy: Enemy) =>
  staggered(enemy) || flagged(enemy, (status) => status.control);

/** The enemy's wind-ups, hazards and contact are cancelled (sleep, a stagger). */
export const interrupted = (enemy: Enemy) =>
  staggered(enemy) || flagged(enemy, (status) => status.interrupts);

/** Player attacks, partners and contact can reach it: not underground (skills/landing.ts burrow). */
export const targetable = (enemy: Enemy) => enemy.phase !== "under";

/** Damage multiplier for a hit on `enemy`; the statuses that grant it end (the hit wakes a sleeper). */
export function wake(enemy: Enemy): number {
  let factor = 1;
  let kept = 0;
  for (const status of enemy.statuses) {
    const bonus = def(status.id).wakeBonus;
    if (bonus) factor *= bonus;
    else enemy.statuses[kept++] = status;
  }
  enemy.statuses.length = kept;
  return factor;
}
