import { TICK } from "../run/sim/state/world";

interface Entity {
  id: number;
  x: number;
  z: number;
  px?: number;
  pz?: number;
  y?: number;
  py?: number;
  faceX?: number;
  faceZ?: number;
  dirX?: number;
  dirZ?: number;
  life?: number;
  delay?: number;
  phaseTime?: number;
  attackTimer?: number;
  phase?: string;
  kind?: string;
  dmg?: number;
}

/** Immutable received snapshots; playback never extrapolates past the newest endpoint. */
export class SnapshotBuffer<T extends Entity> {
  private frames: { clock: number; entities: T[] }[] = [];
  private discardedBefore = -Infinity;

  push(clock: number, entities: T[]) {
    if (this.frames.at(-1)?.clock === clock) this.frames.pop();
    this.frames.push({ clock, entities });
    if (this.frames.length > 32) {
      this.frames.shift();
      this.discardedBefore = this.frames[0]!.clock;
    }
  }

  lostHistory(clock: number): boolean {
    return clock < this.discardedBefore;
  }

  sample(clock: number): T[] {
    while (this.frames.length > 2 && this.frames[1]!.clock <= clock) this.frames.shift();
    const a = this.frames[0];
    if (!a) return [];
    const b = this.frames[1] ?? a;
    const span = b.clock - a.clock;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (clock - a.clock) / span)) : 1;
    const previous = new Map(a.entities.map((entity) => [entity.id, entity]));
    const next = new Map(b.entities.map((entity) => [entity.id, entity]));
    // Births/deaths occur at their snapshot, not at packet arrival.
    return (alpha < 1 ? a : b).entities.map((entity) => {
      const from = previous.get(entity.id) ?? entity;
      const to = next.get(entity.id) ?? entity;
      const result = { ...entity };
      result.x = from.x + (to.x - from.x) * alpha;
      result.z = from.z + (to.z - from.z) * alpha;
      // alpha() is 1 on the guest; px/pz still describe velocity for the animation rigs.
      const moving = span > 0 && clock <= b.clock ? TICK / span : 0;
      // Previous positions are not sent; playback motion rebuilds them for the rigs.
      result.px = result.x - (to.x - from.x) * moving;
      result.pz = result.z - (to.z - from.z) * moving;
      if (from.y !== undefined && to.y !== undefined) {
        result.y = from.y + (to.y - from.y) * alpha;
        result.py = result.y - (to.y - from.y) * moving;
      }
      if (
        from.faceX !== undefined &&
        to.faceX !== undefined &&
        from.faceZ !== undefined &&
        to.faceZ !== undefined
      ) {
        const start = Math.atan2(from.faceX, from.faceZ);
        const end = Math.atan2(to.faceX, to.faceZ);
        const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
        result.faceX = Math.sin(start + delta * alpha);
        result.faceZ = Math.cos(start + delta * alpha);
      }
      // Wind-up progress and direction use the same playback time as the body/ring.
      // A new phase or spent hit stays discrete; never blend a reset timer into its old cast.
      if (from.phase === to.phase && from.kind === to.kind && (from.dmg === 0) === (to.dmg === 0)) {
        for (const key of ["life", "delay", "phaseTime", "attackTimer"] as const) {
          const start = from[key],
            end = to[key];
          if (
            start !== undefined &&
            end !== undefined &&
            (key === "phaseTime" ? end >= start : end <= start)
          )
            result[key] = start + (end - start) * alpha;
        }
        if (
          from.dirX !== undefined &&
          from.dirZ !== undefined &&
          to.dirX !== undefined &&
          to.dirZ !== undefined
        ) {
          const start = Math.atan2(from.dirX, from.dirZ);
          const end = Math.atan2(to.dirX, to.dirZ);
          const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
          const length =
            Math.hypot(from.dirX, from.dirZ) * (1 - alpha) + Math.hypot(to.dirX, to.dirZ) * alpha;
          result.dirX = Math.sin(start + delta * alpha) * length;
          result.dirZ = Math.cos(start + delta * alpha) * length;
        }
      }
      return result;
    });
  }
}
