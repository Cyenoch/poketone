import type { GeneratedMap } from "../run/sim/mapgen";
import { restoreWorld, snapshotWorld, type WorldSnapshot } from "../run/sim/snapshot";
import type { Command } from "../run/sim/state/commands";
import type { RunEvent } from "../run/sim/state/events";
import { TICK, type World } from "../run/sim/state/world";
import { isFrozen, stepSharedWorld, type RunConfig } from "../run/sim/world";
import { departPlayer } from "../run/sim/team";
import { peerCommand, record } from "./protocol";
import type { MultiplayerSession } from "./session";
import {
  OwnerSimulation,
  applyOwnerState,
  applyOwnerGrant,
  ownerState,
  ownerGrant,
  type OwnerFrame,
  type OwnerState,
  type OwnerGrant,
} from "./owner";
import { commitCombat } from "../run/sim/combat";
import { EnemyGrid } from "../run/sim/grid";
import { validateOwner } from "./owner-protocol";
import { refreshStats } from "../run/sim/stats";
import { SnapshotBuffer } from "./interpolation";
import {
  applyEntityDelta,
  entityDelta,
  entityState,
  wireEntities,
  type EntityDelta,
  type EntityState,
} from "./delta";

type State = Omit<World, "map" | "nav" | "events">;
type PlayerState = Pick<State, "players" | "time" | "tick" | "paused" | "outcome" | "zone">;
type EventBatch = { clock: number; events: RunEvent[] };
type TimedEvents = EventBatch & { ageMs: number };
type PendingEvents = EventBatch & { born: number };
type Frame = {
  t: "frame";
  state: PlayerState & Partial<State>;
  events: TimedEvents[];
  grants: OwnerGrant[];
  life: number;
  revision: number;
  clock: number;
  playerClocks: number[];
  ack: number;
  /** The newest owner packet the host applied; earlier ones carrying facts need no resend. */
  ownerAck: number;
  delta?: EntityDelta;
};
type Packet =
  | {
      t: "map";
      map: GeneratedMap;
      snapshot: WorldSnapshot;
      revision: number;
      clock: number;
      nextId: number;
    }
  | Frame
  | { t: "terminal"; map: GeneratedMap; snapshot: WorldSnapshot; events: EventBatch[][] }
  | { t: "terminal-barrier" }
  | { t: "ready"; revision: number }
  /** A guest's path to the host was restored: which map it holds and whether it is loaded. */
  | { t: "hello"; revision: number; ready: boolean }
  | { t: "resumed"; revision: number }
  | { t: "commands"; revision: number; sequence: number; commands: Command[] }
  | ({
      t: "owner";
      revision: number;
      sequence: number;
      grantAck: number;
      /** Clock of the newest host event batch received; older ones need no resend. */
      eventAck: number;
      life: number;
    } & OwnerFrame);

/** Frames (players, entities, events) reach guests at this rate; playback interpolates between. */
const FRAME_INTERVAL = 0.05;
/** Guest playback runs this far behind the newest host frame to absorb jitter. */
const PLAYBACK_DELAY = 0.15;
/** Sent event batches a guest has not acknowledged are kept this long for a path reset. */
const EVENT_RETAIN = 10;
/** Host frames missing this long mean the host is unreachable or stalled. */
const HOST_SILENCE = 2;

interface GuestState {
  /** The map this guest was last sent; 0 means it holds no map of the current world. */
  revision: number;
  /** offline: unreachable; loading: map sent, waiting for ready; playing: receives frames. */
  phase: "offline" | "loading" | "playing" | "departed";
  receivedSequence: number;
  ack: number;
  elapsed: number;
  baseline?: EntityState;
  events: PendingEvents[];
  /** Sent but unacknowledged event batches; a path reset may have lost them in flight. */
  inflight: PendingEvents[];
  grants: OwnerGrant[];
  grantSequence: number;
  ownerSequence: number;
  nextId: number;
  poseClock: number;
  ownerBefore?: OwnerState;
  alive?: boolean;
  revives?: number;
  life: number;
}

