import type { AreaKind } from "../archetypes/index";
import type { Archetype, MoveId, UpgradeStat } from "../content/moves";
import type { ElementType } from "../content/elements";
import type { HazardKind } from "../hazards";
import type { EnemyId } from "../content/enemies";
import type { Stage, StarterId } from "../content/lines/index";
import type { Modifier } from "../content/effects";
import type { ItemId } from "../content/items";
import type { EnemyStatusId, PlayerStatusId, StatusId } from "../content/statuses";

export type PlayerId = number;

export interface MoveMods {
  dmg: number;
  cd: number;
  count: number;
  area: number;
  speed: number;
  dur: number;
  pierce: number;
  crit: number;
  status: number;
}

export interface MoveState {
  id: MoveId;
  level: number;
  cooldown: number;
  /** Ready, but nothing was in range at its last try: it retries every 0.2 s (that wait is not a
   *  cooldown, and the HUD shows the move ready). */
  waiting?: true;
  mods: MoveMods;
  damage: number;
}

export interface ItemState {
  id: ItemId;
  level: number;
}

export type Rarity = 0 | 1 | 2 | 3;

export type Choice =
  | { kind: "move"; move: MoveId }
  | {
      kind: "upgrade";
      move: MoveId;
      rarity: Rarity;
      rolls: { stat: UpgradeStat; value: number }[];
    }
  | { kind: "item"; item: ItemId }
  /** 招式学习器盒: a rare chest card (params/cards.ts `TM_CASE`). */
  | { kind: "tm-case" }
  /** 训练: offered only when no move, upgrade or item is left (params/cards.ts `TRAIN`). */
  | { kind: "train"; stat: TrainStat };

export type TrainStat = "dmg" | "hp" | "speed" | "area" | "cd";

/** Ultimate charge and the cast in progress (sim/ultimates). */
export interface UltState {
  /** 0 → 1; the ultimate can fire at 1. */
  charge: number;
  /** Damage credit the next hits may still turn into charge; refills over time (caps late-game damage). */
  room: number;
  /** Seconds into the running cast, or -1 when none runs. */
  elapsed: number;
  /** Index of the next pulse of the running cast's timeline. */
  next: number;
  /** Tier of the running cast (the stage when it fired). */
  stage: Stage;
  /** Cast origin and aim (unit) when it fired. */
  x: number;
  z: number;
  ax: number;
  az: number;
  /** A path pulse's current point (zig-zag hops) and the enemies already crossed. */
  pathX: number;
  pathZ: number;
  crossed: number[];
}

/** Run rules the lab raises; `LabBonuses.rules` holds each one's bonus over the base. */
export type RunRule =
  | "moveSlots"
  | "itemSlots"
  /** Cards per level-up (chests stay at 3). */
  | "choices"
  | "rerolls"
  | "skips"
  | "banishes"
  | "revives"
  /** 支援队伍: partner slots over `BASE_PARTNER_SLOTS` (partners.ts). */
  | "partners";

/**
 * Account-wide lab (研究所) bonuses, as plain data so a host can receive them from each peer in
 * `RunConfig`; the sim never reads the local save. Stat bonuses fold with every other source
 * (stats.ts); a rule missing from `rules` gets no bonus.
 */
export interface LabBonuses {
  modifiers: Modifier[];
  rules: Partial<Record<RunRule, number>>;
}

export interface PendingChoice {
  /** Pick and reroll commands name the card they answer, so a repeated input cannot hit the next one. */
  id: number;
  source: "level" | "chest";
  /** Rolled when the card reaches the front of the queue; empty while it waits behind another. */
  options: Choice[];
}

/** One status on a body (sim/status.ts); present only while `time` > 0. */
export interface ActiveStatus<Id extends StatusId = StatusId> {
  id: Id;
  /** Seconds left. */
  time: number;
  /** DoT per second (burn, enemy poison); 0 for the rest. */
  power: number;
  /** Player id that last applied it (credited with a DoT kill), or -1 for puddles and enemy attacks. */
  source: number;
  /** Charges of a `builds` status (chill); absent for the rest. */
  stacks?: number;
}

