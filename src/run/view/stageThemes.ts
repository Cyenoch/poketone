import type { Atmosphere, StageId } from "../sim/content/stages/index";
import type { AtmosphereLook, StageTheme } from "./themes/types";
export type * from "./themes/types";
import { forest, forestAtmospheres } from "./themes/forest";
import { desert, desertAtmospheres } from "./themes/desert";
import { coast, coastAtmospheres } from "./themes/coast";
import { glacier, glacierAtmospheres } from "./themes/glacier";
import { volcano, volcanoAtmospheres } from "./themes/volcano";
import { tower, towerAtmospheres } from "./themes/tower";

export const stageThemes: Record<StageId, StageTheme> = {
  forest,
  desert,
  coast,
  glacier,
  volcano,
  tower,
};

export const atmospheres: Record<Atmosphere, AtmosphereLook | null> = {
  ...forestAtmospheres,
  ...desertAtmospheres,
  ...coastAtmospheres,
  ...glacierAtmospheres,
  ...volcanoAtmospheres,
  ...towerAtmospheres,
};

/** A GLSL vector literal, written the way the shaders write them (`vec3(0.5, 1.0, 0.25)`). */
export function glslVec(values: readonly number[]): string {
  const parts = values.map((v) => (Number.isInteger(v) ? v.toFixed(1) : String(v)));
  return `vec${values.length}(${parts.join(", ")})`;
}
