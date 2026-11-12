// Ids are the Pokébonk 0.8.83 keys (src/run/sim/content/README.md「缺少：道具与被动」); numbers are our own tuning
// per level, about half the reference's power since our runs are shorter and a level is one card.

import type { ElementType } from "./elements";
import type { MoveCategory } from "./moves";
import type { EnemyStatusId } from "./statuses";
import { modifierText, type EffectDef, type ModifierDef } from "./effects";
import { isScaledList, resolveTrigger, triggerText, type TriggerDef } from "./triggers";
import { BASE_ITEM_LEVEL_CAP } from "./params/cards";
import type { Rarity } from "../state/entities";

export interface ItemDef<Id extends string = ItemId> {
  id: Id;
  name: string;
  /** Effect summary at level 1, derived from `effect`. */
  desc: string;
  /**
   * Card tier (the upgrade cards' 普通 / 稀有 / 史诗 / 传说): how rarely a new-item card rolls it
   * (params/cards.ts `ITEM_GATES`). Reference tiers 普通 + 罕见 → 普通, 稀有 → 稀有, 史诗 → 史诗, 传说 → 传说.
   */
  rarity: Rarity;
  /** Highest level: the reference's stack limit, at most 5. */
  max: number;
  /**
   * What the item boosts when that is a type or move category: offered only to a player whose line or
   * partners hit with it (type boosters ×`BOOSTER_WEIGHT` among their tier).
   */
  boosts?: ElementType | MoveCategory;
  /**
   * What the item feeds on, offered only when the player has it: a status the line or an item inflicts
   * (fire stone: burn), or a partner (lemonade, poké doll, S.S. ticket).
   */
  needs?: EnemyStatusId | "partner";
  /** Modifier values are per level (`atLevel`); trigger values step with the level (`Scaled`). */
  effect: EffectDef<number>;
  /** Run rules the item changes, per level (`stats.ts` `itemRule`). */
  rules?: ItemRules;
  onPick?: OnPick;
}

export type ItemRules = Partial<Record<ItemRule, number>>;
/** What picking a level does at once: `levels` player levels (Rare Candy), a `roll` (Loaded Dice). */
export interface OnPick {
  levels?: number;
  roll?: true;
}

/**
 * Run rules items change (summed over items × level): extra partner slots (S.S. Ticket), extra item
 * levels (Max Ether), sure captures (Master Ball), extra berry drops as a share (Poké Radar).
 */
export type ItemRule = "partners" | "itemLevels" | "capture" | "berries";

interface Spec {
  rules?: ItemRules;
  onPick?: OnPick;
  rarity: Rarity;
  max?: number;
  mods?: readonly ModifierDef<number>[];
  triggers?: readonly TriggerDef[];
  boosts?: ElementType | MoveCategory;
  needs?: EnemyStatusId | "partner";
}

function item<Id extends string>(id: Id, name: string, spec: Spec): ItemDef<Id> {
  const {
    rarity,
    max = BASE_ITEM_LEVEL_CAP,
    mods: modifiers = [],
    triggers = [],
    boosts,
    needs,
    rules,
    onPick,
  } = spec;
  for (const trigger of triggers)
    for (const value of Object.values(trigger))
      if (isScaledList(value) && value.length !== max)
        throw new Error(`${id}: 触发器的分级数值应有 ${max} 级。`);
  const desc = [
    ...(onPick?.levels ? [`立即升 ${onPick.levels} 级`] : []),
    ...(onPick?.roll ? ["每级随机强化一项属性"] : []),
    ...modifiers.map(modifierText),
    ...triggers.map((trigger) => triggerText(resolveTrigger(trigger, 0))),
    ...Object.entries(rules ?? {}).map(([rule, value]) => ruleText(rule as ItemRule, value)),
  ].join("，");
  return {
    id,
    name,
    desc,
    rarity,
    max,
    ...(boosts ? { boosts } : {}),
    ...(needs ? { needs } : {}),
    ...(rules ? { rules } : {}),
    ...(onPick ? { onPick } : {}),
    effect: { modifiers, triggers },
  };
}

