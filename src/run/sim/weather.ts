import { isUnidentifiedGhost, killEnemy, type Ctx } from "./combat";
import { enemies } from "./content/enemies";
import { WEATHER_MOVE, weatherMoves, type WeatherMoveId } from "./content/moves";
import { activeWeather, weatherDefs } from "./content/weather";
import { WEATHER } from "./content/params/field-events";
import { ABILITY_PARAMS } from "./content/abilities";
import { formOf } from "./evolution";
import { escaping } from "./encounters";
import { applySolarCost, weatherDamagePlayer } from "./hurt";
import { currentStats } from "./stats";
import type { WeatherId } from "./state/field";
import type { Player } from "./state/entities";
import type { World } from "./state/world";

export function startWeather(world: World, id: WeatherId): void {
  if (!weatherDefs[id].stages.includes(world.stage)) return;
  if (world.weather) world.events.push({ t: "weather", id: world.weather.id, phase: "end" });
  world.weatherSetAt = world.time;
  const from = world.time + WEATHER.forecast;
  world.weather = { id, from, until: from + WEATHER.seconds, forecast: true };
  world.events.push(
    { t: "weather", id, phase: "forecast" },
    { t: "banner", text: `${weatherDefs[id].name}即将到来`, tone: "danger", kind: "weather" },
  );
}

function announceWeather(world: World, id: WeatherId): void {
  world.events.push(
    { t: "weather", id, phase: "start" },
    { t: "banner", text: weatherDefs[id].name, tone: "danger", kind: "weather" },
  );
}

/** The owner reports the cast's world time; a late cast cannot extend or roll back shared weather. */
export function castWeather(world: World, player: Player, move: WeatherMoveId, at: number): void {
  const { weather: id, rock } = weatherMoves[move];
  setWeather(
    world,
    id,
    Math.min(at, world.time),
    WEATHER_MOVE.seconds *
      (player.items.some((i) => i.id === rock) ? WEATHER_MOVE.rockDuration : 1),
  );
}

export function setDrought(world: World): void {
  setWeather(world, "sun", world.time, ABILITY_PARAMS.droughtSeconds);
}

function setWeather(world: World, id: WeatherId, from: number, seconds: number): void {
  if (from < world.weatherSetAt) return;
  const until = from + seconds;
  const old = activeWeather(world);
  world.weatherSetAt = from;
  if (world.weather && (old !== id || until <= world.time))
    world.events.push({ t: "weather", id: world.weather.id, phase: "end" });
  world.weather = until > world.time ? { id, from, until } : null;
  if (world.weather && old !== id) announceWeather(world, id);
}

export function updateWeather(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  const weather = world.weather;
  if (!weather || ctx.report) return;
  const before = world.time - dt;
  if (weather.forecast && world.time >= weather.from) {
    delete weather.forecast;
    announceWeather(world, weather.id);
  }
  const seconds = Math.max(0, Math.min(world.time, weather.until) - Math.max(before, weather.from));
  if (weather.id === "sun" && seconds > 0)
    for (const player of world.players) applySolarCost(world, player, seconds);
  const chip = weatherDefs[weather.id].chip;
  if (chip && seconds > 0) {
    for (const player of world.players) {
      if (!formOf(player).types.some((type) => chip.immune.includes(type)))
        weatherDamagePlayer(world, player, currentStats(player).maxHp * chip.dps * seconds);
    }
    for (const enemy of world.enemies) {
      if (
        enemy.hp <= 0 ||
        escaping(world, enemy) ||
        isUnidentifiedGhost(world, enemy) ||
        enemies[enemy.species].types.some((type) => chip.immune.includes(type))
      )
        continue;
      enemy.hp -= enemy.maxHp * chip.dps * seconds * (enemy.boss ? WEATHER.guardianChip : 1);
      if (enemy.hp <= 0) killEnemy(ctx, enemy, null);
    }
  }
  if (world.time >= weather.until) {
    world.events.push({ t: "weather", id: weather.id, phase: "end" });
    world.weather = null;
  }
}
