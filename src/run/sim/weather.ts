import { isUnidentifiedGhost, killEnemy, type Ctx } from "./combat";
import { enemies } from "./content/enemies";
import { weatherDefs } from "./content/weather";
import { WEATHER } from "./content/params/field-events";
import { formOf } from "./evolution";
import { escaping } from "./encounters";
import { weatherDamagePlayer } from "./hurt";
import { currentStats } from "./stats";
import type { WeatherId } from "./state/field";
import type { World } from "./state/world";

export function startWeather(world: World, id: WeatherId): void {
  if (!weatherDefs[id].stages.includes(world.stage)) return;
  if (world.weather) world.events.push({ t: "weather", id: world.weather.id, phase: "end" });
  const from = world.time + WEATHER.forecast;
  world.weather = { id, from, until: from + WEATHER.seconds };
  world.events.push(
    { t: "weather", id, phase: "forecast" },
    { t: "banner", text: `${weatherDefs[id].name}即将到来`, tone: "danger", kind: "weather" },
  );
}

export function updateWeather(ctx: Ctx, dt: number): void {
  const { world } = ctx;
  const weather = world.weather;
  if (!weather || ctx.report) return;
  const before = world.time - dt;
  if (before < weather.from && world.time >= weather.from)
    world.events.push(
      { t: "weather", id: weather.id, phase: "start" },
      { t: "banner", text: weatherDefs[weather.id].name, tone: "danger", kind: "weather" },
    );
  const seconds = Math.max(0, Math.min(world.time, weather.until) - Math.max(before, weather.from));
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
