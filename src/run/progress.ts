import { items, type ItemId } from "./sim/content/items";
import { starterOrder, type StarterId } from "./sim/content/lines/index";
import type { Difficulty } from "./sim/content/difficulties";
import { labDefinitions, type LabId, type LabLevels } from "./sim/content/lab";
import {
  BACKPACK_BASE,
  starterUnlocks,
  type StarterUnlock,
} from "./sim/content/params/progression";
import type { RunResult } from "./createRun";
import { labItem, metaBonuses, nextCost } from "./lab";
import { enemies, type EnemyId } from "./sim/content/enemies";
import { isTrainerId, type TrainerId } from "../trainers";
import { parseProgressV4, type ProgressV4 } from "./progress-v4";

export const PROGRESS_STORAGE_KEY = "poketone.progress.v4";

export interface BestRecord {
  difficulty: Difficulty;
  victory: boolean;
  time: number;
  kills: number;
}

export interface Progress {
  version: 5;
  runs: number;
  /** Clears per difficulty tier; clearing a tier unlocks the next. */
  clears: [number, number, number];
  best: Partial<Record<StarterId, BestRecord>>;
  /** Lifetime kills over every run. */
  kills: number;
  /** Unlock-challenge progress: kills × (1 + 研究), toward research `starterUnlocks`. */
  research: number;
  /** Banked 星星沙子 and bought lab levels. */
  stardust: number;
  lab: LabLevels;
  /** 档案库: items never offered in a run (at most `archiveSlots`). */
  archive: ItemId[];
  /** 背包: items the next run starts with at level 1 (at most `backpackSlots`); emptied when it starts. */
  backpack: ItemId[];
  dex: Partial<Record<EnemyId, { seen: number; defeated: number; shiny: number }>>;
  looks: { owned: StarterId[]; worn: StarterId[] };
  badges: string[];
  rules: string[];
  unlocks: string[];
  bonds: Partial<Record<StarterId, number>>;
  tower: Partial<Record<StarterId, { floor: number; difficulty: Difficulty }>>;
  seeds: SeedRecord[];
}

export interface SeedRecord {
  code: string;
  starter: StarterId;
  trainer: TrainerId;
  result: "victory" | "defeat";
  time: number;
  kills: number;
  floor?: number;
}

/** Partners cleared with at `difficulty` or above (`best` keeps a partner's hardest victory). */
export function distinctClears(progress: Progress, difficulty: Difficulty): number {
  return Object.values(progress.best).filter((b) => b.victory && b.difficulty >= difficulty).length;
}

/** How far a partner's condition is met: `have` of `need` (a clear counts 0 or 1). */
export function starterUnlockProgress(
  progress: Progress,
  unlock: StarterUnlock,
): { have: number; need: number } {
  switch (unlock.kind) {
    case "research":
      return { have: progress.research, need: unlock.points };
    case "clear":
      return { have: Math.min(1, progress.clears[unlock.difficulty]), need: 1 };
    case "distinctClears":
      return { have: distinctClears(progress, unlock.difficulty), need: unlock.count };
  }
}

export function starterUnlocked(progress: Progress, starter: StarterId): boolean {
  const unlock = starterUnlocks[starter];
  if (!unlock) return true;
  const { have, need } = starterUnlockProgress(progress, unlock);
  return have >= need;
}

export function archiveSlots(progress: Progress): number {
  return metaBonuses(progress.lab).archive;
}

export function backpackSlots(progress: Progress): number {
  return BACKPACK_BASE + metaBonuses(progress.lab).backpack;
}

export type ProgressLoad =
  | { status: "ready"; progress: Progress; needsSave: boolean }
  /** Unreadable or future-version data is kept untouched; this session plays without saving. */
  | { status: "locked"; progress: Progress; message: string };

