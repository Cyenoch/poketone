import type { World } from "../run/sim/state/world";
import { encode } from "./codec";

const keys = [
  "players",
  "enemies",
  "projectiles",
  "partners",
  "hazards",
  "pickups",
  "areas",
] as const;
type Key = (typeof keys)[number];
export type EntityState = Pick<World, Key>;
interface Change {
  /** Omitted while entity order is unchanged. */
  order?: number[];
  /** Field names appear once per batch; rows are [id, field index, value, ...]. */
  fields: string[];
  rows: unknown[][];
  unset?: [number, string[]][];
}
export type EntityDelta = Partial<Record<Key, Change>>;

/** Presentation-only fields: a centimetre or centisecond is far below what a frame can show. */
const coarse = new Set([
  "x",
  "z",
  "y",
  "faceX",
  "faceZ",
  "knockX",
  "knockZ",
  "life",
  "delay",
  "phaseTime",
  "attackTimer",
  "hardened",
  "stagger",
]);
/** Previous positions are rebuilt from playback motion on the receiving side. */
const rebuilt = new Set(["px", "pz", "py"]);

/**
 * The compact copy guests receive: guests draw and aim at these entities but never simulate them.
 * Players keep their previous positions, which the owner simulation and rigs read.
 */
export function wireEntities(world: EntityState): EntityState {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      (world[key] as readonly object[]).map((entity) => {
        const out: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(entity)) {
          if (key !== "players" && rebuilt.has(field)) continue;
          // Nested values are copied: the sent baseline must not follow later world mutations.
          out[field] =
            typeof value === "number" && coarse.has(field)
              ? Math.round(value * 100) / 100 || 0
              : typeof value === "object" && value !== null
                ? structuredClone(value)
                : value;
        }
        return out;
      }),
    ]),
  ) as unknown as EntityState;
}

export function entityState(world: EntityState): EntityState {
  return Object.fromEntries(keys.map((key) => [key, world[key]])) as EntityState;
}

const equal = (a: unknown, b: unknown) =>
  Object.is(a, b) ||
  (typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null &&
    encode(a) === encode(b));

/** Field patches retain optional-field deletion, array order, and float64 signed zero. */
export function entityDelta(previous: EntityState, next: EntityState): EntityDelta {
  const result: EntityDelta = {};
  for (const key of keys) {
    const before = previous[key];
    const after = next[key];
    const byId = new Map<number, object>(before.map((entity) => [entity.id, entity]));
    const fields: string[] = [];
    const fieldIds = new Map<string, number>();
    const rows: unknown[][] = [];
    const removed: [number, string[]][] = [];
    for (const entity of after) {
      const old = byId.get(entity.id);
      const row: unknown[] = [entity.id];
      for (const [field, value] of Object.entries(entity))
        if (
          field !== "id" &&
          value !== undefined &&
          (!old || !equal(Reflect.get(old, field), value))
        ) {
          let index = fieldIds.get(field);
          if (index === undefined) {
            index = fields.length;
            fields.push(field);
            fieldIds.set(field, index);
          }
          row.push(index, value);
        }
      const unset = old
        ? Object.keys(old).filter(
            (field) => !Object.hasOwn(entity, field) || Reflect.get(entity, field) === undefined,
          )
        : [];
      if (!old || row.length > 1) rows.push(row);
      if (unset.length) removed.push([entity.id, unset]);
    }
    const reordered =
      before.length !== after.length ||
      before.some((entity, index) => entity.id !== after[index]!.id);
    if (rows.length || removed.length || reordered)
      result[key] = {
        ...(reordered ? { order: after.map((entity) => entity.id) } : {}),
        fields,
        rows,
        ...(removed.length ? { unset: removed } : {}),
      };
  }
  return result;
}

/** Published baselines and buffered snapshots stay immutable; no changes write into the view. */
export function applyEntityDelta(previous: EntityState, delta: EntityDelta): EntityState {
  const result = { ...previous };
  for (const key of keys) {
    const change = delta[key];
    if (!change) continue;
    const entities = new Map<number, object>(previous[key].map((entity) => [entity.id, entity]));
    for (const row of change.rows) {
      const id = row[0] as number;
      const entity: Record<string, unknown> = { ...entities.get(id), id };
      for (let i = 1; i < row.length; i += 2) entity[change.fields[row[i] as number]!] = row[i + 1];
      entities.set(id, entity);
    }
    for (const [id, fields] of change.unset ?? []) {
      const entity = { ...entities.get(id) };
      for (const field of fields) Reflect.deleteProperty(entity, field);
      entities.set(id, entity);
    }
    Object.assign(result, {
      [key]: (change.order ?? previous[key].map((entity) => entity.id)).map((id) => {
        const entity = entities.get(id);
        if (!entity) throw new Error(`世界差分缺少实体：${key}/${id}`);
        return entity;
      }),
    });
  }
  return result;
}
