/**
 * Order-preserving in-place filter over `items[0, live)`: kept items slide down so draw order never
 * shuffles, dropped ones move past the end for reuse. `keep` gets the slot the item will occupy.
 * Returns the new live count.
 */
export function compact<T>(
  items: T[],
  live: number,
  keep: (item: T, slot: number) => boolean,
): number {
  let kept = 0;
  for (let i = 0; i < live; i++) {
    const item = items[i]!;
    if (!keep(item, kept)) continue;
    items[i] = items[kept]!;
    items[kept++] = item;
  }
  return kept;
}
