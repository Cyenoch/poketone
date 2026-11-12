/** Shared P4–P6 gameplay values. The analysis model imports these; dodge/exposure assumptions stay there. */
// 时间为秒，距离/半径/高度为世界单位 u，速度 u/s，角度默认弧度（Degrees 明示度数）。
// landing / beam / shot / burst / fall / cone / sweep / orbit / pool 为接触伤害乘数；
// shield 为承受伤害乘数，slow / song / poison 为状态秒数，其余 count / dashes 等为数量。
export const ZONE_GUARDIAN = {
  landing: 1.2,
  beam: 0.8,
  shot: 0.75,
  burst: 0.8,
  burstPoison: 2,
  shotRadius: 0.3,
  fall: 1,
  cone: 1,
  sweep: 0.8,
  orbit: 0.8,
  pool: 0.4,
  chain: 0.7,
  extremeGap: 0.35,
  extremeDashes: 3,
  shadowSneaks: 2,
  gengarSneaks: 3,
  repeatDashes: 2,
  burstCount: 8,
  sonicBurst: 4,
  magmarBurst: 6,
  fires: 3,
  bone: 8,
  slow: 1.5,
  song: 2,
  shieldTime: 2.5,
  mimeShield: 0.4,
  shellShield: 0.3,
  below: 0.5,
  range: 20,
  /** 普通地面落点的残留秒数（也是命中前剩余寿命阈值）。 */
  fallResidue: 0.3,
  poolLife: 3,
  burstHeight: 0.7,
  burstSpeed: 5,
  burstLife: 2,
} as const;

/**
 * 后期守卫各招式的形状、数量和附属效果；阶段秒数继续由 ZONE_ACTION 维护。
 * 光束 width 为全宽；cage.width / gapHalf 为墙体/开口半宽，outer / inner 为方框半边长（u）。
 * ring / orbit 为中心到落点/环绕物的距离（u）；angularSpeed 为 rad/s。
 * Divisor 表示 π 除数，保留原角度计算顺序；shell.count 和 spacingDivisor 须成套调整。
 */
export const ZONE_ATTACK = {
  shadow: { radius: 2.6, wideRadius: 3 },
  /** [速度 u/s, 预警全宽 u, 长度 u]；乘算顺序留在 dash。 */
  dash: {
    dive: [28, 1.8, 14],
    slide: [16, 2.2, 16],
    "extreme-speed": [20, 1.8, 8],
  },
  shell: { radius: 0.35, orbit: 3.2, count: 4, angularSpeed: 2, spacingDivisor: 2 },
  shellFalls: { count: 6, ring: 3.5, radius: 1.3 },
  shieldBeam: { length: 11, width: 0.7 },
  cage: { count: 1, lowCount: 2, width: 0.4, outer: 4.5, inner: 3, gapHalf: 1.2 },
  psychicFan: { count: 3, spreadDegrees: 25, length: 10, width: 0.6 },
  blink: { destination: [6, 8] },
  ghostFire: { ring: 2, life: 6, radius: 1.2, speed: 2.2, arm: 0.6 },
  /** 角度数组的顺序就是投骨顺序（度）；chain 暂存选中的投骨数。 */
  shadowBones: { count: 1, lowCount: 3, offsets: [0], lowOffsets: [-25, 0, 25] },
  curse: { count: 1, lowCount: 2, hold: 0.6, follow: 1.5, residue: 0.3, radius: 2, delay: 0.5 },
  /** 六个落点占七等分中的前六个，留下逃生开口；poolLife 为落点火池秒数。 */
  flameRing: { count: 6, slots: 7, ring: 4, radius: 1.4, poolLife: 5 },
  nightShade: { count: 5, spread: 0.2, length: 12, radius: 0.3, speed: 5 },
  sludgeBomb: { count: 3, lowCount: 5, ring: 2.8, radius: 1.6, poolLife: 5 },
  sonic: { height: 0.8, length: 8, halfAngleDivisor: 6 },
  foresight: { count: 1, lowCount: 4, radius: 2, windup: 2, gap: 0.5 },
  boneClub: { range: 3, radius: 2.8 },
  shadowBall: { count: 3, spread: 0.28, length: 12, radius: 0.8, speed: 4 },
  dewgongBeam: { length: 12, width: 1.6 },
  icicleFan: { count: 7, spreadDivisor: 12, length: 9, radius: 0.15, speed: 7 },
  laprasBeam: { count: 3, lowCount: 5, spreadDegrees: 25, length: 13, width: 1.6 },
  song: { radius: 5 },
  blizzard: { count: 8, ring: 4, radius: 1.3, spacing: 0.15 },
  flameFan: { count: 3, spreadDivisor: 10, length: 9, width: 1.2 },
  hyperSweep: { height: 0.8, radius: 1.2, length: 20, halfAngleDivisor: 4 },
  hyperBeam: { length: 20, width: 2.4 },
  meteors: { count: 7, ring: 8, radius: 1.6, windup: 1.1, poolLife: 3, spacing: 0.2 },
  lavaDive: { poolLife: 6 },
  slideTrail: { radius: 1.1, life: 8 },
  fireTrail: { radius: 0.6, life: 3 },
  sludgeSlam: { poolRadius: 2.4, poolLife: 5 },
  slideFalls: { count: 5, ring: 3, radius: 1.4 },
  fireBlast: { radius: 3.2 },
  mist: { life: 0.5, radius: 3.6, damage: 0.35, slow: 0.6 },
} as const;

