import type { Difficulty } from "../sim/content/difficulties";
import type { StageId } from "../sim/content/stages/index";
import type { StarterId } from "../sim/content/lines/index";
import type { Choice, LabBonuses, Player } from "../sim/state/entities";
import type { CardAction, RunEvent } from "../sim/state/events";
import type { World } from "../sim/state/world";
import { cardShown, type Loadout } from "../sim/world";
import { itemSlots, moveSlots } from "../sim/upgrades";

/**
 * DEV builds' run log (docs/state-machines/view-tools.md#dv05): real card exposures, accepted card
 * answers, the level at 5:00, the guardian's spawn and fall and the result. Bounded and in memory
 * only; `download()` (F9, or `window.__poketoneRunLog`) saves it as JSON. It only reads the world.
 */

/** Records kept; past this the log says it was truncated instead of passing as complete. */
const MAX_RECORDS = 4000;
const FIVE_MINUTES = 300;

interface At {
  tick: number;
  time: number;
  player: number;
  level: number;
  stage: number;
}

type Entry =
  | (At & {
      kind: "exposure";
      card: number;
      source: "level" | "chest";
      options: Choice[];
      moves: { id: string; level: number }[];
      items: { id: string; level: number }[];
      moveSlots: number;
      itemSlots: number;
    })
  | (At & { kind: "answer"; card: number; action: CardAction; index: number | null });

export interface RunLogHeader {
  stage: StageId;
  starter: StarterId;
  difficulty: Difficulty;
  lab: LabBonuses;
  loadout: Loadout;
}

export interface RunLog {
  /** After each frame's steps: this frame's events and the world as they left it. */
  observe(world: World, events: readonly RunEvent[]): void;
  /** The player left the run (forfeit): marked apart from a natural defeat. */
  forfeit(world: World): void;
  data(): object;
  download(): void;
}

export function createRunLog(header: RunLogHeader): RunLog {
  const createdAt = new Date().toISOString();
  let seed: number | null = null;
  const entries: Entry[] = [];
  let dropped = 0;
  /** Exposure dedup: `${player}:${pending.id}`. */
  const exposed = new Set<string>();
  const levelAt5: Record<number, number> = {};
  let guardianSpawn: number | null = null;
  let guardianDefeat: number | null = null;
  let result: { outcome: World["outcome"]; time: number; tick: number; forfeit: boolean } | null =
    null;
  let forfeited = false;

  const at = (world: World, player: Player): At => ({
    tick: world.tick,
    time: world.time,
    player: player.id,
    level: player.level,
    stage: player.stage,
  });
  const push = (entry: Entry) => {
    if (entries.length < MAX_RECORDS) entries.push(entry);
    else dropped++;
  };

  return {
    observe(world, events) {
      seed ??= world.seed;
      for (const event of events) {
        if (event.t !== "card") continue;
        const player = world.players.find((p) => p.id === event.player)!;
        push({
          ...at(world, player),
          kind: "answer",
          card: event.card,
          action: event.action,
          index: event.index ?? null,
        });
      }
      for (const player of world.players) {
        if (cardShown(player)) {
          const pending = player.pending[0]!;
          const key = `${player.id}:${pending.id}`;
          if (!exposed.has(key)) {
            exposed.add(key);
            push({
              ...at(world, player),
              kind: "exposure",
              card: pending.id,
              source: pending.source,
              options: structuredClone(pending.options),
              moves: player.moves.map((m) => ({ id: m.id, level: m.level })),
              items: player.items.map((i) => ({ id: i.id, level: i.level })),
              moveSlots: moveSlots(player),
              itemSlots: itemSlots(player),
            });
          }
        }
        if (world.time >= FIVE_MINUTES && !(player.id in levelAt5))
          levelAt5[player.id] = player.level;
      }
      if (guardianSpawn === null && world.bossId !== null) guardianSpawn = world.time;
      if (guardianDefeat === null && world.zone.phase !== "active") guardianDefeat = world.time;
      if (!result && world.outcome !== "playing")
        result = { outcome: world.outcome, time: world.time, tick: world.tick, forfeit: forfeited };
    },
    forfeit(world) {
      forfeited = true;
      this.observe(world, []);
    },
    data() {
      return {
        kind: "poketone-run-log",
        build: "dev",
        createdAt,
        header: { ...header, seed },
        // Absent facts stay null: an unfinished run never reads as a 0.
        phases: {
          levelAt5: Object.keys(levelAt5).length > 0 ? levelAt5 : null,
          guardianSpawn,
          guardianDefeat,
        },
        result,
        truncated: dropped > 0 ? { kept: MAX_RECORDS, dropped } : null,
        entries,
      };
    },
    download() {
      const blob = new Blob([JSON.stringify(this.data(), null, 1)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `poketone-run-${seed ?? "unseeded"}-${createdAt.replace(/[:.]/g, "-")}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
