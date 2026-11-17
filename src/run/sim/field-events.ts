import { fireBeat } from "./beats";
import { fieldEventDefs } from "./content/events";
import { zoneDef } from "./currentZone";
import { pick, range } from "./rng";
import type { Player } from "./state/entities";
import type { FieldEventId } from "./state/field";
import type { World } from "./state/world";
import { startWeather } from "./weather";

/** Called once on entry, never on restore. All draws consume the shared world RNG. */
export function scheduleField(world: World): void {
  const { beats, events } = zoneDef(world);
  world.zone.schedule = beats.map(({ window: [from, to], beat }) => ({
    at: range(world.rng, from, to),
    beat,
  }));
  for (const [from, to] of events.windows) {
    const pool = events.pool.filter(
      (id) => !world.eventsUsed.includes(id) && fieldEventDefs[id].stages.includes(world.stage),
    );
    if (pool.length === 0) continue;
    const id = pick(world.rng, pool);
    world.eventsUsed.push(id);
    world.zone.schedule.push({ at: range(world.rng, from, to), beat: { kind: "event", id } });
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
