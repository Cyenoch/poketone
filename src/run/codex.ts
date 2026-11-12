// The 图鉴 (encyclopedia): every entry is derived from the content registries, so new content shows
// up without touching this file, except where a mechanic has no player-facing words yet (skills,
// guardian brains, stations): those are typed records below, so a new id fails typecheck until it
// has its line. Pure data: no Three.js, no DOM. The GPU screen is `ui/gpu/codex.ts`.

import { abilities } from "./sim/content/abilities";
import { typeNames, type ElementType } from "./sim/content/elements";
import { atLevel, modifierText } from "./sim/content/effects";
import { resolveTrigger, triggerText } from "./sim/content/triggers";
import { enemies, type EnemyId } from "./sim/content/enemies";
import { fusionRecipes, signatureFusions } from "./sim/content/fusions";
import { itemIds, items, type ItemId, ruleText, type ItemRule } from "./sim/content/items";
import {
  lineForms,
  starterOrder,
  starters,
  type FormId,
  type StarterId,
} from "./sim/content/lines/index";
import { moves, type MoveDef, type MoveId } from "./sim/content/moves";
import { reactionIds, reactions, type ReactionId } from "./sim/content/reactions";
import { stageDefs } from "./sim/content/stages/index";
import { poiseOf } from "./sim/poise";
import { stationNames } from "./sim/content/stations";
import { statuses, statusIds, type StatusId, type StatusDef } from "./sim/content/statuses";
import type { GuardianBrainId } from "./sim/bosses/index";
import { CONTACT_SECONDS, DRAIN_FLOOR } from "./sim/content/params/combat";
import { difficulties } from "./sim/content/difficulties";
import { STRAFE, WEAVE } from "./sim/content/params/enemy-motion";
import {
  ACID,
  EGG,
  AURA,
  HEAL_PULSE,
  LANDING,
  HARDEN,
  FLAME_TRAIL,
  LUNGE,
  PECK,
  BONEMERANG,
  ROCKFALL,
  PSYBEAM,
  PSYBEAM_HEAVY,
  VINE,
  RADIAL,
  ENEMY_SHOTS,
  BUBBLE,
  SPORE,
  STUN_SPORE,
} from "./sim/content/params/enemy-skills";

import type { SkillId } from "./sim/skills/index";

import { FORGET } from "./sim/content/params/economy";
import type { StationKind } from "./sim/state/entities";
import { ultimates } from "./sim/content/ultimates";
import { describeRoll, rarityNames, statValue } from "./sim/upgrades";
import {
  MAX_FUSION_STARS,
  MAX_MOVE_LEVEL,
  rarityPower,
  TM_CASE,
  UPGRADE_BASE_DMG,
  SIGNATURE_GATES,
} from "./sim/content/params/cards";
import { labItems } from "./lab";
import { type LabId } from "./sim/content/lab";
import { archetypeNames, reactionNames } from "./labels";
import { labTerms } from "./glossary";

export type CodexSectionId = "pokemon" | "moves" | "items" | "stations" | "enemies" | "statuses";

/** What the screen draws as the entry's picture; it owns the file paths. */
export type CodexArt =
  | { kind: "portrait"; form: FormId }
  | { kind: "move"; move: MoveId }
  | { kind: "item"; item: ItemId | "tm-case" }
  | { kind: "lab"; lab: LabId }
  | { kind: "station"; station: StationKind }
  /** A still picture of the entry's `model`, for models with no drawn icon. */
  | { kind: "model" }
  /** No picture or model: a type-coloured plate with the entry's first character. */
  | { kind: "mark" };

/** A 3D model the screen can show and rotate; it owns the file paths and facing. */
export type CodexModel =
  | { kind: "form"; id: FormId }
  | { kind: "enemy"; id: EnemyId }
  | { kind: "station"; id: StationKind };

/** A link to another entry (`key`), or plain text when `key` is absent; `note` sits beside it. */
export interface CodexRef {
  key?: string;
  label?: string;
  note?: string;
}

export type CodexBlock =
  | { kind: "stats"; title: string; rows: readonly { label: string; value: string }[] }
  | { kind: "lines"; title: string; lines: readonly string[] }
  /** A move's level-ups: the fixed gain every level, and each stat's card roll at both rarity ends. */
  | {
      kind: "rolls";
      title: string;
      perLevel: { label: string; value: string };
      /** The lowest and highest card rarity (index into `rarityNames`). */
      ends: readonly [number, number];
      rows: readonly { label: string; low: string; high: string }[];
    }
  | { kind: "refs"; title: string; refs: readonly CodexRef[] };

export interface CodexEntry {
  /** `<section kind>:<content id>`, e.g. `move:ember`. */
  key: string;
  name: string;
  types: readonly ElementType[];
  /** Short facts shown as tags under the name. */
  tags: readonly string[];
  art: CodexArt;
  model?: CodexModel;
  /** One line, shown when another entry links here. */
  summary: string;
  blocks: readonly CodexBlock[];
}

export interface CodexGroup {
  title: string;
  entries: readonly CodexEntry[];
}

export interface CodexSection {
  id: CodexSectionId;
  name: string;
  groups: readonly CodexGroup[];
}

const number = (value: number) => String(Number(value.toFixed(2)));
const percent = (share: number) => `${Number((share * 100).toFixed(1))}%`;
const seconds = (value: number) => `${number(value)} 秒`;

