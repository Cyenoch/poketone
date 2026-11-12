import type { ServerWebSocket } from "bun";
import {
  PROTOCOL_VERSION,
  record,
  type PlayerSetup,
  type Room,
  type RoomErrorCode,
  type ServerMessage,
} from "../../src/network/protocol";
import { starters } from "../../src/run/sim/content/lines/index";
import { stageDefs } from "../../src/run/sim/content/stages/index";
import { difficulties } from "../../src/run/sim/content/difficulties";

interface Connection {
  room?: HostedRoom;
  player: number;
}
class RoomError extends Error {
  readonly code: RoomErrorCode;
  constructor(message: string, code: RoomErrorCode) {
    super(message);
    this.code = code;
  }
}
interface HostedRoom {
  state: Room;
  build: string;
  sockets: (ServerWebSocket<Connection> | undefined)[];
  tokens: string[];
  readyLinks: Set<string>;
  departed: Set<number>;
  terminal?: string;
  terminalAcks: Set<number>;
  config?: Extract<ServerMessage, { t: "start" }>["config"];
  expiry?: ReturnType<typeof setTimeout>;
}

/** Harbor owns rooms and transport only. Accounts can live beside this route without owning sim. */
export function startHarbor(
  options: { port?: number; hostname?: string; iceServers?: RTCIceServer[] } = {},
) {
  const rooms = new Map<string, HostedRoom>();
  const connections = new Set<ServerWebSocket<Connection>>();
  const iceServers = options.iceServers ?? [];
  function send(socket: ServerWebSocket<Connection> | undefined, message: ServerMessage) {
    if (!socket) return;
    if (socket.send(JSON.stringify(message)) === 0) socket.close(1011, "中转连接过慢");
  }
  function publish(room: HostedRoom, removed?: number) {
    room.state.ready = room.sockets.flatMap((socket, id) =>
      socket && (id === 0 || (room.readyLinks.has(`0:${id}`) && room.readyLinks.has(`${id}:0`)))
        ? [id]
        : [],
    );
    room.state.online = room.sockets.flatMap((socket, id) => (socket ? [id] : []));
    room.state.departed = [...room.departed];
    room.sockets.forEach((socket, self) =>
      send(socket, {
        t: "room",
        room: room.state,
        self,
        token: room.tokens[self]!,
        iceServers,
        ...(removed === undefined ? {} : { removed }),
      }),
    );
  }
  function destroy(room: HostedRoom) {
    clearTimeout(room.expiry);
    rooms.delete(room.state.code);
    for (const peer of room.sockets) {
      if (!peer) continue;
      peer.data.room = undefined;
      send(peer, { t: "left" });
      peer.close(1000, "房间已关闭");
    }
  }
  /** Before departure: seats are compacted so a lobby keeps 0..n-1 and the run's player ids. */
  function removeLobbySeat(room: HostedRoom, seat: number) {
    room.sockets.splice(seat, 1);
    room.tokens.splice(seat, 1);
    room.state.players.splice(seat, 1);
    room.sockets.forEach((socket, id) => {
      if (socket) socket.data.player = id;
    });
    const shift = (id: number) => (id > seat ? id - 1 : id);
    room.readyLinks = new Set(
      [...room.readyLinks].flatMap((link) => {
        const [from, to] = link.split(":").map(Number) as [number, number];
        return from === seat || to === seat ? [] : [`${shift(from)}:${shift(to)}`];
      }),
    );
    publish(room, seat);
  }
  /** A started run keeps going without a guest who left; the host owns the world. */
  function depart(room: HostedRoom, seat: number) {
    room.departed.add(seat);
    const socket = room.sockets[seat];
    room.sockets[seat] = undefined;
    if (socket) {
      socket.data.room = undefined;
      send(socket, { t: "left" });
      socket.close(1000, "已离开对局");
    }
    if (!completeTerminal(room)) publish(room);
  }
  function deliverTerminal(room: HostedRoom) {
    for (let id = 1; id < room.sockets.length; id++)
      if (!room.terminalAcks.has(id))
        send(room.sockets[id], { t: "terminal", data: room.terminal! });
    completeTerminal(room);
  }
  function completeTerminal(room: HostedRoom): boolean {
    if (!room.terminal) return false;
    for (let id = 0; id < room.sockets.length; id++)
      if (!room.terminalAcks.has(id) && !room.departed.has(id)) return false;
    destroy(room);
    return true;
  }
  const server = Bun.serve<Connection>({
    reusePort: false,
    port: options.port ?? 8787,
    hostname: options.hostname ?? "0.0.0.0",
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === "/health") return Response.json({ service: "harbor", status: "ok" });
      if (path === "/multiplayer" && server.upgrade(request, { data: { player: -1 } })) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(socket) {
        connections.add(socket);
      },
      idleTimeout: 30,
      maxPayloadLength: 16 * 1024 * 1024,
      backpressureLimit: 16 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      message(socket, raw) {
        try {
          const msg: unknown = JSON.parse(String(raw));
          if (!record(msg)) throw new Error("消息格式错误。");
          let room = socket.data.room;
          if (msg.t === "ping") {
            send(socket, { t: "pong" });
            return;
          }
          if (msg.t === "resume") {
            if (room) throw new Error("已经在房间中。");
            if (
              msg.version !== PROTOCOL_VERSION ||
              typeof msg.code !== "string" ||
              typeof msg.token !== "string"
            )
              throw new Error("重连信息无效。");
            room = rooms.get(msg.code);
            if (!room || !room.state.started) throw new Error("原对局已结束，无法重连。");
            if (room.build !== msg.build)
              throw new RoomError("游戏版本不同，无法恢复对局。", "version");
            const player = room.tokens.indexOf(msg.token);
            if (player < 0 || room.departed.has(player)) throw new Error("无法恢复原玩家席位。");
            const old = room.sockets[player];
            if (old) {
              old.data.room = undefined;
              send(old, { t: "error", message: "对局已在另一连接恢复。" });
              old.close(1000, "连接已替换");
            }
            socket.data = { room, player };
            room.sockets[player] = socket;
            if (player !== 0) room.terminalAcks.delete(player);
            if (player === 0 && !room.terminal) clearTimeout(room.expiry);
            publish(room);
            if (player !== 0) send(socket, { t: "start", config: room.config! });
            if (room.terminal) deliverTerminal(room);
            return;
          }
          if (msg.t === "enter") {
            if (room) throw new Error("已经在房间中。");
            if (msg.version !== PROTOCOL_VERSION || typeof msg.build !== "string")
              throw new RoomError("联机版本不同，请刷新游戏。", "version");
            if (
              !record(msg.player) ||
              typeof msg.player.starter !== "string" ||
              !Object.hasOwn(starters, msg.player.starter)
            )
              throw new Error("伙伴选择无效。");
            if (typeof msg.code !== "string") throw new Error("房间码无效。");
            if (msg.code) {
              room = rooms.get(msg.code);
              if (!room) throw new RoomError("房间不存在。", "no-room");
              if (room.state.started) throw new RoomError("房间已经出发。", "started");
              if (room.sockets.length >= 4) throw new RoomError("房间已满。", "full");
              if (room.build !== msg.build)
                throw new RoomError("游戏版本不同，请所有玩家刷新后重建房间。", "version");
            } else {
              let code;
              do
                code = String(crypto.getRandomValues(new Uint32Array(1))[0]! % 1000000).padStart(
                  6,
                  "0",
                );
              while (rooms.has(code));
              room = {
                state: { code, players: [], started: false, ready: [], online: [], departed: [] },
                build: msg.build,
                sockets: [],
                tokens: [],
                readyLinks: new Set(),
                departed: new Set(),
                terminalAcks: new Set(),
              };
              rooms.set(code, room);
            }
            socket.data = { room, player: room.sockets.length };
            room.state.players.push(msg.player as unknown as PlayerSetup);
            room.sockets.push(socket);
            room.tokens.push(crypto.randomUUID());
            publish(room);
            return;
          }
          if (!room) throw new Error("请先进入房间。");
          const from = socket.data.player;
          const target = (to: unknown) => {
            if (
              !Number.isInteger(to) ||
              Number(to) < 0 ||
              Number(to) >= room!.sockets.length ||
              to === from ||
              (from !== 0 && to !== 0)
            )
              throw new Error("联机目标席位无效。");
            return Number(to);
          };
          if (msg.t === "leave-room") {
            if (!room.state.started) {
              socket.data.room = undefined;
              socket.close(1000, "已离开房间");
              if (from === 0) destroy(room);
              else removeLobbySeat(room, from);
            } else if (room.terminal) {
              room.sockets[from] = undefined;
              socket.data.room = undefined;
              send(socket, { t: "left" });
              socket.close(1000, "结算已交付");
              if (!completeTerminal(room)) publish(room);
            } else if (from === 0) destroy(room);
            else depart(room, from);
            return;
          }
          if (msg.t === "quit") {
            if (!room.state.started || from === 0) throw new Error("只有队友可以中途离开对局。");
            if (!room.terminal) depart(room, from);
            return;
          }
          if (msg.t === "terminal") {
            if (from !== 0 || !room.state.started || typeof msg.data !== "string")
              throw new Error("终局交付无效。");
            // One host result survives transport loss until every original seat has received it.
            if (!room.terminal) {
              room.terminal = msg.data;
              clearTimeout(room.expiry);
              room.expiry = setTimeout(() => destroy(room), 10 * 60 * 1000);
            }
            room.terminalAcks.add(0);
            deliverTerminal(room);
            return;
          }
          if (msg.t === "terminal-ack") {
            if (!room.terminal) throw new Error("终局尚未提交。");
            room.terminalAcks.add(from);
            completeTerminal(room);
            return;
          }
          if (msg.t === "start") {
            if (
              socket.data.player !== 0 ||
              room.state.started ||
              room.sockets.length < 2 ||
              room.state.ready.length !== room.sockets.length
            )
              throw new Error("等待全部玩家连接就绪后由房主出发。");
            if (
              msg.stage !== "forest" ||
              !Number.isInteger(msg.difficulty) ||
              !Object.hasOwn(difficulties, Number(msg.difficulty))
            )
              throw new Error("冒险设置无效。");
            room.state.started = true;
            const config = {
              stage: msg.stage as keyof typeof stageDefs,
              difficulty: Number(msg.difficulty) as 0 | 1 | 2,
              players: room.state.players,
            };
            room.config = config;
            publish(room);
            room.sockets.forEach((peer) => send(peer, { t: "start", config }));
          } else if (msg.t === "transport-ready") {
            const to = target(msg.peer);
            if (room.state.started) return;
            room.readyLinks.add(`${from}:${to}`);
            publish(room);
          } else if (msg.t === "signal") {
            const to = target(msg.to);
            if (record(msg.signal) && msg.signal.mode === "direct" && from !== 0)
              throw new Error("只有房主能选择直连模式。");
            send(room.sockets[to], { t: "signal", from, signal: msg.signal });
          } else if (msg.t === "relay" && typeof msg.data === "string") {
            send(room.sockets[target(msg.to)], { t: "relay", from, data: msg.data });
          } else throw new Error("未知联机消息。");
        } catch (error) {
          send(socket, {
            t: "error",
            message: (error as Error).message,
            ...(error instanceof RoomError ? { code: error.code } : {}),
          });
        }
      },
      close(socket) {
        connections.delete(socket);
        const room = socket.data.room;
        if (!room) return;
        const seat = socket.data.player;
        if (!room.state.started) {
          if (seat === 0) destroy(room);
          else removeLobbySeat(room, seat);
          return;
        }
        room.sockets[seat] = undefined;
        // The host's world survives a dropped Harbor connection for a while; guests only go offline.
        if (seat === 0 && !room.terminal) {
          clearTimeout(room.expiry);
          room.expiry = setTimeout(() => destroy(room), 10 * 60 * 1000);
        }
        publish(room);
      },
    },
  });

  return Object.assign(server, {
    async shutdown() {
      const stopped = server.stop();
      // Idle lobby sockets also need a close frame; they may never have entered a room.
      for (const socket of connections) {
        socket.data.room = undefined;
        socket.close(1001, "Server shutting down");
      }
      for (const room of rooms.values()) clearTimeout(room.expiry);
      rooms.clear();
      const deadline = setTimeout(() => void server.stop(true), 10_000);
      try {
        await stopped;
      } finally {
        clearTimeout(deadline);
      }
    },
  });
}

if (import.meta.main) {
  const server = startHarbor({
    port: Number(Bun.env.PORT ?? 8787),
    hostname: Bun.env.HOST ?? "0.0.0.0",
    iceServers: JSON.parse(Bun.env.ICE_SERVERS ?? "[]"),
  });
  console.log(`Harbor listening on ${server.url}`);
  const shutdown = () => void server.shutdown();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
