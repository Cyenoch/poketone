import type { ElementType } from "./sim/content/elements";
import { starters, type StarterId } from "./sim/content/lines/index";
import { ultimates } from "./sim/content/ultimates";
import type { TrainerId } from "../trainers";
import { assistNames, type AssistItem } from "./sim/content/trainers";

/** The opening line, naming the partner the ball releases. */
export const deployCall = (partner: string) => `就决定是你了，${partner}！`;
/** A teammate's ultimate as their band shows it: the move's name at their stage. */
export const ultimateCall = (line: StarterId, stage: number) =>
  `${ultimates[starters[line].ultimate].names[stage]}！`;
/** A trainer item's call: the item's name. */
export const assistCall = (item: AssistItem) => `${assistNames[item]}！`;

export interface TrainerCue {
  kind: "deploy" | "ultimate" | "assist" | "dialogue";
  trainer: TrainerId;
  text: string;
  /** The speaking player's partner type: the crest in the band's ball. */
  type: ElementType;
  /** Null in solo; the original seat in co-op, including repeated trainer choices. */
  seat: number | null;
  local: boolean;
}

export interface ActiveTrainerCue extends TrainerCue {
  id: number;
  born: number;
  duration: number;
  /** When the ultimate actually released (the sim's `ult-release`), or null before it. */
  released: number | null;
}

/** How long each cue holds the slot, entrance and exit included (ms). The player's own ultimate
 *  spans its two-second preparation and the release beat after it; a trainer item is a short call. */
export const cueDuration = (cue: Pick<TrainerCue, "kind" | "local">) =>
  cue.kind === "deploy"
    ? 1750
    : cue.kind === "dialogue"
      ? 3000
      : cue.kind === "assist"
        ? cue.local
          ? 1400
          : 950
        : cue.local
          ? 3000
          : 950;
/** The release beat: its burst (ms), how long the band stays after the release, exit included,
 *  and the oldest release event that may still play its burst. */
export const RELEASE = { burst: 520, after: 1000, late: 400 } as const;

const priority = (cue: TrainerCue) =>
  cue.kind === "deploy"
    ? 3
    : cue.kind === "ultimate"
      ? cue.local
        ? 2
        : 1
      : cue.kind === "assist" && cue.local
        ? 1
        : 0;

/** What may play over the run now: everything, only the player's own beats under a danger
 *  notice, or nothing but the opening while a window, the map or a hidden HUD covers it. */
export type CueGate = "open" | "danger" | "blocked";
const allowed = (gate: CueGate, cue: TrainerCue) =>
  cue.kind === "deploy" ||
  gate === "open" ||
  (gate === "danger" && (cue.kind === "ultimate" || cue.kind === "assist") && cue.local);

/**
 * One cosmetic slot, with no backlog: old or obscured dialogue never plays after a menu. An item
 * call that arrives over an ultimate's band takes the band's side slot instead (`aside`): the
 * ultimate stays whole and the call shows next to it, for as long as both last.
 */
export class TrainerCues {
  private active: ActiveTrainerCue | null = null;
  private side: ActiveTrainerCue | null = null;
  private sequence = 0;
  private gate: CueGate = "open";

  show(cue: TrainerCue, now: number, ageMs = 0): boolean {
    const duration = cueDuration(cue);
    if (!allowed(this.gate, cue) || ageMs >= duration) return false;
    const current = this.read(now);
    if (current?.kind === "ultimate" && cue.kind === "assist") {
      const held = this.aside(now);
      if (held?.local && !cue.local) return false;
      this.side = {
        ...cue,
        id: ++this.sequence,
        born: now - Math.max(0, ageMs),
        duration,
        released: null,
      };
      return true;
    }
    if (
      current &&
      (priority(current) > priority(cue) ||
        (!cue.local && priority(current) === priority(cue)) ||
        // A repeated start of the same ultimate never reopens its band.
        (cue.kind === "ultimate" && current.kind === "ultimate" && current.seat === cue.seat))
    )
      return false;
    this.active = {
      ...cue,
      id: ++this.sequence,
      born: now - Math.max(0, ageMs),
      duration,
      released: null,
    };
    return true;
  }

  /** Marks the showing ultimate of `seat` as released and keeps its band up for the beat after.
   *  A release for another seat, a band already gone or obscured, a second release, or one too
   *  old to play its burst changes nothing. */
  release(seat: number | null, local: boolean, now: number, ageMs = 0): boolean {
    const cue = this.read(now);
    if (
      !cue ||
      cue.kind !== "ultimate" ||
      cue.seat !== seat ||
      cue.local !== local ||
      cue.released !== null ||
      ageMs >= RELEASE.late
    )
      return false;
    const at = now - Math.max(0, ageMs);
    cue.released = at;
    cue.duration = Math.max(cue.duration, at - cue.born + RELEASE.after);
    return true;
  }

  read(now: number): ActiveTrainerCue | null {
    if (this.active && now - this.active.born >= this.active.duration) this.active = null;
    return this.active;
  }

  /** The item call beside the showing ultimate band, if both still last. */
  aside(now: number): ActiveTrainerCue | null {
    if (this.read(now)?.kind !== "ultimate") this.side = null;
    if (this.side && now - this.side.born >= this.side.duration) this.side = null;
    return this.side;
  }

  suppress(gate: CueGate): void {
    this.gate = gate;
    if (this.active && !allowed(gate, this.active)) this.clear();
    if (this.side && !allowed(gate, this.side)) this.side = null;
  }

  clear(): void {
    this.active = this.side = null;
  }
}
