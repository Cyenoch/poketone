// Body motion the sim leaves to the view (docs/state-machines/simulation.md): leapers and Pinsir arc through
// their jump, burrowers (Sandslash too) sink out of sight and break back out, Haunter fades (shrinks)
// instead of digging, a guardian leans into its dash or jump, and Aerodactyl swoops low and lands.
// Reads phase and phase time only.

import { enemies as enemyDefs } from "../sim/content/enemies";
import { zoneDef } from "../sim/currentZone";
import { PINSIR } from "../sim/content/params/guardian";
import { LANDING } from "../sim/content/params/enemy-skills";
import { LANDING_RESIDUE } from "../sim/skills/landing";
import { FLYER_HOVER } from "../sim/content/params/combat";
import { TICK, type World } from "../sim/state/world";
import type { Enemy } from "../sim/state/entities";

/** Seconds a burrower takes to sink out of sight, and to break back out. */
const DIG = 0.15;
/** Jump apex, in body heights for the swarm, in metres for the guardian. */
const SWARM_APEX = 1.1;
const GUARDIAN_APEX = 2.6;

export interface BodyMotion {
  /** Offset added to the body's height (negative: sinking). */
  lift: number;
  /** × the body's scale (0: hidden). */
  show: number;
  /** Forward lean (rad). */
  pitch: number;
}

const still: BodyMotion = { lift: 0, show: 1, pitch: 0 };
/** A guardian leans this far into its dash or jump. */
const LEAN = 0.35;

/** Integrate cadence: multiplying total elapsed time by a changing speed jumps the pose. */
export function advanceGait(phase: number, speed: number, scale: number, dt: number): number {
  return (phase + (dt * (4 + speed * 2.2)) / Math.sqrt(scale)) % (Math.PI * 2);
}

/** `alpha` is the frame's interpolation between the last two ticks. */
export function bodyMotion(world: World, enemy: Enemy, alpha: number): BodyMotion {
  // The phase timer is the tick's end; the frame drawn sits `1 − alpha` of a tick before it.
  const t = enemy.phaseTime - (1 - alpha) * TICK;
  const height = enemyDefs[enemy.species].height * enemy.scale;
  if (enemy.boss) {
    const brain = zoneDef(world).guardian.brain;
    if (enemy.action) {
      if (enemy.action.attack === "blink")
        return {
          lift: 0,
          show:
            enemy.phase === "under"
              ? Math.min(1, Math.max(0, 1 - t / enemy.action.windup))
              : Math.min(1, Math.max(0, t / DIG)),
          pitch: 0,
        };
      if (enemy.phase === "under")
        return burrowing(enemy, t, height, enemyDefs[enemy.species].types.includes("ghost"))!;
      if (enemy.phase === "windup" && enemy.action.speed > 0)
        return {
          lift: 0,
          show: 1,
          pitch: -0.12 * Math.min(1, Math.max(0, t / enemy.action.windup)),
        };
      if (enemy.phase === "dash") {
        const jump = enemy.action.attack === "sludge-slam";
        return {
          lift: jump ? arc(t / enemy.action.active) * GUARDIAN_APEX : 0,
          show: 1,
          pitch: enemy.action.speed > 0 ? LEAN : 0,
        };
      }
      if (
        enemy.phase === "recover" &&
        enemyDefs[enemy.species].mobility.flying &&
        (brain === "golbat" || brain === "dragonite")
      )
        return flyer(enemy, t);
      if (
        enemy.phase === "recover" &&
        (enemy.action.attack === "shadow" || enemy.action.attack === "gengar-shadow")
      )
        return { lift: 0, show: Math.min(1, Math.max(0, t / DIG)), pitch: 0 };
      if (enemy.phase === "recover" && enemy.action.attack === "lava-dive")
        return { lift: (Math.min(1, Math.max(0, t / DIG)) - 1) * height, show: 1, pitch: 0 };
      return still;
    }
    // Sandslash digs like a swarm burrower; Aerodactyl swoops low on its dive and lands to recover.
    if (brain === "sandslash") return sandslash(world, enemy, t, height);
    if (brain === "aerodactyl") return flyer(enemy, t);
    // Nidoking's `dash` is the fissure going off while it stands, Marowak's its bones in flight: no lean.
    if (enemy.phase !== "dash" || brain === "nidoking" || brain === "marowak") return still;
    const lift = brain === "pinsir" ? arc(t / PINSIR.travel) * GUARDIAN_APEX : 0;
    return { lift, show: 1, pitch: LEAN };
  }
  const kind = enemyDefs[enemy.species].skill?.kind;
  if (kind === "teleport") {
    if (enemy.phase === "under")
      return { lift: 0, show: Math.min(1, Math.max(0, 1 - t / 0.4)), pitch: 0 };
    if (enemy.phase === "windup")
      return { lift: 0, show: Math.min(1, Math.max(0, t / DIG)), pitch: 0 };
    return still;
  }
  if (
    kind === "leap" ||
    kind === "leap-heavy" ||
    kind === "high-jump-kick" ||
    kind === "body-slam"
  ) {
    if (enemy.phase !== "dash") return still;
    return { lift: arc(t / LANDING[kind].travel) * SWARM_APEX * height, show: 1, pitch: 0 };
  }
  if (kind === "belly-slide" && enemy.phase === "dash") return { lift: 0, show: 1, pitch: 0.08 };
  if (
    kind !== "burrow" &&
    kind !== "shadow-sneak" &&
    kind !== "dig" &&
    kind !== "triple-burrow" &&
    kind !== "melt"
  )
    return still;
  return burrowing(enemy, t, height, kind === "shadow-sneak" || kind === "melt") ?? still;
}