export interface Player {
  id: PlayerId;
  /** The evolution line; the current form is `stageForm(starter, stage)`. */
  starter: StarterId;
  stage: Stage;
  x: number;
  z: number;
  px: number;
  pz: number;
  faceX: number;
  faceZ: number;
  /** The player's camera yaw (src/run/cameraYaw.ts), for what their screen shows (viewFootprint.ts). */
  viewYaw: number;
  moving: boolean;
  inputX: number;
  inputZ: number;
  /** Actual walking velocity, eased toward the input (crisp start and stop; dashes are instant). */
  vx: number;
  vz: number;
  hp: number;
  /** Shield HP left, up to the `shield` stat; taken before HP (hurt.ts). */
  shield: number;
  /** `World.time` of the last hit that landed (shield refill, metronome-style triggers). */
  lastHurt: number;
  alive: boolean;
  /** Co-op: this guest left the run for good; never revived, rescued or counted in scaling. */
  departed?: true;
  /** Manually opened in co-op; solo cards open automatically. */
  choosing: boolean;
  rescue: { target: PlayerId; elapsed: number } | null;
  level: number;
  xp: number;
  xpNext: number;
  invulnerable: number;
  /** Seconds before queued cards show (and freeze the world), so an evolution plays out first. */
  cardHold: number;
  /** Seconds until the next dash charge returns (0 while every charge is ready). */
  dashCooldown: number;
  /** Dash charges ready now, up to the `dashCharges` stat. */
  dashes: number;
  dashTime: number;
  dashX: number;
  dashZ: number;
  statuses: ActiveStatus<PlayerStatusId>[];
  hurt: number;
  moves: MoveState[];
  items: ItemState[];
  pending: PendingChoice[];
  rerolls: number;
  skips: number;
  banishes: number;
  /** Banished offers (`banishKey`), never rolled again this run. */
  banished: string[];
  revives: number;
  /** 星星沙子 earned this run (fractional; banked rounded down). */
  stardust: number;
  lab: LabBonuses;
  /** 训练 cards taken, per stat. */
  training: Record<TrainStat, number>;
  ult: UltState;
  /** 招式学习器盒 owned: move level cap 10, fusion star cap +1. */
  tmCase: boolean;
  /** The station dialog open for this player (freezes the world like a card), or null. */
  dialog: StationDialog | null;
  kills: number;
  /** Trigger state (sim/triggers): timers, stacks and cooldowns by `ActiveTrigger.key`. */
  fx: Record<string, number>;
  /** Trigger procs in the current one-second window (per-second caps), by `ActiveTrigger.key`. */
  procs: Record<string, number>;
  procWindow: number;
}

export interface Enemy {
  id: number;
  species: EnemyId;
  x: number;
  z: number;
  px: number;
  pz: number;
  faceX: number;
  faceZ: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  radius: number;
  scale: number;
  xp: number;
  elite: boolean;
  /** 头目: the timeline's alpha elite, the likeliest capture (params/partners.ts `CAPTURE_CHANCE`). */
  alpha: boolean;
  boss: boolean;
  knockX: number;
  knockZ: number;
  flash: number;
  statuses: ActiveStatus<EnemyStatusId>[];
  /** Seconds of Harden remaining; reduces direct hits, never damage over time. */
  hardened: number;
  /** Active guardian shield multiplier, while hardened > 0. */
  hardenDamage?: number;
  /** P4–P6 attack timing; phase and phaseTime remain the shared FSM. */
  action?: GuardianAction;
  /** Raised guardian's next ground cast: seconds left and casts so far (bosses/fury.ts). */
  fury?: { timer: number; casts: number };
  /** Visible-threat reaction, then a finite sidestep and cooldown (enemy-dodge.ts). */
  dodge?: { threat: number; ready: number; until: number; next: number; x: number; z: number };
  /** Independent future-sight sequence, recorded at each interval. */
  foresight?: { left: number; timer: number };
  /** Seconds left in its last stagger (sim/poise.ts): held still above `STAGGER.immune`, unstaggerable until 0. */
  stagger: number;
  /** Seconds to the next skill cast; the guardian counts down its Air Slash wind-up here (0 on a dash's). */
  attackTimer: number;
  /**
   * Attack phase and timer: the guardian's dash, a lunge (`dash` / `recover`), a cast wind-up, or a
   * burrower underground (`under`: untargetable, `status.ts` `targetable`).
   */
  phase: "chase" | "windup" | "dash" | "recover" | "under";
  phaseTime: number;
  /** Follow-up strikes left in the current attack (a peck's repeats, a guardian's chain). */
  strikes: number;
  dashX: number;
  dashZ: number;
  /** Charging herd enemies keep a fixed heading until they leave the arena. */
  charge: boolean;
  /** Cached result of the close-range walkable-line test toward its target (re-tested every few ticks). */
  sightline: boolean;
}

