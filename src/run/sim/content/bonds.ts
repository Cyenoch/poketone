import type { Difficulty } from "./difficulties";
import { atLevel, type Modifier, type ModifierDef } from "./effects";
import type { StarterId } from "./lines/index";
import {
  BOND_DIFFICULTY_MULTIPLIERS,
  BOND_LAB_ARMOR,
  BOND_LAB_DAMAGE,
  BOND_LAB_HP,
  BOND_LAB_REGEN,
  BOND_LAB_SPEED,
  BOND_THRESHOLDS,
  BOND_WIN_POINTS,
} from "./params/bonds";

export const bondMilestones = [
  { points: BOND_THRESHOLDS[0], title: "初识", reward: null },
  { points: BOND_THRESHOLDS[1], title: "熟悉", reward: "挺住" },
  { points: BOND_THRESHOLDS[2], title: "信赖", reward: "羁绊研究" },
  { points: BOND_THRESHOLDS[3], title: "挚友", reward: "自己治好" },
  { points: BOND_THRESHOLDS[4], title: "最好的伙伴", reward: "异色外观" },
] as const;

export const MAX_BOND_LEVEL = bondMilestones.length;

export function bondLevel(points: number): number {
  return bondMilestones.findLastIndex((milestone) => points >= milestone.points) + 1;
}

export function earnedBondPoints(zones: number, victory: boolean, difficulty: Difficulty): number {
  return Math.floor(
    (zones + (victory ? BOND_WIN_POINTS : 0)) * BOND_DIFFICULTY_MULTIPLIERS[difficulty],
  );
}

export type BondLabId = `bond-${StarterId}`;
export const bondLabId = (starter: StarterId): BondLabId => `bond-${starter}`;

export const bondResearch = {
  charmander: {
    label: "火属性伤害",
    stat: "damage",
    op: "add",
    when: "fire",
    value: BOND_LAB_DAMAGE,
  },
  bulbasaur: { label: "再生", stat: "regen", op: "add", value: BOND_LAB_REGEN },
  squirtle: { label: "护甲", stat: "armor", op: "add", value: BOND_LAB_ARMOR },
  pikachu: { label: "移速", stat: "speed", op: "pct", value: BOND_LAB_SPEED },
  gastly: {
    label: "幽灵属性伤害",
    stat: "damage",
    op: "add",
    when: "ghost",
    value: BOND_LAB_DAMAGE,
  },
  dratini: { label: "HP", stat: "maxHp", op: "add", value: BOND_LAB_HP },
  machop: {
    label: "格斗属性伤害",
    stat: "damage",
    op: "add",
    when: "fighting",
    value: BOND_LAB_DAMAGE,
  },
  abra: {
    label: "超能力属性伤害",
    stat: "damage",
    op: "add",
    when: "psychic",
    value: BOND_LAB_DAMAGE,
  },
  geodude: { label: "护甲", stat: "armor", op: "add", value: BOND_LAB_ARMOR },
} as const satisfies Record<StarterId, ModifierDef<number> & { label: string }>;

export function bondLabModifier(starter: StarterId, level: number): Modifier {
  const { label: _label, value, ...grants } = bondResearch[starter];
  return { ...grants, value: atLevel(grants.op, value, level), source: { kind: "lab" } };
}
