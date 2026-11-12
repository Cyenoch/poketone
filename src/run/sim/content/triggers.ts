// Trigger data: what an ability or item does at a fixed point of a run, beyond changing a stat. The
// rules live in `sim/triggers/` (one module per kind), the balance model in `balance/triggers.ts`;
// both are `Record<TriggerKind, …>`, so a new kind does not compile until it has a rule and a model.

import { modifierText, type Condition, type ModifierDef, type StatId } from "./effects";
import { typeNames, type ElementType } from "./elements";
import { statuses, type EnemyStatusId } from "./statuses";
import type { UltLook } from "../state/events";

/**
 * A number that grows with its source: one value, or one per step — `Player.stage` for an ability,
 * item level − 1 for an item (`resolveTrigger`).
 */
export type Scaled = number | readonly number[];

/** What a `scaling` trigger reads off the player (sim/triggers/scaling.ts). */
export type Measure =
  /** Kills this run. */
  | "kills"
  /** Kills in the current streak (each within `STREAK_GAP` seconds of the last). */
  | "streak"
  /** Seconds since the last hit that landed on the player. */
  | "unhurt"
  /** Movement speed over the form's own, as a share (+0.1 = 10% faster). */
  | "speed"
  | "armor"
  /** Share of max HP missing. */
  | "missingHp";

/** Where a `strike` lands: the nearest enemy, the one with the most HP, a random one, or the player. */
export type StrikeTarget = "nearest" | "strongest" | "random" | "self";

/** What starts a `buff`: a hit landing on the player, standing still, the ultimate firing, a dash. */
export type BuffCue = "hurt" | "still" | "ult" | "dash";

