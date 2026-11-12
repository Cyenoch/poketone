import { EnemyGrid } from "../run/sim/grid";
import { applyCommand, isFrozen, stepOwnedPlayer } from "../run/sim/world";
import { movePlayer, rechargeDash } from "../run/sim/player-movement";
import { playerStats } from "../run/sim/stats";
import { decay } from "../run/sim/status";
import { createRng } from "../run/sim/rng";
import { TICK, type World } from "../run/sim/state/world";
import type { Player, Area, Projectile } from "../run/sim/state/entities";
import type { Command } from "../run/sim/state/commands";
import type { RunEvent } from "../run/sim/state/events";
import type { CombatEffect } from "../run/sim/combat";
import { pullPlayerSurface } from "../run/sim/surface-effects";
import { guardianHazards } from "../run/sim/bosses/hazards";

const motionKeys = [
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
  "moving",
  "dashTime",
  "dashCooldown",
  "dashes",
  "dashX",
  "dashZ",
] as const;
type MotionKey = (typeof motionKeys)[number];
export interface OwnerState extends Pick<Player, MotionKey | "ult" | "fx" | "invulnerable"> {
  cooldowns: { id: Player["moves"][number]["id"]; cooldown: number; waiting?: true }[];
}
export interface OwnerFrame {
  state: OwnerState;
  cancelRescue: boolean;
  nextId: number;
  projectiles: Projectile[];
  areas: Area[];
  events: RunEvent[];
  effects: CombatEffect[];
}
/** Host-produced changes to fields that also have owner-side timers. */
export interface OwnerGrant {
  id: number;
  fx: Record<string, number>;
  charge: number;
  room: number;
  invulnerable: number;
}
export function ownerState(player: Player): OwnerState {
  return structuredClone({
    ...Object.fromEntries(motionKeys.map((key) => [key, player[key]])),
    ult: player.ult,
    fx: player.fx,
    invulnerable: player.invulnerable,
    cooldowns: player.moves.map(({ id, cooldown, waiting }) => ({ id, cooldown, waiting })),
  }) as OwnerState;
}
export function applyOwnerState(player: Player, state: OwnerState) {
  for (const key of motionKeys) Object.assign(player, { [key]: state[key] });
  player.ult = structuredClone(state.ult);
  player.fx = { ...state.fx };
  player.invulnerable = state.invulnerable;
  for (const move of player.moves) {
    const runtime = state.cooldowns.find((entry) => entry.id === move.id);
    if (!runtime) continue;
    move.cooldown = runtime.cooldown;
    if (runtime.waiting) move.waiting = true;
    else delete move.waiting;
  }
}
export function ownerGrant(before: OwnerState, player: Player, id: number): OwnerGrant | undefined {
  const fx: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before.fx), ...Object.keys(player.fx)])) {
    const difference = (player.fx[key] ?? 0) - (before.fx[key] ?? 0);
    if (difference !== 0) fx[key] = difference;
  }
  const grant = {
    id,
    fx,
    charge: player.ult.charge - before.ult.charge,
    room: player.ult.room - before.ult.room,
    invulnerable: Math.max(0, player.invulnerable - before.invulnerable),
  };
  return Object.keys(fx).length || grant.charge || grant.room || grant.invulnerable
    ? grant
    : undefined;
}
export function applyOwnerGrant(player: Player, grant: OwnerGrant) {
  for (const [key, value] of Object.entries(grant.fx))
    player.fx[key] = (player.fx[key] ?? 0) + value;
  player.ult.charge = Math.max(0, Math.min(1, player.ult.charge + grant.charge));
  player.ult.room = Math.max(0, player.ult.room + grant.room);
  player.invulnerable = Math.max(0, player.invulnerable + grant.invulnerable);
}