/** Network ownership lives here; simulation and the renderer never depend on WebRTC. */
export class MultiplayerRun {
  readonly host: boolean;
  readonly player: number;
  private readonly stop: () => void;
  private commands: Command[] = [];
  private events: TimedEvents[] = [];
  private frames: Frame[] = [];
  private map?: World;
  private mapResolve?: (world: World) => void;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private mapReject?: (error: Error) => void;
  private guests = new Map<number, GuestState>();
  private failure?: Error;
  private baseline?: EntityState;
  private clock = 0;
  private newestClock = 0;
  private newestFrameAt = 0;
  private readonly eventTimes = new WeakMap<RunEvent, number>();
  private frameSilence = 0;
  private renderClock = -PLAYBACK_DELAY;
  private playbackTrimmed = false;
  private ownerSendElapsed = 0;
  private sequence = 0;
  /** Guest input not yet acknowledged by a host frame; resent after a path reset. */
  private unacked: { sequence: number; commands: Command[] }[] = [];
  /** Sent owner packets carrying hits or events, kept until a host frame acknowledges them. */
  private ownerUnacked: Extract<Packet, { t: "owner" }>[] = [];
  /** Clock of the newest host event batch applied; a resent batch at or before it is a duplicate. */
  private eventClock = -1;
  private ownerCommands: Command[] = [];
  private owner?: OwnerSimulation;
  private ownerSequence = 0;
  private grantAck = 0;
  private life = 0;
  private readonly combatGrid = new EnemyGrid();
  private hostEvents: EventBatch[] = [];
  private hostPlayers = new Map<number, SnapshotBuffer<World["players"][number]>>();
  private hostPositions = new Map<
    number,
    Pick<World["players"][number], "x" | "z" | "px" | "pz" | "faceX" | "faceZ">
  >();
  private hostAttacks = new Map<
    number,
    {
      projectiles: SnapshotBuffer<World["projectiles"][number]>;
      areas: SnapshotBuffer<World["areas"][number]>;
    }
  >();
  private hostEntities?: Pick<World, "projectiles" | "areas">;
  private buffers = this.newBuffers();
  private held = new Map<string, string>();
  private terminal = false;
  private terminalBarrier = false;
  private pendingTerminal?: Extract<Packet, { t: "terminal" }>;
  private terminalWorld?: World;
  private disposed = false;
  private world?: World;
  /** Host: last map revision handed out. Guest: the map it holds. */
  private revision = 0;
  private loadedRevision = 0;
  private readyRevision = 0;
  private revisions = new WeakMap<World, number>();
  /** Host: a zone change waits for every reachable guest. Guest: loading or waiting to resume. */
  suspended = false;
  /** Guest only: the host cannot be reached or has stopped sending frames. */
  reconnecting = false;
  onConnectionChange: () => void = () => {};
  resetInput: () => void = () => {};
  onError: (error: Error) => void = () => {};
  /** Host only: a packet arrived; lets a host whose frames stopped (a hidden page) keep ticking. */
  onPacket: () => void = () => {};

