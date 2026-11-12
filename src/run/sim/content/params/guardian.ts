// Guardian attacks: dash, rhythm and hazards. Base HP and damage are in
// content/enemies.ts; HP growth in params/pacing.ts GUARDIAN_HP_CURVE; per-tier tell and blade count
// in content/difficulties.ts.
// 时间为秒，距离/高度/半径为世界单位 u，速度 u/s，spread / turn 为弧度。
// damage 为接触伤害乘数，below 为当前生命/最大生命的阶段阈值；不改变基础生命。
import type { StageId } from "../stages/index";

/** Guardian dash: speed (u/s) and duration; the telegraph line shows exactly this reach. */
export const BOSS_DASH_SPEED = 14;
export const BOSS_DASH_TIME = 0.6;
/** Guardian rhythm: chase at least this long, then wind up and recover (× the tier's `bossTelegraph`). */
export const BOSS_CHASE_MIN = 3;
export const BOSS_CHASE_JITTER = 1.2;
export const BOSS_WINDUP = 0.8;
export const BOSS_RECOVER = 0.7;
/** Each Air Slash blade hits for this × the guardian's contact damage. */
export const AIR_SLASH_DMG = 1.1;
/** Air Slash blades (count: the tier's `airSlashBlades`): this wide, flying this fast for `life` seconds. */
export const AIR_SLASH = { radius: 0.28, speed: 5, life: 2.6, height: 0.8 } as const;
/** It only dashes at a target closer than this (u). */
export const BOSS_DASH_RANGE = 18;
/** Below this share of max HP, each dash is followed by Air Slash. */
export const BOSS_SLASH_BELOW = 0.5;

/**
 * Aerodactyl (seconds × the tier's `bossTelegraph`), the flying guardian: it crosses mesas and ridges.
 * Dive: within `range`, a band from itself through the target, `length` long and its body wide, for
 * `windup`; it sweeps the band in `time`, then lands for `recover` (the main window to hit it). Rock
 * Slide: within `range`, `rocks` circles of `rockRadius` on and around the target (`rockRing` out) that
 * fall after `rockWindup` for `rockDamage` × contact while it keeps flying. Dives and slides
 * alternate; below `below` of its HP it dives twice (the second re-aimed after `chainWindup`) and
 * drops a slide behind the second dive.
 */
export const AERODACTYL = {
  range: 14,
  windup: 1,
  length: 14,
  time: 0.5,
  recover: 1,
  rocks: 5,
  rockRadius: 1.4,
  rockRing: 2.6,
  rockWindup: 1.1,
  rockDamage: 1,
  below: 0.5,
  chainWindup: 0.7,
  /** 低生命阶段在首轮俯冲后追加的次数。 */
  followupDives: 1,
} as const;

/**
 * Gyarados (seconds × the tier's `bossTelegraph`), the amphibious guardian: it swims the bay and walks
 * the beach. Hydro Pump: within `range`, a band toward the target for `windup`, live `HYDRO_PUMP.active`,
 * then `recover`. Twister: `twisters` whirlpools rise `twisterSide` either side of it and glide after
 * the target (`TWISTER`) while it keeps chasing; a new pair waits until the last is gone. Pumps and
 * twisters alternate; below `below` of its HP every attack is `chain` pumps, each re-aimed after
 * `chainWindup`, then `chainRecover`.
 */
export const GYARADOS = {
  range: 13,
  windup: 1.1,
  recover: 1,
  twisters: 2,
  twisterSide: 2.6,
  below: 0.5,
  chain: 3,
  chainWindup: 0.5,
  chainRecover: 1.4,
} as const;

/**
 * Kingler (seconds × the tier's `bossTelegraph`). Crabhammer: within `hammerRange`, a circle of
 * `hammerRadius` centred `hammerOffset` ahead for `hammerWindup`, one hit for `hammerDamage`, then
 * `hammerRecover`. Bubble Beam: between `bubbleMin` and `bubbleMax`, it tells for `bubbleWindup` while
 * it keeps walking, then fans `bubbles` slow bubbles `bubbleSpread` apart (Poliwag's bubble rule).
 * Below `below` of its HP, within `sideRange`: a lane through the target `sideLength` long for
 * `sideWindup`, a sideways rush along it in `sideTime`, `sideDashes` in all (each re-aimed), then the
 * Crabhammer.
 */
