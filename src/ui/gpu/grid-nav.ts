import type { NavigationDirection } from "../../platform/input";
import type { Container } from "@pmndrs/uikit";

interface Box {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A control's centre as laid out (y down), from Yoga's offsets up the tree: no transforms. */
function restingCentre(panel: Container): [number, number] | null {
  let x = 0,
    y = 0;
  for (let node: Container | undefined = panel; node; node = node.parentContainer.value) {
    const centre = node.relativeCenter.value;
    if (!centre) return null;
    x += centre[0];
    y -= centre[1];
  }
  return [x, y];
}

/**
 * Arrow keys over controls wherever the layout put them, read off their resting layout boxes
 * (not the drawn ones: a focused key lifts a pixel and would leave its row). ←→ go to
 * the nearest control in the same row (boxes overlapping vertically); a control alone in its row
 * goes to the nearest one ahead, off-row distance counted double. Past the last one there is
 * always a way round: to the row's far end, or for a control alone in its row, to the far side
 * of the window (the nearest control there). ↑↓ do the same with columns (boxes overlapping
 * horizontally). Returns the index in `panels` to focus.
 */
export function gridStep(
  panels: readonly Container[],
  current: number,
  direction: NavigationDirection,
): number {
  const boxes = panels
    .map((panel, index): Box | null => {
      const centre = restingCentre(panel),
        size = panel.size.value;
      return centre && size ? { index, x: centre[0], y: centre[1], w: size[0], h: size[1] } : null;
    })
    .filter((box) => box !== null);
  const here = boxes.find((box) => box.index === current);
  if (!here) return boxes[0]?.index ?? current;
  const horizontal = direction === "left" || direction === "right";
  const way = direction === "right" || direction === "down" ? 1 : -1;
  // Along: the axis the key moves on; across: the other one.
  const along = (box: Box) => (horizontal ? box.x - here.x : box.y - here.y);
  const across = (box: Box) => (horizontal ? box.y - here.y : box.x - here.x);
  // Sharing a row (column) means overlapping in it by more than a quarter of the smaller box: a
  // sliver (a touch target reaching past its icon) or touching edges is not alignment.
  const inLine = (box: Box) => {
    const [a, b] = horizontal ? [box.h, here.h] : [box.w, here.w];
    return (a + b) / 2 - Math.abs(across(box)) > Math.min(a, b) / 4;
  };
  const others = boxes.filter((box) => box !== here);
  const ahead = others.filter((box) => along(box) * way > 0);
  const nearest = (list: Box[], cost: (box: Box) => number) =>
    list.reduce((best, box) => (cost(box) < cost(best) ? box : best));
  const line = others.filter(inLine);
  const lineAhead = line.filter((box) => along(box) * way > 0);
  if (lineAhead.length)
    return nearest(lineAhead, (box) => Math.abs(along(box)) * 1e3 + Math.abs(across(box))).index;
  if (horizontal && line.length)
    return nearest(line, (box) => -Math.abs(along(box)) * 1e3 + Math.abs(across(box))).index;
  // At a vertical boundary, continue into the next region before wrapping.
  if (ahead.length)
    return nearest(ahead, (box) => Math.abs(along(box)) + 2 * Math.abs(across(box))).index;
  if (line.length)
    return nearest(line, (box) => -Math.abs(along(box)) * 1e3 + Math.abs(across(box))).index;
  // Wrap only after exhausting the direction, so adjacent regions remain reachable.
  const behind = others.filter((box) => along(box) * way < 0);
  if (behind.length)
    return nearest(behind, (box) => -Math.abs(along(box)) * 1e3 + Math.abs(across(box))).index;
  return here.index;
}
