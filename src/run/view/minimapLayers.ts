import { images } from "../../prepare/images";
import { playerColors } from "../../ui/player-colors";
import { Container, Text } from "@pmndrs/uikit";
import { type Texture } from "three";
import { findPlayer } from "../sim/combat";
import { canBeRescued } from "../sim/rescue";
import { signatureFusions } from "../sim/content/fusions";
import { stationIcon } from "../../screens/runArt";
import { stationNames } from "../sim/content/stations";
import { stationOpen, stationUsable } from "../sim/stations";
import { landmarkOf } from "../sim/currentZone";
import type { MarkerId } from "../sim/state/route";
import type { PlayerId } from "../sim/state/entities";
import { ARENA_HALF, type World } from "../sim/state/world";
import { MapInk } from "./mapInk";
import { exitAccent, exitName, markerIcons, routeSight } from "./routeLook";

/** World → map logical pixels, with the map origin at its top-left. */
export interface MapTransform {
  xx: number;
  xz: number;
  zx: number;
  zz: number;
  ox: number;
  oy: number;
}
export function project(
  map: MapTransform,
  body: { x: number; z: number; px: number; pz: number },
  alpha: number,
): [number, number] {
  const x = body.px + (body.x - body.px) * alpha,
    z = body.pz + (body.z - body.pz) * alpha;
  return [map.ox + map.xx * x + map.xz * z, map.oy + map.zx * x + map.zz * z];
}
export function heading(map: MapTransform, dx: number, dz: number): number {
  return Math.atan2(map.zx * dx + map.zz * dz, map.xx * dx + map.xz * dz);
}
/** Locations beyond normal sight can have a rim marker; the map itself keeps its scale. */
export function scoutPin(
  x: number,
  y: number,
  centre: number,
  radius: number,
  range: number,
): [number, number] | null {
  const dx = x - centre,
    dy = y - centre,
    distance = Math.hypot(dx, dy);
  if (distance <= radius) return [x, y];
  if (distance > radius * range) return null;
  return [centre + (dx * radius) / distance, centre + (dy * radius) / distance];
}
/** Bill's icon is the local player's signature fusion. */
export function stationIconUrls(world: World, local: PlayerId): [string, string] {
  return [
    stationIcon("hypno"),
    `/art/icons/moves/${signatureFusions[findPlayer(world, local).starter].result}.webp`,
  ];
}
/** A station icon from the shared image store; `onLoad` asks its stage for a redraw. */
export function loadMapIcon(url: string, onLoad: () => void): Texture {
  return images().texture(url, "art", onLoad);
}
/** Exit marker art for one map owner (chests are drawn as the item ball). */
export function loadMarkerIcons(onLoad: () => void): Map<MarkerId, Texture> {
  return new Map(
    (Object.entries(markerIcons) as [MarkerId, string | null][]).flatMap(([marker, url]) =>
      url ? [[marker, loadMapIcon(url, onLoad)] as const] : [],
    ),
  );
}
const HEAT_HALF = ARENA_HALF + 8;
const INK = "#0d233f",
  YELLOW = "#ffd45b",
  GUARDIAN = "#d9384f",
  BADGE = "#1d3d63",
  BALL = "#e0475a",
  DOWN = "#e0475a";
/** Seconds per pulse of the guardian and downed-teammate rings. */
const PULSE_SECONDS = 1.4;
export const PRESSURE_SECTORS = 24;
interface MapLabel {
  panel: Container;
  text: Text[];
  name: string;
  opacity: number;
}
/** A label's text as drawn, in map pixels. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const overlaps = (a: Box, b: Box) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** Room for the 1.25px ink outline on both sides and the glyphs' rounding. */
const LABEL_SLACK = 4;

