import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
} from "three";
import { WAVE } from "../../sim/content/params/archetypes";
import { findPlayer } from "../../sim/combat";
import { cellAt, cellCenterX, cellCenterZ, routeBlocked } from "../../sim/nav/index";
import { formOf } from "../../sim/evolution";
import { acquire } from "../../sim/archetypes/kit";
import { nearestPlayer } from "../../sim/director";
import { SPAWN_RING } from "../../sim/content/params/pacing";
import { onScreen, viewClearance } from "../../sim/viewFootprint";
import { STATION_REACH } from "../../sim/content/params/stations";
import { sampleSurface } from "../../sim/surface";
import { WADE_DEPTH } from "../../sim/content/params/environment";
import { routeStep } from "../../sim/nav/grid";
import { ORTHOGONAL_COST, DIAGONAL_COST } from "../../sim/nav/buckets";
import { WALKABLE } from "../../sim/nav/walkable";
import type { DebugLayer } from "../../dev/layers";
import type { UiStage } from "../../../ui/gpu/stage";
import { DebugLabels } from "./labels";
import type { PlayerId } from "../../sim/state/entities";
import type { World } from "../../sim/state/world";

/**
 * Developer-mode overlay: collision circles, damage shapes, hazards, the ground can't-climb mask and
 * flow-field arrows near the player. Reads the world strictly read-only — it must never change what
 * the simulation does (no flow-field requests), so toggling it cannot desync a future co-op session.
 */
export interface DebugOverlay {
  root: Group;
  update(world: World): void;
  dispose(): void;
}

const MAX_VERTICES = 160_000;
const SEGMENTS = 48;
const ARROW_RANGE = 8;

const palette = {
  player: [0.3, 1, 0.45],
  pickup: [0.9, 0.95, 1],
  enemy: [0.65, 0.85, 1],
  boss: [1, 0.95, 0.65],
  solid: [1, 0.85, 0.2],
  shot: [0.3, 0.9, 1],
  area: [0.4, 0.7, 1],
  hazard: [1, 0.88, 0.5],
  flow: [1, 1, 1],
} as const;
type Tone = keyof typeof palette;