export interface Projectile {
  id: number;
  owner: PlayerId;
  move: MoveId;
  archetype: Archetype;
  type: ElementType;
  x: number;
  /** Flight height in world units; shots fly straight and die where they meet the terrain. */
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  radius: number;
  dmg: number;
  pierce: number;
  area: number;
  dur: number;
  status?: EnemyStatusId;
  statusChance: number;
  crit: number;
  hit: number[];
  delay: number;
  /** Enemy id a homing shot steers toward (-1: none). */
  target: number;
}

export interface Area {
  id: number;
  owner: PlayerId;
  move: MoveId | null;
  kind: AreaKind;
  type: ElementType;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  radius: number;
  length: number;
  /** Beams: height gained per unit of length (aimed up or down a slope). */
  rise: number;
  /** Half-angle in radians for cone and strike shapes. */
  angle: number;
  life: number;
  maxLife: number;
  /** Seconds before the first damage (telegraphs). */
  delay: number;
  tick: number;
  tickTimer: number;
  dmg: number;
  status?: EnemyStatusId;
  statusChance: number;
  crit: number;
  follow: boolean;
  /** Fusions: sub-parts per cast (leaves, jets, chain targets) and how many have been released. */
  count: number;
  released: number;
  /** Fusions: area growth of the cast (part sizes × this). */
  scale: number;
}

export interface GuardianAction {
  attack: string;
  windup: number;
  active: number;
  recover: number;
  speed: number;
  chain: number;
  gap: number;
}

export interface Hazard {
  id: number;
  kind: HazardKind;
  element?: ElementType;
  slow?: number;
  poison?: number;
  piercesCover?: true;
  /** Live duration after the telegraph, and total duration for progress. */
  active?: number;
  duration?: number;
  /** Scheduled circles are not visible or active until delay reaches zero. */
  delay?: number;
  angle?: number;
  gap?: number;
  target?: PlayerId;
  /** Players already hit by a moving single-hit wall. */
  hit?: PlayerId[];
  pool?: "poison" | "fire";
  poolLife?: number;
  poolRadius?: number;
  x: number;
  /** Flight height (the dash lane lies on the ground). */
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  radius: number;
  dmg: number;
  dirX: number;
  dirZ: number;
  length: number;
  /** Beams and shot lanes: height gained per unit of length (aimed up or down a slope). */
  rise: number;
  /** Enemy whose wind-up this is (-1: none); a caster killed or put to sleep before it lands cancels it. */
  caster: number;
}

export interface Pickup {
  id: number;
  kind: "xp" | "berry" | "chest" | "stardust";
  x: number;
  z: number;
  value: number;
  magnet: boolean;
}

/** Map stations on the guaranteed building pads (sim/stations.ts). */
export type StationKind = "hypno" | "bill";

export interface Station {
  id: number;
  kind: StationKind;
  x: number;
  z: number;
  /** Solid body radius (a nav blocker); the dialog opens a little beyond it. */
  radius: number;
  /** Players who have used Bill's machine this run; carried across fields. */
  used: PlayerId[];
}

export interface StationDialog {
  /** Station commands name the dialog they answer; a stale one is dropped. */
  id: number;
  station: number;
}

/** A captured alpha fighting for `owner` for the rest of the run (partners.ts). Never blocks or is hit. */
export interface Partner {
  id: number;
  owner: PlayerId;
  species: EnemyId;
  x: number;
  z: number;
  px: number;
  pz: number;
  faceX: number;
  faceZ: number;
  /** Seconds until the next attack. */
  cooldown: number;
  /** Seconds until it can guard its owner again (`GUARD`). */
  guard: number;
}

export interface Obstacle {
  kind: "tree" | "pine" | "rock" | "bush" | "palm";
  x: number;
  z: number;
  radius: number;
  scale: number;
  rotation: number;
  solid: boolean;
}
