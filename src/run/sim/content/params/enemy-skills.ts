// 敌人技能玩法数值；物种基础属性和平均冷却仍在 content/enemies.ts。
// 时间为秒，距离/半径为世界单位 u，速度 u/s，加速度 u/s²，角度为弧度。
// damage / dmg / splash 为接触伤害乘数；share / elite 为治疗比例；count 为数量。
// 公式、阶段切换、随机抽样与遍历顺序由 skills/ 保持。

/** 每次技能冷却乘算的均匀随机区间；telegraph、landing、spore 共用，抽样仍在执行层。 */
export const ENEMY_SKILL_RELOAD = [0.85, 1.15] as const;

/** 命中几何（u）：地面危险物可跨越的高度、地面攻击视线起点；mouth 为身高乘数。 */
export const ENEMY_HAZARD = { level: 1.2, groundSight: 0.5, mouth: 0.7 } as const;

/** 瞬移：触发距离与落点距目标范围（u），消失/前摇/命中阶段（秒），光束半宽与长度（u）。 */
export const TELEPORT = {
  range: 4.5,
  destination: [7, 9],
  vanish: 0.4,
  windup: 0.8,
  active: 0.15,
  /** 总阶段秒数保留原字面量，避免改成浮点加法后改变边界 tick。 */
  duration: 0.95,
  width: 0.3,
  length: 11,
} as const;

/**
 * Wind-up and range; the glob's flight time to the target's spot at the spit, radius and gravity; the
 * pool's radius and life, splash share of contact damage on landing, poison seconds while standing in it.
 */
export const ACID = {
  windup: 0.35,
  range: 9,
  flight: 1.1,
  radius: 0.3,
  gravity: 14,
  pool: 1.2,
  poolLife: 3,
  splash: 0.5,
  poison: 1,
} as const;

/**
 * Wind-up and range; the egg's flight time, radius and gravity; the blast's radius, share of contact
 * damage and the seconds its ring stays as residue; a barrage throws `spots` eggs, the side ones
 * `side` units off the line to the target.
 */
export const EGG = {
  windup: 0.45,
  range: 9,
  flight: 1.2,
  radius: 0.32,
  gravity: 14,
  blast: 1.4,
  damage: 0.9,
  residue: 0.3,
  side: 1.8,
} as const;

/** Ring radius per unit of body radius (Koffing 1.6, Weezing 2.4), share of contact damage per hit, poison seconds. */
export const AURA = { reach: 3.2, dmg: 0.35, poison: 1, range: 2 } as const;

/** Wind-up and range; the bone's reach out, speed, radius and share of contact damage per hit. */
export const BONEMERANG = {
  windup: 0.7,
  range: 7,
  length: 6,
  speed: 8,
  radius: 0.3,
  damage: 0.8,
  /** 离地高度/接回距离（u）和最长飞行秒数；守卫投骨共用。 */
  height: 0.7,
  catch: 0.6,
  maxFlight: 4,
} as const;

/** Wind-up and range; then `duration` seconds of direct hits × `damage` (combat.ts; never DoT). */
export const HARDEN = { windup: 0.6, range: 7, duration: 3, damage: 0.55 } as const;

/** Ring radius; share of max HP it restores (elites take `elite` of that); guardians are never mended. */
export const HEAL_PULSE = { radius: 4, share: 0.15, elite: 0.5 } as const;

/**
 * Trigger range; seconds the circle shows before the body arrives (underground for burrowers), the
 * jump's flight time (0: it breaks out of the ground instead), the circle's radius (× elite body),
 * seconds it stands after the hit, share of contact damage.
 */
export const LANDING = {
  melt: { range: 9, windup: 0.9, travel: 0, radius: 1.6, recover: 1.2, damage: 1 },
  "body-slam": { range: 8, windup: 0.7, travel: 0.45, radius: 2.6, recover: 1.1, damage: 1.2 },
  "triple-burrow": {
    range: 9,
    windup: 0.9,
    travel: 0,
    radius: 1.4,
    recover: 1.2,
    damage: 0.8,
    count: 3,
    /** 两侧落点离中心线的距离（u）。 */
    side: 2.5,
  },
  burrow: { range: 9, windup: 0.9, travel: 0, radius: 1.6, recover: 1.2, damage: 1 },
  "shadow-sneak": { range: 9, windup: 0.9, travel: 0, radius: 1.6, recover: 1.2, damage: 1 },
  leap: { range: 7, windup: 0.7, travel: 0.45, radius: 1.6, recover: 0.8, damage: 1 },
  "leap-heavy": { range: 8, windup: 0.5, travel: 0.45, radius: 2.2, recover: 0.9, damage: 1.1 },
  // Desert: Hitmonlee's longer jump kick, Onix's wider burrow.
  "high-jump-kick": { range: 11, windup: 0.7, travel: 0.55, radius: 1.6, recover: 1, damage: 1.1 },
  dig: { range: 10, windup: 0.9, travel: 0, radius: 2.4, recover: 1.3, damage: 1.1 },
} as const;