export type TriggerDef =
  /** A hit of `type` heals this share of max HP, at most `perSecond` times a second (Photosynthesis). */
  | { kind: "healOnHit"; type: ElementType; heal: Scaled; perSecond: number }
  /** The thorns hit an enemy takes for touching the player lands as `type` with `status` (Static). */
  | { kind: "contactStatus"; type: ElementType; status: EnemyStatusId }
  /** Every `seconds`, a `dmg` hit of `type` with `status` on the nearest enemy within `range` (Static). */
  | {
      kind: "zap";
      seconds: Scaled;
      dmg: Scaled;
      range: number;
      type: ElementType;
      status: EnemyStatusId;
    }
  /** Below `below` of max HP, heal `heal` of it, then wait `cooldown` seconds (sitrus berry). */
  | { kind: "healBelow"; below: Scaled; heal: Scaled; cooldown: Scaled }
  /** Every `every` seconds, heal `heal` of max HP if not full (lum berry). */
  | { kind: "healEvery"; every: Scaled; heal: Scaled }
  /** Each kill heals `heal` of max HP at `chance` (berry juice). */
  | { kind: "healOnKill"; chance: Scaled; heal: Scaled }
  /** A direct hit inflicts `status` at `chance` × the status-chance stat; "flinch" staggers (sim/poise.ts). */
  | { kind: "inflictOnHit"; status: EnemyStatusId | "flinch"; chance: Scaled }
  /** A hit deals × `mult` at `chance` (Stick's Bonk!). */
  | { kind: "bonk"; chance: Scaled; mult: Scaled }
  /** A hit that leaves a non-guardian below `below` of its max HP finishes it (Razor Fang). */
  | { kind: "execute"; below: Scaled }
  /** A crit sends a `dmg` bolt of `type` to another enemy within `range`, at most `perSecond` a second. */
  | {
      kind: "critStrike";
      range: number;
      perSecond: number;
      dmg: Scaled;
      type: ElementType;
      status: EnemyStatusId;
      statusChance: Scaled;
    }
  /** A kill (of an enemy carrying one of `requires`, if set) bursts at `chance`: a `dmg` area of `type`. */
  | {
      kind: "burstOnKill";
      chance: Scaled;
      requires?: readonly EnemyStatusId[];
      radius: Scaled;
      dmg: Scaled;
      type: ElementType;
      status?: EnemyStatusId;
      statusChance: Scaled;
      /** Share of max HP the owner heals per burst. */
      heal?: Scaled;
      look: UltLook;
    }
  /** Every `every` seconds, `count` strikes on `target` enemies within `range`: a `dmg` area of `type`. */
  | {
      kind: "strike";
      every: Scaled;
      target: StrikeTarget;
      count: Scaled;
      range: number;
      radius: Scaled;
      dmg: Scaled;
      type: ElementType;
      status?: EnemyStatusId;
      statusChance: Scaled;
      /** A strike is × `jackpotMult` at this chance (Old Rod's Gyarados). */
      jackpot?: Scaled;
      jackpotMult?: number;
      /** Knockback from the strike's centre (Silver Wing's gust). */
      knock?: number;
      look: UltLook;
    }
  /**
   * On `on`, at `chance` (once per `cooldown` seconds): `mods` for `seconds` (× `power`, by level), and
   * optionally i-frames and a cooldown reset. "still" holds while the player stands still past `delay`.
   */
  | {
      kind: "buff";
      on: BuffCue;
      chance: Scaled;
      cooldown: Scaled;
      seconds: Scaled;
      delay?: number;
      mods: readonly ModifierDef<number>[];
      power: Scaled;
      iframes?: Scaled;
      resetCooldowns?: true;
    }
  /** When a hit lands on the player (once per `cooldown`): enemies within `radius` get `status` for `seconds`. */
  | {
      kind: "statusOnHurt";
      cooldown: Scaled;
      radius: Scaled;
      status: EnemyStatusId;
      seconds: Scaled;
    }
  /**
   * A hit that would knock the player out leaves them at `hp` of max HP (0: 1 HP) instead, at `chance`,
   * at most `uses` times per run or per stage, and once per `cooldown`; optionally with i-frames and a
   * burst around them on the next tick (Rainbow Wing).
   */
  | {
      kind: "lethalSave";
      chance: Scaled;
      cooldown: Scaled;
      uses: Scaled;
      per: "run" | "stage";
      hp: Scaled;
      iframes: Scaled;
      burst?: {
        radius: number;
        dmg: number;
        type: ElementType;
        status: EnemyStatusId;
        knock: number;
        look: UltLook;
      };
    }
  /** A dash's `at` (start or end) bursts around the player; damage grows by `armorScale` × armor (Iron Ball). */
  | {
      kind: "dashBurst";
      at: "start" | "end";
      radius: Scaled;
      dmg: Scaled;
      armorScale?: number;
      type: ElementType;
      status?: EnemyStatusId;
      statusChance: Scaled;
      knock: number;
      look: UltLook;
    }
  /** Overheal is stored (up to `cap` of max HP); every `every` seconds the store shoots the nearest enemy. */
  | {
      kind: "overhealStore";
      cap: Scaled;
      every: number;
      range: number;
      /** Damage per HP stored. */
      perHp: Scaled;
      type: ElementType;
      status: EnemyStatusId;
    }
  /** Overheal tops up the shield (Enigma Berry). */
  | { kind: "overhealShield" }
  /** The next hit that lands is blocked whole, then the guard takes `every` seconds to return (Guard Spec). */
  | { kind: "block"; every: Scaled }
  /** Every `every` seconds, marks the enemy with the most HP within `range`: it takes + `bonus` damage. */
  | { kind: "markStrongest"; every: Scaled; range: number; bonus: Scaled }
  /** Every `every` seconds, enemies within `range` carrying `status` pass it on at `share` of its power. */
  | {
      kind: "spreadStatus";
      every: number;
      status: EnemyStatusId;
      range: number;
      radius: number;
      share: Scaled;
      count: Scaled;
    }
  /** The thorns hit lands on every enemy within `radius` of the player, with `status` (Sticky Barb). */
  | { kind: "contactSpread"; radius: Scaled; status: EnemyStatusId }
  /** A modifier that grows with a `measure` of the player: `per` per unit, at most `cap` (Metronome…). */
  | { kind: "scaling"; measure: Measure; stat: StatId; when?: Condition; per: Scaled; cap: Scaled };

export type TriggerKind = TriggerDef["kind"];

/** A trigger with every `Scaled` field taken at one step (optional ones stay optional). */
export type Resolved<T> = {
  [K in keyof T]: [Exclude<T[K], undefined>] extends [Scaled]
    ? number | Extract<T[K], undefined>
    : T[K];
};
export type ResolvedTrigger = {
  [K in TriggerKind]: Resolved<Extract<TriggerDef, { kind: K }>>;
}[TriggerKind];

/** A per-step number list (not a list of ids such as `requires`). */
export const isScaledList = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && typeof value[0] === "number";

/**
 * The value at `step`. Lists cover every step a source normally reaches (items.ts checks one per level
 * at load); levels past it (Max Ether's +2) keep the last value.
 */
