export const trainerKits = {
  chengxi: { assist: "xSpeed", passive: "scout" },
  shuoye: { assist: "superPotion", passive: "tinker" },
  yewei: { assist: "direHit", passive: "naturalist" },
  xiaqing: { assist: "fullHeal", passive: "caretaker" },
} as const;

export type TrainerId = keyof typeof trainerKits;
export type AssistItem = (typeof trainerKits)[TrainerId]["assist"];
export const DEFAULT_TRAINER: TrainerId = "chengxi";
export const assistNames: Record<AssistItem, string> = {
  xSpeed: "速度强化",
  superPotion: "好伤药",
  direHit: "要害攻击",
  fullHeal: "万灵药",
};
export function isTrainerId(value: unknown): value is TrainerId {
  return typeof value === "string" && Object.hasOwn(trainerKits, value);
}
