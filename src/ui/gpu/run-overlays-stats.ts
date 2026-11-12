import { abilities } from "../../run/sim/content/abilities";
import { items } from "../../run/sim/content/items";
import {
  SOURCE_ORDER,
  type StatKey,
  type StatLine,
  type StatSource,
  type StatSourceKind,
} from "../../run/sim/stats";

/** How a stat reads: whole numbers, one decimal, or a share of 100% (multipliers and chances). */
type Unit = "int" | "dec" | "pct";

interface StatDef {
  name: string;
  unit: Unit;
  suffix?: string;
  /** Hidden while it is 0 with nothing feeding it (lifesteal, thorns, luck). */
  optional?: boolean;
}

export const statDefs: Record<StatKey, StatDef> = {
  maxHp: { name: "HP", unit: "int" },
  armor: { name: "护甲", unit: "int" },
  regen: { name: "再生", unit: "dec", suffix: "/秒" },
  lifesteal: { name: "吸血", unit: "pct", optional: true },
  thorns: { name: "反伤", unit: "int", optional: true },
  damage: { name: "伤害", unit: "pct" },
  crit: { name: "会心", unit: "pct" },
  cooldown: { name: "冷却", unit: "pct" },
  area: { name: "范围", unit: "pct" },
  ultCharge: { name: "充能", unit: "pct" },
  speed: { name: "移速", unit: "dec" },
  pickup: { name: "拾取", unit: "dec" },
  xp: { name: "经验", unit: "pct" },
  stardust: { name: "星星沙子", unit: "pct" },
  luck: { name: "幸运", unit: "int", optional: true },
  healing: { name: "治疗", unit: "pct", optional: true },
  shield: { name: "护盾", unit: "int", optional: true },
  evasion: { name: "闪避", unit: "pct", optional: true },
  damageTaken: { name: "受伤", unit: "pct", optional: true },
  critDamage: { name: "会心伤害", unit: "pct", optional: true },
  projectiles: { name: "弹丸", unit: "int", optional: true },
  projSpeed: { name: "弹速", unit: "pct", optional: true },
  duration: { name: "持续", unit: "pct", optional: true },
  statusChance: { name: "异常几率", unit: "pct", optional: true },
  statusDamage: { name: "异常伤害", unit: "pct", optional: true },
  dashCharges: { name: "冲刺", unit: "int", optional: true },
  partnerDamage: { name: "同伴伤害", unit: "pct", optional: true },
  partnerRate: { name: "同伴出手", unit: "pct", optional: true },
  guardRest: { name: "护主间隔", unit: "pct", optional: true },
  pierce: { name: "穿透", unit: "int", optional: true },
  spawns: { name: "敌人数量", unit: "pct", optional: true },
  elites: { name: "精英", unit: "pct", optional: true },
};

export const statGroups: { name: string; keys: StatKey[] }[] = [
  {
    name: "生存",
    keys: [
      "maxHp",
      "armor",
      "regen",
      "lifesteal",
      "thorns",
      "shield",
      "evasion",
      "damageTaken",
      "healing",
      "guardRest",
    ],
  },
  {
    name: "输出",
    keys: [
      "damage",
      "crit",
      "cooldown",
      "area",
      "ultCharge",
      "critDamage",
      "projectiles",
      "projSpeed",
      "duration",
      "statusChance",
      "statusDamage",
      "pierce",
      "partnerDamage",
      "partnerRate",
    ],
  },
  {
    name: "机动与收益",
    keys: ["speed", "pickup", "xp", "stardust", "luck", "dashCharges", "spawns", "elites"],
  },
];

/** Bar and dot colour per source; the base is the neutral segment. */
const kindNames: Record<StatSourceKind, string> = {
  evolution: "进化",
  level: "等级",
  item: "道具",
  lab: "研究所",
  train: "训练",
  ability: "特性",
};

const decimal = (value: number) => Number(value.toFixed(1)).toString();
// ASCII minus: the UI atlases' source font has no U+2212 (the GPU UI has no font fallback).
const signed = (value: number, text: string) => `${value < 0 ? "-" : "+"}${text}`;

export function formatStat(unit: Unit, value: number): string {
  if (unit === "pct") return `${decimal(value * 100)}%`;
  return unit === "int" ? String(Math.round(value)) : value.toFixed(1);
}

