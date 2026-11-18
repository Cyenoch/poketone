/** Column damage, radius in world units, chances and times in seconds. */
export const PLEDGE = {
  damage: 40,
  cooldown: 5,
  radius: 1.5,
  chance: 0.5,
  window: 1.5,
  distance: 2.5,
} as const;
export const PLEDGE_FIELD = {
  radius: 2.5,
  groundSeconds: 8,
  fireDps: 8,
  swampSlow: 0.5,
  rainbowSeconds: 10,
  rainbowChance: 2,
} as const;

export const pledgeMoves = {
  "grass-pledge": { name: "草之誓约", type: "grass", status: "root" },
  "fire-pledge": { name: "火之誓约", type: "fire", status: "burn" },
  "water-pledge": { name: "水之誓约", type: "water", status: "wet" },
} as const;
export type PledgeMoveId = keyof typeof pledgeMoves;

export function isPledgeMove(move: unknown): move is PledgeMoveId {
  return typeof move === "string" && Object.hasOwn(pledgeMoves, move);
}

export const pledgeCombos = [
  { pair: ["grass-pledge", "fire-pledge"], result: "sea-of-fire" },
  { pair: ["fire-pledge", "water-pledge"], result: "rainbow" },
  { pair: ["grass-pledge", "water-pledge"], result: "swamp" },
] as const satisfies readonly { pair: readonly [PledgeMoveId, PledgeMoveId]; result: string }[];
