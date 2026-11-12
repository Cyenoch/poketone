import type { World } from "../sim/state/world";
import { zoneDef } from "../sim/currentZone";
import { atmospheres, stageThemes, type StageTheme } from "./stageThemes";

export function zoneTheme(world: World): StageTheme {
  const base = stageThemes[world.stage];
  const look = atmospheres[zoneDef(world).atmosphere];
  return look ? { ...base, ...look } : base;
}