function at(value: Scaled, step: number): number {
  if (typeof value === "number") return value;
  const picked = value[Math.min(step, value.length - 1)];
  if (picked === undefined) throw new RangeError("触发器数值列表是空的。");
  return picked;
}

export function resolveTrigger(def: TriggerDef, step: number): ResolvedTrigger {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(def))
    out[key] = typeof value === "number" || isScaledList(value) ? at(value, step) : value;
  return out as ResolvedTrigger;
}

/** One unit of each measure as cards state it: per 100 kills, per 10 in a streak, per 2 armor… */
const measureUnits: Record<Measure, { size: number; text: (size: number) => string }> = {
  kills: { size: 100, text: (n) => `本局每击倒 ${n} 个，` },
  streak: { size: 10, text: (n) => `连续击倒每 ${n} 个，` },
  unhurt: { size: 1, text: () => "未受伤每秒，" },
  speed: { size: 0.02, text: (n) => `移动速度每高 ${percent(n)}，` },
  armor: { size: 2, text: (n) => `护甲每 ${n} 点，` },
  missingHp: { size: 0.1, text: (n) => `每损失 ${percent(n)} HP，` },
};

/** The value a `scaling` trigger adds for `amount` of its measure: `per` each, capped at `cap` (signed). */
export function scaled(trigger: { per: number; cap: number }, amount: number): number {
  const value = trigger.per * amount;
  return Math.sign(value) * Math.min(Math.abs(value), Math.abs(trigger.cap));
}

const number = (value: number) => String(Number(value.toFixed(1)));
const percent = (share: number) => `${number(share * 100)}%`;
const inflicted = (status: EnemyStatusId | "flinch") =>
  status === "flinch" ? "畏缩" : statuses[status].name;

/** A buff's modifier at `power` × its listed value (a `mul` scales its distance from 1). */
export function boosted(mod: ModifierDef<number>, power: number): ModifierDef<number> {
  const value =
    mod.op === "mul" || mod.op === "div" ? 1 + (mod.value - 1) * power : mod.value * power;
  return { ...mod, value };
}

/** "，灼伤" / "，30% 麻痹" for a proc that inflicts a status. */
function afflicts(trigger: { status?: EnemyStatusId; statusChance: number }): string {
  if (!trigger.status || trigger.statusChance <= 0) return "";
  const odds = trigger.statusChance < 1 ? `${percent(trigger.statusChance)} ` : "";
  return `，${odds}${statuses[trigger.status].name}`;
}