export const formKey = (id: FormId) => `form:${id}`;
export const moveKey = (id: MoveId) => `move:${id}`;
export const itemKey = (id: ItemId | "tm-case") => `item:${id}`;
export const labKey = (id: LabId) => `lab:${id}`;
export const stationKey = (id: StationKind) => `station:${id}`;
export const enemyKey = (id: EnemyId) => `enemy:${id}`;
export const statusKey = (id: StatusId) => `status:${id}`;
export const reactionKey = (id: ReactionId) => `reaction:${id}`;

const moveIds = Object.keys(moves) as MoveId[];
const enemyIds = Object.keys(enemies) as EnemyId[];
const stationKinds = Object.keys(stationNames) as StationKind[];
const lines = starterOrder.map((id) => starters[id]);

// ── 宝可梦 ──────────────────────────────────────────────────────────────────

/** The line's stage numbers as "Lv.N" with what happens there. */
function stageNote(line: StarterId, stage: number): string {
  const step = starters[line].stages[stage]!;
  return stage === 0
    ? `Lv.${step.at}`
    : `Lv.${step.at} ${step.kind === "mature" ? "成熟" : "进化"}`;
}

function abilityRows(line: StarterId): { label: string; value: string }[] {
  const def = starters[line];
  const ability = abilities[def.ability];
  return def.stages.map((_, stage) => ({
    label: stageNote(line, stage),
    value: [
      ...ability.effect.modifiers.map((modifier) =>
        modifierText({ ...modifier, value: modifier.value[stage]! }),
      ),
      ...ability.effect.triggers.map((trigger) => triggerText(resolveTrigger(trigger, stage))),
    ].join("；"),
  }));
}

function formEntry(line: StarterId, form: FormId): CodexEntry {
  const def = starters[line];
  const forms = lineForms(line);
  const self = forms.find((candidate) => candidate.id === form)!;
  const ultimate = ultimates[def.ultimate];
  const fusion = signatureFusions[line];
  return {
    key: formKey(form),
    name: self.name,
    types: self.types,
    tags: [def.role],
    art: { kind: "portrait", form },
    model: { kind: "form", id: form },
    summary: `${self.types.map((type) => typeNames[type]).join(" / ")} · ${def.role}`,
    blocks: [
      {
        kind: "stats",
        title: "种族值",
        rows: [
          { label: "HP", value: number(self.hp) },
          { label: "移动速度", value: number(self.speed) },
          { label: "身高", value: `${number(self.height)} m` },
        ],
      },
      {
        kind: "refs",
        title: "进化",
        refs: def.stages.map((step, stage) =>
          step.kind === "evolve"
            ? { key: formKey(step.form.id), note: stageNote(line, stage) }
            : { label: "成熟", note: `Lv.${step.at}` },
        ),
      },
      { kind: "stats", title: `特性 · ${abilities[def.ability].name}`, rows: abilityRows(line) },
      {
        kind: "stats",
        title: `终极技 · ${typeNames[ultimate.type]}`,
        rows: ultimate.names.map((name, stage) => ({ label: stageNote(line, stage), value: name })),
      },
      {
        kind: "refs",
        title: "招牌招式",
        refs: def.kit.map((move, i) => ({
          key: moveKey(move),
          note: i === 0 ? "初始" : `Lv.${SIGNATURE_GATES[i]} 起`,
        })),
      },
      {
        kind: "refs",
        title: "进化招式",
        refs: def.evolutionMoves.map((move, i) => ({
          key: moveKey(move),
          note: `Lv.${def.stages[i + 1]!.at} 起`,
        })),
      },
      {
        kind: "refs",
        title: "融合",
        refs: [
          {
            key: moveKey(fusion.result),
            note: fusion.match.pair.map((move) => moves[move].name).join(" + "),
          },
        ],
      },
    ],
  };
}

// ── 招式 ────────────────────────────────────────────────────────────────────

function moveStats(move: MoveDef): { label: string; value: string }[] {
  const rows = [
    { label: "伤害", value: number(move.dmg) },
    { label: "冷却", value: seconds(move.cd) },
  ];
  if (move.count > 0) rows.push({ label: "数量", value: number(move.count) });
  rows.push({ label: "范围", value: number(move.area) });
  if (move.speed > 0) rows.push({ label: "速度", value: number(move.speed) });
  if (move.dur > 0) rows.push({ label: "持续", value: seconds(move.dur) });
  if (move.pierce > 0)
    rows.push({ label: "穿透", value: move.pierce >= 99 ? "全部" : number(move.pierce) });
  if (move.status)
    rows.push({ label: statuses[move.status].name, value: percent(move.statusChance) });
  if (move.drain) rows.push({ label: "吸取", value: percent(move.drain) });
  return rows;
}

/** Each stat a level-up card can roll, at the lowest and the highest card rarity. */
function upgradeRolls(move: MoveDef): { label: string; low: string; high: string }[] {
  // describeRoll reads "伤害 +15%": the stat, then its value.
  const roll = (stat: MoveDef["stats"][number], power: number) => {
    const text = describeRoll(stat, statValue(stat, power));
    const space = text.lastIndexOf(" ");
    return { label: text.slice(0, space), value: text.slice(space + 1) };
  };
  return move.stats.map((stat) => {
    const low = roll(stat, rarityPower[0]);
    return { label: low.label, low: low.value, high: roll(stat, rarityPower.at(-1)!).value };
  });
}

/** Who learns the move, and from when. */
function moveLearners(id: MoveId): CodexRef[] {
  const refs: CodexRef[] = [];
  for (const line of lines) {
    const first = formKey(line.stages[0].form.id);
    const kit = line.kit.indexOf(id);
    if (kit >= 0)
      refs.push({ key: first, note: kit === 0 ? "初始" : `Lv.${SIGNATURE_GATES[kit]} 起` });
    const evolution = line.evolutionMoves.indexOf(id);
    if (evolution >= 0) refs.push({ key: first, note: `Lv.${line.stages[evolution + 1]!.at} 起` });
  }
  return refs;
}

