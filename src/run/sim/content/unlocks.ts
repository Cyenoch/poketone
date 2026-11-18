import type { AbilityId } from "./abilities";
import type { EnemyId } from "./enemies";
import type { Difficulty } from "./difficulties";
import type { FieldEventId, SiteKind } from "../state/field";
import type { MarkerId } from "../state/route";
import type { RuleId } from "./rules";
import { formDefs } from "./lines/index";

type Content =
  | { site: SiteKind; species?: EnemyId }
  | { event: FieldEventId }
  | { marker: MarkerId }
  | { ability: AbilityId }
  | { rule: RuleId };
type Requirement =
  | { research: EnemyId }
  | { researched: number }
  | { badges: number }
  | { clears: Difficulty };
const entries = {
  "raid-den": [{ site: "raid-den" }, { researched: 3 }],
  outbreak: [{ event: "outbreak" }, { researched: 1 }],
  "fishing-gyarados": [{ site: "fishing", species: "gyarados" }, { research: "magikarp" }],
  "gengar-deal": [{ marker: "gengar-deal" }, { research: "gastly" }],
  "alpha-elites": [{ rule: "alpha-elites" }, { badges: 1 }],
  nuzlocke: [{ rule: "nuzlocke" }, { clears: 1 }],
  "solar-power": [{ ability: "solar-power" }, { research: "vulpix" }],
  chlorophyll: [{ ability: "chlorophyll" }, { research: "oddish" }],
  "rain-dish": [{ ability: "rain-dish" }, { research: "poliwag" }],
  "lightning-rod": [{ ability: "lightning-rod" }, { research: "voltorb" }],
  "sand-veil": [{ ability: "sand-veil" }, { research: "geodude" }],
  steadfast: [{ ability: "steadfast" }, { research: "machop" }],
  "magic-guard": [{ ability: "magic-guard" }, { research: "kadabra" }],
  "marvel-scale": [{ ability: "marvel-scale" }, { research: "dratini" }],
  multiscale: [{ ability: "multiscale" }, { research: "dratini" }],
} as const satisfies Record<string, readonly [Content, Requirement]>;
export type UnlockId = keyof typeof entries;
export interface UnlockDef {
  id: UnlockId;
  content: Content;
  requires: Requirement;
}
export const unlockIds = Object.keys(entries) as UnlockId[];
export const unlocks = Object.fromEntries(
  unlockIds.map((id) => {
    const [content, requires] = entries[id];
    if (
      "ability" in content &&
      !Object.values(formDefs).some((form) => form.abilities.hidden === content.ability)
    )
      throw new Error(`解锁 ${id} 不是伙伴的隐藏特性。`);
    return [id, { id, content, requires }];
  }),
) as Record<UnlockId, UnlockDef>;
export function knownUnlocks(value: unknown): value is UnlockId[] {
  return (
    Array.isArray(value) &&
    value.length <= unlockIds.length &&
    Array.from(value).every((id) => typeof id === "string" && Object.hasOwn(unlocks, id)) &&
    new Set(value).size === value.length
  );
}

/** Content without a registered gate is part of the starting pool. */
export function contentAvailable(owned: readonly UnlockId[], content: Content): boolean {
  const gate = unlockIds.find((id) => {
    const candidate = unlocks[id].content;
    if ("site" in content)
      return (
        "site" in candidate &&
        candidate.site === content.site &&
        candidate.species === content.species
      );
    if ("event" in content) return "event" in candidate && candidate.event === content.event;
    if ("marker" in content) return "marker" in candidate && candidate.marker === content.marker;
    if ("rule" in content) return "rule" in candidate && candidate.rule === content.rule;
    return "ability" in candidate && candidate.ability === content.ability;
  });
  return !gate || owned.includes(gate);
}
