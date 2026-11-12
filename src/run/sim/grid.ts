import { ARENA_HALF } from "./state/world";
import type { Enemy } from "./state/entities";
import { targetable } from "./status";

const CELL = 2.5;
const SIZE = Math.ceil((ARENA_HALF * 2 + 8) / CELL);
const OFFSET = ARENA_HALF + 4;

/** Uniform bucket grid rebuilt every tick; enemies are clamped inside the arena so every one has a cell. */
export class EnemyGrid {
  private readonly cells: Enemy[][] = Array.from({ length: SIZE * SIZE }, () => []);
  private readonly used: number[] = [];

  rebuild(enemies: readonly Enemy[]): void {
    for (const index of this.used) this.cells[index]!.length = 0;
    this.used.length = 0;
    for (const enemy of enemies) {
      // A burrower underground is out of reach of every hit, area and body that queries the grid.
      if (!targetable(enemy)) continue;
      const index = cellIndex(enemy.x, enemy.z);
      const cell = this.cells[index]!;
      if (cell.length === 0) this.used.push(index);
      cell.push(enemy);
    }
  }

  /** Calls `visit` for enemies whose cells overlap the circle; callers do the exact distance test. */
  query(x: number, z: number, radius: number, visit: (enemy: Enemy) => void): void {
    const minX = clampCell((x - radius + OFFSET) / CELL);
    const maxX = clampCell((x + radius + OFFSET) / CELL);
    const minZ = clampCell((z - radius + OFFSET) / CELL);
    const maxZ = clampCell((z + radius + OFFSET) / CELL);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        for (const enemy of this.cells[cz * SIZE + cx]!) visit(enemy);
      }
    }
  }
}

function clampCell(value: number): number {
  return Math.min(SIZE - 1, Math.max(0, Math.floor(value)));
}

function cellIndex(x: number, z: number): number {
  return clampCell((z + OFFSET) / CELL) * SIZE + clampCell((x + OFFSET) / CELL);
}
