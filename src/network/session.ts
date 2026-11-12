import { pack, unpack } from "./wire";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type PlayerSetup,
  type Room,
  type RoomErrorCode,
  type ServerMessage,
} from "./protocol";
import type { RunConfig } from "../run/sim/world";
import type { DirectPeer, DirectPeerFactory, IceServer, PeerSignal } from "../platform/direct-peer";

declare const __GAME_BUILD__: string;
export interface RejoinTicket {
  url: string;
  code: string;
  token: string;
  build: string;
}
export function parseRejoinTicket(text: string | null): RejoinTicket | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as RejoinTicket;
    return value &&
      value.build === __GAME_BUILD__ &&
      typeof value.url === "string" &&
      typeof value.code === "string" &&
      typeof value.token === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}
export type ConnectionMode = "connecting" | "direct" | "relay";
export interface SessionState {
  room: Room | null;
  self: number;
  mode: ConnectionMode;
  error: string;
  errorCode?: RoomErrorCode;
  starting: boolean;
  canStart: boolean;
  peers: Record<number, ConnectionMode>;
}

export interface MultiplayerSessionOptions {
  directPeer: DirectPeerFactory;
  signal: AbortSignal;
  rejoin?: RejoinTicket;
}

interface Link {
  peer?: DirectPeer;
  /** Lobby negotiation result; in play it only says which path carries outgoing data. */
  mode: ConnectionMode;
  timer?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  retries: number;
  pieces: string;
  lastPong: number;
  /** Direct data that arrived before the peer's switch marker over Harbor; kept in order. */
  early: string[];
  inbound: "direct" | "relay";
  reachable: boolean;
}

/** Sent over Harbor before the first direct packet, so direct data never overtakes relayed data. */
const SWITCH = "D";

/** Created only by the multiplayer window. Importing this module never opens a connection. */
export class MultiplayerSession {
  readonly state: SessionState = {
    room: null,
    self: 0,
    mode: "connecting",
    error: "",
    starting: false,
    canStart: false,
    peers: {},
  };
  onChange: () => void = () => {};
  onStart: (config: Omit<RunConfig, "seed">) => void = () => {};
  onFailure: (error: Error) => void = () => {};
  onTicket: (ticket: RejoinTicket | null) => void = () => {};
  onWarning: (error: Error) => void = (error) => console.error(error);
  /**
   * In play: a peer became reachable or unreachable, or its path changed in a way that may have
   * lost data in flight (`reachable` stays true). The run resynchronizes that seat.
   */
  onPath: (peer: number, reachable: boolean) => void = () => {};
  /** Host only: a guest left the started run for good. */
  onDeparted: (peer: number) => void = () => {};
  readonly restored: boolean;
  private readonly rejoin?: RejoinTicket;
  private socket!: WebSocket;
  private readonly url: string;
  private readonly entry: Extract<ClientMessage, { t: "enter" }>;
  private token = "";
  private iceServers: IceServer[] = [];
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private lastPong = Date.now();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private links = new Map<number, Link>();
  private readonly options: MultiplayerSessionOptions;
  private readonly abort = () => this.close(false);
  private connectTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private playing = false;
  private ended = false;
  private quitting = false;
  private terminal?: string;
  private leaving = false;
  private receiver?: (packet: unknown, from: number) => void;
  private pending: { packet: unknown; from: number }[] = [];

