import type { Audio, AmbienceName, SfxName } from "./engine";
import type { PlayerId } from "../run/sim/state/entities";
import type { RunEvent } from "../run/sim/state/events";
import type { World } from "../run/sim/state/world";
import { SITE } from "../run/sim/content/params/sites";
import { WEATHER } from "../run/sim/content/params/field-events";

export type FieldAudioEvent = Extract<
  RunEvent,
  { t: "weather" | "site" | "shiny" | "shiny-caught" }
>;

const WEATHER_CUE = {
  sun: "weather-sun",
  rain: "weather-rain",
  sandstorm: "weather-sand",
  hail: "weather-hail",
} as const;

// Completion/birth feedback has its key frame at zero. The integration must discard events
// behind an overlay; these finite windows also bound late network delivery and sample tails.
export const FIELD_CUE_WINDOW_MS = {
  weather: 1000,
  completion: 800,
  shiny: 900,
} as const;

interface Heard {
  field: string;
  cues: Set<string>;
}
// The application audio singleton must not retain a disposed run's world.
const heard = new WeakMap<Audio, WeakMap<World, Heard>>();
const ambienceWishes = new WeakMap<Audio, AmbienceName | null>();

function cuesFor(audio: Audio, world: World): Set<string> {
  const field = `${world.stage}:${world.zone.index}`;
  let worlds = heard.get(audio);
  if (!worlds) {
    worlds = new WeakMap();
    heard.set(audio, worlds);
  }
  let state = worlds.get(world);
  if (!state || state.field !== field) {
    state = { field, cues: new Set() };
    worlds.set(world, state);
  }
  return state.cues;
}

/**
 * Call from the visible run's event drain, passing network.eventAgeMs(event) (zero locally).
 * This only translates field events; the drain suppresses the accompanying generic weather
 * banner/danger and egg capture cues, and gives the Voltorb warning priority over generic tells.
 * Suppressed/expired events must be drained, not queued to replay when the overlay closes.
 */
export function playFieldEvent(
  audio: Audio,
  event: FieldAudioEvent,
  world: World,
  localPlayer: PlayerId,
  eventAgeMs: number,
): SfxName | null {
  if (!Number.isFinite(eventAgeMs) || eventAgeMs < 0) return null;
  if (world.paused || world.outcome !== "playing" || world.zone.phase === "transitioning")
    return null;
  const cues = cuesFor(audio, world);
  const cue = (name: SfxName, key: string, windowMs: number): SfxName | null => {
    if (cues.has(key) || eventAgeMs >= windowMs) return null;
    cues.add(key);
    audio.sfx(name, { keyMs: -eventAgeMs, maxMs: windowMs - eventAgeMs });
    return name;
  };

  if (event.t === "weather") {
    const weather = world.weather;
    if (!weather || weather.id !== event.id || event.phase === "end") return null;
    if (world.time >= weather.until) return null;
    const forecast = event.phase === "forecast";
    if (forecast ? world.time >= weather.from : world.time < weather.from) return null;
    // An old event for the same weather type must not announce a new occurrence.
    const began = weather.from - (forecast ? WEATHER.forecast : 0);
    if (world.time - eventAgeMs / 1000 < began - 1 / 30) return null;
    // Forecast and start share one cue identity; start is a fallback if forecast wasn't seen.
    return cue(
      WEATHER_CUE[event.id],
      `weather:${event.id}:${weather.from}`,
      forecast ? WEATHER.forecast * 1000 : FIELD_CUE_WINDOW_MS.weather,
    );
  }
  if (event.t === "shiny-caught") return null;
  if (event.t === "shiny") {
    return cue("shiny", `shiny:${event.enemy}`, FIELD_CUE_WINDOW_MS.shiny);
  }

  if (event.phase === "wake" || event.phase === "cancel") return null;
  const self = world.players.find((player) => player.id === localPlayer);
  if (!self || Math.hypot(event.x - self.x, event.z - self.z) >= 14) return null;
  const site = world.sites.find((entry) => entry.id === event.site);
  // Fishing can complete three times at one site. Each actual use gets its own completion cue.
  const key = `site:${event.site}:${event.phase}:${site?.data.uses ?? 0}`;
  if (event.phase === "start") {
    if (!site || site.state !== "busy") return null;
    if (event.kind === "item-ball") {
      if (!site.data.trap || world.time >= site.until) return null;
      return cue(
        "tell-voltorb",
        key,
        Math.min(SITE.balls.warning * 1000, (site.until - world.time) * 1000 + eventAgeMs),
      );
    } else if (event.kind === "snorlax" || event.kind === "raid-den") {
      if (site.data.enemy !== null || world.time >= site.until) return null;
      return cue(
        event.kind === "snorlax" ? "site-flute" : "site-den",
        key,
        Math.min(SITE.warning * 1000, (site.until - world.time) * 1000 + eventAgeMs),
      );
    }
  } else if (event.kind === "fishing" && event.phase === "reveal") {
    return cue("site-fishing", key, FIELD_CUE_WINDOW_MS.completion);
  } else if (event.kind === "fossil" && event.phase === "reveal") {
    return cue("site-dig", key, FIELD_CUE_WINDOW_MS.completion);
  } else if (event.kind === "egg" && event.phase === "complete" && event.player === localPlayer) {
    return cue("egg-hatch", key, FIELD_CUE_WINDOW_MS.completion);
  }
  return null;
}

/**
 * Call each frame and immediately on pause/overlay/end/error/unmount with active=false.
 * The engine owns the hold and fades; only a changed wish reaches it. Resuming reads the current
 * world, so expired weather never restarts and reconnecting mid-weather needs no start event.
 */
export function syncFieldAmbience(audio: Audio, world: World, active: boolean): void {
  // A run can be disposed before its first world is built.
  const weather = active ? world.weather : null;
  const name =
    active &&
    !world.paused &&
    world.outcome === "playing" &&
    world.zone.phase !== "transitioning" &&
    weather &&
    world.time >= weather.from &&
    world.time < weather.until
      ? weather.id
      : null;
  if ((ambienceWishes.get(audio) ?? null) === name) return;
  ambienceWishes.set(audio, name);
  audio.ambience.play(name);
}