/** A source's effect in the stat's own terms: +16, +0.2, +10%, -13.5% (cooldown factors), +70% (honey). */
export function amountText(unit: Unit, source: StatSource): string {
  if (source.op === "add" || source.op === "extra") {
    const magnitude = Math.abs(source.amount);
    return signed(
      source.amount,
      unit === "pct" ? `${decimal(magnitude * 100)}%` : formatStat(unit, magnitude),
    );
  }
  const factor =
    source.op === "pct"
      ? source.amount
      : source.op === "mul"
        ? source.amount - 1
        : 1 / source.amount - 1;
  return signed(factor, `${decimal(Math.abs(factor) * 100)}%`);
}

export function sourceLabel(source: StatSource): string {
  if (source.kind === "item") return `${items[source.item!].name} Lv${source.count}`;
  if (source.kind === "train") return `训练 ×${source.count}`;
  if (source.kind === "level") return `等级 ${source.count}`;
  if (source.kind === "ability") return abilities[source.ability!].name;
  return kindNames[source.kind];
}

export const bySource = (sources: StatSource[]) =>
  sources.toSorted((a, b) => SOURCE_ORDER.indexOf(a.kind) - SOURCE_ORDER.indexOf(b.kind));

/** The value the row shows: area after its diminishing growth, every other stat as the sim has it. */
export const shownValue = (line: StatLine) => line.effective ?? line.value;

/** (base + Σadd) × (1 + Σpct) × … = value, written only when the sources are not a plain sum. */
export function statFormula(unit: Unit, line: StatLine): string | null {
  const counted = line.sources.filter((source) => source.active);
  const sum = (op: StatSource["op"]) =>
    counted
      .filter((source) => source.op === op)
      .reduce((total, source) => total + source.amount, 0);
  const plain = counted.every((source) => source.op === "add");
  if (plain && line.effective === undefined) return null;
  const adds = sum("add");
  let text = adds
    ? `(${formatStat(unit, line.base)} + ${formatStat(unit, adds)})`
    : formatStat(unit, line.base);
  if (counted.some((source) => source.op === "pct"))
    text += ` × ${formatStat("pct", 1 + sum("pct"))}`;
  for (const source of counted) {
    if (source.op === "mul") text += ` × ${formatStat("pct", source.amount)}`;
    if (source.op === "div") text += ` ÷ ${formatStat("pct", source.amount)}`;
  }
  if (sum("extra")) text += ` + ${formatStat(unit, sum("extra"))}`;
  if (line.effective !== undefined)
    return `${text} = ${formatStat(unit, line.value)}，递减后 ${formatStat(unit, line.effective)}`;
  return `${text} = ${formatStat(unit, line.value)}`;
}

/**
 * Each active source's part of the value, for the inline bar: value = base + Σadd + the pct group's
 * share + the factors' share (split by log) + Σextra. Reductions (cooldown) are cut out of the base,
 * so the bar is the base and the coloured part is what changed it.
 */
export function shares(line: StatLine): { kind: StatSourceKind | "base"; size: number }[] {
  const counted = line.sources.filter((source) => source.active);
  const of = (op: StatSource["op"]) => counted.filter((source) => source.op === op);
  const sum = (list: StatSource[]) => list.reduce((total, source) => total + source.amount, 0);
  const scaled = (line.base + sum(of("add"))) * (1 + sum(of("pct")));
  const factors = [
    ...of("mul").map((source) => ({ source, log: Math.log(source.amount) })),
    ...of("div").map((source) => ({ source, log: -Math.log(source.amount) })),
  ];
  const totalLog = factors.reduce((total, factor) => total + factor.log, 0);
  const change = scaled * (Math.exp(totalLog) - 1);
  const parts = [
    ...of("add").map((source) => ({ kind: source.kind, size: source.amount })),
    ...of("pct").map((source) => ({
      kind: source.kind,
      size: (line.base + sum(of("add"))) * source.amount,
    })),
    ...factors.map(({ source, log }) => ({
      kind: source.kind,
      size: totalLog ? (change * log) / totalLog : 0,
    })),
    ...of("extra").map((source) => ({ kind: source.kind, size: source.amount })),
  ];
  const cut = parts.reduce((total, part) => total + Math.min(0, part.size), 0);
  return [{ kind: "base" as const, size: line.base + cut }, ...parts]
    .map((part) => ({ ...part, size: Math.abs(part.size) }))
    .filter((part) => part.size > 0);
}

/** Bar segments merged per source kind, base first, then `SOURCE_ORDER`. */
export function bySourceShares(parts: ReturnType<typeof shares>) {
  const order = ["base", ...SOURCE_ORDER] as const;
  return order
    .map((kind) => ({
      kind,
      size: parts
        .filter((part) => part.kind === kind)
        .reduce((total, part) => total + part.size, 0),
    }))
    .filter((part) => part.size > 0);
}
