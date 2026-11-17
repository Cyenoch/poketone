import type { ItemId } from "./sim/content/items";
import type { StarterId } from "./sim/content/lines/index";
import type { LabLevels } from "./sim/content/lab";

// Published v4 rules from 0910cc31. Runtime tables must stay frozen as new content is added.
const starters: readonly StarterId[] = [
  "charmander",
  "bulbasaur",
  "squirtle",
  "pikachu",
  "gastly",
  "dratini",
  "machop",
  "abra",
  "geodude",
];
const labMax = {
  dmg: 8,
  hp: 8,
  armor: 6,
  regen: 5,
  crit: 5,
  atkspd: 5,
  area: 5,
  ult: 5,
  spd: 6,
  xp: 6,
  gold: 6,
  magnet: 5,
  luck: 6,
  "slot-move": 1,
  "slot-vit": 4,
  choice4: 1,
  reroll: 6,
  skip: 6,
  banish: 6,
  revive: 1,
  research: 4,
  party: 1,
  archive: 6,
  bag: 1,
} as const;
const itemIds: readonly string[] = [
  "life-orb",
  "choice-scarf",
  "quick-claw",
  "leftovers",
  "scope-lens",
  "wide-lens",
  "honey",
  "lucky-egg",
  "hp-up",
  "rocky-helmet",
  "shell-bell",
  "charcoal",
  "mystic-water",
  "miracle-seed",
  "magnet",
  "silk-scarf",
  "silver-powder",
  "sharp-beak",
  "poison-barb",
  "hard-stone",
  "soft-sand",
  "oran-berry",
  "quick-powder",
  "bright-powder",
  "amulet-coin",
  "zoom-lens",
  "soothe-bell",
  "lax-incense",
  "cleanse-tag",
  "potion",
  "lucky-punch",
  "berry-juice",
  "muscle-band",
  "wise-glasses",
  "razor-claw",
  "light-clay",
  "white-herb",
  "power-herb",
  "sitrus-berry",
  "big-root",
  "air-balloon",
  "white-flute",
  "repel",
  "zinc",
  "super-lure",
  "choice-band",
  "choice-specs",
  "expert-belt",
  "assault-vest",
  "eviolite",
  "exp-share",
  "macho-brace",
  "black-sludge",
  "star-piece",
  "lum-berry",
  "pp-max",
  "max-elixir",
  "shiny-stone",
  "dusk-stone",
  "comet-shard",
  "protector",
  "moon-stone",
  "dawn-stone",
  "soul-dew",
  "grip-claw",
  "flame-orb",
  "toxic-orb",
  "snowball",
  "awakening",
  "binding-band",
  "burn-heal",
  "ice-heal",
  "metronome",
  "old-rod",
  "sticky-barb",
  "kings-rock",
  "stick",
  "razor-fang",
  "cell-battery",
  "bicycle",
  "full-heal",
  "thunder-stone",
  "fire-stone",
  "ice-stone",
  "leaf-stone",
  "griseous-orb",
  "reaper-cloth",
  "electirizer",
  "thick-club",
  "rage-candy-bar",
  "silph-scope",
  "sun-stone",
  "lustrous-orb",
  "soda-pop",
  "smoke-ball",
  "adrenaline-orb",
  "metal-powder",
  "lemonade",
  "smooth-rock",
  "enigma-berry",
  "poke-radar",
  "loaded-dice",
  "focus-band",
  "shed-shell",
  "iron-ball",
  "poke-doll",
  "fresh-water",
  "guard-spec",
  "focus-sash",
  "revive",
  "ss-ticket",
  "max-ether",
  "max-revive",
  "rare-candy",
  "master-ball",
  "adamant-orb",
  "silver-wing",
  "rainbow-wing",
  "poke-flute",
];

export interface ProgressV4 {
  version: 4;
  runs: number;
  clears: [number, number, number];
  best: Partial<
    Record<
      StarterId,
      {
        difficulty: 0 | 1 | 2;
        victory: boolean;
        time: number;
        kills: number;
      }
    >
  >;
  kills: number;
  research: number;
  stardust: number;
  lab: LabLevels;
  archive: ItemId[];
  backpack: ItemId[];
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates only the released v4 format, before any upgrade runs. */
export function parseProgressV4(value: unknown): ProgressV4 {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("记录不是对象。");
  const record = value as Partial<ProgressV4>;
  if (record.version !== 4) throw new Error("记录版本不受支持。");
  const fields = [
    "version",
    "runs",
    "clears",
    "best",
    "kills",
    "research",
    "stardust",
    "lab",
    "archive",
    "backpack",
  ];
  if (Object.keys(record).some((key) => !fields.includes(key)))
    throw new Error("记录字段不受支持。");
  if (
    !isCount(record.runs) ||
    !Array.isArray(record.clears) ||
    record.clears.length !== 3 ||
    !Array.from(record.clears).every(isCount)
  )
    throw new Error("记录内容不完整。");
  if (
    typeof record.best !== "object" ||
    record.best === null ||
    Array.isArray(record.best) ||
    Object.keys(record.best).some((id) => !starters.includes(id as StarterId))
  )
    throw new Error("最佳记录无效。");
  const best: ProgressV4["best"] = {};
  for (const id of starters) {
    const entry = record.best[id];
    if (!Object.hasOwn(record.best, id)) continue;
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !["difficulty", "victory", "time", "kills"].includes(key))
    )
      throw new Error("最佳记录无效。");
    const b = entry;
    if (
      (b.difficulty !== 0 && b.difficulty !== 1 && b.difficulty !== 2) ||
      typeof b.victory !== "boolean" ||
      typeof b.time !== "number" ||
      !Number.isFinite(b.time) ||
      b.time < 0 ||
      !isCount(b.kills)
    )
      throw new Error("最佳记录无效。");
    best[id] = { difficulty: b.difficulty, victory: b.victory, time: b.time, kills: b.kills };
  }
  if (!isCount(record.kills) || !isCount(record.research) || !isCount(record.stardust))
    throw new Error("星星沙子或击倒数无效。");
  if (typeof record.lab !== "object" || record.lab === null || Array.isArray(record.lab))
    throw new Error("研究所记录无效。");
  const lab: LabLevels = {};
  for (const [id, level] of Object.entries(record.lab)) {
    if (!Object.hasOwn(labMax, id) || !isCount(level) || level > labMax[id as keyof typeof labMax])
      throw new Error(`研究所等级无效（${id}）。`);
    // Retain even explicit zero levels: migration must not erase old player data.
    lab[id as keyof typeof labMax] = level;
  }
  const progress: ProgressV4 = {
    version: 4,
    runs: record.runs,
    clears: [...record.clears] as ProgressV4["clears"],
    best,
    kills: record.kills,
    research: record.research,
    stardust: record.stardust,
    lab,
    archive: itemList(record.archive, "档案库"),
    backpack: itemList(record.backpack, "背包"),
  };
  if (progress.archive.length > (lab.archive ?? 0)) throw new Error("档案库超出栏位。");
  if (progress.backpack.length > 2 + (lab.bag ?? 0)) throw new Error("背包超出栏位。");
  return progress;
}

function itemList(value: unknown, name: string): ItemId[] {
  if (
    !Array.isArray(value) ||
    !Array.from(value).every((id) => typeof id === "string" && itemIds.includes(id)) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${name}记录无效。`);
  return [...value] as ItemId[];
}
