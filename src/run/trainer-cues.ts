import type { ElementType } from "./sim/content/elements";
import { starters, type StarterId } from "./sim/content/lines/index";
import { ultimates } from "./sim/content/ultimates";
import type { TrainerId } from "../trainers";

/** The opening line, naming the partner the ball releases. */
export const deployCall = (partner: string) => `就决定是你了，${partner}！`;
/** A teammate's ultimate as their band shows it: the move's name at their stage. */
export const ultimateCall = (line: StarterId, stage: number) =>
  `${ultimates[starters[line].ultimate].names[stage]}！`;

export interface TrainerCue {
  kind: "deploy" | "ultimate" | "dialogue";
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
}

/** How long each cue holds the slot, entrance and exit included (ms). */
export const cueDuration = (cue: Pick<TrainerCue, "kind" | "local">) =>
  cue.kind === "deploy" ? 1750 : cue.kind === "dialogue" ? 3000 : cue.local ? 1300 : 950;

const priority = (cue: TrainerCue) =>
  cue.kind === "deploy" ? 3 : cue.kind === "ultimate" ? (cue.local ? 2 : 1) : 0;

/** What may play over the run now: everything, only the player's own beats under a danger
 *  notice, or nothing but the opening while a window, the map or a hidden HUD covers it. */
export type CueGate = "open" | "danger" | "blocked";
const allowed = (gate: CueGate, cue: TrainerCue) =>
  cue.kind === "deploy" ||
  gate === "open" ||
  (gate === "danger" && cue.kind === "ultimate" && cue.local);

/** One cosmetic slot, with no backlog: old or obscured dialogue never plays after a menu. */
export class TrainerCues {
  private active: ActiveTrainerCue | null = null;
  private sequence = 0;
  private gate: CueGate = "open";

  show(cue: TrainerCue, now: number, ageMs = 0): boolean {
    const duration = cueDuration(cue);
    if (!allowed(this.gate, cue) || ageMs >= duration) return false;
    const current = this.read(now);
    if (
      current &&
      (priority(current) > priority(cue) || (!cue.local && priority(current) === priority(cue)))
    )
      return false;
    this.active = { ...cue, id: ++this.sequence, born: now - Math.max(0, ageMs), duration };
    return true;
  }

  read(now: number): ActiveTrainerCue | null {
    if (this.active && now - this.active.born >= this.active.duration) this.active = null;
    return this.active;
  }

  suppress(gate: CueGate): void {
    this.gate = gate;
    if (this.active && !allowed(gate, this.active)) this.clear();
  }

  clear(): void {
    this.active = null;
  }
}