function moveEntry(id: MoveId): CodexEntry {
  const move = moves[id];
  const recipe = fusionRecipes.find((candidate) => candidate.result === id);
  const usedIn = fusionRecipes.filter((candidate) => candidate.match.pair.includes(id));
  const blocks: CodexBlock[] = [
    { kind: "stats", title: "数值", rows: moveStats(move) },
    {
      kind: "rolls",
      title: move.fusion ? `升级 · 最高 ★${MAX_FUSION_STARS}` : `升级 · 最高 Lv.${MAX_MOVE_LEVEL}`,
      perLevel: { label: "每级", value: `伤害 +${percent(UPGRADE_BASE_DMG)}` },
      ends: [0, rarityPower.length - 1],
      rows: upgradeRolls(move),
    },
  ];
  const learners = moveLearners(id);
  if (learners.length) blocks.push({ kind: "refs", title: "学会", refs: learners });
  if (recipe)
    blocks.push({
      kind: "refs",
      title: "融合配方",
      refs: [
        ...recipe.match.pair.map((move) => ({
          key: moveKey(move),
          note: `Lv.${MAX_MOVE_LEVEL}`,
        })),
        { key: stationKey("bill") },
      ],
    });
  if (usedIn.length)
    blocks.push({
      kind: "refs",
      title: "可融合为",
      refs: usedIn.map((candidate) => ({
        key: moveKey(candidate.result),
        note: `+ ${moves[candidate.match.pair.find((move) => move !== id)!].name}`,
      })),
    });
  if (move.status)
    blocks.push({
      kind: "refs",
      title: "附加状态",
      refs: [{ key: statusKey(move.status), note: percent(move.statusChance) }],
    });
  return {
    key: moveKey(id),
    name: move.name,
    types: [move.type],
    tags: [...new Set([archetypeNames[move.archetype], ...(move.fusion ? ["融合"] : [])])],
    art: { kind: "move", move: id },
    summary: `${typeNames[move.type]} · ${archetypeNames[move.archetype]} · 伤害 ${number(move.dmg)} / ${seconds(move.cd)}`,
    blocks,
  };
}

// ── 道具 ────────────────────────────────────────────────────────────────────

/** An item's effect at one level: its modifiers at that level, then its triggers. */
export function itemEffect(id: ItemId, level: number): string {
  const { effect, rules, onPick } = items[id];
  return [
    ...(onPick?.levels ? [`共升 ${onPick.levels * level} 级`] : []),
    ...(onPick?.roll ? [`随机强化 ${level} 项属性`] : []),
    ...effect.modifiers.map((modifier) =>
      modifierText({ ...modifier, value: atLevel(modifier.op, modifier.value, level) }),
    ),
    ...(effect.triggers ?? []).map((trigger) => triggerText(resolveTrigger(trigger, level - 1))),
    ...Object.entries(rules ?? {}).map(([rule, value]) =>
      ruleText(rule as ItemRule, value * level),
    ),
  ].join("，");
}

function itemEntry(id: ItemId): CodexEntry {
  const item = items[id];
  const rows = [{ label: "Lv.1", value: item.desc }];
  if (item.max > 1) rows.push({ label: `Lv.${item.max}`, value: itemEffect(id, item.max) });
  return {
    key: itemKey(id),
    name: item.name,
    types: item.boosts && item.boosts in typeNames ? [item.boosts as ElementType] : [],
    tags: [rarityNames[item.rarity], `最高 Lv.${item.max}`],
    art: { kind: "item", item: id },
    summary: item.desc,
    blocks: [{ kind: "stats", title: "效果", rows }],
  };
}

/** Items by card tier, rarest last; the TM case (chest-only) closes the 传说 group. */
function itemGroups(): CodexGroup[] {
  return rarityNames.map((title, rarity) => ({
    title,
    entries: [
      ...itemIds.filter((id) => items[id].rarity === rarity).map(itemEntry),
      ...(rarity === rarityNames.length - 1 ? [tmCaseEntry] : []),
    ],
  }));
}

const tmCaseEntry: CodexEntry = {
  key: itemKey("tm-case"),
  name: "招式学习器盒",
  types: [],
  tags: ["宝箱"],
  art: { kind: "item", item: "tm-case" },
  summary: `招式 Lv.${MAX_MOVE_LEVEL + TM_CASE.moveLevels}，融合 ★${MAX_FUSION_STARS + TM_CASE.stars}`,
  blocks: [
    {
      kind: "stats",
      title: "效果",
      rows: [
        {
          label: "招式上限",
          value: `Lv.${MAX_MOVE_LEVEL} → Lv.${MAX_MOVE_LEVEL + TM_CASE.moveLevels}`,
        },
        {
          label: "融合上限",
          value: `★${MAX_FUSION_STARS} → ★${MAX_FUSION_STARS + TM_CASE.stars}`,
        },
        { label: "出现", value: `宝箱卡，${percent(TM_CASE.chance)}` },
      ],
    },
  ],
};

function labEntry(item: (typeof labItems)[number]): CodexEntry {
  const rows = [
    { label: "每级", value: `${item.stat} ${item.value(item.per)}` },
    { label: `Lv.${item.max}`, value: `${item.stat} ${item.value(item.per * item.max)}` },
  ];
  const term = labTerms[item.id];
  return {
    key: labKey(item.id),
    name: item.name,
    types: [],
    tags: [`最高 Lv.${item.max}`],
    art: { kind: "lab", lab: item.id },
    summary: term ?? `${item.stat} ${item.value(item.per)}`,
    blocks: [
      { kind: "stats", title: "研究", rows },
      ...(term ? [{ kind: "lines" as const, title: "说明", lines: [term] }] : []),
    ],
  };
}