export function emptyProgress(): Progress {
  return {
    version: 5,
    runs: 0,
    clears: [0, 0, 0],
    best: {},
    kills: 0,
    research: 0,
    stardust: 0,
    lab: {},
    archive: [],
    backpack: [],
    dex: {},
    looks: { owned: [], worn: [] },
    badges: [],
    rules: [],
    unlocks: [],
    bonds: {},
    tower: {},
    seeds: [],
  };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Pure upgrade of an already validated released record. */
export function upgradeProgressV4(progress: ProgressV4): Progress {
  return { ...emptyProgress(), ...structuredClone(progress), version: 5 };
}

/** Validates stored or imported progress (a trust boundary). */
export function parseProgress(value: unknown): Progress {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("记录不是对象。");
  const record = value as Partial<Omit<Progress, "version">> & { version?: unknown };
  if (record.version === 4) return upgradeProgressV4(parseProgressV4(value));
  if (record.version !== 5) throw new Error("记录版本不受支持。");
  const fields = emptyProgress();
  if (Object.keys(record).some((key) => !Object.hasOwn(fields, key)))
    throw new Error("记录字段不受支持。");
  if (
    !isCount(record.runs) ||
    !Array.isArray(record.clears) ||
    record.clears.length !== 3 ||
    !Array.from(record.clears).every(isCount)
  ) {
    throw new Error("记录内容不完整。");
  }
  if (
    typeof record.best !== "object" ||
    record.best === null ||
    Array.isArray(record.best) ||
    Object.keys(record.best).some((id) => !starterOrder.includes(id as StarterId))
  )
    throw new Error("最佳记录无效。");
  const best: Progress["best"] = {};
  for (const id of starterOrder) {
    const entry = record.best[id];
    if (!Object.hasOwn(record.best, id)) continue;
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !["difficulty", "victory", "time", "kills"].includes(key))
    )
      throw new Error("最佳记录无效。");
    const b = entry as Partial<BestRecord>;
    if (
      (b.difficulty !== 0 && b.difficulty !== 1 && b.difficulty !== 2) ||
      typeof b.victory !== "boolean" ||
      typeof b.time !== "number" ||
      !Number.isFinite(b.time) ||
      b.time < 0 ||
      !isCount(b.kills)
    ) {
      throw new Error("最佳记录无效。");
    }
    best[id] = { difficulty: b.difficulty, victory: b.victory, time: b.time, kills: b.kills };
  }
  if (!isCount(record.kills) || !isCount(record.research) || !isCount(record.stardust))
    throw new Error("星星沙子或击倒数无效。");
  if (typeof record.lab !== "object" || record.lab === null || Array.isArray(record.lab))
    throw new Error("研究所记录无效。");
  const lab: LabLevels = {};
  for (const [id, level] of Object.entries(record.lab)) {
    const item = labDefinitions.find((candidate) => candidate.id === id);
    if (!item || !isCount(level) || level > item.max) {
      console.error("研究所等级无效", id, level);
      throw new Error("研究所等级无效。");
    }
    lab[item.id] = level;
  }
  const dex: Progress["dex"] = {};
  for (const [id, value] of Object.entries(objectRecord(record.dex, "图鉴"))) {
    if (!Object.hasOwn(enemies, id)) throw new Error(`图鉴物种无效（${id}）。`);
    const entry = objectRecord(value, `图鉴 ${id}`, ["seen", "defeated", "shiny"]);
    if (!isCount(entry.seen) || !isCount(entry.defeated) || !isCount(entry.shiny))
      throw new Error(`图鉴计数无效（${id}）。`);
    dex[id as EnemyId] = { seen: entry.seen, defeated: entry.defeated, shiny: entry.shiny };
  }
  const looks = objectRecord(record.looks, "异色外观", ["owned", "worn"]);
  const owned = starterList(looks.owned, "拥有的异色外观");
  const worn = starterList(looks.worn, "穿戴的异色外观");
  if (worn.some((id) => !owned.includes(id))) throw new Error("未拥有的异色外观不能穿戴。");
  // shortcut: these content tables land in their feature changes; until then only empty sets exist.
  for (const field of ["badges", "rules", "unlocks"] as const) {
    if (!Array.isArray(record[field]) || record[field].length !== 0)
      throw new Error(`${field} 记录含未知 ID 或格式无效。`);
  }
  const bonds: Progress["bonds"] = {};
  for (const [id, points] of Object.entries(objectRecord(record.bonds, "伙伴羁绊"))) {
    if (!starterOrder.includes(id as StarterId) || !isCount(points))
      throw new Error(`伙伴羁绊无效（${id}）。`);
    bonds[id as StarterId] = points;
  }
  const tower: Progress["tower"] = {};
  for (const [id, value] of Object.entries(objectRecord(record.tower, "对战塔"))) {
    const entry = objectRecord(value, `对战塔 ${id}`, ["floor", "difficulty"]);
    if (
      !starterOrder.includes(id as StarterId) ||
      !isCount(entry.floor) ||
      (entry.difficulty !== 0 && entry.difficulty !== 1 && entry.difficulty !== 2)
    )
      throw new Error(`对战塔记录无效（${id}）。`);
    tower[id as StarterId] = { floor: entry.floor, difficulty: entry.difficulty };
  }
  if (!Array.isArray(record.seeds) || record.seeds.length > 20)
    throw new Error("种子码成绩记录无效。");
  const seeds = Array.from(record.seeds, (value): SeedRecord => {
    const entry = objectRecord(value, "种子码成绩", [
      "code",
      "starter",
      "trainer",
      "result",
      "time",
      "kills",
      "floor",
    ]);
    if (
      typeof entry.code !== "string" ||
      entry.code.trim().length === 0 ||
      typeof entry.starter !== "string" ||
      !starterOrder.includes(entry.starter as StarterId) ||
      !isTrainerId(entry.trainer) ||
      (entry.result !== "victory" && entry.result !== "defeat") ||
      typeof entry.time !== "number" ||
      !Number.isFinite(entry.time) ||
      entry.time < 0 ||
      !isCount(entry.kills) ||
      (Object.hasOwn(entry, "floor") && !isCount(entry.floor))
    )
      throw new Error("种子码成绩记录无效。");
    return {
      code: entry.code,
      starter: entry.starter as StarterId,
      trainer: entry.trainer,
      result: entry.result,
      time: entry.time,
      kills: entry.kills,
      ...(isCount(entry.floor) ? { floor: entry.floor } : {}),
    };
  });
  const progress: Progress = {
    version: 5,
    runs: record.runs,
    clears: [...record.clears] as Progress["clears"],
    best,
    kills: record.kills,
    research: record.research,
    stardust: record.stardust,
    lab,
    archive: itemList(record.archive, "档案库"),
    backpack: itemList(record.backpack, "背包"),
    dex,
    looks: { owned, worn },
    badges: [],
    rules: [],
    unlocks: [],
    bonds,
    tower,
    seeds,
  };
  if (progress.archive.length > archiveSlots(progress)) throw new Error("档案库超出栏位。");
  if (progress.backpack.length > backpackSlots(progress)) throw new Error("背包超出栏位。");
  return progress;
}

