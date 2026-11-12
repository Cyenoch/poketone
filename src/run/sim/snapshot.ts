// World snapshot boundary for co-op (docs/state-machines/simulation.md): the host sends the generated map
// once, then snapshots of the dynamic state. A peer restores a world from both and, fed the same
// commands, steps exactly like the host's.
import type { GeneratedMap } from "./mapgen/index";
import { navContinuation, restoreNav, type NavContinuation } from "./nav/index";
import type { World } from "./state/world";

/** Snapshot format; bumped when the snapshot's dynamic state shape changes. */
export const SNAPSHOT_VERSION = 4;

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
  return { map, nav: restoreNav(map.terrain, navigation), ...dynamic };
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