// ── 站点 ────────────────────────────────────────────────────────────────────

const stationText: Record<StationKind, { lines: string[]; refs: CodexRef[] }> = {
  hypno: {
    lines: [
      `忘记一个招式：每级 ${FORGET.move} 星星沙子（融合每星）`,
      `忘记一件道具：每级 ${FORGET.item} 星星沙子`,
    ],
    refs: [],
  },
  bill: {
    lines: [`两个招牌招式都到 Lv.${MAX_MOVE_LEVEL}，合成一个融合招式`, "每局一次"],
    refs: fusionRecipes.map((recipe) => ({ key: moveKey(recipe.result) })),
  },
};

function stationEntry(kind: StationKind): CodexEntry {
  const text = stationText[kind];
  return {
    key: stationKey(kind),
    name: stationNames[kind],
    types: [],
    tags: [],
    art: { kind: "station", station: kind },
    model: { kind: "station", id: kind },
    summary: text.lines[0]!,
    blocks: [
      { kind: "lines", title: "作用", lines: text.lines },
      ...(text.refs.length ? [{ kind: "refs" as const, title: "融合招式", refs: text.refs }] : []),
    ],
  };
}

// ── 敌人 ────────────────────────────────────────────────────────────────────

const lunge = (numbers: (typeof LUNGE)[keyof typeof LUNGE]) =>
  `预告 ${seconds(numbers.windup)}后沿直线冲出 ${number(numbers.speed * numbers.time)} 格`;
const shot = (numbers: (typeof ENEMY_SHOTS)[keyof typeof ENEMY_SHOTS]) =>
  `预告 ${seconds(numbers.windup)}后射出一发，伤害为接触的 ${percent(numbers.damage)}`;
const landing = (numbers: (typeof LANDING)[keyof typeof LANDING], opener: string) =>
  `${opener}，${seconds(numbers.windup + numbers.travel)}后砸中半径 ${number(numbers.radius)} 的圆圈`;
const radial = (numbers: (typeof RADIAL)[keyof typeof RADIAL]) =>
  `标出半径 ${number(numbers.radius)} 的圆圈，${seconds(numbers.windup)}后命中圈内，伤害为接触的 ${percent(numbers.damage)}`;