/** Trigger range, wind-up, dash speed and time, recovery (seconds). */
export const LUNGE = {
  "belly-slide": { range: 9, windup: 0.8, speed: 10, time: 0.8, recover: 0.9 },
  "fire-punch": { range: 5, windup: 0.6, speed: 10, time: 0.22, recover: 0.8 },
  dive: { range: 5, windup: 0.6, speed: 10, time: 0.4, recover: 0.7 },
  roll: { range: 8, windup: 1, speed: 7, time: 1.1, recover: 1 },
  "flame-charge": { range: 6, windup: 0.8, speed: 9, time: 0.55, recover: 0.9 },
  "horn-attack": { range: 6, windup: 0.7, speed: 10, time: 0.5, recover: 0.8 },
  // Desert (docs/state-machines/simulation.md).
  "double-peck": { range: 5, windup: 0.55, speed: 10, time: 0.25, recover: 0.6 },
  "triple-peck": { range: 5.5, windup: 0.55, speed: 10.5, time: 0.25, recover: 0.7 },
  "take-down": { range: 7, windup: 0.8, speed: 11, time: 0.6, recover: 1.1 },
  "horn-rush": { range: 9, windup: 0.9, speed: 11, time: 0.8, recover: 1.1 },
  "razor-dash": { range: 7, windup: 0.5, speed: 14, time: 0.4, recover: 0.8 },
  "flame-trail": { range: 7, windup: 0.8, speed: 10, time: 0.6, recover: 0.9 },
  // Coast (docs/state-machines/simulation.md): Kabuto's short dash, Seaking's horn out of the water.
  "aqua-jet": { range: 4.5, windup: 0.5, speed: 11, time: 0.3, recover: 0.7 },
  megahorn: { range: 7, windup: 0.8, speed: 11, time: 0.55, recover: 1 },
} as const;

/** Follow-up pecks: strikes in all, and the re-aimed wind-up before each one after the first. */
export const PECK = {
  "double-peck": { count: 2, gap: 0.3 },
  "triple-peck": { count: 3, gap: 0.3 },
} as const;

/**
 * Rapidash's trail: the ground its charge crossed burns for `life` seconds, `width` either side,
 * hurting a player on it for `damage` × contact every `HURT_TICKS` ticks (no burn status).
 */
export const FLAME_TRAIL = { life: 3, width: 0.6, damage: 0.4 } as const;

/** Wind-up and range; reach, half-width, seconds it stays live after the charge, share of contact damage. */
export const PSYBEAM = {
  windup: 0.9,
  range: 10,
  length: 11,
  width: 0.3,
  active: 0.15,
  dmg: 1,
} as const;

/** The vine lash: the psybeam's numbers for Tangela; a hit also applies `slow`. */
export const VINE = {
  windup: 0.9,
  range: 9,
  length: 9,
  width: 0.35,
  active: 0.15,
  dmg: 0.8,
} as const;

/** Golduck's psybeam: wider, quicker and longer; the same beam hazard. */
export const PSYBEAM_HEAVY = {
  windup: 0.7,
  range: 11,
  length: 12,
  width: 0.45,
  active: 0.15,
  dmg: 1.1,
} as const;

