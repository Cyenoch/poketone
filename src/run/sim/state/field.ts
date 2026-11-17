import type { Beat } from "../beats";
import type { EnemyId } from "../content/enemies";
import type { PlayerId } from "./entities";

export type WeatherId = "sun" | "rain" | "sandstorm" | "hail";
export interface WeatherState {
  id: WeatherId;
  /** Absolute world seconds; the interval before `from` is a harmless forecast. */
  from: number;
  until: number;
}

export type FieldEventId =
  | "horde"
  | "outbreak"
  | "sun"
  | "rain"
  | "sandstorm"
  | "hail"
  | "site-awaken";

export interface ScheduledBeat {
  /** Seconds since entering this field. */
  at: number;
  beat: Beat | { kind: "event"; id: FieldEventId };
}

export type SiteKind =
  | "honey-tree"
  | "item-ball"
  | "snorlax"
  | "fishing"
  | "fossil"
  | "raid-den"
  | "spring"
  | "egg"
  | "glint"
  | "ghost"
  | "silph-scope"
  | "gengar-deal";

export interface CarriedEgg {
  species: EnemyId;
  distance: number;
  /** Last shared position sampled for walking distance. */
  x: number;
  z: number;
}

export interface Site {
  id: number;
  kind: SiteKind;
  x: number;
  z: number;
  radius: number;
  state: "dormant" | "ready" | "busy" | "spent";
  /** Absolute world seconds for a pending spawn, telegraph or encounter deadline. */
  until: number;
  owner: PlayerId | null;
  data: {
    /** Time spent channeling; fossils preserve this after interruption. */
    progress: number;
    /** Uses already consumed, including completed fishing attempts. */
    uses: number;
    enemy: number | null;
    /** The channel owner's lastHurt when channeling began. */
    lastHurt: number;
    species?: EnemyId;
    trap?: boolean;
    egg?: CarriedEgg;
    /** Personal accepted trades at this field's altar. */
    traded?: PlayerId[];
  };
}

export type RunDex = Partial<Record<EnemyId, { seen: number; defeated: number; shiny: number }>>;
