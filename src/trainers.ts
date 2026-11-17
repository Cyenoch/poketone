import type { Progress } from "./run/progress";

/** Cosmetic identity only; combat state and random outcomes do not depend on the trainer. */
export const trainers = {
  chengxi: {
    name: "澄汐",
    role: "海岸领航员",
    color: "#2c9f9a",
    light: "#9de7df",
    lines: ["先看风，再出发。", "别急，路还长着呢。", "跟紧我，一起走！"],
    ultimate: "就是现在，全力以赴！",
    clear: "前面的路，已经打开了！",
    evolve: "看见了吗？你又变强了！",
    revive: "回来就好，我们一起走。",
  },
  shuoye: {
    name: "朔野",
    role: "野外维修师",
    color: "#dca441",
    light: "#ffe4a2",
    lines: ["稳住，按我们的节奏来。", "配合得不错，继续。", "放心，我在。"],
    ultimate: "准备好了？一口气突破！",
    clear: "道路畅通，继续前进。",
    evolve: "不错，越来越可靠了。",
    revive: "站稳了，我们还没结束。",
  },
  yewei: {
    name: "夜苇",
    role: "夜行生态记录员",
    color: "#614664",
    light: "#d6c1e3",
    lines: ["听，风向变了。", "不着急，我跟得上。", "你的节奏，我听见了。"],
    ultimate: "听我的信号——现在！",
    clear: "安静下来了，向前走吧。",
    evolve: "嗯，你的声音更有力量了。",
    revive: "听见你了，欢迎回来。",
  },
  xiaqing: {
    name: "夏晴",
    role: "海岸饲育员",
    color: "#c66f79",
    light: "#ffe0d6",
    lines: ["别紧张，我陪着你。", "累了就靠近我一点。", "今天也一起加油吧！"],
    ultimate: "放手去做，我相信你！",
    clear: "做得真好，继续走吧！",
    evolve: "又长大了一点呢！",
    revive: "没事了，我在这里。",
  },
} as const;

export type TrainerId = keyof typeof trainers;
export const trainerOrder = Object.keys(trainers) as TrainerId[];
export const DEFAULT_TRAINER: TrainerId = "chengxi";
export const XIAQING_UNLOCK_KILLS = 5000;

export function trainerUnlocked(progress: Pick<Progress, "kills">, id: TrainerId): boolean {
  return id !== "xiaqing" || progress.kills >= XIAQING_UNLOCK_KILLS;
}

export function isTrainerId(value: unknown): value is TrainerId {
  return typeof value === "string" && Object.hasOwn(trainers, value);
}

export type TrainerExpression = "portrait" | "cutin" | "lobby" | "portrait-locked" | "lobby-locked";
export const trainerArt = (id: TrainerId, expression: TrainerExpression = "portrait") =>
  `/art/trainers/${id}/${expression}.webp`;