/** Card wording of one level of an item rule. */
export function ruleText(rule: ItemRule, value: number): string {
  switch (rule) {
    case "partners":
      return `同伴栏 +${value}`;
    case "itemLevels":
      return `道具等级上限 +${value}`;
    case "capture":
      return "击败的精英有空栏时必定收服";
    case "berries":
      return `树果掉落 +${Math.round(value * 100)}%`;
  }
}

const add = (
  stat: ModifierDef<number>["stat"],
  value: number,
  when?: ModifierDef<number>["when"],
) => ({ stat, op: "add", value, ...(when ? { when } : {}) }) as const satisfies ModifierDef<number>;
const pct = (stat: ModifierDef<number>["stat"], value: number) =>
  ({ stat, op: "pct", value }) as const satisfies ModifierDef<number>;
const mul = (
  stat: ModifierDef<number>["stat"],
  value: number,
  when?: ModifierDef<number>["when"],
) => ({ stat, op: "mul", value, ...(when ? { when } : {}) }) as const satisfies ModifierDef<number>;

/**
 * Loaded Dice's faces: each level rolls one (seeded) at pick time, kept in `Player.fx[diceKey(level)]`
 * and folded as that item's modifier. Each is about 1.5 × a common item's level (reference: 1.5 × a
 * vitamin).
 */
export const DICE_FACES: readonly ModifierDef<number>[] = [
  { stat: "damage", op: "add", value: 0.09 },
  { stat: "maxHp", op: "add", value: 18 },
  { stat: "speed", op: "pct", value: 0.07 },
  { stat: "crit", op: "add", value: 0.06 },
  { stat: "armor", op: "add", value: 7 },
  { stat: "regen", op: "add", value: 0.6 },
  { stat: "area", op: "add", value: 0.12 },
  { stat: "cooldown", op: "mul", value: 0.92 },
  { stat: "xp", op: "add", value: 0.15 },
  { stat: "luck", op: "add", value: 10 },
];
export const diceKey = (level: number) => `dice:${level}`;

/** Type booster: hits of its type +10%, every hit +1% (reference +30% / +3% per stack). */
const booster = (type: ElementType): Spec => ({
  rarity: 0,
  boosts: type,
  mods: [add("damage", 0.1, type), add("damage", 0.01)],
});

