import type { ElementType } from "../content/elements";
import type { EnemyId } from "../content/enemies";
import type { FormId, Stage, StarterId } from "../content/lines/index";
import type { Archetype, MoveId } from "../content/moves";
import type { ReactionId } from "../content/reactions";
import type { EnemyStatusId } from "../content/statuses";
import type { Pickup, PlayerId } from "./entities";
import type { ItemId } from "../content/items";
import type { BuffCue } from "../content/triggers";

export type RunEvent =
  /** Co-op presence: a teammate lost or regained their connection, or left the run. */
  | { t: "peer"; player: PlayerId; state: "offline" | "online" | "left" }
  | { t: "contact"; x: number; z: number; by: PlayerId; type: ElementType }
  | {
      t: "hit";
      x: number;
      z: number;
      amount: number;
      crit: boolean;
      weak: boolean;
      /** The element of what hit, so the hit sounds like the move. */
      type: ElementType;
      /** The player whose move, ultimate or partner landed it. */
      by: PlayerId;
      /** Collision feedback has already played; this event supplies the confirmed number. */
      confirmedContact?: boolean;
    }
  | { t: "player-hit"; player: PlayerId; amount: number }
  /** Co-op only: `player` was knocked out without a personal revive remaining. */
  | { t: "down"; player: PlayerId }
  /** A hit on `player` was evaded (evasion stat): no damage. */
  | { t: "evade"; player: PlayerId }
  | { t: "death"; x: number; z: number; species: EnemyId; elite: boolean }
  | { t: "reaction"; x: number; z: number; reaction: ReactionId }
  | {
      t: "banner";
      text: string;
      tone: "danger";
      kind: "alpha" | "elite-wave" | "swarm" | "stampede" | "eruption" | "rampage";
    }
  | { t: "banner"; text: string; tone: "boss"; kind: "guardian" | "clear" }
  | { t: "banner"; text: string; tone: "boss"; kind: "fusion" | "capture"; player: PlayerId }
  | { t: "banner"; text: string; tone: "info"; kind: "zone" }
  | { t: "level"; player: PlayerId; level: number }
  /**
   * `player` answered card `card` and the answer was accepted (`index`: the option picked or
   * banished). Diagnostics only (the dev run log); nothing in the sim or view reads it.
   */
  | { t: "card"; player: PlayerId; card: number; action: CardAction; index?: number }
  | { t: "pickup"; kind: Pickup["kind"] }
  /** `windup`: seconds until this cast's first shot or hit (the cast sound lands on it). */
  | { t: "cast"; player: PlayerId; move: MoveId; windup: number }
  /**
   * An enemy started an attack's wind-up (`windup` seconds until it lands): the view's glint and the
   * tell sound. Presentation only; nothing in the sim reads it.
   */
  | { t: "tell"; enemy: number; severity: TellSeverity; windup: number }
  | { t: "dash"; player: PlayerId }
  /** `lift`: height of the first point over its ground (default chest; Ball Storm's hovering ball). */
  | { t: "chain"; points: number[]; type: ElementType; lift?: number }
  /** A drain hit at (x, z) healed `player`. */
  | { t: "drain"; player: PlayerId; x: number; z: number }
  /** A projectile or hazard (`id`) flew into the terrain at this point. */
  | { t: "impact"; id: number; x: number; y: number; z: number }
  /** Presentation only: each contact tick or terminal beat, including shots born and removed in one tick. */
  | {
      t: "projectile-feedback";
      id: number;
      tick: number;
      move: MoveId;
      archetype: Archetype;
      type: ElementType;
      x: number;
      y: number;
      z: number;
      fromX: number;
      fromY: number;
      fromZ: number;
      ended: boolean;
      reason: "hit" | "terrain" | "expired" | "burst";
      /** New pierced bodies this tick; burst areas carry their own explosion. */
      hits: number;
    }
  /** One of `player`'s timed buffs (an item or ability trigger) switched on; `on` is what cued it. */
  | { t: "buff"; player: PlayerId; on: BuffCue }
  /** `player` came back: the lab's revive, or an item's save (`item`: Revive, Max Revive, Rainbow Wing). */
  | { t: "revive"; player: PlayerId; item?: ItemId; team?: true }
  /** An elite joined `player` as partner `partner` where it fell. */
  | { t: "capture"; player: PlayerId; partner: number; species: EnemyId; x: number; z: number }
  /** A partner attacked: from its spot to the target's (a cloud is centred on the partner). */
  | {
      t: "partner-attack";
      partner: number;
      style: PartnerStyle;
      type: ElementType;
      x: number;
      z: number;
      tx: number;
      tz: number;
    }
  /** A partner at (x, z) shielded its owner at (tx, tz) (护主). */
  | {
      t: "partner-guard";
      partner: number;
      type: ElementType;
      x: number;
      z: number;
      tx: number;
      tz: number;
    }
  | { t: "evolve"; player: PlayerId; stage: Stage; form: FormId }
  /** An ultimate fired at its tier; its pulses follow as `ult-pulse`. */
  | { t: "ult"; player: PlayerId; line: StarterId; stage: Stage }
  | UltPulseEvent
  /** An item's burst or strike: drawn with the ultimate pulse looks (shape and size are the hitbox). */
  | (Omit<UltPulseEvent, "t"> & { t: "item-burst" })
  /** A status built up into another on an enemy at (x, z) (three chills → `freeze`). */
  | { t: "status-built"; status: EnemyStatusId; x: number; z: number }
  /** A rule-based heal (an item's or ability's trigger) restored `share` of `player`'s max HP. */
  | { t: "heal"; player: PlayerId; share: number }
  /** A healer's pulse mended the enemies within `radius` of it (skills/healPulse.ts). */
  | { t: "heal-pulse"; enemy: number; x: number; z: number; radius: number };

export type CardAction = "pick" | "reroll" | "skip" | "banish";

/** Blue tell: a normal, dodgeable wind-up. Red: heavy, wide or crowd-control (docs/GAME-FEEL.md). */
export type TellSeverity = "normal" | "danger";

/** How a partner fights, from its species' own attack (partners.ts `styleOf`). */
export type PartnerStyle = "tackle" | "shot" | "cloud" | "pulse";

/** One damaging beat of an ultimate, for the view (shape and size are the hitbox). */
export interface UltPulseEvent {
  t: "ult-pulse";
  player: PlayerId;
  look: UltLook;
  x: number;
  z: number;
  radius: number;
  /** Lines: unit heading and the length left after cover clipped it. */
  dirX: number;
  dirZ: number;
  length: number;
}

export type UltLook =
  | "roots"
  | "sun"
  | "spores"
  | "petals"
  | "pillar"
  | "ring"
  | "embers"
  | "crack"
  | "meteor"
  | "blast"
  | "whirl"
  | "wave"
  | "rain"
  | "cannon"
  | "storm"
  | "bolt"
  | "zigzag";
