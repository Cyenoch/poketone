import type { ElementType } from "./elements";
import type { MoveId } from "./moves";
import type { StageId } from "./stages/index";
import type { WeatherId } from "../state/field";
import type { World } from "../state/world";
import { WEATHER } from "./params/field-events";

export interface WeatherDef {
  id: WeatherId;
  name: string;
  stages: readonly StageId[];
  element: Partial<Record<ElementType, number>>;
  chip?: { dps: number; immune: readonly ElementType[] };
  moves?: Partial<Record<MoveId, { cooldown?: number; count?: number }>>;
  freezeDuration?: number;
}

export const weatherDefs: Record<WeatherId, WeatherDef> = {
  sun: {
    id: "sun",
    name: "大晴天",
    stages: ["volcano"],
    element: { fire: 1.3, water: 0.7 },
    moves: { "solar-beam": { cooldown: 0.6 } },
  },
  rain: {
    id: "rain",
    name: "下雨",
    stages: ["coast"],
    element: { water: 1.3, fire: 0.7 },
    moves: { thunder: { count: 1 }, hurricane: { count: 1 } },
  },
  sandstorm: {
    id: "sandstorm",
    name: "沙暴",
    stages: ["desert"],
    element: { rock: 1.2 },
    chip: { dps: WEATHER.chip, immune: ["rock", "ground", "steel"] },
  },
  hail: {
    id: "hail",
    name: "冰雹",
    stages: ["glacier"],
    element: { ice: 1.2 },
    chip: { dps: WEATHER.chip, immune: ["ice"] },
    freezeDuration: 1.3,
  },
};

/** Forecasts and expired weather never alter combat or derived move values. */
export function activeWeather(world: Pick<World, "weather" | "time">): WeatherId | null {
  const weather = world.weather;
  return weather && world.time >= weather.from && world.time < weather.until ? weather.id : null;
}

export function weatherMultiplier(
  world: Pick<World, "weather" | "time">,
  type: ElementType,
): number {
  const id = activeWeather(world);
  return id ? (weatherDefs[id].element[type] ?? 1) : 1;
}
