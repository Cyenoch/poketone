// World snapshot boundary for co-op (docs/state-machines/simulation.md): the host sends the generated map
// once, then snapshots of the dynamic state. A peer restores a world from both and, fed the same
// commands, steps exactly like the host's.
import type { GeneratedMap } from "./mapgen/index";
import { navContinuation, restoreNav, type NavContinuation } from "./nav/index";
import { ARENA_HALF, type World } from "./state/world";
import { enemies } from "./content/enemies";
import { fieldEventDefs } from "./content/events";
import { weatherDefs } from "./content/weather";
import { sites } from "./content/sites";
import { ULT_INVULNERABLE } from "./content/params/ultimates";

/** Snapshot format; bumped when the snapshot's dynamic state shape changes. */
export const SNAPSHOT_VERSION = 7;

/** Static map and runtime navigation; snapshots carry only the nav's continuation facts. */
type MapFields = "map" | "nav";

/**
 * Every World field except the map's, deep-copied as plain data, plus the nav's continuation facts.
 * New World fields travel without touching this file, as long as they are plain data.
 */
export type WorldSnapshot = Omit<World, MapFields> & {
  version: number;
  /** Identity of the map the world runs on (`mapDigest`). */
  mapDigest: string;
  navigation: NavContinuation;
};

/** Between two `stepWorld` calls only. Shares nothing mutable with the world and changes nothing in it. */
export function snapshotWorld(world: World): WorldSnapshot {
  const { map, nav, ...dynamic } = world;
  return {
    ...plain(dynamic, "world"),
    version: SNAPSHOT_VERSION,
    mapDigest: mapDigest(map),
    navigation: plain(navContinuation(nav), "navigation"),
  };
}

/**
 * A new world on `map` (shared read-only) in the state `snapshot` describes; never regenerates the
 * map. Throws on another format version, another map, or anything that is not plain finite data;
 * the snapshot itself is left as it was.
 */
export function restoreWorld(map: GeneratedMap, snapshot: WorldSnapshot): World {
  if (snapshot.version !== SNAPSHOT_VERSION)
    throw new Error(`快照格式 ${snapshot.version}，本版本只读 ${SNAPSHOT_VERSION}。`);
  if (snapshot.mapDigest !== mapDigest(map))
    throw new Error(`快照属于另一张地图（${snapshot.mapDigest}，收到 ${mapDigest(map)}）。`);
  const {
    version: _version,
    mapDigest: _digest,
    navigation,
    ...dynamic
  } = plain(snapshot, "snapshot");
  const pressure = dynamic.spawn?.pressure;
  if (typeof pressure !== "number" || pressure < 0 || pressure > 1)
    throw new Error(`快照增援压力无效：${pressure}`);
  const zone = dynamic.zone;
  const exit = zone?.exit;
  if (
    !zone ||
    !Object.hasOwn(zone, "exit") ||
    (exit !== null &&
      (typeof exit !== "object" ||
        Array.isArray(exit) ||
        typeof exit.x !== "number" ||
        typeof exit.z !== "number" ||
        Object.keys(exit).length !== 2 ||
        Math.abs(exit.x) > ARENA_HALF ||
        Math.abs(exit.z) > ARENA_HALF)) ||
    (zone.phase === "active" ? exit !== null : exit === null)
  )
    throw new Error(`快照出口无效（${dynamic.stage}，${zone?.phase}）。`);
  validateFieldState(dynamic);
  return { map, nav: restoreNav(map.terrain, navigation), ...dynamic };
}