/** One player's real attacks against the displayed enemy scene; no shared-world simulation. */
export class OwnerSimulation {
  readonly player: Player;
  private readonly grid = new EnemyGrid();
  private readonly rng;
  private nextId: number;
  private time: number;
  private tick = 0;
  private accumulator = 0;
  private projectiles: Projectile[];
  private areas: Area[];
  private events: RunEvent[] = [];
  private effects: CombatEffect[] = [];
  private shown = 0;
  private preview = false;
  private cancelRescue = false;
  constructor(world: World, id: number, nextId: number) {
    this.player = structuredClone(world.players[id]!);
    this.rng = createRng(world.seed ^ ((id + 1) * 0x9e3779b9) ^ world.tick);
    this.time = world.time;
    this.projectiles = structuredClone(
      world.projectiles.filter((shot) => shot.owner === id && shot.id < 0),
    );
    this.areas = structuredClone(world.areas.filter((area) => area.owner === id && area.id < 0));
    // Host IDs stay positive; each owner has a disjoint, persistent numeric namespace.
    this.nextId = nextId;
  }
  sync(authoritative: Player, grants: OwnerGrant[], lifeChanged: boolean, time: number) {
    this.time = time;
    if (lifeChanged || !authoritative.rescue) this.cancelRescue = false;
    const state = ownerState(this.player);
    Object.assign(this.player, structuredClone(authoritative));
    if (!lifeChanged) applyOwnerState(this.player, state);
    else {
      this.player.inputX = state.inputX;
      this.player.inputZ = state.inputZ;
    }
    if (!lifeChanged) for (const grant of grants) applyOwnerGrant(this.player, grant);
    if (this.cancelRescue) this.player.rescue = null;
    if (this.player.rescue) {
      this.player.dashTime = 0;
      this.player.ult.elapsed = -1;
    }
  }
  advance(world: World, commands: Command[], dt: number, frozen: boolean) {
    const player = this.player;
    const local: World = {
      ...world,
      rng: this.rng,
      nextId: this.nextId,
      time: this.time,
      tick: this.tick,
      players: world.players.map((p) => (p.id === player.id ? player : p)),
      projectiles: this.projectiles,
      areas: this.areas,
      events: this.events,
    };
    local.paused ||= frozen;
    for (const command of commands) {
      const rescuing = player.rescue !== null;
      applyCommand(local, command);
      if (rescuing && !player.rescue) this.cancelRescue = true;
    }
    if (!frozen && !isFrozen(local) && local.outcome === "playing") {
      this.accumulator += dt;
      this.grid.rebuild(local.enemies);
      while (this.accumulator + 1e-9 >= TICK) {
        this.accumulator = Math.max(0, this.accumulator - TICK);
        local.tick = ++this.tick;
        local.time = this.time += TICK;
        player.px = player.x;
        player.pz = player.z;
        if (player.alive) {
          const stats = playerStats(player);
          decay(player, TICK);
          player.invulnerable = Math.max(0, player.invulnerable - TICK);
          rechargeDash(player, stats.dashCharges, TICK);
          movePlayer(local, player, stats.speed, TICK);
          pullPlayerSurface(local, player, TICK);
          for (const pit of local.hazards)
            if (pit.kind === "quicksand-pit")
              guardianHazards["quicksand-pit"].update({ ...local, players: [player] }, pit);
        }
        stepOwnedPlayer(
          {
            world: local,
            grid: this.grid,
            attackOwner: player.id,
            report: (effect) => {
              this.effects.push(structuredClone(effect));
              if (effect.t === "hit")
                this.events.push({
                  t: "contact",
                  x: effect.x,
                  z: effect.z,
                  by: player.id,
                  type: effect.hit.type,
                });
            },
          },
          player,
        );
      }
    } else {
      player.px = player.x;
      player.pz = player.z;
    }
    this.nextId = local.nextId;
    this.projectiles = local.projectiles;
    this.areas = local.areas;
    this.preview = !frozen && !isFrozen(local) && local.outcome === "playing";
  }
  frame(): OwnerFrame {
    return {
      state: ownerState(this.player),
      cancelRescue: this.cancelRescue,
      nextId: this.nextId,
      projectiles: this.projectiles,
      areas: this.areas,
      events: this.events,
      effects: this.effects,
    };
  }
  takeEvents() {
    const events = this.events.slice(this.shown);
    this.shown = this.events.length;
    return events;
  }
  sent() {
    this.events = [];
    this.effects = [];
    this.shown = 0;
  }
  present(world: World) {
    const target = world.players[this.player.id]!;
    Object.assign(target, this.player);
    if (this.preview && this.accumulator > 0 && this.player.alive) {
      const next = {
        ...this.player,
        statuses: this.player.statuses.map((status) => ({ ...status })),
      };
      const stats = playerStats(next);
      decay(next, TICK);
      rechargeDash(next, stats.dashCharges, TICK);
      movePlayer(
        { nav: world.nav, map: world.map, hazards: world.hazards, time: this.time + TICK },
        next,
        stats.speed,
        TICK,
      );
      pullPlayerSurface(world, next, TICK);
      for (const pit of world.hazards)
        if (pit.kind === "quicksand-pit")
          guardianHazards["quicksand-pit"].update({ ...world, players: [next] }, pit);
      target.x += ((next.x - this.player.x) * this.accumulator) / TICK;
      target.z += ((next.z - this.player.z) * this.accumulator) / TICK;
    }
    target.px = target.x - (this.player.x - this.player.px);
    target.pz = target.z - (this.player.z - this.player.pz);
    world.projectiles = [
      ...world.projectiles.filter((shot) => shot.owner !== this.player.id || shot.id >= 0),
      ...this.projectiles,
    ];
    world.areas = [
      ...world.areas.filter((area) => area.owner !== this.player.id || area.id >= 0),
      ...this.areas,
    ];
  }
}
