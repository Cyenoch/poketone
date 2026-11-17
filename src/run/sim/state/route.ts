import type { StageId } from "../content/stages/index";

export type MarkerId = "chests" | "elite-nest" | "pokecenter" | "research" | "gengar-deal";
export type ModifierId = "dark-cave" | "fog" | "boss-sighting";

export interface ZoneExit {
  x: number;
  z: number;
  /** Null only for the expedition's final exit. */
  to: StageId | null;
  marker: MarkerId | null;
}