function itemList(value: unknown, name: string): ItemId[] {
  if (
    !Array.isArray(value) ||
    !Array.from(value).every((id) => typeof id === "string" && Object.hasOwn(items, id)) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${name}记录无效。`);
  return [...value] as ItemId[];
}

function objectRecord(
  value: unknown,
  name: string,
  fields?: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${name}记录无效。`);
  if (fields && Object.keys(value).some((key) => !fields.includes(key)))
    throw new Error(`${name}字段不受支持。`);
  return value as Record<string, unknown>;
}

function starterList(value: unknown, name: string): StarterId[] {
  if (
    !Array.isArray(value) ||
    !Array.from(value).every(
      (id) => typeof id === "string" && starterOrder.includes(id as StarterId),
    ) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${name}记录无效。`);
  return [...value] as StarterId[];
}

export function loadProgress(): ProgressLoad {
  let raw: string | null;
  try {
    raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return {
      status: "locked",
      progress: emptyProgress(),
      message: "浏览器禁止本地存储，本次记录不会保存。",
    };
  }
  if (raw === null) return { status: "ready", progress: emptyProgress(), needsSave: false };
  try {
    const stored: unknown = JSON.parse(raw);
    const progress = parseProgress(stored);
    return { status: "ready", progress, needsSave: (stored as { version: number }).version === 4 };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: "locked",
      progress: emptyProgress(),
      message: `冒险记录无法读取（${reason}），已保留原数据，本次不会覆盖。`,
    };
  }
}

/** Throws when the browser refuses the write, so the UI never claims it saved. */
export function saveProgress(progress: Progress): void {
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(parseProgress(progress)));
}

export function unlockedDifficulty(progress: Progress): Difficulty {
  return progress.clears[1] > 0 ? 2 : progress.clears[0] > 0 ? 1 : 0;
}

function better(next: BestRecord, previous: BestRecord | undefined): boolean {
  if (!previous) return true;
  if (next.victory !== previous.victory) return next.victory;
  if (next.difficulty !== previous.difficulty) return next.difficulty > previous.difficulty;
  return next.victory ? next.time < previous.time : next.time > previous.time;
}

/** Unlock progress a run's kills are worth with the bought 研究 levels. */
export function researchedKills(progress: Progress, kills: number): number {
  return kills * (1 + metaBonuses(progress.lab).research);
}

/** Records the run and banks its 星星沙子; the host commits the returned progress. */
export function recordRun(progress: Progress, result: RunResult): Progress {
  const next: Progress = {
    ...progress,
    runs: progress.runs + 1,
    clears: [...progress.clears],
    best: { ...progress.best },
    kills: progress.kills + result.kills,
    research: progress.research + Math.floor(researchedKills(progress, result.kills)),
    stardust: progress.stardust + result.stardust,
    dex: { ...progress.dex },
  };
  for (const [id, earned] of Object.entries(result.dex)) {
    const species = id as EnemyId;
    const before = progress.dex[species];
    next.dex[species] = {
      seen: (before?.seen ?? 0) + earned.seen,
      defeated: (before?.defeated ?? 0) + earned.defeated,
      shiny: (before?.shiny ?? 0) + earned.shiny,
    };
  }
  if (result.outcome === "victory") next.clears[result.difficulty] += 1;
  const record: BestRecord = {
    difficulty: result.difficulty,
    victory: result.outcome === "victory",
    time: result.time,
    kills: result.kills,
  };
  if (better(record, progress.best[result.starter])) next.best[result.starter] = record;
  return next;
}

/** Buys the next level of a lab item; throws when maxed or unaffordable. */
export function buyLab(progress: Progress, id: LabId): Progress {
  const level = progress.lab[id] ?? 0;
  const cost = nextCost(labItem(id), level);
  if (cost === null) throw new Error("已满级。");
  if (progress.stardust < cost) throw new Error("星星沙子不足。");
  const next: Progress = {
    ...progress,
    stardust: progress.stardust - cost,
    lab: { ...progress.lab, [id]: level + 1 },
  };
  return next;
}

/** Sets the archived items; throws past the slots. */
export function setArchive(progress: Progress, archive: readonly ItemId[]): Progress {
  if (archive.length > archiveSlots(progress)) throw new Error("档案库已满。");
  const next: Progress = { ...progress, archive: [...archive] };
  return next;
}

/** Sets what the next run carries; throws past the slots. */
export function setBackpack(progress: Progress, backpack: readonly ItemId[]): Progress {
  if (backpack.length > backpackSlots(progress)) throw new Error("背包已满。");
  const next: Progress = { ...progress, backpack: [...backpack] };
  return next;
}
