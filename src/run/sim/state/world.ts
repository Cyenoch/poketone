import type { Difficulty } from "../content/difficulties";
import type { EnemyId } from "../content/enemies";
import type { StageId } from "../content/stages/index";
import type { GeneratedMap } from "../mapgen/index";
import type { Nav } from "../nav/index";
import type { Rng } from "../rng";
import type { Area, Enemy, Hazard, Partner, Pickup, Player, Projectile, Station } from "./entities";
import type { RunEvent } from "./events";

/** Simulation tick. Fixed so a future host can step every peer's world identically. */
export const TICK = 1 / 30;
export const ARENA_HALF = 44;

export interface SpawnState {
  credit: number;
  /** Smoothed team pressure, 0–1; 0.5 gives the authored ordinary spawn rate. */
  pressure: number;
  pool: EnemyId[];
  /** Timeline beats already fired (plain array: the world must survive a JSON snapshot). */
  fired: string[];
  /** Index in `players` of the last player a spawn or beat was placed around (-1 before the first). */
  anchor: number;
}

/**
 * Where the run is in its stage's zones (openspec/specs/world-progression/spec.md): `active` fights toward the guardian,
 * `cleared` lets the players gather what it dropped and use the stations until they leave by the
 * landmark, `transitioning` holds the world still while the host readies the next zone's field.
 */
export interface ZoneState {
  /** 0-based index into the stage's `zones`. */
  index: number;
  /** Ticks fought in this zone; its clock (roster, beats, curves, final swarm) is `tick × TICK`. */
  tick: number;
  phase: "active" | "cleared" | "transitioning";
}

export interface World {
  stage: StageId;
  seed: number;
  rng: Rng;
  difficulty: Difficulty;
  time: number;
  tick: number;
  paused: boolean;
  outcome: "playing" | "victory" | "defeat";
  nextId: number;
  players: Player[];
  partners: Partner[];
  enemies: Enemy[];
  projectiles: Projectile[];
  areas: Area[];
  hazards: Hazard[];
  pickups: Pickup[];
  stations: Station[];
  /** Complete static generation result; navigation remains runtime state. */
  map: GeneratedMap;
  nav: Nav;
  spawn: SpawnState;
  /** The summoned guardian, while it stands. */
  bossId: number | null;
  zone: ZoneState;
  rampage: boolean;
  events: RunEvent[];
}
