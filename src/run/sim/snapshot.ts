import { isTrainerId } from "./content/trainers";
import { TRAINER } from "./content/params/trainers";
import { starters } from "./content/lines/index";
import { knownUnlocks } from "./content/unlocks";
// World snapshot boundary for co-op (docs/state-machines/simulation.md): the host sends the generated map
// once, then snapshots of the dynamic state. A peer restores a world from both and, fed the same
// commands, steps exactly like the host's.
import type { GeneratedMap } from "./mapgen/index";
import { navContinuation, restoreNav, type NavContinuation } from "./nav/index";
import { ARENA_HALF, type World } from "./state/world";
import { enemies } from "./content/enemies";
import { knownRules } from "./content/rules";
import { fieldEventDefs } from "./content/events";
import { weatherDefs } from "./content/weather";
import { sites } from "./content/sites";
import { initialRoute, ROUTE_TIERS, routeStep } from "./content/campaign";
import { towerMap } from "./content/tower-map";
import { markerAllowed, routeMarkers, routeModifiers } from "./content/route";
import { ROUTE_REWARD } from "./content/params/route";
import { ULT_INVULNERABLE } from "./content/params/ultimates";
import { MAX_BOND_LEVEL } from "./content/bonds";
import { BOND_CURE_LEVEL, BOND_ENDURE_LEVEL } from "./content/params/bonds";