function validateFieldState(world: Omit<World, MapFields>): void {
  const check = (ok: unknown, path: string): void => {
    if (!ok) throw new Error(`快照野外状态无效：${path}`);
  };
  const record = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const nonnegative = (v: unknown): v is number => typeof v === "number" && v >= 0;
  const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
  const species = (v: unknown) => typeof v === "string" && Object.hasOwn(enemies, v);
  const point = (v: Record<string, unknown>) =>
    typeof v.x === "number" &&
    typeof v.z === "number" &&
    Math.abs(v.x) <= ARENA_HALF &&
    Math.abs(v.z) <= ARENA_HALF;
  const egg = (v: unknown) =>
    record(v) && species(v.species) && nonnegative(v.distance) && point(v);
  check(
    Array.isArray(world.eventsUsed) &&
      world.eventsUsed.every((id) => Object.hasOwn(fieldEventDefs, id)) &&
      new Set(world.eventsUsed).size === world.eventsUsed.length,
    "eventsUsed",
  );
  check(typeof world.silphScope === "boolean", "silphScope");
  const weather = world.weather;
  check(
    weather === null ||
      (record(weather) &&
        Object.hasOwn(weatherDefs, weather.id) &&
        nonnegative(weather.from) &&
        nonnegative(weather.until) &&
        weather.until > weather.from),
    "weather",
  );
  check(Array.isArray(world.zone.schedule), "zone.schedule");
  let previous = -1;
  for (const [i, entry] of world.zone.schedule.entries()) {
    check(
      record(entry) && nonnegative(entry.at) && entry.at >= previous && record(entry.beat),
      `zone.schedule[${i}]`,
    );
    previous = entry.at;
    const beat = entry.beat;
    if (beat.kind === "event")
      check(
        Object.hasOwn(fieldEventDefs, beat.id) && world.eventsUsed.includes(beat.id),
        `zone.schedule[${i}].event`,
      );
    else {
      check(
        ["alpha", "elite-wave", "swarm", "stampede", "eruption", "horde", "outbreak"].includes(
          beat.kind,
        ),
        `zone.schedule[${i}].beat`,
      );
      if ("species" in beat)
        check(
          Array.isArray(beat.species)
            ? beat.species.length > 0 && beat.species.every(species)
            : species(beat.species),
          `zone.schedule[${i}].species`,
        );
    }
  }
  check(
    Array.isArray(world.spawn.fired) &&
      world.spawn.fired.every((i) => count(i) && i < world.zone.schedule.length) &&
      new Set(world.spawn.fired).size === world.spawn.fired.length,
    "spawn.fired",
  );
  check(typeof world.spawn.shinySpawned === "boolean", "spawn.shinySpawned");
  const outbreak = world.spawn.outbreak;
  check(
    outbreak === null ||
      (record(outbreak) && species(outbreak.species) && nonnegative(outbreak.until)),
    "spawn.outbreak",
  );
  check(Array.isArray(world.sites), "sites");
  const ids = new Set<number>();
  for (const site of world.sites) {
    check(
      record(site) &&
        Number.isSafeInteger(site.id) &&
        !ids.has(site.id) &&
        Object.hasOwn(sites, site.kind) &&
        point(site) &&
        nonnegative(site.radius) &&
        ["dormant", "ready", "busy", "spent"].includes(site.state) &&
        nonnegative(site.until) &&
        record(site.data),
      "sites.entry",
    );
    ids.add(site.id);
    check(
      site.owner === null || world.players.some((p) => p.id === site.owner),
      `sites.${site.id}.owner`,
    );
    check(
      nonnegative(site.data.progress) &&
        count(site.data.uses) &&
        nonnegative(site.data.lastHurt) &&
        (site.data.enemy === null || Number.isSafeInteger(site.data.enemy)),
      `sites.${site.id}.data`,
    );
    check(
      site.data.species === undefined || species(site.data.species),
      `sites.${site.id}.species`,
    );
    check(
      site.data.trap === undefined || typeof site.data.trap === "boolean",
      `sites.${site.id}.trap`,
    );
    check(site.data.egg === undefined || egg(site.data.egg), `sites.${site.id}.egg`);
  }
  for (const player of world.players) {
    check(record(player.dex), `players.${player.id}.dex`);
    for (const [id, entry] of Object.entries(player.dex))
      check(
        species(id) &&
          record(entry) &&
          count(entry.seen) &&
          count(entry.defeated) &&
          count(entry.shiny),
        `players.${player.id}.dex.${id}`,
      );
    check(player.egg === null || egg(player.egg), `players.${player.id}.egg`);
    check(
      nonnegative(player.ult.protection) && player.ult.protection <= ULT_INVULNERABLE,
      `players.${player.id}.ult.protection`,
    );
    check(count(player.ult.cast), `players.${player.id}.ult.cast`);
    for (const pending of player.pending)
      check(
        pending.minRarity === undefined || (count(pending.minRarity) && pending.minRarity <= 3),
        `players.${player.id}.pending.minRarity`,
      );
  }
  for (const enemy of world.enemies) {
    check(
      typeof enemy.shiny === "boolean" &&
        (enemy.shinyUntil === null || nonnegative(enemy.shinyUntil)) &&
        enemy.shiny === (enemy.shinyUntil !== null),
      `enemies.${enemy.id}.shiny`,
    );
    check(enemy.site === null || ids.has(enemy.site), `enemies.${enemy.id}.site`);
    check(
      enemy.escape === null ||
        (enemy.shiny &&
          record(enemy.escape) &&
          point(enemy.escape) &&
          Array.isArray(enemy.escape.path) &&
          enemy.escape.path.length % 2 === 0 &&
          enemy.escape.path.every((v) => typeof v === "number" && Math.abs(v) <= ARENA_HALF)),
      `enemies.${enemy.id}.escape`,
    );
  }
  for (const pickup of world.pickups)
    check(
      pickup.minRarity === undefined ||
        (pickup.kind === "chest" && count(pickup.minRarity) && pickup.minRarity <= 3),
      "pickups.minRarity",
    );
}