export const KINGLER = {
  hammerRange: 3.4,
  hammerWindup: 0.9,
  hammerOffset: 2,
  hammerRadius: 2.4,
  hammerDamage: 1.3,
  hammerRecover: 1,
  bubbleMin: 3,
  bubbleMax: 9,
  bubbleWindup: 0.6,
  bubbles: 7,
  bubbleSpread: 0.22,
  bubbleDamage: 0.8,
  /** 相对普通泡泡的半径乘数。 */
  bubbleRadius: 1.5,
  below: 0.5,
  sideRange: 8,
  sideWindup: 0.8,
  sideLength: 10,
  sideTime: 0.55,
  sideDashes: 2,
} as const;

/**
 * Marowak (seconds × the tier's `bossTelegraph`). Bonemerang: within `range`, a lane `length` long for
 * `windup`, then a bone out and back (`damage` × contact each way); below `below` of its HP two bones
 * `spread` radians either side. Bone club: within `clubRange`, its own circle of `clubRadius` for
 * `clubWindup`, one hit for `clubDamage`, then `clubRecover`; below half the club is followed by
 * `ringBones` short bones (`ringLength` out) all around, and it stands until they are back plus
 * `ringRecover`.
 */
export const MAROWAK = {
  range: 9,
  windup: 0.8,
  length: 7,
  damage: 1,
  spread: 0.44,
  clubRange: 3,
  clubWindup: 0.7,
  clubRadius: 2.8,
  clubDamage: 1.2,
  clubRecover: 0.9,
  below: 0.5,
  ringBones: 6,
  ringLength: 4,
  ringRecover: 0.6,
} as const;

/**
 * Nidoking (seconds × the tier's `bossTelegraph`): within `range` it splits the ground along `lines`
 * fissures fanned toward the target (`windup`, then `recover`); every second attack is Toxic Spikes
 * instead, `spikes` acid globs on and around the target (`spikeRing` out) while it keeps walking.
 * Below `below` of its HP the fissure has `linesBelow` lines and a stomp follows it: its own circle
 * for `stompWindup`, then the same `recover`.
 */
export const NIDOKING = {
  range: 11,
  windup: 1,
  recover: 0.8,
  lines: 3,
  linesBelow: 5,
  spikes: 4,
  spikeRing: 2.2,
  below: 0.5,
  stompWindup: 0.7,
} as const;

/**
 * Pinsir's slam (seconds × the tier's `bossTelegraph`): it locks the target's spot within `range`,
 * shows a circle of `radius` for `windup`, jumps for `travel`, hits the circle once for `damage` ×
 * contact, then stands for `recover` (the main window to hit it). Below `below` of its HP it slams
 * `chain` times in a row, re-locking each time with the shorter `chainWindup`, throws `SHARD.count`
 * rock shards from every landing, and stands `chainRecover` after the last.
 */
export const PINSIR = {
  range: 12,
  windup: 0.9,
  travel: 0.5,
  radius: 3,
  damage: 1.2,
  recover: 1,
  below: 0.5,
  chain: 3,
  chainWindup: 0.6,
  chainRecover: 1.4,
} as const;

/**
 * Sandslash (seconds × the tier's `bossTelegraph`). Dig: underground for `digWindup` while a circle of
 * `radius` shows on the target's spot within `range`, then it breaks out there for `damage` × contact
 * and stands `digRecover`. Roll: a lane `rollLength` long toward the target within `rollRange`, shown
 * for `rollWindup`, rolled in `rollTime`, then `rollRecover`. Below `below` of its HP each break-out
 * also throws `spikes` rock shards and leaves a quicksand pit (`QUICKSAND_PIT`).
 */
export const SANDSLASH = {
  range: 12,
  digWindup: 1,
  radius: 2.6,
  damage: 1.2,
  digRecover: 1.2,
  rollRange: 10,
  rollWindup: 1,
  rollLength: 12,
  rollTime: 1.3,
  rollRecover: 1,
  below: 0.5,
  spikes: 6,
} as const;

/**
 * Starmie (seconds × the tier's `bossTelegraph`). Rapid Spin: within `range`, a zigzag of `segments`
 * lanes `segment` long (the first toward the target, each next one turned `turn` radians, alternating
 * sides) shown for `spinWindup`, spun along at `spinSpeed`, then dizzy for `spinRecover`. Thunderbolt:
 * `bolts` circles of `boltRadius` dropped on the target's spot `boltGap` apart while it keeps moving,
 * each striking `boltWindup` after it appears for `boltDamage` × contact. Spins and bolts alternate;
 * below `below` of its HP, `lowSegments` lanes and `lowBolts` bolts.
 */