  readonly session: MultiplayerSession;
  readonly config: Omit<RunConfig, "seed">;
  constructor(session: MultiplayerSession, config: Omit<RunConfig, "seed">) {
    this.session = session;
    this.config = config;
    this.player = session.state.self;
    this.host = this.player === 0;
    if (this.host)
      for (let id = 1; id < config.players.length; id++)
        this.guests.set(id, {
          revision: 0,
          phase: "offline",
          receivedSequence: 0,
          ack: 0,
          elapsed: 0,
          events: [],
          inflight: [],
          grants: [],
          grantSequence: 0,
          ownerSequence: 0,
          life: 0,
          nextId: -(id + 1) * 1e12,
          poseClock: 0,
        });
    session.onFailure = (error) => {
      this.failure = error;
      this.readyReject?.(error);
      this.mapReject?.(error);
      this.onError(error);
    };
    session.onPath = (peer, reachable) => {
      if (this.terminal) return;
      if (this.host) this.hostPath(peer, reachable);
      else this.guestPath(reachable);
    };
    session.onDeparted = (peer) => this.depart(peer);
    this.stop = session.receive((raw, from) => {
      try {
        this.receive(raw, from);
      } catch (error) {
        session.fail(error as Error);
      }
    });
    // A guest that reopened the game holds no map; the host sends one on this request.
    if (!this.host && session.restored) this.hello();
  }
  private receive(raw: unknown, from: number) {
    if (this.terminal) return;
    if ((this.host && !this.guests.has(from)) || (!this.host && from !== 0))
      throw new Error("对局来源席位无效。");
    if (!record(raw)) throw new Error("对局消息格式错误。");
    const packet = raw as unknown as Packet;
    if (this.host && this.guests.get(from)!.phase === "departed") return;
    switch (packet.t) {
      case "owner": {
        this.receiveOwner(packet, from);
        break;
      }
      case "commands": {
        const guest = this.guests.get(from);
        if (
          !guest ||
          !Array.isArray(packet.commands) ||
          packet.commands.length > 128 ||
          !Number.isSafeInteger(packet.sequence) ||
          packet.sequence <= 0
        )
          throw new Error("对局指令格式错误。");
        if (this.suspended || guest.phase !== "playing" || packet.revision !== guest.revision)
          break;
        if (packet.sequence <= guest.receivedSequence) break;
        for (const command of packet.commands) this.enqueue(peerCommand(command, from), from);
        guest.receivedSequence = packet.sequence;
        break;
      }
      case "hello": {
        if (!this.host) throw new Error("非房主收到重连请求。");
        if (!Number.isSafeInteger(packet.revision) || typeof packet.ready !== "boolean")
          throw new Error("重连请求格式错误。");
        this.hostHello(from, packet.revision, packet.ready);
        break;
      }
      case "terminal":
        if (this.host) throw new Error("客机不能提交终局。");
        // Harbor and a healthy direct channel are independently ordered. Drain the latter first.
        if (
          !this.terminalBarrier &&
          !this.reconnecting &&
          !(this.session.restored && this.revision === 0)
        )
          this.pendingTerminal = packet;
        else this.acceptTerminal(packet);
        break;
      case "terminal-barrier":
        if (this.host) throw new Error("客机不能提交终局。");
        this.terminalBarrier = true;
        if (this.pendingTerminal) this.acceptTerminal(this.pendingTerminal);
        break;
      case "ready":
        if (!this.host) throw new Error("非房主收到准备指令。");
        this.guestReady(from, packet.revision);
        break;
      case "resumed":
        if (!this.host && packet.revision === (this.loadedRevision || this.revision)) this.resume();
        break;
      case "map": {
        if (this.host) throw new Error("客机不能发送世界。");
        this.suspended = true;
        const world = restoreWorld(packet.map, packet.snapshot);
        this.terminal = world.outcome !== "playing";
        this.revision = packet.revision;
        this.revisions.set(world, packet.revision);
        this.resetPlayback();
        // Restored state has no occurrence clock: retain its facts, never replay its notice text.
        for (const event of world.events) this.eventTimes.set(event, -Infinity);
        this.seedPlayback(world, packet.nextId, packet.clock);
        this.events = [];
        if (this.mapResolve) {
          this.mapResolve(world);
          this.mapResolve = undefined;
        } else this.map = world;
        this.onConnectionChange();
        break;
      }
      case "frame":
        if (this.host || !record(packet.state) || !Array.isArray(packet.events))
          throw new Error("世界状态格式错误。");
        if (this.suspended || packet.revision !== this.revision) break;
        if (
          !Number.isFinite(packet.clock) ||
          packet.clock < 0 ||
          packet.events.some(
            (batch) =>
              !record(batch) ||
              !Number.isFinite(batch.clock) ||
              batch.clock < 0 ||
              batch.clock > packet.clock ||
              !Number.isFinite(batch.ageMs) ||
              batch.ageMs < 0 ||
              !Array.isArray(batch.events),
          ) ||
          !Number.isSafeInteger(packet.ack) ||
          packet.ack < 0 ||
          packet.ack > this.sequence ||
          !Number.isSafeInteger(packet.ownerAck) ||
          packet.ownerAck > this.ownerSequence
        )
          throw new Error("世界输入确认格式错误。");
        if (packet.clock < this.newestClock) break;
        if (packet.state.enemies) this.baseline = entityState(packet.state as State);
        else if (packet.delta) {
          if (!this.baseline) throw new Error("世界差分缺少基准快照。");
          this.baseline = applyEntityDelta(this.baseline, packet.delta);
          packet.state = { ...packet.state, ...this.baseline };
        }
        this.unacked = this.unacked.filter((sample) => sample.sequence > packet.ack);
        this.ownerUnacked = this.ownerUnacked.filter((sent) => sent.sequence > packet.ownerAck);
        // Batches resent after a path reset that already arrived once.
        packet.events = packet.events.filter((batch) => batch.clock > this.eventClock);
        if (packet.events.length) this.eventClock = packet.events.at(-1)!.clock;
        this.newestClock = packet.clock;
        this.newestFrameAt = performance.now();
        for (const batch of packet.events) {
          const born =
            this.newestFrameAt - Math.max(batch.ageMs, (packet.clock - batch.clock) * 1000);
          for (const event of batch.events) this.eventTimes.set(event, born);
        }
        this.frameSilence = 0;
        if (this.reconnecting) {
          this.reconnecting = false;
          this.onConnectionChange();
        }
        this.frames.push(packet);
        // The render loop can be hidden while the reliable transport continues to receive.
        if (this.frames.length > 32) {
          const previous = this.frames.shift()!;
          this.frames[0]!.state = { ...previous.state, ...this.frames[0]!.state };
          if (this.renderClock < this.frames[0]!.clock) this.playbackTrimmed = true;
        }
        this.events.push(...packet.events);
        break;
      default:
        throw new Error("未知对局消息。");
    }
    if (this.host) this.onPacket();
  }
  private acceptTerminal(packet: Extract<Packet, { t: "terminal" }>) {
    const world = restoreWorld(packet.map, packet.snapshot);
    if (world.outcome === "playing") throw new Error("终局仍在进行中。");
    world.events = [
      ...this.events.flatMap((batch) => batch.events),
      ...packet.events[this.player]!.flatMap((batch) => batch.events),
      ...world.events,
    ];
    this.events = [];
    this.resetPlayback();
    this.pendingTerminal = undefined;
    this.terminal = true;
    this.terminalWorld = world;
    const changedField =
      this.world &&
      (this.world.stage !== world.stage || this.world.zone.index !== world.zone.index);
    // A result from a later field must replace the scene/assets through the normal loading path.
    this.map = changedField ? world : undefined;
    this.suspended = !!changedField;
    this.reconnecting = false;
    if (this.mapResolve) {
      this.mapResolve(world);
      this.mapResolve = undefined;
    } else if (!this.world) this.map = world;
    this.session.finish();
    if (this.disposed) this.stop();
    else this.onConnectionChange();
  }
  private resume() {
    this.resetInput();
    this.suspended = false;
    this.reconnecting = false;
    this.frameSilence = 0;
    this.held.clear();
    this.onConnectionChange();
  }
  /** Guest: report the held map so the host resumes it or sends a fresh one. */
  private hello() {
    this.session.send({
      t: "hello",
      revision: this.revision,
      ready: this.readyRevision !== 0 && this.readyRevision === this.revision,
    });
  }
  private guestPath(reachable: boolean) {
    // A reset path voids the ordering a result waits for: a barrier sent on it may be lost.
    this.terminalBarrier = true;
    if (this.pendingTerminal) {
      this.acceptTerminal(this.pendingTerminal);
      return;
    }
    if (!reachable) {
      if (!this.reconnecting) {
        this.reconnecting = true;
        this.resetInput();
        this.onConnectionChange();
      }
      return;
    }
    this.hello();
    // Facts and input lost with the old path go again; the host skips sequences it already applied.
    for (const sent of this.ownerUnacked) this.session.send(sent);
    for (const sample of this.unacked)
      this.session.send({ t: "commands", revision: this.revision, ...sample });
    this.held.clear();
  }
  private hostPath(id: number, reachable: boolean) {
    const guest = this.guests.get(id)!;
    if (guest.phase === "departed") return;
    if (reachable) {
      // Data in flight may be gone: the next frame carries the full state and events again.
      if (guest.phase === "playing") this.resync(guest);
      return;
    }
    if (guest.phase === "offline") return;
    guest.phase = "offline";
    if (this.world) {
      const player = this.world.players[id]!;
      // The host never steps a remote player's motion, so a dash would stay immune while away.
      player.inputX = player.inputZ = 0;
      player.moving = false;
      player.dashTime = 0;
      this.notice(id, "offline");
    }
    this.settleZone();
  }
  private resync(guest: GuestState) {
    guest.baseline = undefined;
    guest.events = [...guest.inflight, ...guest.events];
    guest.inflight = [];
  }
  private hostHello(id: number, revision: number, ready: boolean) {
    const guest = this.guests.get(id)!;
    if (!this.world || guest.phase === "departed") return;
    const returning = guest.phase === "offline";
    if (revision !== 0 && revision === guest.revision) {
      if (returning) this.notice(id, "online");
      if (!ready) guest.phase = "loading";
      else if (guest.phase === "playing" || returning) {
        guest.phase = "playing";
        this.resync(guest);
        if (!this.suspended) this.session.send({ t: "resumed", revision }, false, id);
      } else this.guestReady(id, revision);
      return;
    }
    if (returning) this.notice(id, "online");
    this.sendMap(id, this.world, this.snapshot(this.world));
  }
  private guestReady(id: number, revision: number) {
    const guest = this.guests.get(id)!;
    if (revision !== guest.revision || guest.phase !== "loading") return;
    guest.phase = "playing";
    if (!this.suspended) this.session.send({ t: "resumed", revision }, false, id);
    else this.settleZone();
  }
  /** A zone change resumes once no reachable guest is still loading it. */
  private settleZone() {
    if (!this.suspended || !this.host) return;
    for (const guest of this.guests.values()) if (guest.phase === "loading") return;
    this.suspended = false;
    for (const [id, guest] of this.guests)
      if (guest.phase === "playing")
        this.session.send({ t: "resumed", revision: guest.revision }, false, id);
    this.readyResolve?.();
    this.readyResolve = undefined;
    this.onConnectionChange();
  }
  private depart(id: number) {
    const guest = this.guests.get(id);
    if (!guest || guest.phase === "departed") return;
    guest.phase = "departed";
    guest.events = [];
    guest.grants = [];
    this.hostPlayers.delete(id);
    this.hostAttacks.delete(id);
    if (this.world && !this.terminal) {
      this.restoreHost(this.world);
      departPlayer(this.world, id);
      this.notice(id, "left");
    }
    this.settleZone();
  }
  /** Host presence notices travel with the shared events, so every teammate sees them. */
  private notice(player: number, state: "offline" | "online" | "left") {
    const event: RunEvent = { t: "peer", player, state };
    this.eventTimes.set(event, performance.now());
    this.world!.events.push(event);
  }
  /** Call when a transferred world is installed, before asynchronously warming its scene. */
  loading(world: World) {
    this.loadedRevision = this.revisions.get(world) ?? this.revision;
    if (!this.host) this.world = world;
  }
  private enqueue(command: Command, player: number) {
    if (command.t === "move" || command.t === "view") {
      // Only the latest held direction matters, including while the host is hidden.
      let index = -1;
      for (let i = this.commands.length - 1; i >= 0; i--) {
        const old = this.commands[i]!;
        if (old.t !== "move" && old.t !== "view") break;
        if (old.t === command.t && old.player === player) {
          index = i;
          break;
        }
      }
      if (index >= 0) this.commands[index] = command;
      else this.commands.push(command);
    } else {
      if (this.commands.length >= 256) throw new Error("积压的联机操作过多。");
      this.commands.push(command);
    }
  }
  submit(commands: Command[]): Command[] {
    if (this.suspended) return [];
    if (this.host) {
      for (const command of commands) this.enqueue(command, 0);
      // submit is consumed by stepWorld before publish can acknowledge it.
      for (const guest of this.guests.values()) guest.ack = guest.receivedSequence;
      return this.commands.splice(0);
    }
    const owned: Command[] = [];
    const shared: Command[] = [];
    for (const command of commands) {
      const next = peerCommand(command, this.player);
      if (next.t === "move" || next.t === "view" || next.t === "dash" || next.t === "ult") {
        owned.push(next);
        if (next.t === "move" || next.t === "view") {
          const value = JSON.stringify(next);
          if (this.held.get(next.t) !== value) {
            shared.push(next);
            this.held.set(next.t, value);
          }
        }
      } else shared.push(next);
    }
    this.ownerCommands.push(...owned);
    if (shared.length) this.sendInput(shared);
    return [];
  }
  step(world: World, commands: readonly Command[]) {
    this.restoreHost(world);
    const start = world.events.length;
    stepSharedWorld(world, commands);
    const transitions = world.events.slice(start);
    for (const [id, guest] of this.guests)
      if (
        transitions.some(
          // Item saves never ended the life; personal/team revives do, even within one tick.
          (event) =>
            (event.t === "down" || (event.t === "revive" && !event.item)) && event.player === id,
        )
      )
        this.captureGrant(id, guest, true);
  }
  private captureGrant(id: number, guest: GuestState, lifeChanged = false) {
    const player = this.world!.players[id]!;
    if (
      lifeChanged ||
      guest.alive !== player.alive ||
      (guest.revives !== undefined && player.revives < guest.revives)
    ) {
      guest.life++;
      guest.alive = player.alive;
    }
    guest.revives = player.revives;
    if (guest.ownerBefore) {
      const grant = ownerGrant(guest.ownerBefore, player, guest.grantSequence + 1);
      if (grant) {
        guest.grants.push(grant);
        guest.grantSequence = grant.id;
      }
    }
    guest.ownerBefore = ownerState(player);
  }
  private receiveOwner(packet: Extract<Packet, { t: "owner" }>, from: number) {
    const guest = this.guests.get(from);
    if (!guest || !this.world) throw new Error("非房主收到玩家状态。");
    if (this.suspended || guest.phase !== "playing" || packet.revision !== guest.revision) return;
    if (
      !Number.isSafeInteger(packet.sequence) ||
      packet.sequence <= 0 ||
      !Number.isSafeInteger(packet.grantAck) ||
      packet.grantAck < 0 ||
      packet.grantAck > guest.grantSequence ||
      !Number.isSafeInteger(packet.life) ||
      !Number.isFinite(packet.eventAck) ||
      !record(packet.state) ||
      !Array.isArray(packet.effects) ||
      !Array.isArray(packet.events) ||
      !Array.isArray(packet.projectiles) ||
      !Array.isArray(packet.areas)
    )
      throw new Error("玩家状态格式错误。");
    if (packet.sequence <= guest.ownerSequence) return;
    validateOwner(packet, this.world.players[from]!);
    guest.nextId = Math.max(guest.nextId, packet.nextId);
    guest.ownerSequence = packet.sequence;
    guest.inflight = guest.inflight.filter((batch) => batch.clock > packet.eventAck);
    this.restoreHost(this.world);
    this.captureGrant(from, guest);
    if (packet.life !== guest.life) return;
    const world = this.world;
    const player = world.players[from]!;
    // Reliable facts produced before a transition still settle; a hit in flight is not discarded.
    if (world.zone.phase === "transitioning" || world.outcome !== "playing") return;
    guest.grants = guest.grants.filter((grant) => grant.id > packet.grantAck);
    if (player.alive) {
      applyOwnerState(player, packet.state);
      for (const grant of guest.grants) applyOwnerGrant(player, grant);
      if (packet.cancelRescue) player.rescue = null;
      if (player.rescue) {
        player.dashTime = 0;
        player.ult.elapsed = -1;
      }
    }
    guest.poseClock = this.clock;
    this.hostPlayers.get(from)?.push(this.clock, [structuredClone(player)]);
    world.projectiles = [
      ...world.projectiles.filter((shot) => shot.owner !== from || shot.id >= 0),
      ...packet.projectiles.map((shot) => ({ ...shot, owner: from })),
    ];
    world.areas = [
      ...world.areas.filter((area) => area.owner !== from || area.id >= 0),
      ...packet.areas.map((area) => ({ ...area, owner: from })),
    ];
    const attacks = this.hostAttacks.get(from);
    attacks?.projectiles.push(this.clock, structuredClone(packet.projectiles));
    attacks?.areas.push(this.clock, structuredClone(packet.areas));
    // Attack births and short-lived areas cannot wait for the ordinary entity batch.
    if (packet.events.length)
      for (const target of this.guests.values())
        target.elapsed = Math.max(FRAME_INTERVAL, target.elapsed);
    guest.ownerBefore = ownerState(player);
    this.combatGrid.rebuild(world.enemies);
    refreshStats();
    const start = world.events.length;
    const born = performance.now();
    for (const effect of packet.effects)
      commitCombat({ world, grid: this.combatGrid }, player, effect);
    // In-flight hits still settle while the host's render loop is stopped.
    for (let i = start; i < world.events.length; i++) this.eventTimes.set(world.events[i]!, born);
    this.captureGrant(from, guest);
    for (const [id, target] of this.guests)
      if (
        id !== from &&
        (target.phase === "playing" || target.phase === "loading") &&
        packet.events.length
      )
        target.events.push({ clock: this.clock, events: packet.events, born });
    if (packet.events.length) this.hostEvents.push({ clock: this.clock, events: packet.events });
  }
  private snapshot(world: World): WorldSnapshot {
    const snapshot = snapshotWorld(world);
    // These events are still in the host's queue and will arrive with the first dynamic frame.
    snapshot.events = [];
    return snapshot;
  }
  /** One guest receives the current world and loads it; other seats keep playing. */
  private sendMap(id: number, world: World, snapshot: WorldSnapshot) {
    const guest = this.guests.get(id)!;
    const player = world.players[id]!;
    guest.revision = ++this.revision;
    guest.phase = "loading";
    guest.receivedSequence = guest.ack = 0;
    guest.elapsed = 0;
    guest.baseline = wireEntities(world);
    guest.events = [];
    guest.inflight = [];
    guest.grants = [];
    guest.grantSequence = guest.ownerSequence = guest.life = 0;
    guest.poseClock = this.clock;
    guest.alive = player.alive;
    guest.revives = player.revives;
    guest.ownerBefore = ownerState(player);
    const buffer = new SnapshotBuffer<World["players"][number]>();
    buffer.push(this.clock, [structuredClone(player)]);
    this.hostPlayers.set(id, buffer);
    const attacks = {
      projectiles: new SnapshotBuffer<World["projectiles"][number]>(),
      areas: new SnapshotBuffer<World["areas"][number]>(),
    };
    attacks.projectiles.push(
      this.clock,
      structuredClone(world.projectiles.filter((shot) => shot.owner === id && shot.id < 0)),
    );
    attacks.areas.push(
      this.clock,
      structuredClone(world.areas.filter((area) => area.owner === id && area.id < 0)),
    );
    this.hostAttacks.set(id, attacks);
    if (
      !this.session.send(
        {
          t: "map",
          map: world.map,
          snapshot,
          revision: guest.revision,
          clock: this.clock,
          nextId: guest.nextId,
        },
        false,
        id,
      )
    )
      guest.phase = "offline";
  }
  /** A new world (the start or a zone change): every reachable guest loads it before play goes on. */
  publishMap(world: World) {
    this.restoreHost(world);
    this.world = world;
    if (world.outcome !== "playing") {
      this.publish(world, world.events, 0, true);
      return;
    }
    const now = performance.now();
    for (const event of world.events)
      if (!this.eventTimes.has(event)) this.eventTimes.set(event, now);
    this.commands = [];
    this.held.clear();
    this.hostEvents = [];
    for (const [id, guest] of this.guests) if (guest.phase === "departed") departPlayer(world, id);
    const snapshot = this.snapshot(world);
    for (const [id, guest] of this.guests) {
      if (guest.phase === "departed") continue;
      if (this.session.isReachable(id)) this.sendMap(id, world, snapshot);
      else {
        // Its old map is gone; a returning guest asks again and gets this one.
        guest.phase = "offline";
        guest.revision = 0;
      }
    }
    this.events = [];
    this.suspended = true;
    this.settleZone();
  }
  initial(): Promise<World> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.map) {
      const world = this.map;
      this.map = undefined;
      return Promise.resolve(world);
    }
    return new Promise((resolve, reject) => {
      this.mapResolve = resolve;
      this.mapReject = reject;
    });
  }
  takeMap(): World | undefined {
    const map = this.map;
    this.map = undefined;
    return map;
  }
  async ready(): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.terminal) {
      if (!this.map) this.suspended = false;
      return;
    }
    if (!this.host) {
      this.readyRevision = this.loadedRevision || this.revision;
      this.session.send({ t: "ready", revision: this.readyRevision });
      return;
    }
    if (!this.suspended) return;
    await new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
  }
  publish(world: World, events: RunEvent[], dt: number, force = false) {
    if (!this.host || this.terminal) return;
    this.restoreHost(world);
    if (world.outcome !== "playing") {
      this.terminal = true;
      this.suspended = false;
      const snapshot = snapshotWorld(world);
      snapshot.events = events;
      // This barrier shares each frame's reliable channel; Harbor retains the full result.
      this.session.send({ t: "terminal-barrier" });
      this.session.finish({
        t: "terminal",
        map: world.map,
        snapshot,
        events: world.players.map(
          (player) =>
            this.guests.get(player.id)?.events.map(({ clock, events }) => ({ clock, events })) ??
            [],
        ),
      });
      this.readyResolve?.();
      return;
    }
    if (this.suspended) return;
    this.clock += dt;
    const now = performance.now();
    const batches: PendingEvents[] = [];
    for (const event of events) {
      const born = this.eventTimes.get(event) ?? now;
      const last = batches.at(-1);
      if (last?.born === born) last.events.push(event);
      else batches.push({ clock: this.clock, events: [event], born });
    }
    let wire: EntityState | undefined;
    const { map: _map, nav: _nav, events: _events, ...all } = world;
    const {
      players: _players,
      enemies: _enemies,
      projectiles: _projectiles,
      partners: _partners,
      hazards: _hazards,
      pickups: _pickups,
      areas: _areas,
      ...rest
    } = all;
    const playerClocks = world.players.map(
      (player) => this.guests.get(player.id)?.poseClock ?? this.clock,
    );
    for (const [id, guest] of this.guests) {
      if (guest.phase === "departed") continue;
      this.captureGrant(id, guest);
      if (guest.phase === "offline") continue;
      // A loading guest's snapshot omits these; they arrive with its first frame.
      if (batches.length) guest.events.push(...batches);
      if (guest.phase !== "playing") continue;
      guest.elapsed += dt;
      if (!force && guest.elapsed + 1e-9 < FRAME_INTERVAL) continue;
      wire ??= wireEntities(world);
      // A frame skipped under congestion keeps its baseline; a path reset forces the full state.
      const full = force || !guest.baseline;
      if (
        this.session.send(
          {
            t: "frame",
            state: full ? { ...rest, ...wire } : rest,
            events: guest.events.map(({ born, ...batch }) => ({
              ...batch,
              ageMs: Math.max(0, now - born),
            })),
            revision: guest.revision,
            clock: this.clock,
            playerClocks,
            ack: guest.ack,
            ownerAck: guest.ownerSequence,
            grants: guest.grants,
            life: guest.life,
            ...(full ? {} : { delta: entityDelta(guest.baseline!, wire) }),
          },
          !force,
          id,
        )
      ) {
        guest.inflight.push(...guest.events);
        // An unresponsive guest (hidden tab) cannot hold an unbounded backlog.
        while (guest.inflight.length && guest.inflight[0]!.clock < this.clock - EVENT_RETAIN)
          guest.inflight.shift();
        guest.events = [];
        // Keep the cadence's phase: at a 30 Hz tick, 20 Hz frames alternate one and two ticks apart.
        guest.elapsed = Math.max(0, guest.elapsed - FRAME_INTERVAL) % FRAME_INTERVAL;
        guest.baseline = wire;
      }
    }
  }
  /** Guest-generated visuals for the host, excluded from its broadcast event queue. */
  takeEvents(): RunEvent[] {
    const events: RunEvent[] = [];
    while (this.hostEvents.length && this.hostEvents[0]!.clock <= this.clock - PLAYBACK_DELAY)
      events.push(...this.hostEvents.shift()!.events);
    return events;
  }
  /** Local presentation age, independent of the event's playback clock. */
  eventAgeMs(event: RunEvent): number {
    if (this.terminal) return Infinity;
    const born = this.eventTimes.get(event);
    return born === undefined ? 0 : Math.max(0, performance.now() - born);
  }
  restoreHost(world: World) {
    for (const [id, position] of this.hostPositions) Object.assign(world.players[id]!, position);
    this.hostPositions.clear();
    if (this.hostEntities) Object.assign(world, this.hostEntities);
    this.hostEntities = undefined;
  }
  presentHost(world: World) {
    this.restoreHost(world);
    const playerSpeeds = new Map<number, number>();
    this.hostEntities = { projectiles: world.projectiles, areas: world.areas };
    world.projectiles = world.projectiles.filter((shot) => shot.id >= 0);
    world.areas = world.areas.filter((area) => area.id >= 0);
    for (const attacks of this.hostAttacks.values()) {
      world.projectiles.push(...attacks.projectiles.sample(this.clock - PLAYBACK_DELAY));
      world.areas.push(...attacks.areas.sample(this.clock - PLAYBACK_DELAY));
    }
    for (const buffer of this.hostPlayers.values())
      for (const sample of buffer.sample(this.clock - PLAYBACK_DELAY)) {
        playerSpeeds.set(sample.id, Math.hypot(sample.x - sample.px, sample.z - sample.pz) / TICK);
        const target = world.players[sample.id]!;
        const { x, z, px, pz, faceX, faceZ } = target;
        this.hostPositions.set(sample.id, { x, z, px, pz, faceX, faceZ });
        // The host's render alpha is shared with its own fixed tick; hold this already sampled pose.
        Object.assign(target, {
          x: sample.x,
          z: sample.z,
          px: sample.x,
          pz: sample.z,
          faceX: sample.faceX,
          faceZ: sample.faceZ,
        });
      }
    return playerSpeeds;
  }
  apply(world: World, dt: number): boolean {
    if (this.suspended && this.terminal) return false;
    if (this.terminalWorld) {
      const terminal = this.terminalWorld;
      this.terminalWorld = undefined;
      if (terminal !== world) {
        const { players, events, ...state } = terminal;
        Object.assign(world, state);
        for (const player of world.players) {
          const next = players[player.id]!;
          for (const key of Object.keys(player))
            if (!Object.hasOwn(next, key)) Reflect.deleteProperty(player, key);
          Object.assign(player, next);
        }
        world.events.push(...events);
      }
      return true;
    }
    if (this.host || this.suspended || this.pendingTerminal) return false;
    if (this.terminal) return false;
    this.frameSilence += dt;
    if (this.frameSilence > HOST_SILENCE && !this.reconnecting) {
      this.reconnecting = true;
      this.resetInput();
      this.onConnectionChange();
    }
    this.owner ??= new OwnerSimulation(world, this.player, -(this.player + 1) * 1e12);
    const received = this.frames.length > 0;
    for (const frame of this.frames) {
      const { players, ...state } = frame.state;
      Object.assign(world, state);
      // Player rigs retain their player's identity for the lifetime of this map.
      for (const player of world.players) {
        const next = players.find((entry) => entry.id === player.id)!;
        for (const key of Object.keys(player))
          if (!Object.hasOwn(next, key)) Reflect.deleteProperty(player, key);
        Object.assign(player, structuredClone(next));
      }
      const grants = frame.grants.filter((grant) => grant.id > this.grantAck);
      this.owner.sync(players[this.player]!, grants, frame.life !== this.life, frame.state.time);
      this.life = frame.life;
      if (grants.length) this.grantAck = grants.at(-1)!.id;
      this.bufferState(frame.clock, frame.state, frame.playerClocks);
    }
    this.frames = [];
    if (this.playbackTrimmed || this.buffers.players.get(0)?.lostHistory(this.renderClock)) {
      this.renderClock = this.newestClock - PLAYBACK_DELAY;
      this.playbackTrimmed = false;
    }
    const lag = this.newestClock - PLAYBACK_DELAY - this.renderClock;
    // Far behind (a stall or a burst after one): jump to the playback window instead of crawling.
    if (lag > 0.5) this.renderClock = this.newestClock - PLAYBACK_DELAY;
    const rate = lag > 0.05 ? 1.1 : lag < -0.05 ? 0.9 : 1;
    this.renderClock = Math.min(this.newestClock, this.renderClock + dt * rate);
    for (const buffer of this.buffers.players.values())
      for (const player of buffer.sample(this.renderClock)) {
        if (player.id === this.player) continue;
        const target = world.players.find((entry) => entry.id === player.id)!;
        for (const key of ["x", "z", "px", "pz", "faceX", "faceZ"] as const)
          target[key] = player[key];
      }
    for (const key of [
      "enemies",
      "projectiles",
      "partners",
      "hazards",
      "pickups",
      "areas",
    ] as const)
      Object.assign(world, { [key]: this.buffers[key].sample(this.renderClock) });
    const local = this.owner;
    local.advance(
      world,
      this.ownerCommands.splice(0),
      dt,
      isFrozen(world) || this.frameSilence > 0.5,
    );
    local.present(world);
    const ownerFrame = local.frame();
    world.events.push(...local.takeEvents());
    this.ownerSendElapsed += dt;
    if (
      this.ownerSendElapsed + 1e-9 >= TICK ||
      ownerFrame.effects.length ||
      ownerFrame.events.length
    ) {
      const packet: Extract<Packet, { t: "owner" }> = {
        t: "owner",
        revision: this.revision,
        sequence: ++this.ownerSequence,
        grantAck: this.grantAck,
        eventAck: this.eventClock,
        life: this.life,
        ...ownerFrame,
      };
      // Skipped under congestion: effects and events stay queued and go with the next frame.
      if (this.session.send(packet, true)) {
        this.ownerSendElapsed = 0;
        if (packet.effects.length || packet.events.length) this.ownerUnacked.push(packet);
        local.sent();
      }
    }
    for (const batch of this.events)
      batch.events = batch.events.filter((event) => {
        if (event.t !== "hit" || event.by !== this.player || !event.confirmedContact) return true;
        world.events.push(event);
        return false;
      });
    while (
      this.events.length &&
      (this.events[0]!.clock <= this.renderClock || world.outcome !== "playing")
    ) {
      const batch = this.events.shift()!;
      const born = this.newestFrameAt - (this.newestClock - batch.clock) * 1000;
      for (const event of batch.events)
        this.eventTimes.set(event, Math.min(this.eventTimes.get(event)!, born));
      world.events.push(...batch.events);
    }
    return received;
  }
  alpha() {
    return 1;
  }
  private sendInput(commands: Command[]) {
    const sample = { sequence: ++this.sequence, commands };
    this.unacked.push(sample);
    this.session.send({ t: "commands", revision: this.revision, ...sample });
  }
  private newBuffers() {
    return {
      players: new Map<number, SnapshotBuffer<World["players"][number]>>(),
      enemies: new SnapshotBuffer<World["enemies"][number]>(),
      projectiles: new SnapshotBuffer<World["projectiles"][number]>(),
      partners: new SnapshotBuffer<World["partners"][number]>(),
      hazards: new SnapshotBuffer<World["hazards"][number]>(),
      pickups: new SnapshotBuffer<World["pickups"][number]>(),
      areas: new SnapshotBuffer<World["areas"][number]>(),
    };
  }
  private bufferState(clock: number, state: PlayerState & Partial<State>, playerClocks: number[]) {
    for (const player of state.players) {
      let buffer = this.buffers.players.get(player.id);
      if (!buffer) {
        buffer = new SnapshotBuffer();
        this.buffers.players.set(player.id, buffer);
      }
      buffer.push(playerClocks[player.id]!, [player]);
    }
    if (state.enemies) this.buffers.enemies.push(clock, state.enemies);
    if (state.projectiles) this.buffers.projectiles.push(clock, state.projectiles);
    if (state.partners) this.buffers.partners.push(clock, state.partners);
    if (state.hazards) this.buffers.hazards.push(clock, state.hazards);
    if (state.pickups) this.buffers.pickups.push(clock, state.pickups);
    if (state.areas) this.buffers.areas.push(clock, state.areas);
  }
  private seedPlayback(world: World, nextId: number, clock: number) {
    const { map: _map, nav: _nav, events: _events, ...state } = world;
    const initial = structuredClone(state);
    this.baseline = entityState(initial);
    this.bufferState(
      clock,
      initial,
      initial.players.map(() => clock),
    );
    this.newestClock = clock;
    this.renderClock = clock - PLAYBACK_DELAY;
    this.owner = new OwnerSimulation(world, this.player, nextId);
  }
  private resetPlayback() {
    this.readyRevision = 0;
    this.frames = [];
    this.hostEvents = [];
    this.ownerCommands = [];
    this.owner = undefined;
    this.ownerSequence = this.grantAck = this.life = 0;
    this.baseline = undefined;
    this.buffers = this.newBuffers();
    this.sequence = 0;
    this.unacked = [];
    this.ownerUnacked = [];
    this.eventClock = -1;
    this.ownerSendElapsed = this.newestClock = 0;
    this.newestFrameAt = 0;
    this.frameSilence = 0;
    this.renderClock = -PLAYBACK_DELAY;
    this.playbackTrimmed = false;
    this.held.clear();
  }
  /** Guest: leave the run; the host and other guests keep playing. */
  quit() {
    this.session.quit();
  }
  dispose(leave = true) {
    this.disposed = true;
    this.onConnectionChange = this.resetInput = () => {};
    this.onError = () => {};
    this.onPacket = () => {};
    this.session.onPath = () => {};
    this.session.onDeparted = () => {};
    if (!leave || this.host || this.terminal) this.stop();
    this.readyReject?.(new Error("对局已退出。"));
    this.mapReject?.(new Error("对局已退出。"));
    this.session.close(leave);
  }
}
