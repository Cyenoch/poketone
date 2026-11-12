import type { Container } from "@pmndrs/uikit";
import { RING_ROOM } from "./box-shadow";

/**
 * Scrolls `scroller` vertically just enough that `control` and `room` past it (its focus ring, or a
 * scroll fade) are inside the scroller's visible box. Reads the laid-out global boxes; true when it
 * scrolled.
 */
export function revealInScroller(
  control: Container,
  scroller: Container,
  room = RING_ROOM,
): boolean {
  const matrix = control.globalMatrix.value,
    size = control.size.value,
    scrollerMatrix = scroller.globalMatrix.value,
    scrollerSize = scroller.size.value,
    border = scroller.borderInset.value;
  if (!matrix || !size || !scrollerMatrix || !scrollerSize || !border) return false;
  const top = matrix.elements[13]! + size[1] / 2 + room,
    bottom = matrix.elements[13]! - size[1] / 2 - room;
  const high = scrollerMatrix.elements[13]! + scrollerSize[1] / 2 - border[0],
    low = scrollerMatrix.elements[13]! - scrollerSize[1] / 2 + border[2];
  const shift = top > high ? high - top : bottom < low ? low - bottom : 0;
  if (!shift) return false;
  const [x, y] = scroller.scrollPosition.value;
  const max = scroller.maxScrollPosition.value[1] ?? 0;
  const next = Math.max(0, Math.min(max, y + shift));
  if (next === y) return false;
  scroller.scrollPosition.value = [x, next];
  return true;
}