/** Player-facing names of the swarm's attacks (`sim/skills/`), with what they telegraph. */
const skillText: Record<SkillId, { name: string; desc: string; status?: StatusId }> = {
  trail: {
    name: "污泥足迹",
    desc: "移动时留下短暂毒池，绕开身后的污泥",
    status: "poison",
  },
  teleport: { name: "瞬间移动", desc: "靠近时隐去，在远处标记处出现，再预告并发射光线" },
  sing: { name: "唱歌", desc: radial(RADIAL.sing), status: "slow" },
  "sing-wide": { name: "唱歌", desc: radial(RADIAL["sing-wide"]), status: "slow" },
  "dragon-pulse": { name: "龙之波动", desc: radial(RADIAL["dragon-pulse"]) },
  icicle: { name: "冰锥", desc: shot(ENEMY_SHOTS.icicle), status: "slow" },
  flamethrower: { name: "喷射火焰", desc: shot(ENEMY_SHOTS.flamethrower) },
  "ice-beam": {
    name: "冰冻光束",
    desc: `预告 ${seconds(VINE.windup)}后射出 ${number(VINE.length)} 格长的冰束`,
    status: "slow",
  },
  "belly-slide": { name: "腹滑", desc: lunge(LUNGE["belly-slide"]) },
  "fire-punch": { name: "火焰拳", desc: `${lunge(LUNGE["fire-punch"])}，连续 3 次` },
  melt: { name: "溶化", desc: landing(LANDING.melt, "溶入地面") },
  "body-slam": { name: "泰山压顶", desc: landing(LANDING["body-slam"], "锁定落点") },
  "triple-burrow": {
    name: "三重钻地",
    desc: `${landing(LANDING["triple-burrow"], "潜入地下")}，周围另有两个落点`,
  },
  "fire-aura": { name: "燃烧光环", desc: `身边常驻火焰，伤害为接触的 ${percent(AURA.dmg)}` },
  dive: { name: "俯冲", desc: lunge(LUNGE.dive) },
  roll: { name: "滚动", desc: lunge(LUNGE.roll) },
  "flame-charge": { name: "蓄能焰袭", desc: lunge(LUNGE["flame-charge"]) },
  acid: {
    name: "溶解液",
    desc: `${seconds(ACID.flight)}后落在你站的位置，留下 ${seconds(ACID.poolLife)}的毒池`,
    status: "poison",
  },
  "stun-spore": {
    name: "麻痹粉",
    desc: `${seconds(STUN_SPORE.windup)}后放出半径 ${number(STUN_SPORE.radius)} 的孢子云，持续 ${seconds(STUN_SPORE.active)}`,
    status: "slow",
  },
  psybeam: {
    name: "幻象光线",
    desc: `预告 ${seconds(PSYBEAM.windup)}后射出 ${number(PSYBEAM.length)} 格长的光线`,
  },
  harden: {
    name: "变硬",
    desc: `预告 ${seconds(HARDEN.windup)}后 ${seconds(HARDEN.duration)}内受到的直接伤害 -${percent(1 - HARDEN.damage)}`,
  },
  "poison-sting": { name: "毒针", desc: shot(ENEMY_SHOTS["poison-sting"]), status: "poison" },
  ember: { name: "火花", desc: shot(ENEMY_SHOTS.ember) },
  discharge: { name: "放电", desc: radial(RADIAL.discharge) },
  "self-destruct": { name: "自爆", desc: radial(RADIAL["self-destruct"]) },
  spore: {
    name: "孢子",
    desc: `没有预告，慢速孢子（${number(SPORE.speed)} 格/秒）可以跑开或躲开`,
    status: "poison",
  },
  "poison-fan": {
    name: "毒针扇射",
    desc: `预告 ${seconds(ENEMY_SHOTS["poison-fan"].windup)}后扇形射出 ${ENEMY_SHOTS["poison-fan"].count} 发`,
    status: "poison",
  },
  "thunder-shock": { name: "电击", desc: shot(ENEMY_SHOTS["thunder-shock"]) },
  bubble: { name: "泡沫", desc: `没有预告，慢速泡沫（${number(BUBBLE.speed)} 格/秒）` },
  "bubble-burst": { name: "泡沫连射", desc: `没有预告，连射 ${BUBBLE.burst} 发慢速泡沫` },
  "egg-bomb": {
    name: "炸蛋",
    desc: `${seconds(EGG.flight)}后落在你站的位置，炸开半径 ${number(EGG.blast)} 的圆圈`,
  },
  "egg-barrage": { name: "炸蛋连投", desc: `一次投 3 颗，${seconds(EGG.flight)}后同时炸开` },
  "horn-attack": { name: "角撞", desc: lunge(LUNGE["horn-attack"]) },
  "vine-bind": {
    name: "藤鞭",
    desc: `预告 ${seconds(VINE.windup)}后抽出 ${number(VINE.length)} 格长的藤蔓`,
    status: "slow",
  },
  burrow: { name: "钻地", desc: landing(LANDING.burrow, "潜入地下") },
  "shadow-sneak": { name: "影子偷袭", desc: landing(LANDING["shadow-sneak"], "隐入地面") },
  leap: { name: "跳扑", desc: landing(LANDING.leap, "锁定落点") },
  "leap-heavy": { name: "飞扑", desc: landing(LANDING["leap-heavy"], "锁定落点") },
  aura: { name: "毒雾", desc: `身边常驻毒雾，伤害为接触的 ${percent(AURA.dmg)}`, status: "poison" },
  "heal-pulse": {
    name: "治愈波动",
    desc: `回复半径 ${number(HEAL_PULSE.radius)} 内其他敌人 ${percent(HEAL_PULSE.share)} 最大 HP`,
  },
  "double-peck": {
    name: "连啄",
    desc: `${lunge(LUNGE["double-peck"])}，连续 ${PECK["double-peck"].count} 次`,
  },
  "triple-peck": {
    name: "连啄",
    desc: `${lunge(LUNGE["triple-peck"])}，连续 ${PECK["triple-peck"].count} 次`,
  },
  "pay-day": { name: "聚宝功", desc: shot(ENEMY_SHOTS["pay-day"]) },
  bonemerang: {
    name: "骨头回力镖",
    desc: `预告 ${seconds(BONEMERANG.windup)}后掷出骨头，飞出 ${number(BONEMERANG.length)} 格再飞回，往返都会命中`,
  },
  "take-down": { name: "舍身冲撞", desc: lunge(LUNGE["take-down"]) },
  "high-jump-kick": { name: "飞膝踢", desc: landing(LANDING["high-jump-kick"], "锁定落点") },
  "horn-rush": { name: "角撞", desc: lunge(LUNGE["horn-rush"]) },
  dig: { name: "挖洞", desc: landing(LANDING.dig, "潜入地下") },
  "flame-trail": {
    name: "蓄能焰袭",
    desc: `${lunge(LUNGE["flame-trail"])}，路径燃烧 ${seconds(FLAME_TRAIL.life)}`,
  },
  "razor-dash": { name: "镰刀斩", desc: lunge(LUNGE["razor-dash"]) },
  "spike-cannon": {
    name: "尖刺加农炮",
    desc: `预告 ${seconds(ENEMY_SHOTS["spike-cannon"].windup)}后扇形射出 ${ENEMY_SHOTS["spike-cannon"].count} 发`,
  },
  rockfall: {
    name: "落石",
    desc: `在你脚下和周围标出 ${ROCKFALL.spots} 个圆圈，${seconds(ROCKFALL.windup)}后落石`,
  },
  "aqua-jet": { name: "水流喷射", desc: lunge(LUNGE["aqua-jet"]) },
  megahorn: { name: "超级角击", desc: `${lunge(LUNGE.megahorn)}，从水里冲向岸边` },
  "psybeam-heavy": {
    name: "幻象光线",
    desc: `预告 ${seconds(PSYBEAM_HEAVY.windup)}后射出 ${number(PSYBEAM_HEAVY.length)} 格长的粗光线`,
  },
  "water-gun": { name: "水枪", desc: shot(ENEMY_SHOTS["water-gun"]) },
  "pin-missile": {
    name: "飞弹针",
    desc: `预告 ${seconds(ENEMY_SHOTS["pin-missile"].windup)}后扇形射出 ${ENEMY_SHOTS["pin-missile"].count} 发`,
  },
  "discharge-wide": { name: "放电", desc: radial(RADIAL["discharge-wide"]) },
  "discharge-quick": { name: "放电", desc: radial(RADIAL["discharge-quick"]) },
  "dragon-rage": { name: "龙之怒", desc: radial(RADIAL["dragon-rage"]) },
};

