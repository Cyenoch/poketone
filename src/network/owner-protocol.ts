import { record } from "./protocol";
import type { OwnerFrame } from "./owner";
import { moves } from "../run/sim/content/moves";
import { statuses } from "../run/sim/content/statuses";
import { typeNames } from "../run/sim/content/elements";
import { starters } from "../run/sim/content/lines";
import { archetypes, areaRules } from "../run/sim/archetypes";
import { timeline } from "../run/sim/ultimates";
import type { Player } from "../run/sim/state/entities";

/** Trusted peers still cross a data boundary: reject malformed/non-finite state before mutation. */
export function validateOwner(frame: OwnerFrame, player: Player): void {
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const check = (value: unknown, depth = 0): boolean => {
    if (depth > 16) return false;
    if (typeof value === "number") return finite(value);
    if (
      value === undefined ||
      value === null ||
      typeof value === "boolean" ||
      typeof value === "string"
    )
      return true;
    return (
      (Array.isArray(value) || record(value)) &&
      Object.values(value).every((entry) => check(entry, depth + 1))
    );
  };
  if (
    !check(frame) ||
    typeof frame.cancelRescue !== "boolean" ||
    frame.effects.length > 8192 ||
    frame.events.length > 8192 ||
    frame.projectiles.length > 8192 ||
    frame.areas.length > 8192
  )
    throw new Error("玩家状态数据无效。");
  if (
    frame.events.some(
      (event) =>
        !record(event) || ["banner", "capture", "evolve", "revive", "down"].includes(event.t),
    )
  )
    throw new Error("玩家状态不能提交共享通知或奖励。");
  if (
    !Number.isSafeInteger(frame.nextId) ||
    frame.nextId < -(player.id + 1) * 1e12 ||
    frame.nextId >= -player.id * 1e12
  )
    throw new Error("攻击ID无效。");
  const state = frame.state;
  for (const key of [
    "x",
    "z",
    "px",
    "pz",
    "vx",
    "vz",
    "faceX",
    "faceZ",
    "viewYaw",
    "inputX",
    "inputZ",
    "dashTime",
    "dashCooldown",
    "dashes",
    "dashX",
    "dashZ",
    "invulnerable",
  ] as const)
    if (!finite(state[key])) throw new Error(`玩家状态 ${key} 无效。`);
  if (
    typeof state.moving !== "boolean" ||
    !record(state.ult) ||
    !record(state.fx) ||
    !Array.isArray(state.cooldowns) ||
    !Object.values(state.fx).every(finite)
  )
    throw new Error("玩家技能状态无效。");
  const ult = state.ult;
  if (
    ![ult.charge, ult.room, ult.elapsed, ult.x, ult.z, ult.ax, ult.az, ult.pathX, ult.pathZ].every(
      finite,
    ) ||
    !Number.isSafeInteger(ult.stage) ||
    ult.stage < 0 ||
    ult.stage >= starters[player.starter].stages.length ||
    !Number.isSafeInteger(ult.next) ||
    ult.next < 0 ||
    ult.next > timeline(starters[player.starter].ultimate, ult.stage).length ||
    !Array.isArray(ult.crossed) ||
    !ult.crossed.every(Number.isSafeInteger)
  )
    throw new Error("玩家终极技状态无效。");
  for (const entry of state.cooldowns)
    if (
      !record(entry) ||
      !Object.hasOwn(moves, entry.id) ||
      !finite(entry.cooldown) ||
      (entry.waiting !== undefined && entry.waiting !== true)
    )
      throw new Error("玩家冷却状态无效。");
  for (const entity of [...frame.projectiles, ...frame.areas])
    if (
      !record(entity) ||
      entity.owner !== player.id ||
      !Number.isSafeInteger(entity.id) ||
      entity.id < -(player.id + 1) * 1e12 ||
      entity.id >= -player.id * 1e12 ||
      !finite(entity.x) ||
      !finite(entity.z) ||
      !finite(entity.life)
    )
      throw new Error("玩家攻击实体无效。");
  for (const shot of frame.projectiles) {
    if (
      !Object.hasOwn(moves, shot.move) ||
      !Object.hasOwn(archetypes, shot.archetype) ||
      !archetypes[shot.archetype].shot ||
      !Object.hasOwn(typeNames, shot.type) ||
      (shot.status !== undefined && !Object.hasOwn(statuses, shot.status)) ||
      !Array.isArray(shot.hit) ||
      !shot.hit.every(Number.isSafeInteger) ||
      !Number.isSafeInteger(shot.target) ||
      ![
        shot.y,
        shot.px,
        shot.py,
        shot.pz,
        shot.vx,
        shot.vy,
        shot.vz,
        shot.radius,
        shot.dmg,
        shot.pierce,
        shot.area,
        shot.dur,
        shot.statusChance,
        shot.crit,
        shot.delay,
      ].every(finite)
    )
      throw new Error("玩家弹体状态无效。");
  }
  for (const area of frame.areas) {
    if (
      (area.move !== null && !Object.hasOwn(moves, area.move)) ||
      !Object.hasOwn(areaRules, area.kind) ||
      !Object.hasOwn(typeNames, area.type) ||
      (area.status !== undefined && !Object.hasOwn(statuses, area.status)) ||
      typeof area.follow !== "boolean" ||
      ![
        area.dirX,
        area.dirZ,
        area.radius,
        area.length,
        area.rise,
        area.angle,
        area.maxLife,
        area.delay,
        area.tick,
        area.tickTimer,
        area.dmg,
        area.statusChance,
        area.crit,
        area.count,
        area.released,
        area.scale,
      ].every(finite)
    )
      throw new Error("玩家范围攻击状态无效。");
  }
  for (const effect of frame.effects) {
    if (!record(effect)) throw new Error("玩家战斗数据无效。");
    if (effect.t !== "heal" && !Number.isSafeInteger(effect.enemy))
      throw new Error("命中目标无效。");
    switch (effect.t) {
      case "hit": {
        const hit = effect.hit;
        if (
          !record(hit) ||
          !finite(effect.x) ||
          !finite(effect.z) ||
          (hit.move !== null && !Object.hasOwn(moves, hit.move)) ||
          !Object.hasOwn(typeNames, hit.type) ||
          ![hit.dmg, hit.crit, hit.statusChance, hit.knock, hit.fromX, hit.fromZ].every(finite) ||
          (hit.status !== undefined && !Object.hasOwn(statuses, hit.status)) ||
          (hit.drain !== undefined && !finite(hit.drain)) ||
          (hit.secondary !== undefined && typeof hit.secondary !== "boolean")
        )
          throw new Error("命中数据无效。");
        break;
      }
      case "status":
        if (
          !Object.hasOwn(statuses, effect.status) ||
          !finite(effect.time) ||
          !finite(effect.power)
        )
          throw new Error("状态数据无效。");
        break;
      case "pull":
        if (![effect.x, effect.z, effect.step, effect.stop].every(finite))
          throw new Error("位移数据无效。");
        break;
      case "heal":
        if (!finite(effect.amount)) throw new Error("治疗数据无效。");
        break;
      default:
        throw new Error("未知战斗数据。");
    }
  }
}
