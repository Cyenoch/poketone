/** 有可行直线时，敌人改为直接追击玩家当前位置的距离（u）。 */
export const PURSUIT_RANGE = 6;

/** 奔袭者单 tick 沿前进方向的实际位移不足期望步长此比例时，结束奔袭并恢复追击。 */
export const STAMPEDE_MIN_PROGRESS = 0.5;

/** Zubat's heading swings up to this many radians either side of the target, at this rate (rad/s). */
export const WEAVE = { amplitude: 0.9, rate: 2.2, phasePerId: 1.3 } as const;

/** Krabby's sidelong approach: its heading is turned this many radians off the target, to one side per crab. */
export const STRAFE = { angle: 0.75 } as const;
