// Fusion recipes (openspec/specs/combat-builds/spec.md 融合; reference `fusions.json`). Bill's machine turns two
// max-level moves into `result`. Only the signature (two named moves) recipes exist so far.

import { starters, type StarterId } from "./lines/index";
import { moves, type MoveId } from "./moves";

export interface FusionRecipe {
  /** A move with `fusion: true`. */
  result: MoveId;
  match: { pair: readonly [MoveId, MoveId] };
}

export const fusionRecipes: readonly FusionRecipe[] = [
  { result: "fire-whirl", match: { pair: ["fire-spin", "flamethrower"] } },
  { result: "floral-beam", match: { pair: ["razor-leaf", "solar-beam"] } },
  { result: "hydro-spiral", match: { pair: ["rapid-spin", "hydro-pump"] } },
  { result: "ball-storm", match: { pair: ["electro-ball", "thunder"] } },
];
for (const { result } of fusionRecipes)
  if (!moves[result].fusion)
    throw new Error(`融合配方结果 ${result} 不是融合招式（fusion: true）。`);

/** Each line's signature recipe: the first whose pair are both moves of its kit. */
export const signatureFusions = Object.fromEntries(
  Object.values(starters).map((line) => {
    const recipe = fusionRecipes.find(({ match }) =>
      match.pair.every((move) => line.kit.includes(move)),
    );
    if (!recipe) throw new Error(`${line.id}: 没有用两招招牌招式的融合配方。`);
    return [line.id, recipe];
  }),
) as Record<StarterId, FusionRecipe>;