// Key order is the card pool's order (determinism) and the fold's order among items. The first eleven
// keep their old order; new items follow by reference tier.
const itemsTable = {
  "life-orb": item("life-orb", "生命宝珠", {
    rarity: 1,
    mods: [add("damage", 0.1), mul("maxHp", 0.97)],
  }),
  "choice-scarf": item("choice-scarf", "讲究围巾", {
    rarity: 1,
    mods: [pct("speed", 0.08), mul("cooldown", 0.98)],
  }),
  "quick-claw": item("quick-claw", "先制之爪", { rarity: 0, mods: [mul("cooldown", 0.93)] }),
  leftovers: item("leftovers", "吃剩的东西", { rarity: 0, mods: [add("regen", 0.5)] }),
  "scope-lens": item("scope-lens", "焦点镜", { rarity: 0, mods: [add("crit", 0.06)] }),
  "wide-lens": item("wide-lens", "广角镜", { rarity: 0, mods: [add("area", 0.1)] }),
  honey: item("honey", "甜甜蜜", { rarity: 0, mods: [pct("pickup", 0.35)] }),
  "lucky-egg": item("lucky-egg", "幸运蛋", { rarity: 0, mods: [add("xp", 0.12)] }),
  "hp-up": item("hp-up", "HP增强剂", { rarity: 0, mods: [add("maxHp", 15)] }),
  "rocky-helmet": item("rocky-helmet", "凸凸头盔", {
    rarity: 0,
    mods: [add("armor", 4), add("thorns", 8)],
  }),
  "shell-bell": item("shell-bell", "贝壳之铃", { rarity: 0, mods: [add("lifesteal", 0.01)] }),

  // 普通 (reference 普通 / 罕见)
  charcoal: item("charcoal", "木炭", booster("fire")),
  "mystic-water": item("mystic-water", "神秘水滴", booster("water")),
  "miracle-seed": item("miracle-seed", "奇迹种子", booster("grass")),
  magnet: item("magnet", "磁铁", booster("electric")),
  "silk-scarf": item("silk-scarf", "丝绸围巾", booster("normal")),
  "silver-powder": item("silver-powder", "银粉", booster("bug")),
  "sharp-beak": item("sharp-beak", "锐利鸟嘴", booster("flying")),
  "poison-barb": item("poison-barb", "毒针", booster("poison")),
  "hard-stone": item("hard-stone", "硬石头", booster("rock")),
  "soft-sand": item("soft-sand", "柔软沙子", booster("ground")),
  "oran-berry": item("oran-berry", "橙橙果", { rarity: 0, mods: [add("maxHp", 12)] }),
  "quick-powder": item("quick-powder", "速度粉", { rarity: 0, mods: [pct("speed", 0.05)] }),
  "bright-powder": item("bright-powder", "光粉", { rarity: 0, mods: [add("evasion", 0.03)] }),
  "amulet-coin": item("amulet-coin", "护符金币", { rarity: 0, mods: [add("stardust", 0.15)] }),
  "zoom-lens": item("zoom-lens", "对焦镜", {
    rarity: 0,
    mods: [add("projSpeed", 0.12), add("crit", 0.02)],
  }),
  "soothe-bell": item("soothe-bell", "安抚之铃", {
    rarity: 0,
    mods: [add("healing", 0.1), add("regen", 0.2)],
  }),
  "lax-incense": item("lax-incense", "悠闲薰香", { rarity: 0, mods: [add("armor", 5)] }),
  "cleanse-tag": item("cleanse-tag", "洁净之符", {
    rarity: 0,
    mods: [add("damage", 0.12, "elite")],
  }),
  potion: item("potion", "伤药", { rarity: 0, mods: [add("regen", 0.35)] }),
  "lucky-punch": item("lucky-punch", "吉利拳", {
    rarity: 0,
    mods: [add("luck", 6), add("crit", 0.02)],
  }),
  "berry-juice": item("berry-juice", "树果汁", {
    rarity: 0,
    triggers: [{ kind: "healOnKill", chance: 0.04, heal: [0.01, 0.015, 0.02, 0.025, 0.03] }],
  }),
  "muscle-band": item("muscle-band", "力量头带", {
    rarity: 0,
    boosts: "physical",
    mods: [add("damage", 0.12, "physical")],
  }),
  "wise-glasses": item("wise-glasses", "博识眼镜", {
    rarity: 0,
    mods: [add("damage", 0.08, "special")],
  }),
  "razor-claw": item("razor-claw", "锐利之爪", { rarity: 0, mods: [add("critDamage", 0.2)] }),
  "light-clay": item("light-clay", "光之黏土", { rarity: 0, mods: [add("duration", 0.1)] }),
  "white-herb": item("white-herb", "白色香草", { rarity: 0, mods: [add("statusChance", 0.15)] }),
  "power-herb": item("power-herb", "强力香草", { rarity: 0, mods: [add("statusDamage", 0.15)] }),
  "sitrus-berry": item("sitrus-berry", "文柚果", {
    rarity: 0,
    mods: [add("maxHp", 5)],
    triggers: [
      { kind: "healBelow", below: 0.3, heal: [0.2, 0.24, 0.28, 0.32, 0.36], cooldown: 45 },
    ],
  }),
  "big-root": item("big-root", "大根茎", {
    rarity: 0,
    mods: [add("lifesteal", 0.006), add("healing", 0.08)],
  }),
  "air-balloon": item("air-balloon", "气球", { rarity: 0, max: 2, mods: [add("dashCharges", 1)] }),
  "white-flute": item("white-flute", "白色玻璃哨", {
    rarity: 0,
    mods: [add("spawns", 0.1), add("xp", 0.08), add("luck", 4)],
  }),
  repel: item("repel", "除虫喷雾", {
    rarity: 0,
    max: 3,
    mods: [add("spawns", -0.06), pct("speed", 0.04)],
  }),
  zinc: item("zinc", "特防增强剂", { rarity: 0, mods: [add("shield", 8)] }),
  "super-lure": item("super-lure", "白银香水", {
    rarity: 0,
    mods: [add("elites", 0.12), add("damage", 0.04, "elite")],
  }),

  // 稀有
  "choice-band": item("choice-band", "讲究头带", {
    rarity: 1,
    boosts: "physical",
    mods: [add("damage", 0.2, "physical"), mul("cooldown", 1.03)],
  }),
  "choice-specs": item("choice-specs", "讲究眼镜", {
    rarity: 1,
    mods: [add("damage", 0.15, "special"), mul("cooldown", 1.03)],
  }),
  "expert-belt": item("expert-belt", "达人带", {
    rarity: 1,
    mods: [add("damage", 0.15, "superEffective")],
  }),
  "assault-vest": item("assault-vest", "突击背心", {
    rarity: 1,
    mods: [add("armor", 4), mul("maxHp", 1.05)],
  }),
  eviolite: item("eviolite", "进化奇石", {
    rarity: 1,
    max: 1,
    mods: [add("armor", 6, "canEvolve"), mul("maxHp", 1.08, "canEvolve")],
  }),
  "exp-share": item("exp-share", "学习装置", {
    rarity: 1,
    mods: [add("xp", 0.15), add("pickup", 0.6)],
  }),
  "macho-brace": item("macho-brace", "强制锻炼器", {
    rarity: 1,
    max: 3,
    mods: [add("xp", 0.3), pct("speed", -0.06)],
  }),
  "black-sludge": item("black-sludge", "黑色污泥", {
    rarity: 1,
    mods: [add("regen", 0.8), add("statusDamage", 0.12)],
  }),
  "star-piece": item("star-piece", "星星碎片", { rarity: 1, mods: [add("luck", 12)] }),
  "lum-berry": item("lum-berry", "木子果", {
    rarity: 1,
    max: 3,
    mods: [add("healing", 0.05)],
    triggers: [{ kind: "healEvery", every: 30, heal: [0.08, 0.1, 0.12] }],
  }),

  // 史诗
  "pp-max": item("pp-max", "PP极限提升剂", { rarity: 2, max: 2, mods: [add("projectiles", 1)] }),
  "max-elixir": item("max-elixir", "PP多项全补剂", { rarity: 2, mods: [mul("cooldown", 0.9)] }),
  "shiny-stone": item("shiny-stone", "光之石", {
    rarity: 2,
    mods: [add("damage", 0.08), add("area", 0.08)],
  }),
  "dusk-stone": item("dusk-stone", "暗之石", {
    rarity: 2,
    mods: [add("critDamage", 0.25), add("crit", 0.04)],
  }),
  "comet-shard": item("comet-shard", "彗星碎片", {
    rarity: 2,
    mods: [add("stardust", 0.3), add("luck", 15)],
  }),
  protector: item("protector", "护具", {
    rarity: 2,
    max: 3,
    mods: [add("armor", 10), mul("maxHp", 1.08), add("thorns", 15), pct("speed", -0.03)],
  }),

  // 传说
  "moon-stone": item("moon-stone", "月之石", {
    rarity: 3,
    max: 2,
    mods: [add("projectiles", 1), add("area", 0.15)],
  }),
  "dawn-stone": item("dawn-stone", "觉醒之石", {
    rarity: 3,
    max: 2,
    mods: [add("damage", 0.2), mul("cooldown", 0.9)],
  }),
  "soul-dew": item("soul-dew", "心之水滴", {
    rarity: 3,
    max: 1,
    mods: [add("damage", 0.15, "special"), add("area", 0.1), add("ultCharge", 0.3)],
  }),

  // Batch 2: triggered items (on hit, on kill, timed, scaling), by tier.
  "grip-claw": item("grip-claw", "紧缠钩爪", {
    rarity: 0,
    triggers: [{ kind: "inflictOnHit", status: "root", chance: [0.06, 0.07, 0.08, 0.09, 0.1] }],
  }),
  "flame-orb": item("flame-orb", "火焰宝珠", {
    rarity: 0,
    mods: [add("statusDamage", 0.05)],
    triggers: [{ kind: "inflictOnHit", status: "burn", chance: [0.05, 0.06, 0.07, 0.08, 0.09] }],
  }),
  "toxic-orb": item("toxic-orb", "剧毒宝珠", {
    rarity: 0,
    mods: [add("statusChance", 0.05)],
    triggers: [{ kind: "inflictOnHit", status: "poison", chance: [0.06, 0.07, 0.08, 0.09, 0.1] }],
  }),
  snowball: item("snowball", "雪球", {
    rarity: 0,
    mods: [add("armor", 2)],
    triggers: [{ kind: "inflictOnHit", status: "chill", chance: [0.06, 0.07, 0.08, 0.09, 0.1] }],
  }),
  awakening: item("awakening", "解眠药", {
    rarity: 0,
    max: 3,
    triggers: [{ kind: "inflictOnHit", status: "sleep", chance: [0.04, 0.055, 0.07] }],
  }),
  "binding-band": item("binding-band", "紧绑束带", {
    rarity: 0,
    mods: [add("damage", 0.2, "held")],
  }),
  "burn-heal": item("burn-heal", "灼伤药", {
    rarity: 0,
    needs: "burn",
    max: 3,
    mods: [add("statusDamage", 0.03)],
    triggers: [
      {
        kind: "spreadStatus",
        every: 0.5,
        status: "burn",
        range: 6,
        radius: 2.5,
        share: [0.5, 0.6, 0.7],
        count: [3, 5, 7],
      },
    ],
  }),
  "ice-heal": item("ice-heal", "解冻药", {
    rarity: 0,
    needs: "freeze",
    max: 3,
    triggers: [
      {
        kind: "burstOnKill",
        chance: 1,
        requires: ["freeze"],
        radius: [1.4, 1.7, 2],
        dmg: [10, 14, 18],
        type: "water",
        status: "chill",
        statusChance: 1,
        look: "wave",
      },
    ],
  }),
  metronome: item("metronome", "节拍器", {
    rarity: 0,
    triggers: [
      {
        kind: "scaling",
        measure: "unhurt",
        stat: "damage",
        per: 0.03,
        cap: [0.08, 0.11, 0.14, 0.17, 0.2],
      },
    ],
  }),
  "old-rod": item("old-rod", "破旧钓竿", {
    rarity: 0,
    max: 3,
    triggers: [
      {
        kind: "strike",
        every: 9,
        target: "random",
        count: 1,
        range: 9,
        radius: 1.2,
        dmg: [20, 26, 32],
        type: "water",
        status: "wet",
        statusChance: 1,
        jackpot: 0.08,
        jackpotMult: 4,
        look: "wave",
      },
    ],
  }),
  "sticky-barb": item("sticky-barb", "附着针", {
    rarity: 0,
    mods: [add("thorns", 6)],
    triggers: [{ kind: "contactSpread", radius: [1.6, 1.8, 2, 2.2, 2.4], status: "poison" }],
  }),
  "kings-rock": item("kings-rock", "王者之证", {
    rarity: 1,
    triggers: [{ kind: "inflictOnHit", status: "flinch", chance: [0.08, 0.1, 0.12, 0.14, 0.16] }],
  }),
  stick: item("stick", "大葱", {
    rarity: 1,
    max: 4,
    triggers: [{ kind: "bonk", chance: [0.03, 0.04, 0.05, 0.06], mult: 4 }],
  }),
  "razor-fang": item("razor-fang", "锐利之牙", {
    rarity: 1,
    max: 4,
    triggers: [{ kind: "execute", below: [0.06, 0.08, 0.1, 0.12] }],
  }),
  "cell-battery": item("cell-battery", "充电电池", {
    rarity: 1,
    max: 2,
    triggers: [
      {
        kind: "scaling",
        measure: "streak",
        stat: "cooldown",
        per: [-0.002, -0.003],
        cap: [-0.08, -0.12],
      },
    ],
  }),
  bicycle: item("bicycle", "自行车", {
    rarity: 1,
    max: 2,
    mods: [pct("speed", 0.05)],
    triggers: [{ kind: "scaling", measure: "speed", stat: "damage", per: 0.5, cap: [0.15, 0.25] }],
  }),
  "full-heal": item("full-heal", "万灵药", {
    rarity: 1,
    max: 3,
    mods: [add("damage", 0.08, "perStatus")],
  }),
  "thunder-stone": item("thunder-stone", "雷之石", {
    rarity: 2,
    mods: [add("crit", 0.03)],
    triggers: [
      {
        kind: "critStrike",
        range: 8,
        perSecond: 5,
        dmg: [14, 18, 22, 26, 30],
        type: "electric",
        status: "paralysis",
        statusChance: 0.3,
      },
    ],
  }),
  "fire-stone": item("fire-stone", "火之石", {
    rarity: 2,
    needs: "burn",
    max: 3,
    triggers: [
      {
        kind: "burstOnKill",
        chance: 0.5,
        requires: ["burn"],
        radius: [1.8, 2.1, 2.4],
        dmg: [16, 22, 28],
        type: "fire",
        status: "burn",
        statusChance: 0.5,
        look: "embers",
      },
    ],
  }),
  "ice-stone": item("ice-stone", "冰之石", {
    rarity: 2,
    needs: "chill",
    max: 3,
    mods: [add("statusChance", 0.05)],
    triggers: [
      {
        kind: "burstOnKill",
        chance: 1,
        requires: ["chill", "freeze"],
        radius: [1.6, 1.9, 2.2],
        dmg: [12, 16, 20],
        type: "water",
        status: "chill",
        statusChance: 1,
        look: "wave",
      },
    ],
  }),
  "leaf-stone": item("leaf-stone", "叶之石", {
    rarity: 2,
    max: 3,
    triggers: [
      {
        kind: "burstOnKill",
        chance: 0.1,
        radius: [1.8, 2.1, 2.4],
        dmg: [14, 19, 24],
        type: "grass",
        statusChance: 0,
        heal: 0.01,
        look: "petals",
      },
    ],
  }),
  "griseous-orb": item("griseous-orb", "白金宝珠", {
    rarity: 2,
    max: 2,
    triggers: [
      {
        kind: "burstOnKill",
        chance: [0.1, 0.14],
        radius: 1.8,
        dmg: [14, 20],
        type: "normal",
        status: "curse",
        statusChance: 1,
        look: "spores",
      },
    ],
  }),
  "reaper-cloth": item("reaper-cloth", "灵界之布", {
    rarity: 2,
    max: 2,
    triggers: [
      {
        kind: "scaling",
        measure: "kills",
        stat: "damage",
        per: [0.0001, 0.00015],
        cap: [0.15, 0.2],
      },
    ],
  }),
  electirizer: item("electirizer", "电力增幅器", {
    rarity: 2,
    max: 3,
    triggers: [
      {
        kind: "strike",
        every: 2.5,
        target: "random",
        count: [2, 3, 4],
        range: 7,
        radius: 0.6,
        dmg: [9, 11, 13],
        type: "electric",
        status: "paralysis",
        statusChance: 0.3,
        look: "storm",
      },
    ],
  }),
  "thick-club": item("thick-club", "粗骨头", {
    rarity: 2,
    max: 2,
    boosts: "physical",
    triggers: [
      {
        kind: "scaling",
        measure: "armor",
        stat: "damage",
        when: "physical",
        per: 0.005,
        cap: [0.25, 0.35],
      },
    ],
  }),
  "rage-candy-bar": item("rage-candy-bar", "愤怒馒头", {
    rarity: 2,
    max: 1,
    mods: [add("healing", -0.25)],
    triggers: [{ kind: "scaling", measure: "missingHp", stat: "damage", per: 0.5, cap: 0.4 }],
  }),
  "silph-scope": item("silph-scope", "西尔佛检视镜", {
    rarity: 2,
    max: 2,
    triggers: [{ kind: "markStrongest", every: 6, range: 10, bonus: [0.2, 0.3] }],
  }),
  "sun-stone": item("sun-stone", "日之石", {
    rarity: 3,
    max: 2,
    mods: [add("damage", 0.06)],
    triggers: [
      {
        kind: "strike",
        every: 6,
        target: "strongest",
        count: 1,
        range: 9,
        radius: [1.8, 2.2],
        dmg: [40, 55],
        type: "fire",
        status: "burn",
        statusChance: 1,
        look: "blast",
      },
    ],
  }),
  "lustrous-orb": item("lustrous-orb", "白玉宝珠", {
    rarity: 3,
    max: 1,
    mods: [add("area", 0.1)],
    triggers: [
      {
        kind: "strike",
        every: 8,
        target: "random",
        count: 1,
        range: 8,
        radius: 2.4,
        dmg: 35,
        type: "water",
        statusChance: 0,
        look: "whirl",
      },
    ],
  }),

  // Batch 3: hurt, knockout, dash, ultimate, partner and rule items, by tier.
  "soda-pop": item("soda-pop", "劲爽汽水", {
    rarity: 0,
    triggers: [
      {
        kind: "dashBurst",
        at: "start",
        radius: [1.6, 1.8, 2, 2.2, 2.4],
        dmg: [8, 10, 12, 14, 16],
        type: "water",
        status: "wet",
        statusChance: 1,
        knock: 1.5,
        look: "wave",
      },
    ],
  }),
  "smoke-ball": item("smoke-ball", "烟雾球", {
    rarity: 0,
    mods: [add("evasion", 0.02)],
    triggers: [
      {
        kind: "buff",
        on: "hurt",
        chance: 0.25,
        cooldown: 0,
        seconds: 1.5,
        mods: [],
        power: 1,
        iframes: 1.5,
      },
    ],
  }),
  "adrenaline-orb": item("adrenaline-orb", "胆怯球", {
    rarity: 0,
    max: 3,
    triggers: [
      {
        kind: "buff",
        on: "hurt",
        chance: 1,
        cooldown: 6,
        seconds: 3,
        mods: [pct("speed", 0.15), mul("cooldown", 0.9)],
        power: [1, 1.3, 1.6],
      },
    ],
  }),
  "metal-powder": item("metal-powder", "金属粉", {
    rarity: 0,
    max: 3,
    triggers: [
      {
        kind: "buff",
        on: "still",
        delay: 0.5,
        chance: 1,
        cooldown: 0,
        seconds: 0.1,
        mods: [add("armor", 12), mul("cooldown", 0.94)],
        power: [1, 1.4, 1.8],
      },
    ],
  }),
  lemonade: item("lemonade", "果汁牛奶", {
    rarity: 0,
    needs: "partner",
    max: 3,
    mods: [add("partnerDamage", 0.15), add("partnerRate", 0.1)],
  }),
  "smooth-rock": item("smooth-rock", "沙沙岩石", {
    rarity: 0,
    max: 3,
    mods: [add("pierce", 1), add("projSpeed", 0.08)],
  }),
  "enigma-berry": item("enigma-berry", "谜芝果", {
    rarity: 0,
    mods: [add("shield", 6)],
    triggers: [{ kind: "overhealShield" }],
  }),
  "poke-radar": item("poke-radar", "宝可追踪", { rarity: 0, rules: { berries: 0.5 } }),
  "loaded-dice": item("loaded-dice", "机变骰子", { rarity: 0, onPick: { roll: true } }),
  "focus-band": item("focus-band", "气势头带", {
    rarity: 1,
    max: 4,
    triggers: [
      {
        kind: "lethalSave",
        chance: [0.15, 0.2, 0.25, 0.3],
        cooldown: 20,
        uses: 99,
        per: "run",
        hp: 0,
        iframes: 1,
      },
    ],
  }),
  "shed-shell": item("shed-shell", "美丽空壳", {
    rarity: 1,
    max: 1,
    triggers: [
      {
        kind: "buff",
        on: "dash",
        chance: 1,
        cooldown: 0,
        seconds: 0,
        mods: [],
        power: 1,
        iframes: 0.4,
      },
    ],
  }),
  "iron-ball": item("iron-ball", "黑色铁球", {
    rarity: 1,
    max: 3,
    mods: [add("armor", 6), pct("speed", -0.05)],
    triggers: [
      {
        kind: "dashBurst",
        at: "end",
        radius: [1.8, 2, 2.2],
        dmg: [10, 13, 16],
        armorScale: 0.5,
        type: "normal",
        statusChance: 0,
        knock: 2,
        look: "sun",
      },
    ],
  }),
  "poke-doll": item("poke-doll", "皮皮玩偶", {
    rarity: 1,
    needs: "partner",
    max: 2,
    mods: [mul("guardRest", 0.75), add("partnerDamage", 0.05)],
  }),
  "fresh-water": item("fresh-water", "美味之水", {
    rarity: 1,
    max: 3,
    mods: [add("healing", 0.05)],
    triggers: [
      {
        kind: "overhealStore",
        cap: [0.2, 0.3, 0.4],
        every: 1.5,
        range: 14,
        perHp: [1.5, 2, 2.5],
        type: "water",
        status: "wet",
      },
    ],
  }),
  "guard-spec": item("guard-spec", "能力防守", {
    rarity: 1,
    max: 2,
    triggers: [{ kind: "block", every: [14, 10] }],
  }),
  "focus-sash": item("focus-sash", "气势披带", {
    rarity: 2,
    max: 1,
    triggers: [
      {
        kind: "lethalSave",
        chance: 1,
        cooldown: 0,
        uses: 1,
        per: "stage",
        hp: 0,
        iframes: 1.5,
      },
    ],
  }),
  revive: item("revive", "活力碎片", {
    rarity: 2,
    max: 2,
    triggers: [
      {
        kind: "lethalSave",
        chance: 1,
        cooldown: 0,
        uses: [1, 2],
        per: "run",
        hp: 0.35,
        iframes: 2.5,
      },
    ],
  }),
  "ss-ticket": item("ss-ticket", "船票", {
    rarity: 2,
    max: 1,
    needs: "partner",
    rules: { partners: 1 },
  }),
  "max-ether": item("max-ether", "PP单项全补剂", { rarity: 2, max: 1, rules: { itemLevels: 2 } }),
  "max-revive": item("max-revive", "活力块", {
    rarity: 3,
    max: 2,
    triggers: [
      {
        kind: "lethalSave",
        chance: 1,
        cooldown: 0,
        uses: [1, 2],
        per: "run",
        hp: 0.6,
        iframes: 2.5,
      },
    ],
  }),
  "rare-candy": item("rare-candy", "神奇糖果", {
    rarity: 3,
    max: 2,
    mods: [add("damage", 0.05)],
    onPick: { levels: 2 },
  }),
  "master-ball": item("master-ball", "大师球", {
    rarity: 3,
    max: 1,
    mods: [add("damage", 0.12)],
    rules: { capture: 1 },
  }),
  "adamant-orb": item("adamant-orb", "金刚宝珠", {
    rarity: 3,
    max: 1,
    mods: [add("damage", 0.1)],
    triggers: [{ kind: "statusOnHurt", cooldown: 20, radius: 4, status: "freeze", seconds: 3 }],
  }),
  "silver-wing": item("silver-wing", "银色之羽", {
    rarity: 3,
    max: 1,
    mods: [add("dashCharges", 1), pct("speed", 0.08)],
    triggers: [
      {
        kind: "strike",
        every: 5,
        target: "self",
        count: 1,
        range: 0,
        radius: 3,
        dmg: 0,
        type: "flying",
        statusChance: 0,
        knock: 4,
        look: "whirl",
      },
    ],
  }),
  "rainbow-wing": item("rainbow-wing", "虹色之羽", {
    rarity: 3,
    max: 1,
    mods: [add("healing", 0.1)],
    triggers: [
      {
        kind: "lethalSave",
        chance: 1,
        cooldown: 0,
        uses: 1,
        per: "run",
        hp: 0.5,
        iframes: 3,
        burst: { radius: 3, dmg: 30, type: "fire", status: "burn", knock: 4, look: "blast" },
      },
    ],
  }),
  "poke-flute": item("poke-flute", "宝可梦之笛", {
    rarity: 3,
    max: 1,
    mods: [add("ultCharge", 0.25)],
    triggers: [
      {
        kind: "buff",
        on: "ult",
        chance: 1,
        cooldown: 0,
        seconds: 6,
        mods: [mul("cooldown", 0.77)],
        power: 1,
        resetCooldowns: true,
      },
    ],
  }),
};

export type ItemId = keyof typeof itemsTable;
export const items: Record<ItemId, ItemDef> = itemsTable;
export const itemIds = Object.keys(itemsTable) as ItemId[];
