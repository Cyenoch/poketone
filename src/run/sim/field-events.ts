import { contentAvailable } from "./content/unlocks";
import { fireBeat } from "./beats";
import { fieldEventDefs } from "./content/events";
import { WEATHER_EVENT_WEIGHT } from "./content/params/rules";
import { isTowerGuardianFloor } from "./content/params/tower";
import { stageDefs } from "./content/stages/index";
import { weatherDefs } from "./content/weather";
import { zoneDef, zoneTimeLimit } from "./currentZone";
import { pick, range } from "./rng";
import type { Player } from "./state/entities";
import type { FieldEventId } from "./state/field";
import type { World } from "./state/world";
import { startWeather } from "./weather";

/** Called once on entry, never on restore. All draws consume the shared world RNG. */
export function scheduleField(world: World): void {
  const { beats, events } = zoneDef(world);
  const wildWeather = world.rules.includes("wild-weather");
  // Floors 1–7 share their draw history; entering 8 starts a fresh pool (likewise 15, 22, …).
  if (
    world.mode === "tower" &&
    world.route.length > 1 &&
    isTowerGuardianFloor(world.route.length - 1)
  )
    world.eventsUsed.length = 0;
  const duration = stageDefs[world.stage].duration;
  const scale = (zoneTimeLimit(world) ?? duration) / duration;
  const at = (from: number, to: number) => range(world.rng, from * scale, to * scale);
  world.zone.schedule = beats.map(({ window: [from, to], beat }) => ({
    at: at(from, to),
    beat,
  }));
  for (const [from, to] of events.windows) {
    const pool = events.pool.filter(
      (id) =>
        contentAvailable(world.unlocks, { event: id }) &&
        !world.eventsUsed.includes(id) &&
        fieldEventDefs[id].stages.includes(world.stage),
    );
    if (pool.length === 0) continue;
    const weighted = wildWeather
      ? pool.flatMap((id) =>
          Object.hasOwn(weatherDefs, id)
            ? Array<FieldEventId>(WEATHER_EVENT_WEIGHT).fill(id)
            : [id],
        )
      : pool;
    const id = pick(world.rng, weighted);
    world.eventsUsed.push(id);
    world.zone.schedule.push({ at: at(from, to), beat: { kind: "event", id } });
  }
  world.zone.schedule.sort((a, b) => a.at - b.at);
  world.spawn.fired = [];
}

export function fireFieldEvent(world: World, id: FieldEventId, player: Player): void {
  if (id === "horde" || id === "outbreak") {
    if (world.spawn.pool.length > 0) {
      const species = pick(world.rng, world.spawn.pool);
      fireBeat(
        world,
        id === "horde" ? { kind: "horde", species } : { kind: "outbreak", species },
        player,
      );
    }
  } else if (id === "site-awaken") {
    const dormant = world.sites.filter((site) => site.state === "dormant");
    if (dormant.length === 0) return;
    const site = pick(world.rng, dormant);
    site.state = "ready";
    world.events.push({
      t: "site",
      site: site.id,
      kind: site.kind,
      phase: "wake",
      x: site.x,
      z: site.z,
    });
  } else startWeather(world, id);
}
