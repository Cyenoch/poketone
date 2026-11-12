/** Integer edge costs: 5 per orthogonal step, 7 per diagonal (√2 within 1%). */
export const ORTHOGONAL_COST = 5;
export const DIAGONAL_COST = 7;
const BUCKETS = 8;

/**
 * Dial's bucket queue for the flow-field Dijkstra. With integer edge costs ≤ 7, every queued key
 * lies in [level, level + 7], so each of the 8 buckets holds one key and push/pop are O(1).
 * A cell re-pushed at a lower cost leaves a stale entry; callers skip entries whose stored cost
 * differs from `level`. Each bucket holds a cell at most once, so `capacity` cells always fit.
 */
export class BucketQueue {
  size = 0;
  /** Key of the entry returned by the latest `pop`. */
  level = 0;
  private readonly buckets: Int32Array[];
  private readonly counts = new Int32Array(BUCKETS);

  constructor(capacity: number) {
    this.buckets = Array.from({ length: BUCKETS }, () => new Int32Array(capacity));
  }

  clear(): void {
    this.counts.fill(0);
    this.size = 0;
    this.level = 0;
  }

  /** `key` must lie in [level, level + 7]; Dijkstra's relaxations guarantee it. */
  push(cell: number, key: number): void {
    const bucket = key & (BUCKETS - 1);
    this.buckets[bucket]![this.counts[bucket]!++] = cell;
    this.size++;
  }

  pop(): number {
    while (this.counts[this.level & (BUCKETS - 1)] === 0) this.level++;
    const bucket = this.level & (BUCKETS - 1);
    this.size--;
    return this.buckets[bucket]![--this.counts[bucket]!]!;
  }
}