/** Snapshot format; bumped when the snapshot's dynamic state shape changes. */
export const SNAPSHOT_VERSION = 16;

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
  if (
    !knownUnlocks(dynamic.unlocks) ||
    !Array.isArray(dynamic.playerUnlocks) ||
    dynamic.playerUnlocks.length !== dynamic.players.length ||
    !dynamic.playerUnlocks.every(knownUnlocks)
  )
    throw new Error("快照研究解锁无效。");
  validateFieldState(dynamic);
  if (!knownRules(dynamic.rules)) throw new Error("快照挑战规则无效。");
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
  check(Array.isArray(world.route), "route");
  check(world.mode === "tower" || world.mode === "expedition", "mode");
  const tower = world.mode === "tower";
  if (tower) {
    check(
      world.route.length > 0 &&
        world.route.at(-1) === world.stage &&
        world.route.every((stage, i, route) => stage === towerMap(world.seed, i + 1, route[i - 1])),
      "tower.route",
    );
    check(world.marker === null && world.modifier === null && world.outcome !== "victory", "tower");
  } else initialRoute(world.stage, world.route);
  check(
    world.marker === null ||
      (Object.hasOwn(routeMarkers, world.marker) && markerAllowed(world.marker, world.stage)),
    "marker",
  );
  check(
    world.modifier === null ||
      (Object.hasOwn(routeModifiers, world.modifier) &&
        ROUTE_REWARD.modifierChance[routeStep(world)] > 0),
    "modifier",
  );
  const zone = world.zone;
  const targets: readonly string[] = tower
    ? [towerMap(world.seed, world.route.length + 1, world.stage)]
    : (ROUTE_TIERS[world.route.length] ?? []);
  if (
    !zone ||
    !Array.isArray(zone.exits) ||
    !["active", "cleared", "transitioning"].includes(zone.phase) ||
    (zone.phase === "active" ? zone.exits.length !== 0 : zone.exits.length === 0) ||
    (zone.leaving !== null && (!count(zone.leaving) || zone.leaving >= zone.exits.length)) ||
    (zone.phase === "transitioning" && (zone.leaving === null || !targets.length)) ||
    (zone.phase !== "transitioning" && zone.leaving !== null && world.outcome !== "victory") ||
    (world.outcome === "victory" &&
      (world.stage !== "tower" || zone.phase !== "cleared" || zone.leaving !== 0)) ||
    zone.exits.some(
      (exit) =>
        !record(exit) ||
        !point(exit) ||
        (targets.length
          ? exit.to === null ||
            !targets.includes(exit.to) ||
            (tower
              ? exit.marker !== null
              : exit.marker === null ||
                !Object.hasOwn(routeMarkers, exit.marker) ||
                !markerAllowed(exit.marker, exit.to))
          : exit.to !== null || exit.marker !== null),
    ) ||
    (zone.phase !== "active" &&
      (zone.exits.length > targets.length + 1 ||
        !targets.every((to) => zone.exits.some((exit) => exit.to === to)) ||
        new Set(zone.exits.map((exit) => exit.marker)).size !== zone.exits.length))
  )
    throw new Error(`快照出口无效（${world.stage}，${zone?.phase}）。`);
  check(
    Array.isArray(world.eventsUsed) &&
      world.eventsUsed.every((id) => Object.hasOwn(fieldEventDefs, id)) &&
      new Set(world.eventsUsed).size === world.eventsUsed.length,
    "eventsUsed",
  );
  check(typeof world.silphScope === "boolean", "silphScope");
  check(nonnegative(world.rainbowUntil), "rainbowUntil");
  check(nonnegative(world.weatherSetAt), "weatherSetAt");
  check(
    Array.isArray(world.pledgeHits) &&
      world.pledgeHits.every(
        (hit) =>
          record(hit) &&
          point(hit) &&
          nonnegative(hit.at) &&
          hit.at <= world.time &&
          ["grass-pledge", "fire-pledge", "water-pledge"].includes(hit.move) &&
          world.players.some((player) => player.id === hit.player),
      ),
    "pledgeHits",
  );
  const weather = world.weather;
  check(
    weather === null ||
      (record(weather) &&
        Object.hasOwn(weatherDefs, weather.id) &&
        (weather.forecast === undefined || weather.forecast === true) &&
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
    check(
      site.data.traded === undefined ||
        (site.kind === "gengar-deal" &&
          Array.isArray(site.data.traded) &&
          site.data.traded.every((id) => world.players.some((player) => player.id === id))),
      `sites.${site.id}.traded`,
    );
  }
  for (const player of world.players) {
    check(isTrainerId(player.trainer), `players.${player.id}.trainer`);
    check(nonnegative(player.assistReady), `players.${player.id}.assistReady`);
    check(
      record(player.assistBuffs) &&
        Object.entries(player.assistBuffs).every(
          ([id, left]) =>
            (id === "xSpeed" || id === "direHit" || id === "fullHeal") &&
            nonnegative(left) &&
            left <= TRAINER[id].seconds,
        ),
      `players.${player.id}.assistBuffs`,
    );
    check(count(player.bond) && player.bond <= MAX_BOND_LEVEL, `players.${player.id}.bond`);
    check(
      player.bondEndure === false ||
        (player.bondEndure === true && player.bond >= BOND_ENDURE_LEVEL),
      `players.${player.id}.bondEndure`,
    );
    check(
      player.bondCure === false || (player.bondCure === true && player.bond >= BOND_CURE_LEVEL),
      `players.${player.id}.bondCure`,
    );
    check(
      player.mega === null ||
        (starters[player.starter]?.megas?.some((mega) => mega.form.id === player.mega) &&
          player.stage === starters[player.starter].stages.length - 1),
      `players.${player.id}.mega`,
    );
    check([0, 1, "hidden"].includes(player.abilitySlot), `players.${player.id}.abilitySlot`);
    check(nonnegative(player.lightningRodTime), `players.${player.id}.lightningRodTime`);
    const trade = player.tradeRequest;
    check(
      trade === null ||
        (record(trade) &&
          count(trade.expiresAtTick) &&
          trade.target !== player.id &&
          world.players.some((peer) => peer.id === trade.target)),
      `players.${player.id}.tradeRequest`,
    );
    check(
      typeof player.tradeHp === "number" && player.tradeHp > 0 && player.tradeHp <= 1,
      `players.${player.id}.tradeHp`,
    );
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
    for (const pending of player.pending) {
      check(
        pending.minRarity === undefined || (count(pending.minRarity) && pending.minRarity <= 3),
        `players.${player.id}.pending.minRarity`,
      );
      const offer = pending.offer;
      check(
        offer === undefined ||
          (pending.source === "chest" &&
            record(offer) &&
            ((offer.kind === "trophy" &&
              (offer.megaStones === undefined || offer.megaStones === true)) ||
              (offer.kind === "deal" &&
                world.sites.some((s) => s.id === offer.site && s.kind === "gengar-deal")))),
        `players.${player.id}.pending.offer`,
      );
    }
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
  for (const pickup of world.pickups) {
    check(
      pickup.kind === "trophy"
        ? world.players.some((p) => p.id === pickup.owner)
        : pickup.owner === undefined,
      "pickups.owner",
    );
    check(
      pickup.minRarity === undefined ||
        (pickup.kind === "chest" && count(pickup.minRarity) && pickup.minRarity <= 3),
      "pickups.minRarity",
    );
  }
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
