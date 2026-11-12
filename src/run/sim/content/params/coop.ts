/** Fixed run seats, including downed/disconnected members; see docs/BALANCE.md. */
export const COOP_SCALING = [
  { spawns: 1, hp: 1, bossHp: 1, cap: 1, xp: 1 },
  { spawns: 1.35, hp: 1.15, bossHp: 1.75, cap: 1.2, xp: 0.75 },
  { spawns: 1.7, hp: 1.3, bossHp: 2.5, cap: 1.4, xp: 0.6 },
  { spawns: 2.05, hp: 1.45, bossHp: 3.25, cap: 1.6, xp: 0.5 },
] as const;

/** `createWorld` validates the roster; seats stay in `world.players` for the whole run. */
export function coopScaling(players: number) {
  return COOP_SCALING[players - 1]!;
}

export const COOP = {
  rescueSeconds: 3,
  rescueReach: 2.5,
  reviveHp: 0.3,
  invulnerable: 2.5,
} as const;