export function triggerText(trigger: ResolvedTrigger): string {
  switch (trigger.kind) {
    case "healOnHit":
      return `${typeNames[trigger.type]}属性命中回复 ${percent(trigger.heal)} HP（每秒至多 ${trigger.perSecond} 次）`;
    case "contactStatus":
      return `接触你的敌人会${statuses[trigger.status].name}`;
    case "zap":
      return `每 ${number(trigger.seconds)} 秒${typeNames[trigger.type]}击附近一名敌人（${number(trigger.dmg)} 伤害）`;
    case "healBelow":
      return `HP 低于 ${percent(trigger.below)} 时回复 ${percent(trigger.heal)}（每 ${number(trigger.cooldown)} 秒一次）`;
    case "healEvery":
      return `每 ${number(trigger.every)} 秒回复 ${percent(trigger.heal)} HP`;
    case "healOnKill":
      return `击倒时 ${percent(trigger.chance)} 几率回复 ${percent(trigger.heal)} HP`;
    case "inflictOnHit":
      return `命中 ${percent(trigger.chance)} 几率${inflicted(trigger.status)}`;
    case "bonk":
      return `命中 ${percent(trigger.chance)} 几率伤害 ×${number(trigger.mult)}`;
    case "execute":
      return `HP 低于 ${percent(trigger.below)} 的敌人（首领除外）直接击倒`;
    case "critStrike":
      return `会心时${typeNames[trigger.type]}击另一名敌人（${number(trigger.dmg)} 伤害${afflicts(trigger)}，每秒至多 ${trigger.perSecond} 次）`;
    case "burstOnKill": {
      const victim = trigger.requires
        ? `${trigger.requires.map((id) => statuses[id].name).join(" / ")}的敌人倒下时`
        : "击倒时";
      const odds = trigger.chance < 1 ? ` ${percent(trigger.chance)} 几率` : "";
      const heal = trigger.heal ? `，回复 ${percent(trigger.heal)} HP` : "";
      return `${victim}${odds}爆开（${typeNames[trigger.type]}，${number(trigger.dmg)} 伤害${afflicts(trigger)}${heal}）`;
    }
    case "strike": {
      if (trigger.target === "self")
        return `每 ${number(trigger.every)} 秒一阵${typeNames[trigger.type]}属性冲击推开 ${number(trigger.radius)} 米内的敌人`;
      const who = { nearest: "附近", strongest: "附近 HP 最多的", random: "附近" }[trigger.target];
      const n = trigger.count > 1 ? ` ${trigger.count} 名` : "一名";
      return `每 ${number(trigger.every)} 秒${typeNames[trigger.type]}击${who}${n}敌人（${number(trigger.dmg)} 伤害${afflicts(trigger)}）`;
    }
    case "markStrongest":
      return `每 ${number(trigger.every)} 秒标记附近 HP 最多的敌人，它受到的伤害 +${percent(trigger.bonus)}`;
    case "spreadStatus":
      return `附近${statuses[trigger.status].name}的敌人传给身边 ${trigger.count} 名敌人（${percent(trigger.share)} 强度）`;
    case "contactSpread":
      return `接触反伤打到周围所有敌人并${statuses[trigger.status].name}`;
    case "buff": {
      const when = {
        hurt: "受到攻击时",
        still: `站定 ${number(trigger.delay ?? 0)} 秒后`,
        ult: "发动终极技时",
        dash: "冲刺时",
      }[trigger.on];
      const odds = trigger.chance < 1 ? ` ${percent(trigger.chance)} 几率` : "";
      const parts = [
        ...(trigger.resetCooldowns ? ["招式冷却清零"] : []),
        ...(trigger.iframes ? [`无敌 ${number(trigger.iframes)} 秒`] : []),
        ...trigger.mods.map((m) => modifierText(boosted(m, trigger.power))),
      ];
      const span =
        trigger.on === "still"
          ? "（移动即失效）"
          : trigger.mods.length
            ? `，持续 ${number(trigger.seconds)} 秒`
            : "";
      const rest = trigger.cooldown > 0 ? `（每 ${number(trigger.cooldown)} 秒一次）` : "";
      return `${when}${odds}${parts.join("，")}${span}${rest}`;
    }
    case "statusOnHurt":
      return `受到攻击时，${number(trigger.radius)} 米内的敌人${statuses[trigger.status].name} ${number(trigger.seconds)} 秒（每 ${number(trigger.cooldown)} 秒一次）`;
    case "lethalSave": {
      const odds = trigger.chance < 1 ? ` ${percent(trigger.chance)} 几率` : "";
      const left = trigger.hp > 0 ? `以 ${percent(trigger.hp)} HP 复活` : "以 1 HP 撑住";
      const times = trigger.per === "stage" ? "每个进化阶段一次" : `每局 ${trigger.uses} 次`;
      const rest = trigger.cooldown > 0 ? `，每 ${number(trigger.cooldown)} 秒一次` : `，${times}`;
      return `倒下时${odds}${left}${rest}${trigger.burst ? `，并灼烧周围的敌人` : ""}`;
    }
    case "dashBurst": {
      const at = trigger.at === "start" ? "冲刺时" : "冲刺结束时";
      const armor = trigger.armorScale ? "，随护甲增长" : "";
      return `${at}${typeNames[trigger.type]}属性冲击（${number(trigger.dmg)} 伤害${armor}${afflicts(trigger)}）`;
    }
    case "overhealStore":
      return `满血时溢出的治疗储存起来（至多 ${percent(trigger.cap)} HP），每 ${number(trigger.every)} 秒射向附近的敌人`;
    case "overhealShield":
      return "溢出的治疗补充护盾";
    case "block":
      return `每 ${number(trigger.every)} 秒完全挡下一次攻击`;
    case "scaling": {
      const unit = measureUnits[trigger.measure];
      const step = modifierText({
        stat: trigger.stat,
        op: "add",
        value: trigger.per * unit.size,
        when: trigger.when,
      });
      const cap = modifierText({ stat: trigger.stat, op: "add", value: trigger.cap });
      return `${unit.text(unit.size)}${step}（至多 ${cap.slice(cap.lastIndexOf(" ") + 1)}）`;
    }
  }
}