const guardianText: Record<GuardianBrainId, string[]> = {
  "haunter-guardian": [
    "隐入地面，在你脚下预告后现身",
    "扇形发射暗影弹",
    "HP 低于一半后连续偷袭，现身后向四周散射",
  ],
  muk: [
    "移动时留下毒池，投掷污泥封住落点",
    "锁定你的位置后跃起砸下",
    "HP 低于一半后毒池更多，砸地后向四周溅射",
  ],
  "mr-mime": [
    "光墙向内收拢，沿缺口离开",
    "护盾期间减伤并发射光线",
    "HP 低于一半后出现两层缺口方向不同的光墙",
  ],
  golbat: [
    "会飞，越过墙壁追你",
    "预告扇形声波，命中后减速",
    "预告长带后俯冲，HP 低于一半后连续俯冲并散射",
  ],
  alakazam: [
    "瞬移落点先显示标记，之后预告三道扇形光线",
    "预知未来在你脚下留下延迟爆发的圆圈",
    "HP 低于一半后连续标记多个落点",
  ],
  "marowak-ghost": [
    "暗影骨头往返飞行，能够穿墙",
    "召唤追踪鬼火，碰到后消散",
    "HP 低于一半后骨头变为三道，近身时挥棒",
  ],
  gengar: [
    "扇形发射暗影球，隐入地面后在预告圈现身",
    "诅咒圈先跟随你，再停住并爆发",
    "HP 低于一半后连续偷袭，并增加诅咒圈",
  ],
  dewgong: [
    "预告直线后腹滑，路径留下暂时的滑冰带",
    "沿预告长带喷出冰冻光束",
    "HP 低于一半后连续腹滑，结束时接落冰",
  ],
  cloyster: ["扇形发射七枚冰锥", "闭壳时减伤，身边冰柱旋转", "HP 低于一半后闭壳同时在周围落冰"],
  lapras: [
    "扇形冰束和连续落冰交替",
    "HP 低于一半后冰束增加，身边出现减速冰雾",
    "低血量时唱歌，避开身边的预告圈",
  ],
  magmar: [
    "扇形喷出三道火焰",
    "潜入地面，从预告圈出现并留下燃烧地面",
    "HP 低于一半后现身时向四周喷火",
  ],
  arcanine: [
    "连续三次神速冲刺，每次重新预告",
    "在你周围落下带缺口的火焰环",
    "HP 低于一半后冲刺留下火焰，结束时接近身爆发",
  ],
  dragonite: [
    "破坏光线沿预告长带发射，之后停下喘息",
    "流星群依次落下，留下短暂燃烧地面",
    "HP 低于一半后增加扇形横扫光线",
  ],
  scyther: [
    "预告直线冲刺",
    `HP 低于一半后，冲刺后放出 ${difficulties[0].airSlashBlades} 道以上的空气斩`,
  ],
  pinsir: ["锁定你的位置后跳砸", "HP 低于一半后连跳 3 次，每次落地甩出碎石"],
  nidoking: [
    "朝你裂开 3 道地裂",
    "每第 2 次改为毒菱：落点留下毒池",
    "HP 低于一半后地裂变 5 道，并接践踏",
  ],
  sandslash: [
    "挖洞：潜入地下，从你脚下的圆圈破土",
    "滚动：预告直线后滚过来",
    "HP 低于一半后破土时向 6 个方向射出尖刺，并留下流沙",
  ],
  marowak: [
    "骨头回力镖：飞出再飞回，往返都会命中",
    "贴近时挥骨棒砸向身边的圆圈",
    "HP 低于一半后一次掷 2 根，骨棒后向四周掷出 6 根",
  ],
  aerodactyl: [
    "会飞，越过台地追你",
    "俯冲：预告长带后高速掠过，之后落地不动",
    "岩崩：在你身边落下 5 块落石",
    "HP 低于一半后连续俯冲 2 次，再接岩崩",
  ],
  kingler: [
    "蟹钳锤：贴近时砸向面前的圆圈",
    "泡沫光线：中距离扇形吐出 7 个慢速泡沫，边走边吐",
    "HP 低于一半后预告长带，连续横冲 2 次，再接蟹钳锤",
  ],
  gyarados: [
    "水陆两栖，能游过海湾追你",
    "水炮：预告宽带后喷出持续的水柱",
    "龙卷：身边升起 2 个漩涡，慢慢追向你，碰到就散",
    "HP 低于一半后水炮连发 3 道，每道重新瞄准",
  ],
  starmie: [
    "高速旋转：预告 3 段折线后沿折线滚过，之后原地晕眩",
    "十万伏特：在你脚下接连落下 4 个落雷圈，本体不停",
    "HP 低于一半后折线变 4 段，落雷变 6 个",
  ],
};

const enemyMoveText = {
  weave: `左右摇摆着逼近（最多偏 ${Math.round((WEAVE.amplitude * 180) / Math.PI)}°）`,
  strafe: `横着斜向逼近（偏 ${Math.round((STRAFE.angle * 180) / Math.PI)}°）`,
} as const;

/** Poise (sim/poise.ts) as one word: pushed around, holds its ground, barely moves. */
export function poiseWord(poise: number): "轻" | "稳" | "重" {
  return poise < 0.2 ? "轻" : poise < 0.5 ? "稳" : "重";
}