  constructor(url: string, code: string, player: PlayerSetup, options: MultiplayerSessionOptions) {
    options.signal.throwIfAborted();
    this.options = options;
    this.restored = Boolean(options.rejoin);
    this.rejoin = options.rejoin;
    this.url = url;
    this.entry = { t: "enter", version: PROTOCOL_VERSION, build: __GAME_BUILD__, code, player };
    this.open();
    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      for (const [id, link] of this.links) {
        if (!link.peer?.open) continue;
        if (Date.now() - link.lastPong > 8000) this.dropDirect(id);
        else {
          try {
            link.peer.send("P");
          } catch {
            this.dropDirect(id);
          }
        }
      }
      if (this.socket.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastPong > 15000) this.socket.close();
        else this.signal({ t: "ping" });
      }
    }, 2000);
    options.signal.addEventListener("abort", this.abort, { once: true });
  }

  private open() {
    if (this.closed) return;
    const socket = (this.socket = new WebSocket(this.url));
    this.lastPong = Date.now();
    this.connectTimer = setTimeout(() => {
      if (socket !== this.socket) return;
      if (this.playing || this.rejoin) socket.close();
      else this.fail(new Error("连接中断"));
    }, 10000);
    socket.onopen = () => {
      if (socket !== this.socket || this.closed) return;
      this.lastPong = Date.now();
      this.signal(
        this.playing && this.token && this.state.room
          ? {
              t: "resume",
              version: PROTOCOL_VERSION,
              build: __GAME_BUILD__,
              code: this.state.room.code,
              token: this.token,
            }
          : this.rejoin
            ? {
                t: "resume",
                version: PROTOCOL_VERSION,
                build: __GAME_BUILD__,
                code: this.rejoin.code,
                token: this.rejoin.token,
              }
            : this.entry,
      );
    };
    socket.onmessage = (event) => {
      if (socket !== this.socket || this.closed) return;
      try {
        this.message(JSON.parse(String(event.data)) as ServerMessage);
      } catch (error) {
        this.fail(error as Error);
      }
    };
    socket.onerror = () => {
      if (!this.playing && !this.rejoin) this.fail(new Error("连接中断"));
      else socket.close();
    };
    socket.onclose = () => {
      if (socket !== this.socket || this.closed) return;
      clearTimeout(this.connectTimer);
      if (!this.playing && !this.rejoin) {
        this.fail(new Error("连接中断"));
        return;
      }
      this.updatePaths();
      this.retry = setTimeout(
        () => this.open(),
        Math.min(5000, 500 * 2 ** Math.min(this.attempts++, 4)),
      );
    };
  }
  private resetPeer(id: number) {
    const link = this.links.get(id);
    if (!link) return;
    clearTimeout(link.timer);
    const peer = link.peer;
    link.peer = undefined;
    link.pieces = "";
    link.early = [];
    link.inbound = "relay";
    peer?.close();
  }
  private changed() {
    this.state.peers = Object.fromEntries([...this.links].map(([id, link]) => [id, link.mode]));
    const modes = [...this.links.values()].map((link) => link.mode);
    this.state.mode =
      !modes.length || modes.includes("connecting")
        ? "connecting"
        : modes.includes("relay")
          ? "relay"
          : "direct";
    const room = this.state.room;
    this.state.canStart =
      this.state.self === 0 &&
      !this.playing &&
      !this.state.starting &&
      !!room &&
      !room.started &&
      room.players.length >= 2 &&
      room.ready.length === room.players.length &&
      this.state.mode !== "connecting";
    this.onChange();
  }
  private socketOpen() {
    return this.socket.readyState === WebSocket.OPEN;
  }
  /** Harbor can carry data to this peer right now. */
  private relayable(id: number) {
    return this.socketOpen() && !!this.state.room?.online.includes(id);
  }
  private reachable(id: number) {
    const link = this.links.get(id)!;
    return (link.mode === "direct" && !!link.peer?.open) || this.relayable(id);
  }
  /** Reports reachability changes in play; Harbor's room list and both paths decide it. */
  private updatePaths() {
    if (!this.playing || this.closed || this.ended) return;
    for (const [id, link] of this.links) {
      const reachable = this.reachable(id);
      if (reachable === link.reachable) continue;
      link.reachable = reachable;
      this.onPath(id, reachable);
    }
    this.changed();
  }
  /** A broken direct path falls back to Harbor for this peer only; data in flight may be lost. */
  private dropDirect(id: number) {
    const link = this.links.get(id);
    if (!link || this.closed) return;
    if (!this.playing) {
      this.selectMode(id, "relay");
      return;
    }
    const wasDirect = link.mode === "direct";
    this.resetPeer(id);
    link.mode = "relay";
    if (this.ended) return;
    const reachable = this.reachable(id);
    if (wasDirect && reachable && link.reachable) this.onPath(id, true);
    this.updatePaths();
    this.scheduleDirect(id);
  }
  /** The host keeps offering a direct path while a guest plays over Harbor. */
  private scheduleDirect(id: number) {
    const link = this.links.get(id)!;
    if (this.state.self !== 0 || this.ended || this.closed || link.retry) return;
    const delay = Math.min(60000, 5000 * 2 ** Math.min(link.retries++, 4));
    link.retry = setTimeout(() => {
      link.retry = undefined;
      if (this.closed || this.ended || link.peer || !this.relayable(id)) {
        if (!this.closed && !this.ended && !link.peer) this.scheduleDirect(id);
        return;
      }
      this.connectPeer(id);
    }, delay);
  }

  private signal(message: ClientMessage) {
    if (!this.socketOpen()) throw new Error("Harbor 尚未连接。");
    this.socket.send(JSON.stringify(message));
  }
  private message(message: ServerMessage) {
    switch (message.t) {
      case "pong":
        this.lastPong = Date.now();
        break;
      case "terminal":
        if (this.ended) this.finish();
        else this.deliver(unpack(message.data), 0);
        break;
      case "room": {
        clearTimeout(this.connectTimer);
        this.token = message.token;
        this.iceServers = message.iceServers;
        this.attempts = 0;
        const previous = this.state.room;
        if (message.removed !== undefined && this.state.self === 0) {
          // Lobby seats above the removed one moved down; their links follow.
          this.resetPeer(message.removed);
          const links = new Map<number, Link>();
          for (const [id, link] of this.links)
            if (id !== message.removed) links.set(id > message.removed ? id - 1 : id, link);
          this.links = links;
        }
        this.state.room = message.room;
        this.state.self = message.self;
        for (const id of message.room.players.keys()) {
          if (id === this.state.self || (this.state.self !== 0 && id !== 0) || this.links.has(id))
            continue;
          this.links.set(id, {
            mode: this.playing ? "relay" : "connecting",
            pieces: "",
            lastPong: Date.now(),
            early: [],
            inbound: "relay",
            retries: 0,
            reachable: true,
          });
          if (!message.room.started && !this.playing) this.connectPeer(id);
        }
        if (this.terminal) this.signal({ t: "terminal", data: this.terminal });
        else if (this.ended) this.signal({ t: "terminal-ack" });
        else if (this.quitting) this.signal({ t: "quit" });
        if (this.leaving) {
          this.close();
          break;
        }
        if (this.playing && this.state.self === 0)
          for (const id of message.room.departed)
            if (!previous?.departed.includes(id) && this.links.has(id)) {
              const link = this.links.get(id)!;
              clearTimeout(link.retry);
              this.resetPeer(id);
              this.links.delete(id);
              this.onDeparted(id);
            }
        if (this.playing) this.updatePaths();
        else this.changed();
        break;
      }
      case "signal": {
        if (!this.links.has(message.from)) break;
        void this.acceptSignal(message.from, message.signal).catch(() => {
          this.dropDirect(message.from);
        });
        break;
      }
      case "start":
        if (this.playing) break;
        this.state.starting = false;
        this.playing = true;
        for (const link of this.links.values()) {
          link.reachable = true;
          link.inbound = link.mode === "direct" ? "direct" : "relay";
        }
        if (this.state.self !== 0)
          this.saveTicket({
            url: this.url,
            code: this.state.room!.code,
            token: this.token,
            build: __GAME_BUILD__,
          });
        this.changed();
        this.onStart(message.config);
        if (this.state.self === 0)
          for (const [id, link] of this.links) if (link.mode !== "direct") this.scheduleDirect(id);
        break;
      case "relay":
        if (!this.links.has(message.from)) break;
        if (message.data === SWITCH) {
          const link = this.links.get(message.from)!;
          link.inbound = "direct";
          for (const text of link.early.splice(0)) this.assemble(message.from, text);
        } else this.deliver(unpack(message.data), message.from);
        break;
      case "error":
        this.state.errorCode = message.code;
        this.fail(new Error(message.message));
        break;
      case "left":
        if (this.ended || this.quitting) this.close(false);
        else this.fail(new Error(this.state.self === 0 ? "房间已关闭" : "房主已离开"));
        break;
    }
  }
  /** Lobby seats can shift down while a peer stays open, so callbacks look up the link's seat. */
  private seatOf(link: Link) {
    for (const [id, value] of this.links) if (value === link) return id;
    return undefined;
  }
  private connectPeer(id: number) {
    const link = this.links.get(id)!;
    const initiator = this.state.self === 0;
    const current = (peer: DirectPeer | undefined, act: (id: number) => void) => {
      const seat = this.seatOf(link);
      if (seat !== undefined && link.peer === peer) act(seat);
    };
    if (initiator)
      link.timer = setTimeout(() => current(link.peer, (id) => this.dropDirect(id)), 8000);
    try {
      const peer: DirectPeer = this.options.directPeer(
        { initiator, iceServers: this.iceServers },
        {
          signal: (signal) => {
            const seat = this.seatOf(link);
            if (seat !== undefined && !this.closed && this.socketOpen())
              this.signal({ t: "signal", to: seat, signal });
          },
          opened: () =>
            current(peer, (id) => {
              link.lastPong = Date.now();
              if (!this.playing) {
                if (!this.state.self) this.selectMode(id, "direct");
                return;
              }
              clearTimeout(link.timer);
              link.retries = 0;
              // Relayed data sent before this marker is delivered before any direct data.
              if (this.relayable(id)) this.signal({ t: "relay", to: id, data: SWITCH });
              link.mode = "direct";
              this.updatePaths();
            }),
          disconnected: () => current(peer, (id) => this.dropDirect(id)),
          message: (text) => current(peer, (id) => this.peerMessage(id, text)),
          error: () => current(peer, (id) => this.dropDirect(id)),
        },
      );
      if (!this.playing && link.mode === "relay") peer.close();
      else link.peer = peer;
    } catch {
      this.dropDirect(id);
    }
  }
  private async acceptSignal(id: number, signal: unknown) {
    const link = this.links.get(id)!;
    if (!signal || typeof signal !== "object") throw new Error("直连信令无效。");
    if ("mode" in signal) {
      if (signal.mode !== "direct" && signal.mode !== "relay") throw new Error("直连模式无效。");
      if (this.state.self === 0 && signal.mode === "direct") throw new Error("客机不能选择直连。");
      this.selectMode(id, signal.mode);
      return;
    }
    const data = signal as Partial<
      Extract<PeerSignal, { description: unknown }> & Extract<PeerSignal, { candidate: unknown }>
    >;
    // In play the host may offer a fresh direct path; the guest answers with a new peer.
    if (
      this.playing &&
      this.state.self !== 0 &&
      data.description?.type === "offer" &&
      !this.ended
    ) {
      this.dropDirect(id);
      this.connectPeer(id);
    }
    if (!link.peer || (!this.playing && link.mode === "relay")) return;
    if (data.description) {
      if (
        !["offer", "answer"].includes(data.description.type) ||
        typeof data.description.sdp !== "string"
      )
        throw new Error("直连会话描述无效。");
      await link.peer.accept({ description: data.description });
    } else if (data.candidate && typeof data.candidate.candidate === "string") {
      const candidate = data.candidate;
      if (
        (candidate.sdpMid != null && typeof candidate.sdpMid !== "string") ||
        (candidate.sdpMLineIndex != null && !Number.isInteger(candidate.sdpMLineIndex)) ||
        (candidate.usernameFragment != null && typeof candidate.usernameFragment !== "string")
      )
        throw new Error("直连候选地址无效。");
      await link.peer.accept({ candidate });
    } else throw new Error("直连信令无效。");
  }
  private selectMode(id: number, mode: "direct" | "relay") {
    const link = this.links.get(id);
    if (!link || this.closed || this.playing || link.mode === mode || link.mode === "relay") return;
    clearTimeout(link.timer);
    link.mode = mode;
    if (this.state.self === 0 || mode === "relay")
      this.signal({ t: "signal", to: id, signal: { mode } });
    if (mode === "relay") this.resetPeer(id);
    this.signal({ t: "transport-ready", peer: id });
    this.changed();
  }
  private peerMessage(id: number, text: string) {
    const link = this.links.get(id)!;
    try {
      if (text === "P") {
        link.peer!.send("Q");
        return;
      }
      link.lastPong = Date.now();
      if (text === "Q") return;
      // Until the switch marker arrives over a working Harbor path, relayed data may still be due.
      if (this.playing && link.inbound === "relay" && this.relayable(id)) link.early.push(text);
      else this.assemble(id, text);
    } catch (error) {
      this.fail(error as Error);
    }
  }
  private assemble(id: number, text: string) {
    const link = this.links.get(id)!;
    if (text[0] !== "0" && text[0] !== "1") throw new Error("联机数据格式无效。");
    link.pieces += text.slice(1);
    if (link.pieces.length > 16 * 1024 * 1024) throw new Error("联机数据过大。");
    if (text[0] === "1") {
      const packet = unpack(link.pieces);
      link.pieces = "";
      this.deliver(packet, id);
    }
  }
  private deliver(packet: unknown, from: number) {
    if (!this.links.has(from)) return;
    if (this.receiver) this.receiver(packet, from);
    else this.pending.push({ packet, from });
  }
  receive(receiver: (packet: unknown, from: number) => void): () => void {
    this.receiver = receiver;
    for (const { packet, from } of this.pending.splice(0)) receiver(packet, from);
    return () => {
      if (this.receiver === receiver) this.receiver = undefined;
    };
  }
  start(stage: RunConfig["stage"], difficulty: RunConfig["difficulty"]) {
    if (!this.state.canStart) return;
    this.state.starting = true;
    this.signal({ t: "start", stage, difficulty });
    this.changed();
  }
  /** Seats this session can currently exchange data with. */
  isReachable(id: number): boolean {
    return this.links.has(id) && this.reachable(id);
  }
  private saveTicket(ticket: RejoinTicket | null) {
    try {
      this.onTicket(ticket);
    } catch (cause) {
      this.onWarning(new Error(`重返凭据${ticket ? "保存" : "清除"}失败`, { cause }));
    }
  }
  /** A guest leaves the started run; the host and the other guests keep playing. */
  quit() {
    this.quitting = true;
    if (this.socketOpen()) this.signal({ t: "quit" });
  }
  /** Harbor retains the host result and acknowledges delivery independently of render ticks. */
  finish(terminal?: unknown) {
    if (terminal && !this.terminal) this.terminal = pack(terminal);
    if (!this.ended) this.saveTicket(null);
    this.ended = true;
    if (this.socketOpen()) {
      if (this.terminal) this.signal({ t: "terminal", data: this.terminal });
      else if (this.state.self !== 0) this.signal({ t: "terminal-ack" });
      if (this.leaving) this.signal({ t: "leave-room" });
    }
  }
  /** Replaceable packets are skipped under congestion so latency stays bounded; reliable ones queue. */
  send(packet: unknown, replaceable = false, target?: number): boolean {
    if (this.closed) return false;
    const targets = target === undefined ? [...this.links.keys()] : [target];
    let sent = true;
    for (const id of targets) if (!this.sendTo(id, packet, replaceable)) sent = false;
    return sent;
  }
  private sendTo(id: number, packet: unknown, replaceable: boolean): boolean {
    const link = this.links.get(id);
    if (!link) return false;
    const direct = link.mode === "direct" && !!link.peer?.open;
    if (!direct && !this.relayable(id)) return false;
    const buffered = direct ? link.peer!.bufferedAmount : this.socket.bufferedAmount;
    if (replaceable && buffered > 64 * 1024) return false;
    if (buffered > 8 * 1024 * 1024) {
      if (direct) this.dropDirect(id);
      else this.socket.close();
      return false;
    }
    const text = pack(packet);
    if (direct) {
      try {
        for (let i = 0; i < text.length; i += 12000)
          link.peer!.send(`${i + 12000 >= text.length ? "1" : "0"}${text.slice(i, i + 12000)}`);
      } catch {
        this.dropDirect(id);
        return false;
      }
    } else this.signal({ t: "relay", to: id, data: text });
    return true;
  }
  fail(error: Error) {
    if (this.closed) return;
    this.state.error = error.message;
    this.state.canStart = false;
    this.onChange();
    this.onFailure(error);
    this.close();
  }
  close(leave = true) {
    if (this.closed) return;
    if (
      leave &&
      !this.state.error &&
      this.playing &&
      (!this.socketOpen() || this.quitting || this.ended)
    ) {
      // Keep only the transport alive until the intentional departure reaches Harbor.
      this.leaving = true;
      this.onPath = () => {};
      this.onChange = () => {};
      this.onFailure = () => {};
      this.onStart = () => {};
      this.saveTicket(null);
      if (this.socketOpen()) this.signal({ t: "leave-room" });
      return;
    }
    if (leave && this.socketOpen()) this.signal({ t: "leave-room" });
    if (leave) this.saveTicket(null);
    this.closed = true;
    this.state.canStart = false;
    this.options.signal.removeEventListener("abort", this.abort);
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    clearTimeout(this.connectTimer);
    for (const [id, link] of this.links) {
      clearTimeout(link.retry);
      this.resetPeer(id);
    }
    this.socket.close();
    this.pending.length = 0;
    this.receiver = undefined;
  }
}
