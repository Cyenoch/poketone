import type { RunConfig } from "../run/sim/world";
import type { Command } from "../run/sim/state/commands";
import { difficulties } from "../run/sim/content/difficulties";
import { starters, type StarterId } from "../run/sim/content/lines/index";
import type { StageId } from "../run/sim/content/stages/index";
import { playableStages } from "../lobbyPick";
import type { TrainerId } from "../trainers";

export const PROTOCOL_VERSION = 13;
export type RoomErrorCode = "no-room" | "full" | "started" | "version";
export type PlayerSetup = RunConfig["players"][number] & { trainer: TrainerId };
/** The host's choice of route and difficulty; changed only before the room starts. */
export type Mission = Pick<RunConfig, "stage" | "difficulty">;
export type MultiplayerConfig = Omit<RunConfig, "seed" | "players"> & {
  players: readonly PlayerSetup[];
};
export interface Room {
  code: string;
  players: PlayerSetup[];
  mission: Mission;
  started: boolean;
  ready: number[];
  /** Seats whose Harbor connection is currently open. */
  online: number[];
  /** Guests who left a started run for good; their seat is never reused. */
  departed: number[];
}
export type ClientMessage =
  | {
      t: "enter";
      version: number;
      build: string;
      code: string;
      player: PlayerSetup;
      /** Creating only: the room's first mission. */
      mission?: Mission;
    }
  | { t: "resume"; version: number; build: string; code: string; token: string }
  | { t: "leave-room" }
  | { t: "quit" }
  | { t: "terminal"; data: string }
  | { t: "terminal-ack" }
  | { t: "ping" }
  | { t: "start" }
  /** Before the start: the sender's own partner, trainer and look. */
  | ({ t: "setup" } & Pick<PlayerSetup, "starter" | "trainer" | "shiny">)
  /** Before the start, host only. */
  | ({ t: "mission" } & Mission)
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
  | { t: "start"; config: MultiplayerConfig }
  | { t: "signal"; from: number; signal: unknown }
  | { t: "relay"; from: number; data: string }
  | { t: "error"; message: string; code?: RoomErrorCode }
  | { t: "left" };

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function knownStarter(value: unknown): value is StarterId {
  return typeof value === "string" && Object.hasOwn(starters, value);
}

export function knownMission(value: unknown): value is Mission {
  return (
    record(value) &&
    playableStages.includes(value.stage as StageId) &&
    Number.isInteger(value.difficulty) &&
    Object.hasOwn(difficulties, Number(value.difficulty))
  );
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
