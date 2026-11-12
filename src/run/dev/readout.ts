import type { FrameStats, PassCounts } from "../../rendering/app-renderer";
import { difficulties } from "../sim/content/difficulties";
import { statIds } from "../sim/content/effects";
import { zoneClock } from "../sim/content/params/zones";
import { stageDefs } from "../sim/content/stages/index";
import { liveCap, spawnRate, zoneScaling } from "../sim/director";
import { zoneDef, zoneFactors, zoneTime } from "../sim/currentZone";
import { steepnessAt } from "../sim/nav/index";
import { currentStats } from "../sim/stats";
import type { PlayerId } from "../sim/state/entities";
import type { World } from "../sim/state/world";
import { heightAt } from "../sim/terrain";

/**
 * Developer mode's readout (docs/state-machines/view-tools.md#dv03): three pages, cycled with `
 * (Backquote): frame cost, run state, the local player. Collected every frame, written 4× a second.
 * It only reads the world and the frame stats; nothing here has a side effect on the sim.
 */

const PAGES = ["perf", "run", "player"] as const;
const REFRESH = 0.25;
/** Sim seconds of move damage the per-move DPS is averaged over. */
const DPS_WINDOW = 5;
const WRAP = 52;

/** Mean and worst of a value over one refresh window. */
class Window {
  total = 0;
  worst = 0;
  count = 0;
  add(value: number): void {
    this.total += value;
    this.worst = Math.max(this.worst, value);
    this.count++;
  }
  text(digits = 2): string {
    return this.count === 0
      ? "--"
      : `${(this.total / this.count).toFixed(digits)} / ${this.worst.toFixed(digits)}`;
  }
  reset(): void {
    this.total = this.worst = this.count = 0;
  }
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
const pass = (counts: PassCounts) => `${counts.calls} dc ${k(counts.triangles)} tri`;
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, ""));

/** `head` then `words`, broken into lines of about WRAP characters (the readout is narrow on phones). */
function wrap(head: string, words: readonly string[]): string[] {
  const lines = [head];
  for (const word of words) {
    if (lines.at(-1)!.length + word.length + 1 > WRAP) lines.push(" ");
    lines[lines.length - 1] += ` ${word}`;
  }
  return lines;
}

