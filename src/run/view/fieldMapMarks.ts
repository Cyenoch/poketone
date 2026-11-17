import type { Container } from "@pmndrs/uikit";
import type { Texture } from "three";
import { SITE_POOLS } from "../sim/content/sites";
import type { SiteKind } from "../sim/state/field";
import type { World } from "../sim/state/world";
import type { MapTransform } from "./minimapLayers";
import { loadMapIcon } from "./minimapLayers";
import { MapInk } from "./mapInk";

/**
 * Each site's map and prompt icon, from the item art players know (the Poké Flute wakes Snorlax,
 * the Old Rod fishes…). Item balls are drawn as a ball; the glint never appears on a map.
 */
export const siteIcons: Partial<Record<SiteKind, string>> = {
  "honey-tree": "/art/icons/items/honey.webp",
  snorlax: "/art/icons/items/poke-flute.webp",
  fishing: "/art/icons/items/old-rod.webp",
  fossil: "/art/icons/items/hard-stone.webp",
  "raid-den": "/art/icons/items/comet-shard.webp",
  spring: "/art/icons/items/fresh-water.webp",
  egg: "/art/icons/items/lucky-egg.webp",
  ghost: "/art/icons/items/cleanse-tag.webp",
  "silph-scope": "/art/icons/items/silph-scope.webp",
};

export interface FieldMark {
  /** Stable while the mark exists (the compass keeps its side by it). */
  key: string;
  kind: SiteKind;
  x: number;
  z: number;
  /** Usable now; false while another player's encounter runs there. */
  ready: boolean;
}

/** One pad's ready item balls show as one mark. */
const BALL_GROUP = 3;

/**
 * The sites a map shows: ready or in use. Dormant and used-up sites are not offered, the glint is
 * left to the eye, and a trap that has gone off is no longer a ball.
 */
export function fieldMarks(world: World): FieldMark[] {
  const marks: FieldMark[] = [];
  const balls: { key: string; x: number; z: number; n: number }[] = [];
  for (const site of world.sites) {
    if (site.kind === "glint" || site.state === "dormant" || site.state === "spent") continue;
    if (site.kind === "item-ball") {
      if (site.state !== "ready") continue;
      const group = balls.find((ball) => Math.hypot(ball.x - site.x, ball.z - site.z) < BALL_GROUP);
      if (group) {
        group.x += (site.x - group.x) / (group.n + 1);
        group.z += (site.z - group.z) / (group.n + 1);
        group.n++;
      } else balls.push({ key: `balls:${site.id}`, x: site.x, z: site.z, n: 1 });
      continue;
    }
    marks.push({
      key: `site:${site.id}`,
      kind: site.kind,
      x: site.x,
      z: site.z,
      ready: site.state === "ready",
    });
  }
  for (const ball of balls)
    marks.push({ key: ball.key, kind: "item-ball", x: ball.x, z: ball.z, ready: true });
  return marks;
}

/** The icon textures this stage's sites can need, loaded once per map owner. */
export function loadSiteIcons(world: World, onLoad: () => void): Map<SiteKind, Texture> {
  const kinds = new Set<SiteKind>([
    ...SITE_POOLS[world.stage],
    ...world.sites.map((site) => site.kind),
  ]);
  return new Map(
    [...kinds].flatMap((kind) => {
      const url = siteIcons[kind];
      return url ? [[kind, loadMapIcon(url, onLoad)] as const] : [];
    }),
  );
}

const INK = "#0d233f",
  YELLOW = "#ffd45b",
  BADGE = "#1d3d63",
  LIGHT = "#d8effb",
  BALL = "#e0475a";

/** Site badges and shiny sparkles on one map, in the minimap's own drawing grammar (`MapInk`). */
export class FieldMapMarks {
  private readonly back = new MapInk();
  private readonly front = new MapInk();
  private readonly icons = new Map<SiteKind, MapInk>();

  constructor(parent: Container, textures: ReadonlyMap<SiteKind, Texture>, baseOrder: number) {
    this.back.content.setProperties({ zIndex: baseOrder + 3 });
    this.front.content.setProperties({ zIndex: baseOrder + 4 });
    parent.add(this.back.content);
    for (const [kind, texture] of textures) {
      const ink = new MapInk(texture);
      ink.content.setProperties({ zIndex: baseOrder + 4 });
      this.icons.set(kind, ink);
      parent.add(ink.content);
    }
    parent.add(this.front.content);
  }

  private get inks(): MapInk[] {
    return [this.back, this.front, ...this.icons.values()];
  }

  update(
    world: World,
    alpha: number,
    map: MapTransform,
    size: number,
    unit: number,
    radius: number,
    full: boolean,
  ): void {
    for (const ink of this.inks) {
      ink.begin();
      ink.uniforms.inkSize.value.set(size, size);
      ink.uniforms.inkMask.value = full ? 4 : 3;
    }
    const centre = size / 2;
    const at = (x: number, z: number): [number, number] => [
      map.ox + map.xx * x + map.xz * z,
      map.oy + map.zx * x + map.zz * z,
    ];
    const inside = (x: number, y: number) => Math.hypot(x - centre, y - centre) <= radius;
    for (const mark of fieldMarks(world)) {
      const [x, y] = at(mark.x, mark.z);
      if (!inside(x, y)) continue;
      const opacity = mark.ready ? 1 : 0.55;
      if (mark.kind === "item-ball") {
        this.back.add(x, y, unit * 8, unit * 8, 0, BALL, INK, unit * 1.25);
        this.front.add(x, y, unit * 3, unit * 3, 0, "#fff", INK, unit * 0.8);
        continue;
      }
      // The same usable halo as a station; a site in use has none.
      if (mark.ready) this.back.add(x, y, unit * 17.6, unit * 17.6, 4, YELLOW, YELLOW, 0);
      this.back.add(x, y, unit * 14, unit * 14, 0, BADGE, LIGHT, unit * 1.2, 0, opacity);
      this.icons.get(mark.kind)?.add(x, y, unit * 11.5, unit * 11.5, 9, "#fff", INK, 0, 0, opacity);
    }
    // A shiny: a gold diamond in a spreading ring, apart from the red crowd heat.
    const wave = (performance.now() / 1000 / 1.2) % 1;
    for (const enemy of world.enemies) {
      if (!enemy.shiny) continue;
      const wx = enemy.px + (enemy.x - enemy.px) * alpha,
        wz = enemy.pz + (enemy.z - enemy.pz) * alpha;
      const [x, y] = at(wx, wz);
      if (!inside(x, y)) continue;
      const ring = unit * (9 + 10 * wave);
      this.front.add(x, y, ring, ring, 4, YELLOW, YELLOW, unit * 1.6, 0, 1 - wave);
      this.front.add(x, y, unit * 8.4, unit * 8.4, 1, YELLOW, INK, unit * 1.25);
    }
    for (const ink of this.inks) ink.end();
  }

  afterLayout(): void {
    for (const ink of this.inks) ink.afterLayout();
  }

  setOpacity(alpha: number): void {
    for (const ink of this.inks) ink.uniforms.inkOpacity.value = alpha;
  }

  restore(): void {
    for (const ink of this.inks) ink.restore();
  }

  releaseUploads(): void {
    for (const ink of this.inks) ink.releaseUploads();
  }

  dispose(): void {
    for (const ink of this.inks) ink.dispose();
  }
}
