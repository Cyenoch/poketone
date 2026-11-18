import type { RouteStep } from "../campaign";
import type { StageDef } from "../stages/index";
import { zoneClock, zoneFactorsFor, type ZoneDef } from "./zones";

export type TowerSlope = Pick<ZoneDef, "hp" | "dmg" | "xp" | "guardianHp"> & { clock: number };

export const TOWER = {
  /** 普通层战斗时长（秒）。 */
  floorSeconds: 150,
  guardianInterval: 7,
  /** 额外乘在守卫的生命与伤害上。 */
  guardianBonus: 1.25,
  /** 叠乘在守卫层的守卫生命上，延长战斗但不提高每次命中的伤害。 */
  guardianHealthBonus: 2.56,
  /** 击败守卫后回复的最大生命比例。 */
  guardianHeal: 0.5,
  /** 末段斜率的倍数；经验停在末图倍率，避免沿负斜率出现负经验。 */
  slope: { hp: 4, dmg: 75, guardianHp: 8, xp: 0, clock: 1 },
} as const;

/** 弧度；长局的周期相位在超出此值后才折回，保留远征原有结果。 */
export const PHASE_FOLD = 1 << 19;

export function foldPhase(phase: number): number {
  return Math.abs(phase) > PHASE_FOLD ? phase % (2 * Math.PI) : phase;
}

export function isTowerGuardianFloor(floor: number): boolean {
  return floor % TOWER.guardianInterval === 0;
}

export function towerPosition(floor: number): number {
  return (floor - 1) / TOWER.guardianInterval;
}

/** 守卫攻势等离散档位继续用路线最后一档；强度另外外推。 */
export function towerRouteStep(floor: number): RouteStep {
  return Math.min(3, Math.floor(towerPosition(floor))) as RouteStep;
}

function lowerStep(position: number): RouteStep {
  return Math.min(2, Math.floor(position)) as RouteStep;
}

function blend(a: number, b: number, offset: number, slope: number): number {
  return offset <= 1 ? a + (b - a) * offset : b + (b - a) * (offset - 1) * slope;
}

/** 一层的出生倍率，守卫层的 guardianHp 和 guardianDmg 已含守卫加成。 */
export function towerFactorsFor(
  floor: number,
  stage: Pick<StageDef, "id">,
  slope: TowerSlope = TOWER.slope,
): ZoneDef {
  const position = towerPosition(floor);
  const low = lowerStep(position);
  const from = zoneFactorsFor(low, stage, 0);
  const to = zoneFactorsFor((low + 1) as RouteStep, stage, 0);
  const offset = position - low;
  const guardian = isTowerGuardianFloor(floor);
  const bonus = guardian ? TOWER.guardianBonus : 1;
  return {
    ...to,
    hp: blend(from.hp, to.hp, offset, slope.hp),
    dmg: blend(from.dmg, to.dmg, offset, slope.dmg),
    xp: blend(from.xp, to.xp, offset, slope.xp),
    guardianHp:
      blend(from.guardianHp, to.guardianHp, offset, slope.guardianHp) *
      (guardian ? bonus * TOWER.guardianHealthBonus : 1),
    guardianDmg: to.guardianDmg * bonus,
  };
}

/** 以本层局部秒数计算怪群和同伴的共享成长时钟，沿用入图升温。 */
export function towerClock(floor: number, time: number, slope: number = TOWER.slope.clock): number {
  const position = towerPosition(floor);
  const low = lowerStep(position);
  return blend(
    zoneClock(low, time),
    zoneClock((low + 1) as RouteStep, time),
    position - low,
    slope,
  );
}