export function createDevReadout(
  stats: FrameStats,
  player: PlayerId,
  publish: (text: string) => void,
) {
  let page = 0;
  let elapsed = REFRESH;
  let frames = 0;
  let presented = 0;
  let worldDrawn = 0;
  let presentedSeen = stats.presented;
  let worldSeen = stats.worldDrawn;
  let lastGpuAt = stats.gpuAt;
  const interval = new Window();
  const sim = new Window();
  const view = new Window();
  const gpu = new Window();
  /** Move damage samples, oldest first, for the per-move DPS. */
  const samples: { time: number; damage: Map<string, number> }[] = [];

  function perf(): string[] {
    const fps = interval.count === 0 ? 0 : (1000 * interval.count) / interval.total;
    const gpuLine = !stats.gpuSupported
      ? "gpu n/a (no timer query)"
      : gpu.count > 0
        ? `gpu frame ${gpu.text()} ms`
        : worldDrawn === 0
          ? "gpu -- (cached world)"
          : "gpu -- (pending or disjoint)";
    return [
      `fps ${fps.toFixed(0)}  frame ${interval.text(1)} ms`,
      `sim ${sim.text()} ms  view ${view.text()} ms`,
      `world ${pass(stats.world)}  cpu ${stats.worldCpuMs.toFixed(2)} ms  ${worldDrawn}/${frames}f`,
      `shadow ${pass(stats.shadow)}`,
      `ui ${pass(stats.ui)}  cpu ${stats.uiCpuMs.toFixed(2)} ms  ${presented}/${frames}f`,
      gpuLine,
    ];
  }

  function run(world: World): string[] {
    const diff = difficulties[world.difficulty];
    const t = zoneTime(world);
    const clockT = zoneClock(stageDefs[world.stage], world.zone.index, t);
    const factors = zoneFactors(world);
    const swarm = zoneScaling(world);
    const early = diff.earlyBy;
    let next: string | null = null;
    let nextAt = Infinity;
    for (const [at, beat] of zoneDef(world).beats) {
      if (at - early < nextAt && !world.spawn.fired.includes(`${beat.kind}@${at}`)) {
        nextAt = at - early;
        next = beat.kind;
      }
    }
    const boss = world.enemies.find((enemy) => enemy.id === world.bossId);
    const guardian =
      world.zone.phase !== "active"
        ? "defeated"
        : boss
          ? `hp ${boss.hp.toFixed(0)}/${boss.maxHp.toFixed(0)}`
          : "not summoned";
    let elites = 0;
    for (const enemy of world.enemies) if (enemy.elite) elites++;
    const fields = world.nav.layers.filter((layer) => layer.field).length;
    const self = world.players[player]!;
    return [
      `seed ${world.seed}  tick ${world.tick}  zone ${world.zone.index + 1} ${world.zone.phase} t ${clock(t)} (run ${clock(world.time)})  ${diff.name}`,
      `diff hp ${num(diff.hp)} dmg ${num(diff.dmg)} spd ${num(diff.speed)} amt ${num(diff.amount)} elite ${num(diff.eliteChance)}`,
      `swarm hp x${num(swarm.hp)} dmg x${num(swarm.dmg)} spd x${num(swarm.speed)}`,
      `spawn credit ${world.spawn.credit.toFixed(2)}  rate ${(spawnRate(clockT, world.difficulty, world.rampage) * factors.spawns).toFixed(2)}/s  live ${world.enemies.length}/${(liveCap(clockT, world.difficulty) * factors.cap).toFixed(0)}`,
      ...wrap(`pool ${world.spawn.pool.length}:`, world.spawn.pool),
      `beat ${next ? `${next} @${clock(nextAt)}` : "none left"}  guardian ${guardian}${world.rampage ? "  RAMPAGE" : ""}`,
      `enemies ${world.enemies.length} elite ${elites}  shots ${world.projectiles.length}  areas ${world.areas.length}  hazards ${world.hazards.length}  pickups ${world.pickups.length}`,
      `flow fields ${fields}/${world.nav.layers.length}  partners ${world.partners.length}`,
      `pos ${self.x.toFixed(1)}, ${self.z.toFixed(1)}  h ${heightAt(world.map.terrain, self.x, self.z).toFixed(2)}  steep ${steepnessAt(world.nav.grid, self.x, self.z).toFixed(2)}`,
    ];
  }

  function you(world: World): string[] {
    const self = world.players[player]!;
    const values = currentStats(self);
    const lines = [
      `Lv ${self.level}  xp ${Math.floor(self.xp)}/${self.xpNext}  stage ${self.stage}  hp ${self.hp.toFixed(0)}/${values.maxHp.toFixed(0)}  kills ${self.kills}`,
    ];
    const cells = statIds.map((id) => `${id} ${num(values[id])}`);
    for (let i = 0; i < cells.length; i += 4) lines.push(cells.slice(i, i + 4).join("  "));
    const oldest = samples[0];
    const span = oldest ? world.time - oldest.time : 0;
    for (const move of self.moves) {
      const dps =
        oldest && span > 0
          ? ((move.damage - (oldest.damage.get(move.id) ?? 0)) / span).toFixed(1)
          : "--";
      lines.push(`${move.id} L${move.level}  dps ${dps}  total ${k(Math.round(move.damage))}`);
    }
    if (self.items.length > 0)
      lines.push(
        ...wrap(
          "items",
          self.items.map((item) => `${item.id}:${item.level}`),
        ),
      );
    return lines;
  }

  return {
    nextPage(): void {
      page = (page + 1) % PAGES.length;
      elapsed = REFRESH;
    },
    /** One app frame, after the view update; the frame stats are the previous drawn frame's. */
    frame(dt: number, simMs: number, viewMs: number, world: World): void {
      elapsed += dt;
      frames++;
      presented += stats.presented - presentedSeen;
      worldDrawn += stats.worldDrawn - worldSeen;
      presentedSeen = stats.presented;
      worldSeen = stats.worldDrawn;
      interval.add(stats.intervalMs);
      sim.add(simMs);
      view.add(viewMs);
      if (stats.gpuMs !== null && stats.gpuAt !== lastGpuAt) {
        lastGpuAt = stats.gpuAt;
        gpu.add(stats.gpuMs);
      }
      if (elapsed < REFRESH) return;
      const self = world.players[player]!;
      // A move's total only grows, so the window's DPS is its growth over the window's sim time.
      if (samples.at(-1)?.time !== world.time)
        samples.push({
          time: world.time,
          damage: new Map(self.moves.map((move) => [move.id, move.damage])),
        });
      while (samples.length > 1 && world.time - samples[0]!.time > DPS_WINDOW) samples.shift();
      const tabs = PAGES.map((name, i) => (i === page ? `[${name}]` : name)).join(" ");
      const body = page === 0 ? perf() : page === 1 ? run(world) : you(world);
      publish([`${tabs}   \` page`, ...body].join("\n"));
      elapsed = frames = presented = worldDrawn = 0;
      for (const each of [interval, sim, view, gpu]) each.reset();
    },
  };
}