/** [windup, active, recovery]; ordinary windup/recovery scale with difficulty in zone-kit.action. */
const phase = (
  windup: number,
  active: number,
  recover: number,
): readonly [number, number, number] => [windup, active, recover];

export const ZONE_ACTION = {
  shadow: phase(1, 0, 1.2),
  "gengar-shadow-low": phase(1, 0, 1.6),
  "sludge-slam": phase(1, 0.45, 1.2),
  dive: phase(1, 0.5, 1),
  slide: phase(0.9, 1, 1),
  "slide-low": phase(0.9, 1, 1.2),
  "extreme-speed": phase(0.6, 0.4, 1.2),
  "extreme-speed-low": phase(0.6, 0.4, 1.4),
  shell: phase(0, ZONE_GUARDIAN.shieldTime, 1.2),
  "light-shield": phase(0, ZONE_GUARDIAN.shieldTime, 1),
  "shield-beam": phase(0.9, 0.3, 0),
  cage: phase(1.2, 1, 0.8),
  "psychic-fan": phase(1, 0.3, 0.8),
  "psychic-fan-low": phase(1, 0.3, 1.2),
  blink: phase(0.5, 0, 0),
  "shadow-bones": phase(0.8, 0, 0),
  "night-shade": phase(0.6, 0, 0),
  sonic: phase(0.9, 0.25, 0.8),
  "shadow-ball": phase(0.7, 0, 0),
  "dewgong-beam": phase(1, 0.5, 0.9),
  "icicle-fan": phase(0.9, 0, 0.6),
  "lapras-beam": phase(1.1, 0.5, 1),
  "flame-fan": phase(0.9, 0.4, 0.8),
  "hyper-sweep": phase(1.3, 1, 2),
  "hyper-beam": phase(1.3, 0.6, 1.8),
  "bone-club": phase(0.7, 0.25, 0.8),
  song: phase(1.2, 0.25, 1.2),
  "fire-blast": phase(0.8, 0.25, 1.4),
} as const satisfies Record<string, readonly [number, number, number]>;

export const ERUPTION = {
  duration: 10,
  every: 1,
  ring: [3, 6],
  windup: 1.1,
  active: 0.3,
  radius: 1.6,
  dmg: 12,
  pool: 1.4,
  poolLife: 4,
  /** 每名玩家视野内的同时预警数，以及该玩家的喷发落点上限。 */
  warnings: 6,
  fallsPerPlayer: 2,
  /** 计入预警预算的视野外延（u）。 */
  viewMargin: 1,
} as const;
export const TRAIL = {
  pools: 5,
  life: 4,
  radius: 0.9,
  range: 2,
  /** 相邻毒池的最短距离 u；精英/守卫扩大半径 u，守卫毒池寿命秒数。 */
  spacing: 0.15,
  wideRadius: 1.4,
  guardianLife: 5,
  /** 守卫每隔多少模拟 tick 留下毒池；保留原有取模节奏。 */
  guardianTicks: 15,
} as const;
export const SING_SLOW = 1.5;
export const FIRE_PUNCHES = 3;
/** 连拳重瞄前摇秒数。 */
export const FIRE_PUNCH_GAP = 0.3;
