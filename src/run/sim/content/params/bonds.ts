/** Total points at each level, starting at level 1. */
export const BOND_THRESHOLDS = [10, 30, 60, 100, 160] as const;
export const BOND_WIN_POINTS = 6;
export const BOND_DIFFICULTY_MULTIPLIERS = [1, 1.5, 2] as const;
export const BOND_ENDURE_LEVEL = 2;
export const BOND_LAB_LEVEL = 3;
export const BOND_CURE_LEVEL = 4;
export const BOND_LAB_MAX = 3;

// Research values per bought level, calibrated with balance:model (docs/BALANCE.md「羁绊」).
export const BOND_LAB_DAMAGE = 0.02;
export const BOND_LAB_REGEN = 0.1;
export const BOND_LAB_ARMOR = 1;
export const BOND_LAB_SPEED = 0.01;
export const BOND_LAB_HP = 4;
export const BOND_LAB_PRICE = { first: 180, growth: 1.45 } as const;
