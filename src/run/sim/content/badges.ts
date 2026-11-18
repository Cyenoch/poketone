import type { Difficulty } from "./difficulties";

export const badges = {
  boulder: { name: "灰色徽章", score: 2 },
  cascade: { name: "蓝色徽章", score: 4 },
  thunder: { name: "橙色徽章", score: 6 },
  rainbow: { name: "彩虹徽章", score: 8 },
  soul: { name: "粉红徽章", score: 10 },
  marsh: { name: "金色徽章", score: 12 },
  volcano: { name: "深红徽章", score: 14 },
  earth: { name: "绿色徽章", score: 16 },
} as const;

export type BadgeId = keyof typeof badges;
export const badgeIds = Object.keys(badges) as BadgeId[];

export function badgeScore(difficulty: Difficulty, danger: number): number {
  return difficulty * 3 + danger;
}