/**
 * Deep copy of plain data: finite numbers (−0 kept), strings, booleans, null, arrays and plain
 * objects in key order; unset optional fields are dropped. Anything else (typed arrays, class
 * instances, Map/Set, functions, Infinity/NaN) is a state that cannot travel, and throws.
 */
function plain<T>(value: T, path: string): T {
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error(`快照字段 ${path} 不是有限数：${value}`);
      return value;
    case "string":
    case "boolean":
      return value;
    case "object": {
      if (value === null) return value;
      if (Array.isArray(value)) return value.map((item, i) => plain(item, `${path}[${i}]`)) as T;
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) break;
      const copy: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(value))
        if (field !== undefined) copy[key] = plain(field, `${path}.${key}`);
      return copy as T;
    }
  }
  throw new Error(`快照字段 ${path} 不是普通数据（${describe(value)}）。`);
}

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;
  return Object.getPrototypeOf(value)?.constructor?.name ?? "object";
}

/** FNV-1a over what the world keeps of a map: every number's bits, every string and key, in order. */
export function mapDigest(map: GeneratedMap): string {
  const bits = new DataView(new ArrayBuffer(8));
  let hash = 0x811c9dc5;
  const byte = (b: number) => {
    hash = Math.imul(hash ^ b, 0x01000193);
  };
  const number = (v: number) => {
    bits.setFloat64(0, v);
    for (let i = 0; i < 8; i++) byte(bits.getUint8(i));
  };
  const text = (s: string) => {
    number(s.length);
    for (let i = 0; i < s.length; i++) number(s.charCodeAt(i));
  };
  const walk = (value: unknown): void => {
    if (typeof value === "number") return number(value);
    if (typeof value === "string") return text(value);
    if (typeof value === "boolean") return byte(value ? 1 : 2);
    if (value === undefined || value === null) return byte(0);
    if (ArrayBuffer.isView(value)) {
      const list = value as unknown as ArrayLike<number>;
      number(list.length);
      for (let i = 0; i < list.length; i++) number(list[i]!);
      return;
    }
    if (Array.isArray(value)) {
      number(value.length);
      for (const item of value) walk(item);
      return;
    }
    for (const [key, field] of Object.entries(value as object)) {
      text(key);
      walk(field);
    }
  };
  walk([map.terrain, map.obstacles, map.water, map.pads, map.passages]);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
