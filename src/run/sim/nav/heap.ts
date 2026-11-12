/**
 * Indexed binary min-heap of cell ids with decrease-key, so a search never holds more entries than
 * there are cells and allocates nothing after construction. Keys live beside the ids so sifting
 * touches contiguous memory only.
 */
export class CellHeap {
  size = 0;
  private readonly items: Int32Array;
  private readonly keys: Float64Array;
  /** Heap position of each cell, -1 when absent. */
  private readonly slot: Int32Array;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
    this.slot = new Int32Array(capacity).fill(-1);
  }

  clear(): void {
    for (let i = 0; i < this.size; i++) this.slot[this.items[i]!] = -1;
    this.size = 0;
  }

  /** Inserts the cell, or lowers its key if already queued (keys never rise). */
  push(cell: number, key: number): void {
    let at = this.slot[cell]!;
    if (at < 0) at = this.size++;
    this.up(at, cell, key);
  }

  pop(): number {
    const top = this.items[0]!;
    this.slot[top] = -1;
    const last = --this.size;
    if (last > 0) this.down(this.items[last]!, this.keys[last]!);
    return top;
  }

  private up(at: number, cell: number, key: number): void {
    const { items, keys, slot } = this;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (keys[parent]! <= key) break;
      const above = items[parent]!;
      items[at] = above;
      keys[at] = keys[parent]!;
      slot[above] = at;
      at = parent;
    }
    items[at] = cell;
    keys[at] = key;
    slot[cell] = at;
  }

  /** Sifts `cell` down from the root. */
  private down(cell: number, key: number): void {
    const { items, keys, slot, size } = this;
    let at = 0;
    for (;;) {
      let child = at * 2 + 1;
      if (child >= size) break;
      if (child + 1 < size && keys[child + 1]! < keys[child]!) child++;
      if (keys[child]! >= key) break;
      const below = items[child]!;
      items[at] = below;
      keys[at] = keys[child]!;
      slot[below] = at;
      at = child;
    }
    items[at] = cell;
    keys[at] = key;
    slot[cell] = at;
  }
}