/** Camera-independent markers and binned soft heat, submitted as instance attributes every frame. */
export class MapLayers {
  /** Per bearing: crowd weight, nearest crowd weight, elite, guardian. Reused by terrain paint. */
  readonly pressure = new Float32Array(PRESSURE_SECTORS * 4);
  readonly heat = new MapInk();
  readonly cone = new MapInk();
  readonly markers = new MapInk();
  private readonly icons: MapInk[];
  /** Exit marker art (routeLook.ts), drawn like station icons. */
  private readonly markerInks: Map<MarkerId, MapInk>;
  private readonly labels = new Map<number, MapLabel>();
  private opacity = 1;
  private readonly counts: Uint16Array;
  private readonly sumX: Float32Array;
  private readonly sumY: Float32Array;
  private readonly touched: Uint32Array;
  private readonly side: number;
  private readonly parent: Container;
  private readonly cell: number;
  private readonly baseOrder: number;
  /** The player the map is centred on and whose station prompts it shows. */
  private readonly local: PlayerId;
  constructor(
    parent: Container,
    cell: number,
    textures: Texture[],
    baseOrder: number,
    local: PlayerId,
    markerTextures: ReadonlyMap<MarkerId, Texture>,
  ) {
    this.local = local;
    this.parent = parent;
    this.cell = cell;
    this.baseOrder = baseOrder;
    this.icons = textures.map((texture) => new MapInk(texture));
    this.markerInks = new Map(
      [...markerTextures].map(([marker, texture]) => [marker, new MapInk(texture)]),
    );
    this.side = Math.ceil((HEAT_HALF * 2) / cell);
    this.counts = new Uint16Array(this.side * this.side);
    this.sumX = new Float32Array(this.counts.length);
    this.sumY = new Float32Array(this.counts.length);
    this.touched = new Uint32Array(this.counts.length);
    this.heat.content.setProperties({ zIndex: baseOrder + 1 });
    this.cone.content.setProperties({ zIndex: baseOrder + 2 });
    this.markers.content.setProperties({ zIndex: baseOrder + 3 });
    for (const icon of this.inks.slice(3)) icon.content.setProperties({ zIndex: baseOrder + 4 });
    parent.add(...this.inks.map((ink) => ink.content));
  }
  /** Every ink this layer draws with: heat, cone, markers, then station and exit-marker icons. */
  private get inks(): MapInk[] {
    return [this.heat, this.cone, this.markers, ...this.icons, ...this.markerInks.values()];
  }
  update(
    world: World,
    alpha: number,
    yaw: number,
    map: MapTransform,
    size: number,
    unit: number,
    radius: number,
    strength: number,
    full: boolean,
    subject = this.local,
    markerRange = 1,
  ): void {
    for (const ink of this.inks) {
      ink.begin();
      ink.uniforms.inkSize.value.set(size, size);
      ink.uniforms.inkMask.value = full ? 4 : 3;
    }
    this.heat.uniforms.inkMask.value = full ? 2 : 1;
    this.cone.uniforms.inkMask.value = 2;
    // Fog shows no ordinary mark, a dark cave only lit ones; the guardian's way stays.
    const sight = routeSight(world, alpha);
    const centre = size / 2;
    const inside = (x: number, y: number) => Math.hypot(x - centre, y - centre) <= radius;
    this.pressure.fill(0);
    let occupied = 0;
    for (const enemy of world.enemies) {
      const wx = enemy.px + (enemy.x - enemy.px) * alpha,
        wz = enemy.pz + (enemy.z - enemy.pz) * alpha;
      if (!enemy.boss && !sight(wx, wz)) continue;
      const x = map.ox + map.xx * wx + map.xz * wz,
        y = map.oy + map.zx * wx + map.zz * wz;
      if (!full) {
        const dx = x - centre,
          dy = y - centre,
          distance = Math.hypot(dx, dy),
          edge = enemy.elite || enemy.boss ? radius : centre;
        if (distance > edge) {
          // Fade over three map radii; crossfade in as the enemy leaves its map marker.
          const beyond = (distance - edge) / centre;
          const fade = Math.max(0, 1 - beyond / 3);
          const weight = fade * fade * Math.min(1, beyond / 0.12);
          const sector = ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1) * PRESSURE_SECTORS;
          const lo = Math.floor(sector),
            fraction = sector - lo;
          for (let side = 0; side < 2; side++) {
            const i = ((lo + side) % PRESSURE_SECTORS) * 4;
            const share = weight * (side === 0 ? 1 - fraction : fraction);
            if (enemy.boss) this.pressure[i + 3] = Math.max(this.pressure[i + 3]!, share);
            else if (enemy.elite) this.pressure[i + 2] = Math.max(this.pressure[i + 2]!, share);
            else {
              this.pressure[i]! += share;
              this.pressure[i + 1] = Math.max(this.pressure[i + 1]!, share);
            }
          }
        }
        if (distance > centre) continue;
      }
      if (enemy.elite || enemy.boss) continue;
      const gx = Math.floor((wx + HEAT_HALF) / this.cell),
        gz = Math.floor((wz + HEAT_HALF) / this.cell);
      if (gx < 0 || gz < 0 || gx >= this.side || gz >= this.side) continue;
      const i = gz * this.side + gx;
      if (this.counts[i] === 0) this.touched[occupied++] = i;
      this.counts[i]!++;
      this.sumX[i]! += x;
      this.sumY[i]! += y;
    }
    for (let j = 0; j < occupied; j++) {
      const i = this.touched[j]!,
        count = this.counts[i]!;
      const diameter = unit * (5 + 7 * Math.min(1, Math.log2(count) / 4));
      this.heat.add(
        this.sumX[i]! / count,
        this.sumY[i]! / count,
        diameter,
        diameter,
        5,
        "#e0475a",
        INK,
        0,
        0,
        Math.min(1, 0.5 + 0.1 * count) * strength,
      );
      this.counts[i] = 0;
      this.sumX[i] = this.sumY[i] = 0;
    }
    const player = findPlayer(world, this.local);
    if (full) {
      const [x, y] = project(map, findPlayer(world, subject), alpha),
        length = 16 * map.xx;
      this.cone.add(
        x,
        y,
        length * 2,
        length * 2,
        6,
        YELLOW,
        INK,
        0,
        heading(map, -Math.sin(yaw), -Math.cos(yaw)),
        0.28,
      );
    }
    const circle = (x: number, y: number, r: number, color: string, stroke = unit * 1.25) =>
      this.markers.add(x, y, r * 2 + stroke, r * 2 + stroke, 0, color, INK, stroke);
    /** Where a marker sits: its spot, or the rim in its direction when it is off the map. */
    const pin = (x: number, y: number) => {
      if (inside(x, y)) return { x, y, angle: null };
      const angle = Math.atan2(y - centre, x - centre);
      return { x: centre + Math.cos(angle) * radius, y: centre + Math.sin(angle) * radius, angle };
    };
    // View-only clock: the rings keep pulsing while the full map holds a frozen solo world.
    const wave = ((performance.now() / 1000) % PULSE_SECONDS) / PULSE_SECONDS;
    const ring = (x: number, y: number, size: number, color: string) =>
      this.markers.add(x, y, size, size, 4, color, color, unit * 2.4, 0, 1 - wave * wave);
    for (const pickup of world.pickups) {
      // The modifier cures (Flash, Defog) show only in the world, under their beacon.
      if (
        pickup.kind === "xp" ||
        pickup.kind === "stardust" ||
        pickup.kind === "flash" ||
        pickup.kind === "defog" ||
        !sight(pickup.x, pickup.z)
      )
        continue;
      const x = map.ox + map.xx * pickup.x + map.xz * pickup.z,
        y = map.oy + map.zx * pickup.x + map.zz * pickup.z;
      const point = scoutPin(x, y, centre, radius, markerRange);
      if (!point) continue;
      if (pickup.kind === "chest" || pickup.kind === "trophy")
        this.markers.add(...point, unit * 6.8, unit * 6.8, 2, YELLOW, "#b48129", unit * 1.25);
      else circle(...point, unit * 3, "#4fb952");
    }
    const seen = new Set<number>();
    /** Where a label centred on `x` with its top at `top` is drawn: whole, inside the map. Map names
     *  are Chinese, one em per character in the UI font. */
    const labelBox = (name: string, x: number, top: number, font: number): Box => {
      const width = Math.min(size, name.length * font * unit + LABEL_SLACK),
        height = unit * (font + 5);
      const left = Math.max(0, Math.min(size - width, x - width / 2));
      top = Math.max(0, Math.min(size - height, top));
      return { left, top, right: left + width, bottom: top + height };
    };
    const labelAt = (id: number, name: string, box: Box, opacity: number, font: number) => {
      seen.add(id);
      let label = this.labels.get(id);
      if (!label) {
        const panel = new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          zIndex: this.baseOrder + 5,
        });
        const text: Text[] = [];
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-0.7, -0.7],
          [0.7, -0.7],
          [-0.7, 0.7],
          [0.7, 0.7],
          [0, 0],
        ]) {
          const node = new Text({
            text: name,
            positionType: "absolute",
            textAlign: "center",
            wordBreak: "keep-all",
            fontWeight: 700,
            zIndex: this.baseOrder + (text.length === 8 ? 6 : 5),
            color: text.length === 8 ? "#fff" : INK,
            transformTranslateX: dx! * 1.25,
            transformTranslateY: dy! * 1.25,
          });
          panel.add(node);
          text.push(node);
        }
        label = { panel, text, name, opacity: 1 };
        this.labels.set(id, label);
        this.parent.add(panel);
      } else if (label.name !== name) {
        label.name = name;
        for (const node of label.text) node.setProperties({ text: name });
      }
      label.opacity = opacity;
      const width = box.right - box.left;
      label.panel.setProperties({
        display: "flex",
        width,
        height: box.bottom - box.top,
        transformTranslateX: box.left,
        transformTranslateY: box.top,
        opacity: opacity * this.opacity,
      });
      for (const node of label.text) node.setProperties({ width, fontSize: unit * font });
    };
    /** Station names, which exit names step around. */
    const taken: Box[] = [];
    for (const station of world.stations) {
      let x = map.ox + map.xx * station.x + map.xz * station.z,
        y = map.oy + map.zx * station.x + map.zz * station.z;
      if (!sight(station.x, station.z)) continue;
      const named = scoutPin(x, y, centre, radius, markerRange) !== null;
      const onMap = inside(x, y),
        usable = stationUsable(player, station);
      if (!onMap) {
        if (!stationOpen(station, player)) continue;
        const a = Math.atan2(y - centre, x - centre);
        x = centre + Math.cos(a) * radius;
        y = centre + Math.sin(a) * radius;
      }
      if (usable) this.markers.add(x, y, unit * 19.2, unit * 19.2, 4, YELLOW, YELLOW, 0);
      this.icons[station.kind === "hypno" ? 0 : 1]!.add(
        x,
        y,
        unit * 16,
        unit * 16,
        9,
        "#fff",
        INK,
        0,
        0,
        usable ? 1 : 0.6,
      );
      if (named) {
        const name = stationNames[station.kind],
          box = labelBox(name, x, y + (y <= centre ? unit * 8.8 : -unit * 20.8), 7.5);
        taken.push(box);
        labelAt(station.id, name, box, usable ? 1 : 0.6, 7.5);
      }
    }
    let boss: World["enemies"][number] | undefined;
    for (const enemy of world.enemies) {
      if (enemy.id === world.bossId && enemy.hp > 0) boss = enemy;
      if (!enemy.elite || enemy.boss) continue;
      const [x, y] = project(map, enemy, alpha);
      if (!sight(enemy.px + (enemy.x - enemy.px) * alpha, enemy.pz + (enemy.z - enemy.pz) * alpha))
        continue;
      if (inside(x, y))
        this.markers.add(x, y, unit * 8.4, unit * 8.4, 1, "#9a4fc7", INK, unit * 1.25);
    }
    if (
      boss ||
      (world.bossId === null && world.zone.phase === "active" && world.mode !== "tower")
    ) {
      // The zone's one guardian: a big gold-edged red crest inside a spreading ring, pinned to the rim
      // with an outward wedge while it is off the map.
      const landmark = landmarkOf(world);
      const [bx, by] = boss
        ? project(map, boss, alpha)
        : [
            map.ox + map.xx * landmark.x + map.xz * landmark.z,
            map.oy + map.zx * landmark.x + map.zz * landmark.z,
          ];
      const { x, y, angle } = pin(bx, by);
      const k = angle === null ? 1 : 0.75;
      ring(x, y, unit * (26 + 24 * wave) * k, YELLOW);
      this.markers.add(x, y, unit * 32 * k, unit * 32 * k, 1, INK, INK, 0, 0, 0.7);
      this.markers.add(x, y, unit * 28 * k, unit * 28 * k, 1, GUARDIAN, YELLOW, unit * 2.8 * k);
      circle(x, y, unit * 3.6 * k, YELLOW, unit * 1.4);
      // The same label identifies the summoning landmark before the guardian is on the field.
      labelAt(
        -1,
        "守卫",
        labelBox("守卫", x, y + (y <= centre ? unit * 16 : -unit * 30), 11),
        1,
        11,
      );
      if (angle !== null) {
        const reach = unit * 17 * k;
        this.markers.add(
          x + Math.cos(angle) * reach,
          y + Math.sin(angle) * reach,
          unit * 9 * k,
          unit * 9 * k,
          3,
          YELLOW,
          INK,
          unit * 1.2,
          angle,
        );
      }
    } else if (world.zone.phase === "cleared") {
      // Each exit the guardian opened: a ring in its target's accent around a disc with its marker
      // art, labelled with the map's name; pinned to the rim with a wedge while off the map.
      // Every exit carries its own name, so two exits to one map read as two ways there.
      const named: { index: number; x: number; y: number; away: 1 | -1; name: string }[] = [];
      for (const [index, exit] of world.zone.exits.entries()) {
        const accent = exitAccent(exit);
        const ex = map.ox + map.xx * exit.x + map.xz * exit.z,
          ey = map.oy + map.zx * exit.x + map.zz * exit.z;
        const { x, y, angle } = pin(ex, ey);
        // Exits always guide the team. Scouting resolves their full reward badge farther away.
        const k = scoutPin(ex, ey, centre, radius, markerRange) ? 1 : 0.75;
        ring(x, y, unit * (20 + 18 * wave) * k, accent.light);
        this.markers.add(x, y, unit * 16 * k, unit * 16 * k, 0, BADGE, accent.light, unit * 2 * k);
        const art = exit.marker ? this.markerInks.get(exit.marker) : undefined;
        if (art) art.add(x, y, unit * 11.5 * k, unit * 11.5 * k, 9, "#fff", INK, 0);
        else if (exit.marker === "chests") {
          circle(x, y, unit * 4.2 * k, BALL);
          circle(x, y, unit * 1.6 * k, "#fff", unit * 0.8);
        } else circle(x, y, unit * 3.2 * k, accent.light, unit * 1.2);
        named.push({
          index,
          x,
          y: y + (y <= centre ? unit * 14 : -unit * 28),
          away: y <= centre ? 1 : -1,
          name: exitName(exit),
        });
        if (angle !== null) {
          const reach = unit * 14 * k;
          this.markers.add(
            x + Math.cos(angle) * reach,
            y + Math.sin(angle) * reach,
            unit * 9 * k,
            unit * 9 * k,
            3,
            accent.light,
            INK,
            unit * 1.2,
            angle,
          );
        }
      }
      // Names never overlap as drawn (already pushed inside the map): outward from the rings, each
      // steps past whatever name it would cover, further below for names under their ring, further
      // above for names over it; one with no room left that way stacks the other way.
      for (const label of named.sort((a, b) => b.away - a.away || a.away * (a.y - b.y))) {
        const start = labelBox(label.name, label.x, label.y, 11);
        const step = (away: 1 | -1): Box | null => {
          const box = { ...start },
            height = start.bottom - start.top;
          for (let hit = taken.find((o) => overlaps(box, o)); hit;) {
            // The edge it steps to is set exactly, so the name it passed never counts as hit again.
            if (away > 0) {
              box.top = hit.bottom;
              box.bottom = box.top + height;
            } else {
              box.bottom = hit.top;
              box.top = box.bottom - height;
            }
            if (box.top < 0 || box.bottom > size) return null;
            hit = taken.find((o) => overlaps(box, o));
          }
          return box;
        };
        const box = step(label.away) ?? step(label.away > 0 ? -1 : 1) ?? start;
        taken.push(box);
        labelAt(-2 - label.index, label.name, box, 1, 11);
      }
    }
    for (const [id, label] of this.labels)
      if (!seen.has(id)) label.panel.setProperties({ display: "none" });
    for (const partner of world.partners) {
      const [x, y] = project(map, partner, alpha);
      if (inside(x, y)) circle(x, y, unit * 2.8, YELLOW);
    }
    for (const [slot, teammate] of world.players.entries()) {
      if (teammate.id === this.local || teammate.departed) continue;
      const [tx, ty] = project(map, teammate, alpha);
      if (teammate.alive) {
        if (inside(tx, ty)) circle(tx, ty, unit * 4, playerColors[slot]!, unit * 1.5);
        continue;
      }
      // Rescuable: the seat dot inside a spreading red ring, pinned to the rim while off the map. A
      // permanent knockout has no place to come to (the team bar still lists the seat).
      if (!canBeRescued(world, teammate)) continue;
      const { x, y } = pin(tx, ty);
      ring(x, y, unit * (14 + 18 * wave), DOWN);
      circle(x, y, unit * 4, playerColors[slot]!, unit * 1.5);
    }
    const [px, py] = project(map, player, alpha);
    const slotColor = playerColors[world.players.indexOf(player)]!;
    this.markers.add(
      px,
      py,
      unit * 18,
      unit * 18,
      3,
      slotColor,
      INK,
      unit * 1.25,
      heading(map, player.faceX, player.faceZ),
    );
    circle(px, py, unit * 3.4, slotColor);
    for (const ink of this.inks) ink.end();
  }
  afterLayout(): void {
    for (const ink of this.inks) ink.afterLayout();
  }
  setOpacity(alpha: number): void {
    this.opacity = alpha;
    for (const ink of this.inks) ink.uniforms.inkOpacity.value = alpha;
    for (const label of this.labels.values())
      label.panel.setProperties({ opacity: label.opacity * alpha });
  }
  restore(): void {
    for (const ink of this.inks) ink.restore();
  }
  releaseUploads(): void {
    for (const ink of this.inks) ink.releaseUploads();
  }
  dispose(): void {
    for (const ink of this.inks) ink.dispose();
    for (const label of this.labels.values()) {
      for (const text of label.text) text.dispose();
      label.panel.removeFromParent();
      label.panel.dispose();
    }
  }
}
