import type { RunConfig } from "../run/sim/world";
import type { Command } from "../run/sim/state/commands";

export const PROTOCOL_VERSION = 10;
export type RoomErrorCode = "no-room" | "full" | "started" | "version";
export type PlayerSetup = RunConfig["players"][number];
export interface Room {
  code: string;
  players: PlayerSetup[];
  started: boolean;
  ready: number[];
  /** Seats whose Harbor connection is currently open. */
  online: number[];
  /** Guests who left a started run for good; their seat is never reused. */
  departed: number[];
}
export type ClientMessage =
  | { t: "enter"; version: number; build: string; code: string; player: PlayerSetup }
  | { t: "resume"; version: number; build: string; code: string; token: string }
  | { t: "leave-room" }
  | { t: "quit" }
  | { t: "terminal"; data: string }
  | { t: "terminal-ack" }
  | { t: "ping" }
  | { t: "start"; stage: RunConfig["stage"]; difficulty: RunConfig["difficulty"] }
  | { t: "transport-ready"; peer: number }
  | { t: "signal"; to: number; signal: unknown }
  | { t: "relay"; to: number; data: string };
export type ServerMessage =
  | {
      t: "room";
      room: Room;
      self: number;
      token: string;
      iceServers: RTCIceServer[];
      /** A lobby seat that was removed; higher seats moved down by one. */
      removed?: number;
    }
  | { t: "pong" }
  | { t: "terminal"; data: string }
  | { t: "start"; config: Omit<RunConfig, "seed"> }
  | { t: "signal"; from: number; signal: unknown }
  | { t: "relay"; from: number; data: string }
  | { t: "error"; message: string; code?: RoomErrorCode }
  | { t: "left" };

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Peers send intent; player ownership is assigned by the connection, never by its payload. */
export function peerCommand(value: unknown, player: number): Command {
  if (!record(value)) throw new Error("联机指令格式错误。");
  const finite = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]);
  const integer = (key: string) =>
    finite(key) && Number.isInteger(value[key]) && Number(value[key]) >= 0;
  switch (value.t) {
    case "move":
      if (finite("x") && finite("z"))
        return {
          t: "move",
          player,
          x: Math.max(-1, Math.min(1, Number(value.x))),
          z: Math.max(-1, Math.min(1, Number(value.z))),
        };
      break;
    case "view":
      if (finite("yaw")) return { t: "view", player, yaw: Number(value.yaw) };
      break;
    case "dash":
    case "ult":
    case "interact":
      return { t: value.t, player };
    case "choices":
      if (typeof value.open === "boolean") return { t: "choices", player, open: value.open };
      break;
    case "pick":
    case "banish":
      if (integer("card") && integer("index"))
        return { t: value.t, player, card: Number(value.card), index: Number(value.index) };
      break;
    case "reroll":
    case "skip":
      if (integer("card")) return { t: value.t, player, card: Number(value.card) };
      break;
    case "fuse":
    case "leave":
      if (integer("dialog")) return { t: value.t, player, dialog: Number(value.dialog) };
      break;
    case "forget":
      if (
        integer("dialog") &&
        record(value.target) &&
        (value.target.kind === "move" || value.target.kind === "item") &&
        typeof value.target.id === "string"
      )
        return {
          t: "forget",
          player,
          dialog: Number(value.dialog),
          target: value.target as Extract<Command, { t: "forget" }>["target"],
        };
      break;
  }
  throw new Error("不支持的联机指令。");
}