/** Wind-up and range; a single hit at the end of the charge, the short active window is visual residue. */
export const RADIAL = {
  sing: { windup: 1, range: 3.5, radius: 3, active: 0.25, damage: 0.5 },
  "sing-wide": { windup: 1.1, range: 4.7, radius: 4.2, active: 0.25, damage: 0.5 },
  "dragon-pulse": { windup: 0.9, range: 2.6, radius: 2, active: 0.25, damage: 1 },
  discharge: { windup: 1, range: 3.2, radius: 2.8, active: 0.25, damage: 0.9 },
  "self-destruct": { windup: 1.5, range: 3.5, radius: 3.8, active: 0.3, damage: 1.6 },
  // Coast: Magneton's wider ring, Electabuzz's quicker one, Dragonair's dragon-type ring.
  "discharge-wide": { windup: 1.1, range: 4.2, radius: 3.8, active: 0.25, damage: 0.9 },
  "discharge-quick": { windup: 0.65, range: 3, radius: 2.6, active: 0.25, damage: 0.9 },
  "dragon-rage": { windup: 0.9, range: 4, radius: 3.4, active: 0.25, damage: 1 },
} as const;

/**
 * Wind-up (the fall) and range; `spots` circles of `radius` (× elite body), the first on the target,
 * the rest `ring` units around it; share of contact damage; seconds the spent circle stays as residue.
 */
export const ROCKFALL = {
  windup: 1,
  range: 9,
  radius: 1.3,
  spots: 3,
  ring: 2.2,
  damage: 1,
  residue: 0.3,
} as const;

/**
 * Wind-up and range; the shot's speed, radius, life and share of contact damage; poison seconds on hit;
 * a fan fires `count` lanes `spread` radians apart.
 */
export const ENEMY_SHOTS = {
  icicle: {
    windup: 0.7,
    range: 8,
    speed: 7,
    radius: 0.15,
    life: 1.5,
    damage: 0.55,
    count: 3,
    spread: 0.3,
    slow: 1.5,
  },
  flamethrower: {
    windup: 0.8,
    range: 9,
    speed: 5.5,
    radius: 0.23,
    life: 1.8,
    damage: 0.65,
    count: 5,
    spread: 0.22,
  },
  "poison-sting": {
    windup: 0.65,
    range: 8,
    speed: 6,
    radius: 0.14,
    life: 1.6,
    damage: 0.65,
    poison: 2,
  },
  ember: { windup: 0.7, range: 8, speed: 5, radius: 0.23, life: 1.8, damage: 0.9 },
  "thunder-shock": { windup: 0.6, range: 7, speed: 7, radius: 0.18, life: 1.3, damage: 0.8 },
  "poison-fan": {
    windup: 0.7,
    range: 8,
    speed: 6,
    radius: 0.14,
    life: 1.6,
    damage: 0.55,
    poison: 2,
    count: 3,
    spread: 0.35,
  },
  // Desert: Meowth's coin and Omastar's five-spike fan.
  "pay-day": { windup: 0.6, range: 8, speed: 6.5, radius: 0.18, life: 1.4, damage: 0.7 },
  "spike-cannon": {
    windup: 0.75,
    range: 8,
    speed: 6,
    radius: 0.15,
    life: 1.6,
    damage: 0.5,
    count: 5,
    spread: 0.28,
  },
  // Coast: Seadra's water gun from the sea, Jolteon's three-pin fan.
  "water-gun": { windup: 0.7, range: 9, speed: 6.5, radius: 0.22, life: 1.6, damage: 0.85 },
  "pin-missile": {
    windup: 0.55,
    range: 8,
    speed: 7.5,
    radius: 0.13,
    life: 1.2,
    damage: 0.5,
    count: 3,
    spread: 0.3,
  },
} as const;

/**
 * Range, shot body radius and speed (slower than every starter, so spores can be outpaced as well as
 * sidestepped), share of contact damage, poison seconds on hit; elites fire `elite` shots `spread` apart.
 */
export const SPORE = {
  range: 8,
  radius: 0.18,
  speed: 2.8,
  life: 3.6,
  dmg: 0.9,
  poison: 2,
  elite: 3,
  spread: 0.3,
} as const;

/** Bubbles: spores without the poison; a burst fires `burst` volleys `gap` seconds apart. */
export const BUBBLE = {
  range: 7,
  radius: 0.2,
  speed: 2.6,
  life: 3.4,
  dmg: 0.8,
  elite: 3,
  spread: 0.3,
  burst: 3,
  gap: 0.3,
} as const;

/** Wind-up and range; the cloud's radius and active seconds after it arms (inside, `slow` stays full). */
export const STUN_SPORE = { windup: 0.8, range: 2.8, radius: 2.4, active: 2.4 } as const;
