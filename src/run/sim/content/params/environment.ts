/** 玩家站在熔岩/燃烧地表时，每次伤害的 HP；护甲、护盾、冲刺和无敌仍由 hurt.ts 结算。 */
export const LAVA_DMG = 8;
export const EMBERS = { dmg: 4 } as const;

/** 地表及共用此节拍的技能危险物每隔多少 tick 伤害一次（30 Hz 下为 0.5 秒）。 */
export const HURT_TICKS = 15;

/** 非火属性地面敌人的熔岩灼烧：每秒 HP 与刷新后的持续秒数；保留更强的已有灼烧。 */
export const LAVA_BURN = { power: 8, time: 1 } as const;

/** 流沙吸力在距中心此距离内线性降至零（u），玩家与普通敌人共用。 */
export const QUICKSAND_EASE_DISTANCE = 0.5;

/** 仅玩家的冰面动量：步行速度倍率，及按 30 Hz 归一的指数响应系数。 */
export const ICE_MOMENTUM = {
  speed: 1.15,
  // 保留原十进制值，不能重新求对数或合并乘数而改变浮点运算。
  response: 0.16251892949777494,
} as const;

/** 换区/换层落位时，同伴距主人身后身体边缘的距离（u），不影响日常跟随距离。 */
export const PARTNER_BEHIND = 1.5;

/** Ground speed on quicksand, and its pull toward the centre in u/s before that speed applies. */
export const QUICKSAND = { speed: 0.5, pull: 2.4 } as const;

/** Static ice shores, shared with the ground decal. radius is the enclosing extent, not a circle. */
export const ICE_SHORE = { base: 0.74, bay: 0.15, inlet: 0.07, skew: 0.04 } as const;

/** Maximum water depth ground units can wade through; only nav/walkable decides walkability. */
export const WADE_DEPTH = 0.6;

/** Minimum water depth swimmers move in: they reach the wading fringe but never the dry beach. */
export const SWIM_DEPTH = 0.3;
