import {
  assistNames,
  trainerKits,
  type AssistItem,
  type TrainerId,
} from "./run/sim/content/trainers";
import { TRAINER } from "./run/sim/content/params/trainers";
import type { Progress } from "./run/progress";
import { MAX_BOND_LEVEL } from "./run/sim/content/bonds";

/** Presentation for the identities in sim/content/trainers. */
export const trainers = {
  chengxi: {
    name: "澄汐",
    role: "海岸领航员",
    color: "#2c9f9a",
    light: "#9de7df",
    lines: {
      low: ["先看风，再出发。", "别急，路还长着呢。", "跟紧我，一起走！"],
      mid: [
        "风往你那边吹，你来带路吧。",
        "这段路，我们走过好几回了。",
        "有你在，我不用一直回头了。",
      ],
      high: ["这次换你带我走一段。", "新地图上，这条路写我们俩。", "潮水再大，我也跟你一起。"],
    },
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
    lines: {
      low: ["稳住，按我们的节奏来。", "配合得不错，继续。", "放心，我在。"],
      mid: ["你的节奏，我记熟了。", "累了说一声，水我带着。", "比上次稳多了。"],
      high: ["交给你，我不担心。", "你接得住，我知道。", "这条路能通，是因为有你。"],
    },
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
    lines: {
      low: ["听，风向变了。", "不着急，我跟得上。", "你的节奏，我听见了。"],
      mid: ["你的脚步声，我一下就认得出。", "不用回头，我在听。", "你想往哪走，我猜到了。"],
      high: ["不用信号了，我们已经合拍。", "你的声音，我会一直记着。", "这次不等证据了，我信你。"],
    },
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
    lines: {
      low: ["别紧张，我陪着你。", "累了就靠近我一点。", "今天也一起加油吧！"],
      mid: ["今天也很有精神呢！", "受伤了要告诉我哦。", "我们越来越默契了呢。"],
      high: ["有你在身边，真好。", "走多远，我都陪着你。", "最喜欢和你一起冒险了！"],
    },
    ultimate: "放手去做，我相信你！",
    clear: "做得真好，继续走吧！",
    evolve: "又长大了一点呢！",
    revive: "没事了，我在这里。",
  },
} as const;

export type { TrainerId } from "./run/sim/content/trainers";
export type TrainerTier = keyof (typeof trainers)[TrainerId]["lines"];
/** The in-run lines follow the current partner's bond: Lv.0–2, 3–4, 5. */
export const trainerTier = (bond: number): TrainerTier =>
  bond >= MAX_BOND_LEVEL ? "high" : bond >= 3 ? "mid" : "low";
export const trainerOrder = Object.keys(trainers) as TrainerId[];

const pct = (factor: number) => Math.round(Math.abs(factor - 1) * 100);

/** The item each trainer uses in a run: its art and what it does, for the HUD and the lobby tip. */
export const assistLooks: Record<AssistItem, { icon: string; detail: string }> = {
  xSpeed: {
    icon: "/art/icons/items/x-speed.webp",
    detail: `自己和附近队友移动 +${pct(TRAINER.xSpeed.movement)}%、攻击速度 +${pct(TRAINER.xSpeed.attackRate)}%，${TRAINER.xSpeed.seconds} 秒`,
  },
  superPotion: {
    icon: "/art/icons/items/super-potion.webp",
    detail: `自己和附近队友回复 ${Math.round(TRAINER.superPotion.hp * 100)}% 最大生命`,
  },
  direHit: {
    icon: "/art/icons/items/dire-hit.webp",
    detail: `自己和附近队友 ${TRAINER.direHit.seconds} 秒内攻击必定击中要害`,
  },
  fullHeal: {
    icon: "/art/icons/items/full-heal.webp",
    detail: `解除自己和附近队友的异常状态，${TRAINER.fullHeal.seconds} 秒内不再陷入`,
  },
};

type Passive = (typeof trainerKits)[TrainerId]["passive"];
export const passiveLooks: Record<
  Passive,
  { name: string; icon: "eye" | "case" | "spark" | "heart"; detail: string }
> = {
  scout: { name: "远眺", icon: "eye", detail: "小地图上的交互点、出口和奖励标记显示得更远" },
  tinker: {
    name: "巧修",
    icon: "case",
    detail: `在催眠貘处遗忘招式或道具，返还的星星沙子 +${pct(TRAINER.tinker.refund)}%`,
  },
  naturalist: {
    name: "博物",
    icon: "spark",
    detail: `异色宝可梦更常出现（×${TRAINER.naturalist.shiny}），图鉴遇见计数 +${pct(TRAINER.naturalist.seen)}%`,
  },
  caretaker: {
    name: "照料",
    icon: "heart",
    detail: `本局收服的同伴伤害 +${pct(TRAINER.caretaker.damage)}%、攻击间隔 −${pct(TRAINER.caretaker.interval)}%`,
  },
};

/** The lobby tip for a trainer's kit: the item with its cooldown, then the passive. */
export function kitTip(id: TrainerId): string {
  const { assist, passive } = trainerKits[id];
  return [
    `${assistNames[assist]} · ${assistLooks[assist].detail} · 冷却 ${TRAINER.cooldown} 秒`,
    `${passiveLooks[passive].name} · ${passiveLooks[passive].detail}`,
  ].join("\n");
}

export const XIAQING_UNLOCK_KILLS = 5000;

export function trainerUnlocked(progress: Pick<Progress, "kills">, id: TrainerId): boolean {
  return id !== "xiaqing" || progress.kills >= XIAQING_UNLOCK_KILLS;
}

export type TrainerExpression = "portrait" | "cutin" | "lobby" | "portrait-locked" | "lobby-locked";
export const trainerArt = (id: TrainerId, expression: TrainerExpression = "portrait") =>
  `/art/trainers/${id}/${expression}.webp`;
