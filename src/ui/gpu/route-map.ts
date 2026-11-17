import { Container } from "@pmndrs/uikit";
import { ROUTE_TIERS } from "../../run/sim/content/campaign";
import { MapSwatch } from "./map-swatch";
import { ui } from "./tokens";

/** Swatch diameter, the gap between tiers and between a tier's maps; `links` draws the dotted forks. */
export interface RouteMapSize {
  swatch: number;
  column: number;
  row: number;
  links: boolean;
}

const DOT = 2.5;
const PITCH = 4.5;
/** Dots stop this far outside a swatch's ring. */
const INSET = 3;

/**
 * The expedition's tiers as a static map (not interactive): one column per tier, a tier's maps
 * stacked and centred, every map dotted to each map of the next tier, so the forks read as "take
 * one" without words. Shared by the lobby and the room's dock.
 */
export class RouteMap {
  readonly panel = new Container({ flexShrink: 0 });
  private readonly swatches: MapSwatch[] = [];
  private key = "";

  resize(size: RouteMapSize): void {
    const key = `${size.swatch},${size.column},${size.row},${size.links}`;
    if (key === this.key) return;
    this.key = key;
    this.clear();
    const { swatch: s, column, row } = size;
    const rows = Math.max(...ROUTE_TIERS.map((tier) => tier.length));
    const height = rows * s + (rows - 1) * row;
    const centres = ROUTE_TIERS.map((tier, t) => {
      const top = (height - (tier.length * s + (tier.length - 1) * row)) / 2;
      return tier.map((_, i) => ({ x: t * (s + column) + s / 2, y: top + i * (s + row) + s / 2 }));
    });
    this.panel.setProperties({
      width: ROUTE_TIERS.length * s + (ROUTE_TIERS.length - 1) * column,
      height,
    });
    if (size.links)
      for (let t = 0; t + 1 < centres.length; t++)
        for (const a of centres[t]!)
          for (const b of centres[t + 1]!) this.dots(a, b, s / 2 + INSET);
    for (const [t, tier] of ROUTE_TIERS.entries())
      for (const [i, id] of tier.entries()) {
        const { x, y } = centres[t]![i]!;
        const ring = new Container({
          positionType: "absolute",
          positionLeft: x - s / 2,
          positionTop: y - s / 2,
          width: s,
          height: s,
          borderRadius: 999,
          borderWidth: 2,
          borderColor: ui.ink,
        });
        const swatch = new MapSwatch(id, s / 2 - 2);
        ring.add(swatch.content);
        this.panel.add(ring);
        this.swatches.push(swatch);
      }
  }

  /** Dots centred on the visible part of the segment between two rings. */
  private dots(a: { x: number; y: number }, b: { x: number; y: number }, clear: number): void {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    const span = length - 2 * clear;
    if (span < DOT) return;
    const count = Math.floor((span - DOT) / PITCH) + 1;
    const start = clear + (span - (count - 1) * PITCH) / 2;
    for (let i = 0; i < count; i++) {
      const d = start + i * PITCH;
      this.panel.add(
        new Container({
          positionType: "absolute",
          positionLeft: a.x + (dx * d) / length - DOT / 2,
          positionTop: a.y + (dy * d) / length - DOT / 2,
          width: DOT,
          height: DOT,
          borderRadius: 2,
          backgroundColor: ui.ink,
        }),
      );
    }
  }

  /** Call after layout. */
  update(): void {
    for (const swatch of this.swatches) swatch.update();
  }

  private clear(): void {
    for (const swatch of this.swatches.splice(0)) swatch.dispose();
    for (const child of this.panel.children.slice()) {
      child.removeFromParent();
      (child as Container).dispose?.();
    }
  }

  dispose(): void {
    this.clear();
    this.panel.dispose();
  }
}