function enemyEntry(id: EnemyId): CodexEntry {
  const enemy = enemies[id];
  const guardian = guardianZones().find((zone) => zone.guardian.species === id);
  const skill = enemy.skill ? skillText[enemy.skill.kind] : undefined;
  const behaviour: string[] = [];
  if (guardian) behaviour.push(...guardianText[guardian.guardian.brain]);
  if (skill)
    behaviour.push(`${skill.name}：${skill.desc}`, `约每 ${seconds(enemy.skill!.every)}一次`);
  if (enemy.move) behaviour.push(enemyMoveText[enemy.move]);
  if (enemy.mobility.water === "swim") behaviour.push("只在水里游动，不上岸");
  const inflicts: CodexRef[] = [];
  if (enemy.contact)
    inflicts.push({
      key: statusKey(enemy.contact.status),
      note: `接触 ${seconds(CONTACT_SECONDS)}`,
    });
  if (skill?.status) inflicts.push({ key: statusKey(skill.status), note: skill.name });
  return {
    key: enemyKey(id),
    name: enemy.name,
    types: enemy.types,
    tags: guardian ? ["守卫"] : skill ? [skill.name] : [],
    art: { kind: "model" },
    model: { kind: "enemy", id },
    summary: `${enemy.types.map((type) => typeNames[type]).join(" / ")}${skill ? ` · ${skill.name}` : ""}`,
    blocks: [
      {
        kind: "stats",
        title: "数值",
        rows: [
          { label: "HP", value: number(enemy.hp) },
          { label: "接触伤害", value: number(enemy.dmg) },
          { label: "移动速度", value: number(enemy.speed) },
          { label: "韧性", value: poiseWord(poiseOf(enemy, false, Boolean(guardian))) },
          { label: "经验", value: number(enemy.xp) },
        ],
      },
      ...(behaviour.length ? [{ kind: "lines" as const, title: "行动", lines: behaviour }] : []),
      ...(inflicts.length ? [{ kind: "refs" as const, title: "造成状态", refs: inflicts }] : []),
    ],
  };
}

// ── 状态 / 反应 ──────────────────────────────────────────────────────────────

const carrierNames = { enemy: "敌人", player: "你", both: "敌人与你" } as const;

function statusLines(id: StatusId): string[] {
  const status: (typeof statuses)[StatusId] = statuses[id];
  const out: string[] = [];
  if ("dotShare" in status) out.push(`敌人每秒受到施加那一击 ${percent(status.dotShare)} 的伤害`);
  if ("drain" in status)
    out.push(`你每秒失去 ${number(status.drain.dps)} HP，越来越快，最低留 ${DRAIN_FLOOR} HP`);
  if ("move" in status) {
    const move = status.move;
    if (move.kind === "stop") out.push("无法移动");
    else if (move.kind === "factor") out.push(`移动速度 -${percent(1 - move.factor)}`);
    else out.push(`走走停停，移动时速度 -${percent(1 - move.factor)}`);
  }
  if ("blocksAttacks" in status) out.push("无法出招");
  if ("interrupts" in status) out.push("打断预告与冲刺，接触不造成伤害");
  if ("wakeBonus" in status) out.push(`下一次命中伤害 ×${number(status.wakeBonus)}，随后醒来`);
  if ("vulnerable" in status)
    out.push(
      status.vulnerable === "power"
        ? "受到的伤害增加（按施加的道具等级）"
        : `受到的伤害 +${percent(status.vulnerable)}`,
    );
  if ("builds" in status)
    out.push(
      `第 ${status.builds.count} 次施加变成${statuses[status.builds.into as StatusId].name}`,
    );
  if ("bossScale" in status) out.push(`守卫只持续 ${percent(status.bossScale)}`);
  out.push(
    status.stacking === "max-power" ? "重复施加：刷新时间，保留更强的一次" : "重复施加：刷新时间",
  );
  return out;
}

/** One link per entry; a second mention joins its note to the first ("接触 · 溶解液"). */
function mergeRefs(refs: readonly CodexRef[]): CodexRef[] {
  const out: CodexRef[] = [];
  for (const ref of refs) {
    const known = out.find((candidate) => candidate.key === ref.key);
    if (!known) out.push({ ...ref });
    else if (ref.note) known.note = known.note ? `${known.note} · ${ref.note}` : ref.note;
  }
  return out;
}

function statusEntry(id: StatusId): CodexEntry {
  const status = statuses[id];
  const appliers: CodexRef[] = [
    ...moveIds.filter((move) => moves[move].status === id).map((move) => ({ key: moveKey(move) })),
    ...enemyIds
      .filter((enemy) => enemies[enemy].contact?.status === id)
      .map((enemy) => ({ key: enemyKey(enemy), note: "接触" })),
    ...enemyIds
      .filter((enemy) => {
        const skill = enemies[enemy].skill;
        return skill !== undefined && skillText[skill.kind].status === id;
      })
      .map((enemy) => ({ key: enemyKey(enemy), note: skillText[enemies[enemy].skill!.kind].name })),
    ...lines.flatMap((line) =>
      abilities[line.ability].effect.triggers.some(
        (trigger) => "status" in trigger && trigger.status === id,
      )
        ? [{ key: formKey(line.stages[0].form.id), note: abilities[line.ability].name }]
        : [],
    ),
    ...statusIds.flatMap((other) => {
      const { builds }: StatusDef = statuses[other];
      return builds?.into === id ? [{ key: statusKey(other), note: `${builds.count} 层` }] : [];
    }),
    ...itemIds
      .filter((item) =>
        (items[item].effect.triggers ?? []).some(
          (trigger) =>
            ("status" in trigger && trigger.status === id) ||
            (trigger.kind === "markStrongest" && id === "marked"),
        ),
      )
      .map((item) => ({ key: itemKey(item) })),
  ];
  const primes = reactionIds.filter((reaction) => reactions[reaction].primed === id);
  return {
    key: statusKey(id),
    name: status.name,
    types: [],
    tags: [carrierNames[status.appliesTo], seconds(status.duration)],
    art: { kind: "mark" },
    summary: statusLines(id)[0]!,
    blocks: [
      { kind: "lines", title: "效果", lines: statusLines(id) },
      ...(appliers.length
        ? [{ kind: "refs" as const, title: "来源", refs: mergeRefs(appliers) }]
        : []),
      ...(primes.length
        ? [
            {
              kind: "refs" as const,
              title: "反应",
              refs: primes.map((r) => ({ key: reactionKey(r) })),
            },
          ]
        : []),
    ],
  };
}