/**
 * Sandslash sinks like a burrower; its recovery starts with a head start on the phase timer, so the
 * break-out reads the spent circle's residue instead. It leans into its roll.
 */
function sandslash(world: World, enemy: Enemy, t: number, height: number): BodyMotion {
  if (enemy.phase === "under") return burrowing(enemy, t, height, false)!;
  if (enemy.phase === "dash") return { lift: 0, show: 1, pitch: LEAN };
  const spent = world.hazards.find(
    (hazard) => hazard.kind === "landing" && hazard.caster === enemy.id && hazard.dmg === 0,
  );
  if (enemy.phase !== "recover" || !spent) return still;
  const out = Math.min(1, (LANDING_RESIDUE - spent.life) / DIG);
  return { lift: (out - 1) * height, show: 1, pitch: 0 };
}

/** Aerodactyl: down to the band on its dive, on the ground through its recovery. */
function flyer(enemy: Enemy, t: number): BodyMotion {
  if (enemy.phase === "dash") return { lift: -FLYER_HOVER * 0.6, show: 1, pitch: LEAN };
  if (enemy.phase !== "recover") return still;
  const down = Math.min(1, Math.max(0, t / DIG));
  return { lift: -FLYER_HOVER * down, show: 1, pitch: 0 };
}

/** Sinking out of sight underground and breaking back out; a ghost fades instead. Null: neither. */
function burrowing(enemy: Enemy, t: number, height: number, ghost: boolean): BodyMotion | null {
  if (enemy.phase === "under") {
    const gone = Math.min(1, Math.max(0, t / DIG));
    return ghost
      ? { lift: 0, show: 1 - gone, pitch: 0 }
      : { lift: -gone * height, show: gone < 1 ? 1 : 0, pitch: 0 };
  }
  if (enemy.phase === "recover" && t < DIG) {
    const out = Math.max(0, t / DIG);
    return ghost
      ? { lift: 0, show: out, pitch: 0 }
      : { lift: (out - 1) * height, show: 1, pitch: 0 };
  }
  return null;
}

/** 0 → 1 → 0 over the jump. */
function arc(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return 4 * p * (1 - p);
}
