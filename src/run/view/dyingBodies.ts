import { Matrix4 } from "three";
import type { EnemyId } from "../sim/content/enemies";
import type { DeathKind } from "./vfx/common";

/**
 * Defeated enemies keep their body for a beat: the sim removes them on the death tick, so the view
 * remembers each enemy's last drawn pose and, on a `death` event, plays that body as a white squash
 * and shrink before its poof. View-only: nothing here reads back into the sim.
 */
export interface DyingBody {
  species: EnemyId;
  shiny: boolean;
  /** The last drawn instance matrix (feet at the origin, scaled to the body). */
  readonly matrix: Matrix4;
  x: number;
  z: number;
  radius: number;
  height: number;
  kind: DeathKind;
  age: number;
}

export interface Death {
  /** The defeated enemy; absent for a death with no enemy body (a burst item ball). */
  id: number | undefined;
  species: EnemyId;
  x: number;
  z: number;
  kind: DeathKind;
}

/** Seconds of game time each body holds before it bursts. */
export const DYING_LIFE: Record<DeathKind, number> = { swarm: 0.1, elite: 0.16, guardian: 0.34 };

export class DyingBodies {
  readonly dying: DyingBody[] = [];
  private readonly poses = new Map<number, DyingBody>();
  private readonly spare: DyingBody[] = [];
  private readonly deaths: Death[] = [];
  private readonly squash = new Matrix4();

  died(id: number | undefined, species: EnemyId, x: number, z: number, kind: DeathKind): void {
    this.deaths.push({ id, species, x, z, kind });
  }

  /** Records a living enemy's drawn pose for this frame. */
  pose(
    id: number,
    species: EnemyId,
    shiny: boolean,
    matrix: Matrix4,
    x: number,
    z: number,
    radius: number,
    height: number,
    kind: DeathKind,
  ): void {
    let pose = this.poses.get(id);
    if (!pose) {
      pose = this.spare.pop() ?? blank();
      this.poses.set(id, pose);
    }
    pose.species = species;
    pose.shiny = shiny;
    pose.matrix.copy(matrix);
    pose.x = x;
    pose.z = z;
    pose.radius = radius;
    pose.height = height;
    pose.kind = kind;
  }

  /**
   * Before the living are drawn: turns this frame's deaths into dying bodies (the dead enemy's own last
   * pose, by id), forgets other vanished enemies, and ages the dying; `burst` is called for each body
   * whose beat ended, and `unmatched` for a death whose enemy was never drawn, so every kill gets its poof.
   */
  step(
    living: ReadonlySet<number>,
    dt: number,
    burst: (x: number, z: number, kind: DeathKind, radius: number, height: number) => void,
    unmatched: (death: Death) => void,
  ): void {
    for (const death of this.deaths) {
      const body = death.id === undefined ? undefined : this.poses.get(death.id);
      if (!body || living.has(death.id!)) {
        unmatched(death);
        continue;
      }
      this.poses.delete(death.id!);
      body.age = 0;
      this.dying.push(body);
    }
    this.deaths.length = 0;
    for (const [id, pose] of this.poses) {
      if (living.has(id)) continue;
      this.poses.delete(id);
      this.spare.push(pose);
    }
    let kept = 0;
    for (const body of this.dying) {
      body.age += dt;
      if (body.age < DYING_LIFE[body.kind]) {
        this.dying[kept++] = body;
        continue;
      }
      burst(body.x, body.z, body.kind, body.radius, body.height);
      this.spare.push(body);
    }
    this.dying.length = kept;
  }

  /**
   * The body's matrix this frame: a quick squash (wider, lower) through the first third, then a shrink
   * to nothing at its feet.
   */
  matrixOf(body: DyingBody, out: Matrix4): Matrix4 {
    const t = Math.min(1, body.age / DYING_LIFE[body.kind]);
    const squash = Math.min(1, t / 0.35);
    const shrink = t < 0.35 ? 1 : 1 - ((t - 0.35) / 0.65) ** 2;
    const wide = (1 + 0.25 * squash) * shrink;
    const tall = (1 - 0.35 * squash) * shrink;
    return out.copy(body.matrix).multiply(this.squash.makeScale(wide, tall, wide));
  }
}

function blank(): DyingBody {
  return {
    species: "rattata",
    shiny: false,
    matrix: new Matrix4(),
    x: 0,
    z: 0,
    radius: 0,
    height: 0,
    kind: "swarm",
    age: 0,
  };
}