function reactionLines(id: ReactionId): string[] {
  const reaction = reactions[id];
  const out: string[] = [];
  if (reaction.bonus > 0) out.push(`这一击伤害 +${percent(reaction.bonus)}`);
  const effect = reaction.effect;
  if (effect.kind === "splash")
    out.push(
      `半径 ${number(effect.radius)} 内至多 ${effect.limit} 个敌人受到 ${percent(effect.share)} 的伤害`,
    );
  else if (effect.kind === "detonate")
    out.push(
      `${statuses[reaction.primed].name}剩余的伤害立刻爆发`,
      `半径 ${number(effect.radius)} 内至多 ${effect.limit} 个敌人受到 ${percent(effect.share)} 的伤害`,
    );
  else
    out.push(
      `半径 ${number(effect.radius)} 内的敌人都${statuses[reaction.primed].name} ${seconds(effect.time)}`,
    );
  out.push(
    reaction.consume
      ? `消耗${statuses[reaction.primed].name}`
      : `保留${statuses[reaction.primed].name}`,
  );
  return out;
}

function reactionEntry(id: ReactionId): CodexEntry {
  const reaction = reactions[id];
  const trigger = `${typeNames[reaction.trigger]}属性命中`;
  return {
    key: reactionKey(id),
    name: reactionNames[id],
    types: [reaction.trigger],
    tags: [`${statuses[reaction.primed].name} + ${typeNames[reaction.trigger]}`],
    art: { kind: "mark" },
    summary: `${statuses[reaction.primed].name}的敌人被${trigger}`,
    blocks: [
      {
        kind: "refs",
        title: "触发",
        refs: [{ key: statusKey(reaction.primed), note: `的敌人被${trigger}` }],
      },
      { kind: "lines", title: "效果", lines: reactionLines(id) },
      {
        kind: "refs",
        title: `${typeNames[reaction.trigger]}属性招式`,
        refs: moveIds
          .filter((move) => moves[move].type === reaction.trigger)
          .map((move) => ({ key: moveKey(move) })),
      },
    ],
  };
}

// ── Sections ────────────────────────────────────────────────────────────────

function pokemonGroups(): CodexGroup[] {
  return lines.map((line) => ({
    title: `${line.stages[0].form.name}系`,
    entries: lineForms(line.id).map((form) => formEntry(line.id, form.id)),
  }));
}

function moveGroups(): CodexGroup[] {
  const placed = new Set<MoveId>();
  const groups: CodexGroup[] = lines.map((line) => {
    const ids = [...line.kit, ...line.evolutionMoves].filter((id) => !placed.has(id));
    for (const id of ids) placed.add(id);
    return { title: `${line.stages[0].form.name}系`, entries: ids.map(moveEntry) };
  });
  const fusion = moveIds.filter((id) => moves[id].fusion && !placed.has(id));
  const other = moveIds.filter((id) => !moves[id].fusion && !placed.has(id));
  if (fusion.length) groups.push({ title: "融合招式", entries: fusion.map(moveEntry) });
  if (other.length) groups.push({ title: "其他", entries: other.map(moveEntry) });
  return groups;
}

/** Every stage's zones, in table order: a guardian's entry describes it as its first zone does. */
function guardianZones() {
  return Object.values(stageDefs).flatMap((stage) => stage.zones);
}

function enemyGroups(): CodexGroup[] {
  const guardians = new Set(guardianZones().map((zone) => zone.guardian.species));
  const swarm = enemyIds.filter((id) => !guardians.has(id));
  return [
    { title: "守卫", entries: [...guardians].map(enemyEntry) },
    { title: "野生", entries: swarm.map(enemyEntry) },
  ];
}

let cached: readonly CodexSection[] | undefined;

/** Every section of the 图鉴, built once (content is static for the application's lifetime). */
export function codexSections(): readonly CodexSection[] {
  cached ??= [
    { id: "pokemon", name: "宝可梦", groups: pokemonGroups() },
    { id: "moves", name: "招式", groups: moveGroups() },
    {
      id: "items",
      name: "道具",
      groups: [...itemGroups(), { title: "研究所", entries: labItems.map(labEntry) }],
    },
    {
      id: "stations",
      name: "站点",
      groups: [{ title: "站点", entries: stationKinds.map(stationEntry) }],
    },
    { id: "enemies", name: "敌人", groups: enemyGroups() },
    {
      id: "statuses",
      name: "状态",
      groups: [
        { title: "状态", entries: statusIds.map(statusEntry) },
        { title: "反应", entries: reactionIds.map(reactionEntry) },
      ],
    },
  ];
  return cached;
}

/** The entry for `key` and the section it is in. */
export function codexEntry(key: string): { section: CodexSection; entry: CodexEntry } | undefined {
  for (const section of codexSections())
    for (const group of section.groups)
      for (const entry of group.entries) if (entry.key === key) return { section, entry };
  return undefined;
}
