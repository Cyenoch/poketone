import type { Archetype } from "./sim/content/moves";
import type { ReactionId } from "./sim/content/reactions";

export { typeNames } from "./sim/content/elements";

export const reactionNames: Record<ReactionId, string> = {
  shock: "感电",
  steam: "蒸汽",
  wildfire: "蔓延燃烧",
};

/** Attack-form names follow the Pokébonk Chinese labels so the docs can be cross-checked. */
export const archetypeNames: Record<Archetype, string> = {
  bolt: "弹丸",
  cone: "扇形",
  vortex: "漩涡",
  orb: "爆裂球",
  strike: "打击",
  barrage: "连射",
  beam: "光束",
  spin: "旋转",
  chain: "连锁",
  smite: "落雷",
  nova: "冲击波",
  homing: "追踪",
  drain: "吸取",
  lob: "炸弹",
  wave: "波浪",
  bloom: "融合",
  firestorm: "融合",
  sprinkler: "融合",
  rod: "融合",
};

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
