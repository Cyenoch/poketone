export type ElementType =
  | "normal"
  | "fire"
  | "water"
  | "grass"
  | "electric"
  | "bug"
  | "flying"
  | "poison"
  | "rock"
  | "ground"
  | "fighting"
  | "psychic"
  | "ghost"
  | "fairy"
  | "steel"
  | "dragon"
  | "ice";

export const typeNames: Record<ElementType, string> = {
  normal: "一般",
  fire: "火",
  water: "水",
  grass: "草",
  electric: "电",
  bug: "虫",
  flying: "飞行",
  poison: "毒",
  rock: "岩石",
  ground: "地面",
  fighting: "格斗",
  psychic: "超能力",
  ghost: "幽灵",
  fairy: "妖精",
  steel: "钢",
  dragon: "龙",
  ice: "冰",
};

/**
 * Attacker type → defender type multiplier; softened from the main series (2 → 1.4, ½ → 0.8) so no
 * starter is hopeless. Immunities are kept soft (0.6, never 0), as ground's to electric, so a move
 * can still chip such an enemy down. Pairs among the first ten types cover only what the forest
 * needed; pairs with fighting, psychic, ghost, fairy, steel or dragon follow the main series in full.
 */
const typeChart: Partial<Record<ElementType, Partial<Record<ElementType, number>>>> = {
  normal: { rock: 0.8, steel: 0.8, ghost: 0.6 },
  fire: {
    ice: 1.4,
    grass: 1.4,
    bug: 1.4,
    steel: 1.4,
    fire: 0.8,
    water: 0.8,
    rock: 0.8,
    dragon: 0.8,
  },
  water: { fire: 1.4, grass: 0.8, water: 0.8, rock: 1.4, ground: 1.4, dragon: 0.8 },
  grass: {
    water: 1.4,
    fire: 0.8,
    grass: 0.8,
    poison: 0.8,
    rock: 1.4,
    ground: 1.4,
    steel: 0.8,
    dragon: 0.8,
  },
  electric: { water: 1.4, flying: 1.4, grass: 0.8, electric: 0.8, ground: 0.6, dragon: 0.8 },
  bug: { psychic: 1.4, fighting: 0.8, ghost: 0.8, fairy: 0.8, steel: 0.8 },
  flying: { fighting: 1.4, steel: 0.8 },
  poison: { fairy: 1.4, ghost: 0.8, steel: 0.6 },
  rock: { ice: 1.4, fighting: 0.8, steel: 0.8 },
  ground: { steel: 1.4 },
  fighting: {
    ice: 1.4,
    normal: 1.4,
    rock: 1.4,
    steel: 1.4,
    poison: 0.8,
    flying: 0.8,
    psychic: 0.8,
    bug: 0.8,
    fairy: 0.8,
    ghost: 0.6,
  },
  psychic: { fighting: 1.4, poison: 1.4, psychic: 0.8, steel: 0.8 },
  ghost: { ghost: 1.4, psychic: 1.4, normal: 0.6 },
  fairy: { fighting: 1.4, dragon: 1.4, fire: 0.8, poison: 0.8, steel: 0.8 },
  steel: { ice: 1.4, rock: 1.4, fairy: 1.4, fire: 0.8, water: 0.8, electric: 0.8, steel: 0.8 },
  ice: {
    grass: 1.4,
    ground: 1.4,
    flying: 1.4,
    dragon: 1.4,
    fire: 0.8,
    water: 0.8,
    ice: 0.8,
    steel: 0.8,
  },
  dragon: { dragon: 1.4, steel: 0.8, fairy: 0.6 },
};

/**
 * A guardian's resistance never drops below this: a starter whose moves all share one type (Pikachu
 * against ground-type Nidoking) still has a fight it can finish, while the matchup stays visible.
 */
const GUARDIAN_MIN_MULTIPLIER = 0.8;

export function typeMultiplier(
  attack: ElementType,
  defender: readonly ElementType[],
  guardian = false,
): number {
  let multiplier = 1;
  for (const type of defender) multiplier *= typeChart[attack]?.[type] ?? 1;
  return guardian ? Math.max(multiplier, GUARDIAN_MIN_MULTIPLIER) : multiplier;
}