/** Flow arrows are drawn around the player `local`. */
export function createDebugOverlay(
  world: World,
  local: PlayerId,
  enabled: ReadonlySet<DebugLayer>,
  ground: (x: number, z: number) => number,
  stage: UiStage,
  project: (x: number, y: number, z: number) => [number, number] | null,
): DebugOverlay {
  const root = new Group();
  root.name = "dev-world-layers";
  root.renderOrder = 10;
  const positions = new Float32Array(MAX_VERTICES * 3);
  const colors = new Float32Array(MAX_VERTICES * 3);
  const geometry = new BufferGeometry();
  geometry.setDrawRange(0, 0);
  geometry.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("color", new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage));
  const material = new LineBasicMaterial({
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
    opacity: 0.7,
    transparent: true,
    toneMapped: false,
  });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  root.add(lines);

  const labels = enabled.has("states") ? new DebugLabels(stage, project) : undefined;

  let count = 0;

  function segment(ax: number, az: number, bx: number, bz: number, tone: Tone): void {
    if (count + 2 > MAX_VERTICES) return;
    const [r, g, b] = palette[tone];
    vertex(ax, az, r, g, b);
    vertex(bx, bz, r, g, b);
  }

  function vertex(x: number, z: number, r: number, g: number, b: number): void {
    const o = count * 3;
    positions[o] = x;
    positions[o + 1] = ground(x, z);
    positions[o + 2] = z;
    colors[o] = r;
    colors[o + 1] = g;
    colors[o + 2] = b;
    count++;
  }

  function circle(x: number, z: number, radius: number, tone: Tone): void {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const b = ((i + 1) / SEGMENTS) * Math.PI * 2;
      segment(
        x + Math.cos(a) * radius,
        z + Math.sin(a) * radius,
        x + Math.cos(b) * radius,
        z + Math.sin(b) * radius,
        tone,
      );
    }
  }

  function sector(
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    reach: number,
    half: number,
    tone: Tone,
  ): void {
    const base = Math.atan2(dirZ, dirX);
    const steps = 8;
    let px = x + Math.cos(base - half) * reach;
    let pz = z + Math.sin(base - half) * reach;
    segment(x, z, px, pz, tone);
    for (let i = 1; i <= steps; i++) {
      const a = base - half + (2 * half * i) / steps;
      const nx = x + Math.cos(a) * reach;
      const nz = z + Math.sin(a) * reach;
      segment(px, pz, nx, nz, tone);
      px = nx;
      pz = nz;
    }
    segment(x, z, px, pz, tone);
  }

  function lane(
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    length: number,
    half: number,
    tone: Tone,
  ): void {
    const sx = -dirZ * half;
    const sz = dirX * half;
    const ex = x + dirX * length;
    const ez = z + dirZ * length;
    segment(x + sx, z + sz, ex + sx, ez + sz, tone);
    segment(x - sx, z - sz, ex - sx, ez - sz, tone);
    segment(x + sx, z + sz, x - sx, z - sz, tone);
    segment(ex + sx, ez + sz, ex - sx, ez - sz, tone);
  }

  function square(x: number, z: number, half: number, tone: Tone): void {
    lane(x - half, z, 1, 0, half * 2, half, tone);
  }

  function contour(
    cx: number,
    cz: number,
    inside: (x: number, z: number) => boolean,
    tone: Tone,
  ): void {
    const step = 1;
    for (let z = Math.floor(cz) - 36; z < cz + 36; z += step) {
      for (let x = Math.floor(cx) - 36; x < cx + 36; x += step) {
        const here = inside(x, z);
        if (here !== inside(x + step, z)) segment(x + 0.5, z - 0.5, x + 0.5, z + 0.5, tone);
        if (here !== inside(x, z + step)) segment(x - 0.5, z + 0.5, x + 0.5, z + 0.5, tone);
      }
    }
  }

  /** Arrows down the ground cost field, read directly (no request, no scheduling side effect). */
  function flowArrows(cx: number, cz: number): void {
    const layer = world.nav.layers.find((candidate) => !candidate.profile.flying);
    const field = layer?.field;
    if (!field) return;
    const grid = world.nav.grid;
    for (let gz = -ARROW_RANGE; gz <= ARROW_RANGE; gz += 1) {
      for (let gx = -ARROW_RANGE; gx <= ARROW_RANGE; gx += 1) {
        const x = Math.round(cx) + gx;
        const z = Math.round(cz) + gz;
        const cell = cellAt(grid, x, z);
        const here = field.cost[cell]!;
        if (!Number.isFinite(here) || here === 0) continue;
        // Same neighbour costs and corner rules as flowDirection, without its demand write.
        let best = -1,
          bestCost = Infinity;
        for (let d = 0; d < 8; d++) {
          const next = field.cost[cell + grid.offset[d]!]!;
          if (!Number.isFinite(next) || !routeStep(grid, layer.pass, cell, d, next === 0)) continue;
          const total = next + (d < 4 ? ORTHOGONAL_COST : DIAGONAL_COST);
          if (total < bestCost) {
            best = d;
            bestCost = total;
          }
        }
        if (best < 0) continue;
        let dx = cellCenterX(grid, cell + grid.offset[best]!) - x;
        let dz = cellCenterZ(grid, cell + grid.offset[best]!) - z;
        const length = Math.hypot(dx, dz);
        if (length === 0) continue;
        dx = (dx / length) * 0.4;
        dz = (dz / length) * 0.4;
        segment(x, z, x + dx, z + dz, "flow");
        segment(x + dx, z + dz, x + dx * 0.55 - dz * 0.4, z + dz * 0.55 + dx * 0.4, "flow");
      }
    }
  }

  return {
    root,
    update(current) {
      count = 0;
      const self = findPlayer(current, local);
      const grid = current.nav.grid;
      const near = (x: number, z: number) => Math.abs(x - self.x) < 28 && Math.abs(z - self.z) < 28;
      if (enabled.has("bodies")) {
        for (const blocker of current.nav.blockers) {
          if (blocker.kind === "circle") {
            if (near(blocker.x, blocker.z)) circle(blocker.x, blocker.z, blocker.radius, "solid");
          } else
            for (const cell of blocker.cells) {
              const x = cellCenterX(grid, cell),
                z = cellCenterZ(grid, cell);
              if (near(x, z)) square(x, z, grid.cell / 2, "solid");
            }
        }
        for (const player of current.players)
          if (player.alive) circle(player.x, player.z, formOf(player).radius, "player");
        for (const enemy of current.enemies)
          if (near(enemy.x, enemy.z))
            circle(enemy.x, enemy.z, enemy.radius, enemy.boss ? "boss" : "enemy");
      }
      if (enabled.has("nav")) {
        const groundLayer = current.nav.layers[0]!;
        for (let dz = -12; dz <= 12; dz += grid.cell)
          for (let dx = -12; dx <= 12; dx += grid.cell) {
            const cell = cellAt(grid, self.x + dx, self.z + dz);
            const x = cellCenterX(grid, cell),
              z = cellCenterZ(grid, cell);
            const surface = sampleSurface(current.map.terrain.surface, x, z);
            const tone =
              surface.lavaDepth > 0
                ? "hazard"
                : surface.waterDepth > WADE_DEPTH
                  ? "shot"
                  : routeBlocked(grid, cell) || groundLayer.kinds[cell] !== WALKABLE
                    ? "solid"
                    : "player";
            square(x, z, grid.cell * 0.38, tone);
          }
      }
      if (enabled.has("flow")) flowArrows(self.x, self.z);
      if (enabled.has("spawn")) {
        for (const player of current.players) {
          circle(player.x, player.z, SPAWN_RING.min, "solid");
          circle(player.x, player.z, SPAWN_RING.max, "solid");
          // Sample the actual sim footprint at cell edges; no second camera formula.
          contour(player.x, player.z, (x, z) => onScreen(current, player, x, z, 0), "player");
        }
        contour(self.x, self.z, (x, z) => viewClearance(current, x, z) <= 1, "shot");
      }
      if (enabled.has("sites")) {
        for (const site of current.stations) {
          circle(site.x, site.z, site.radius, "solid");
          circle(site.x, site.z, site.radius + formOf(self).radius + STATION_REACH, "player");
        }
        for (const pad of current.map.pads)
          if (pad.tag === "landmark") circle(pad.x, pad.z, pad.radius, "boss");
        for (const passage of current.map.passages)
          for (let i = 1; i < passage.points.length; i++) {
            const [x, z] = passage.points[i - 1]!,
              [ex, ez] = passage.points[i]!;
            const length = Math.hypot(ex - x, ez - z);
            if (length)
              lane(x, z, (ex - x) / length, (ez - z) / length, length, passage.width / 2, "flow");
          }
      }
      if (enabled.has("states")) {
        labels!.update(current, local);
        for (const enemy of current.enemies)
          if (near(enemy.x, enemy.z)) {
            const target = nearestPlayer(current, enemy.x, enemy.z);
            if (target) segment(enemy.x, enemy.z, target.x, target.z, "enemy");
          }
      }
      if (enabled.has("aim")) {
        // Default acquisition range in archetypes/kit.ts. Move-specific ranges vary.
        circle(self.x, self.z, 15, "player");
        const [target] = acquire(current, self, 1);
        if (target) segment(self.x, self.z, target.x, target.z, "player");
        for (const shot of current.projectiles)
          if (shot.owner === local && shot.target >= 0) {
            const enemy = current.enemies.find((candidate) => candidate.id === shot.target);
            if (enemy) segment(shot.x, shot.z, enemy.x, enemy.z, "shot");
          }
      }
      if (enabled.has("hits")) {
        for (const shot of current.projectiles) {
          if (shot.archetype === "wave") {
            const speed = Math.hypot(shot.vx, shot.vz) || 1;
            const dirX = shot.vx / speed;
            const dirZ = shot.vz / speed;
            const back = WAVE.depth;
            lane(
              shot.x - dirX * back,
              shot.z - dirZ * back,
              dirX,
              dirZ,
              2 * back,
              shot.radius,
              "shot",
            );
          } else circle(shot.x, shot.z, shot.radius, "shot");
        }
        for (const area of current.areas) {
          if (area.kind === "cone" || area.kind === "strike")
            sector(area.x, area.z, area.dirX, area.dirZ, area.length, area.angle, "area");
          else if (area.kind === "beam")
            lane(area.x, area.z, area.dirX, area.dirZ, area.length, area.radius, "area");
          else circle(area.x, area.z, area.radius, "area");
        }
        for (const hazard of current.hazards) {
          if (["dash-warn", "psybeam", "vine", "fissure", "hydro-pump"].includes(hazard.kind))
            lane(
              hazard.x,
              hazard.z,
              hazard.dirX,
              hazard.dirZ,
              hazard.length,
              hazard.radius,
              "hazard",
            );
          else circle(hazard.x, hazard.z, hazard.radius, "hazard");
        }
      }
      geometry.setDrawRange(0, count);
      for (const attribute of [geometry.attributes.position, geometry.attributes.color]) {
        const buffer = attribute as BufferAttribute;
        buffer.clearUpdateRanges();
        if (count) buffer.addUpdateRange(0, count * 3);
        buffer.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      labels?.dispose();
      root.removeFromParent();
      root.clear();
    },
  };
}