export const STARMIE = {
  range: 9,
  segment: 7,
  turn: 2.2,
  segments: 3,
  lowSegments: 4,
  spinWindup: 1,
  spinSpeed: 14,
  spinRecover: 1.2,
  bolts: 4,
  lowBolts: 6,
  boltGap: 0.4,
  boltWindup: 0.9,
  boltRadius: 1.5,
  boltDamage: 1,
  below: 0.5,
} as const;

/** Rock shards thrown from each slam of Pinsir's chain: radius, speed, life, share of contact damage. */
export const SHARD = {
  count: 4,
  radius: 0.3,
  speed: 5,
  life: 2.2,
  damage: 0.9,
  height: 0.6,
} as const;

/**
 * Nidoking's fissure: a ground line `length` long and `width` × 2 wide that hurts for `active` seconds
 * after its wind-up; `spread` radians between lines.
 */
export const FISSURE = {
  length: 10,
  width: 0.6,
  active: 0.3,
  spread: 0.35,
  damage: 1.1,
  height: 0.4,
} as const;

/** Nidoking's stomp: its own circle, one hit at the end of the wind-up; `active` is the residue. */
export const STOMP = { radius: 3.5, active: 0.25, damage: 1.2 } as const;

/**
 * Sandslash's pit: quicksand for `life` seconds. A static patch slows through the mover; the pit has
 * no surface of its own, so it holds players in `slow` (refreshed each tick, `linger` after they
 * leave) and pulls at the static patch's net rate.
 */
export const QUICKSAND_PIT = { life: 6, radius: 2.4, linger: 0.2 } as const;

/**
 * Gyarados's Hydro Pump: a band `width` × 2 wide and up to `length` long that stays live `active`
 * seconds after its wind-up, hitting for `damage` × contact (player i-frames space the hits).
 */
export const HYDRO_PUMP = { length: 14, width: 1, active: 0.6, damage: 0.6, height: 0.8 } as const;

/**
 * Gyarados's Twister: a whirlpool of `radius` gliding at `speed` toward the nearest player for `life`
 * seconds; harmless for its first `arm` seconds, it breaks on the first player it touches
 * (`damage` × contact), leaving `ROCKFALL.residue` seconds of spray.
 */
export const TWISTER = { radius: 1.6, speed: 2.2, life: 6, arm: 0.6, damage: 1 } as const;

/** The ground-circle patterns a raised guardian casts between its own attacks (`bosses/fury.ts`). */
export type FuryCast = "rain" | "barrage" | "pincer";

/**
 * Route guardians: forest keeps the base rhythm; desert/coast use the middle tier and
 * glacier/volcano/tower the final tier. `chaseRate` advances only the chase clock.
 * Every `every` seconds (first after `first`, × `lowEvery` below ZONE_GUARDIAN.below)
 * it also casts the next of `casts` in turn, whenever it is chasing
 * or recovering and not paralysed; a cast that falls due mid-attack waits for the next such moment.
 * Each pattern is ground circles on the shared falling-circle rule (`boss-fall`): a red circle for
 * the windup × the tier's tell, one hit of the guardian's `dmg` when it lands. Its element is the
 * guardian's first type.
 */
export const GUARDIAN_FURY = [
  null,
  { chaseRate: 1.4, first: 5, every: 8, lowEvery: 0.75, casts: ["rain", "barrage"] },
  { chaseRate: 2, first: 4, every: 3, lowEvery: 0.75, casts: ["rain", "barrage", "pincer"] },
] as const satisfies readonly (GuardianFury | null)[];

/** The fixed map's guardian tier; internal field index does not add another multiplier. */
export function furyOf(stage: StageId, _zone: number): GuardianFury | null {
  return stage === "forest" ? null : GUARDIAN_FURY[stage === "desert" || stage === "coast" ? 1 : 2];
}

export interface GuardianFury {
  chaseRate: number;
  first: number;
  every: number;
  lowEvery: number;
  casts: readonly FuryCast[];
}

/**
 * Rain: the target's spot and a ring of circles `ring` around it (`count`, `lowCount` in the low
 * phase). Barrage: a line of circles `gap` apart through the target along the guardian's heading,
 * appearing one after another `spacing` apart, so the player steps out sideways. Pincer: the target's
 * spot, then `follow` seconds later a circle `side` to each side of it for the dodge. `radius` and
 * `windup` (seconds × tell) are per circle.
 */
export const FURY_CAST = {
  rain: { count: 5, lowCount: 7, ring: 3.6, radius: 1.4, windup: 1.2 },
  barrage: { count: 5, lowCount: 7, gap: 2.2, radius: 1.3, windup: 1, spacing: 0.2 },
  pincer: { radius: 1.5, side: 3.2, windup: 1.1, follow: 0.7 },
} as const;
