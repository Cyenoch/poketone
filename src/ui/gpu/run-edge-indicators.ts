import { Container, Image, type ImageOutProperties } from "@pmndrs/uikit";
import { Vector3, type PerspectiveCamera } from "three";
import type { World } from "../../run/sim/state/world";
import type { PlayerId } from "../../run/sim/state/entities";
import { formOf } from "../../run/sim/evolution";
import { heightAt } from "../../run/sim/terrain";
import { playerColors } from "../player-colors";
import { createMenuIcon } from "./icons";
import { fade, stack } from "./layer";
import { gameTag } from "./tag";
import type { UiStage } from "./stage";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Marker {
  root: Container;
  face: Container;
  portrait: Image<ImageOutProperties<unknown>> | null;
  arrow: ReturnType<typeof createMenuIcon>;
  danger: Container;
  halo: Container;
  size: number;
  opacity: number;
  x: number;
  y: number;
  form: string;
}
const INK = "#0d233f";
/** hp-low red (DESIGN.md): a downed teammate keeps the seat colour and adds this alarm. */
const DOWN = "#e0475a";

/** Projects the very same interpolated world/camera as the scene. This layer only reads it. */
export class GpuEdgeIndicators {
  private readonly root = new Container({
    positionType: "absolute",
    // Projection uses the full viewport, independent of the HUD's safe-area padding.
    positionLeft: 0,
    positionTop: 0,
    positionRight: 0,
    positionBottom: 0,
  });
  private readonly players: Marker[];
  private readonly guardian: Marker;
  private readonly names: Container[];
  private readonly point = new Vector3();
  private clock = 0;
  private readonly stage: UiStage;
  private readonly obstacles: readonly Container[];
  constructor(stage: UiStage, obstacles: readonly Container[]) {
    this.stage = stage;
    this.obstacles = obstacles;
    stage.root.add(stack(this.root, -1));
    this.players = playerColors.map((color, slot) => this.marker(color, 42, slot));
    this.guardian = this.marker("#ffd45b", 48);
    this.names = playerColors.map((color, slot) => {
      const tag = gameTag(`P${slot + 1}`, {
        size: "badge",
        face: color,
        ink: INK,
        ring: { color: INK, width: 1 },
      });
      tag.setProperties({ positionType: "absolute", display: "none" });
      this.root.add(tag);
      return tag;
    });
  }
  private marker(color: string, size: number, slot?: number): Marker {
    const root = new Container({
      positionType: "absolute",
      width: size,
      height: size,
      display: "none",
      alignItems: "center",
      justifyContent: "center",
    });
    const face = new Container({
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 3,
      borderColor: color,
      backgroundColor: INK,
      alignItems: "center",
      justifyContent: "center",
    });
    const portrait = slot === undefined ? null : new Image({ width: size - 8, height: size - 8 });
    if (!portrait) {
      // Guardian icon uses the existing run-hud boss tone; no guardian portrait assets exist.
      const icon = createMenuIcon("spark");
      icon.setProperties({ width: 30, height: 30, color });
      face.add(icon);
    } else face.add(portrait);
    const arrow = createMenuIcon("chevron");
    arrow.setProperties({ positionType: "absolute", width: 20, height: 20, color });
    const danger = new Container({
      positionType: "absolute",
      positionRight: -8,
      positionTop: -9,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: DOWN,
      borderWidth: 2,
      borderColor: INK,
      alignItems: "center",
      justifyContent: "center",
      display: "none",
    });
    const warning = createMenuIcon("danger");
    warning.setProperties({ width: 18, height: 18, color: "#ffffff" });
    danger.add(warning);
    const halo = new Container({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 3,
      borderColor: DOWN,
      display: "none",
    });
    const tag =
      slot === undefined
        ? null
        : gameTag(`P${slot + 1}`, {
            size: "badge",
            face: color,
            ink: INK,
            ring: { color: INK, width: 1 },
          });
    if (tag) {
      tag.setProperties({ positionType: "absolute", positionBottom: -7 });
      root.add(stack(tag, 2));
    }
    root.add(halo, face, arrow, stack(danger, 2));
    this.root.add(root);
    return {
      root,
      face,
      portrait,
      arrow,
      danger,
      halo,
      size,
      opacity: 0,
      x: NaN,
      y: NaN,
      form: "",
    };
  }
  update(
    world: World,
    local: PlayerId,
    camera: PerspectiveCamera,
    alpha: number,
    delta: number,
    visible: boolean,
  ) {
    this.clock += delta;
    this.root.setProperties({ display: visible ? "flex" : "none" });
    if (!visible) return;
    const v = this.stage.viewport;
    const blocked: Rect[] = [];
    for (const node of this.obstacles) {
      const m = node.globalMatrix.value,
        size = node.size.value;
      if (!node.displayed.value || !m || !size) continue;
      blocked.push({
        left: m.elements[12]! + v.width / 2 - size[0] / 2,
        right: m.elements[12]! + v.width / 2 + size[0] / 2,
        top: v.height / 2 - m.elements[13]! - size[1] / 2,
        bottom: v.height / 2 - m.elements[13]! + size[1] / 2,
      });
    }
    // The floating stick has no permanent layout node; its whole gesture region is reserved.
    blocked.push({
      left: 0,
      top: v.height - 180,
      right: Math.max(v.safeArea.left + 170, v.width * 0.25),
      bottom: v.height,
    });
    world.players.forEach((player, slot) => {
      const marker = this.players[slot]!,
        name = this.names[slot]!;
      const form = formOf(player);
      const x = player.px + (player.x - player.px) * alpha,
        z = player.pz + (player.z - player.pz) * alpha;
      const projection = this.project(world, camera, x, z, form.height * 0.5);
      const onScreen =
        projection.front && Math.abs(projection.x) <= 1 && Math.abs(projection.y) <= 1;
      const shown = world.players.length > 1 && !player.departed;
      name.setProperties({ display: shown && onScreen ? "flex" : "none" });
      if (onScreen) {
        const head = this.project(world, camera, x, z, form.height + 0.35);
        name.setProperties({
          positionLeft: ((head.x + 1) * v.width) / 2 - (name.size.value?.[0] ?? 24) / 2,
          positionTop: ((1 - head.y) * v.height) / 2 - 16,
        });
      }
      if (marker.form !== form.id) {
        marker.form = form.id;
        marker.portrait!.setProperties({ src: `/art/portraits/${form.id}.webp` });
      }
      this.place(
        marker,
        projection,
        shown && player.id !== local && !onScreen,
        !player.alive,
        delta,
        blocked,
      );
    });
    // No stale marker when a new solo world replaces a co-op run.
    for (let i = world.players.length; i < this.players.length; i++) {
      this.players[i]!.root.setProperties({ display: "none" });
      this.names[i]!.setProperties({ display: "none" });
    }
    const boss = world.enemies.find((enemy) => enemy.id === world.bossId && enemy.hp > 0);
    if (boss) {
      const projection = this.project(
        world,
        camera,
        boss.px + (boss.x - boss.px) * alpha,
        boss.pz + (boss.z - boss.pz) * alpha,
        0.6,
      );
      const off = !projection.front || Math.abs(projection.x) > 1 || Math.abs(projection.y) > 1;
      this.place(this.guardian, projection, off, false, delta, blocked);
    } else this.place(this.guardian, { x: 0, y: 1 }, false, false, delta, blocked);
  }
  private project(world: World, camera: PerspectiveCamera, x: number, z: number, rise: number) {
    this.point
      .set(x, heightAt(world.map.terrain, x, z) + rise, z)
      .applyMatrix4(camera.matrixWorldInverse);
    const front = this.point.z < -camera.near;
    // Absolute depth keeps a target behind the camera pointing outwards rather than mirroring it.
    const depth = Math.max(camera.near, Math.abs(this.point.z));
    return {
      x: (this.point.x * camera.projectionMatrix.elements[0]!) / depth,
      y: (this.point.y * camera.projectionMatrix.elements[5]!) / depth,
      front,
    };
  }
  private place(
    marker: Marker,
    projection: { x: number; y: number },
    shown: boolean,
    down: boolean,
    delta: number,
    blocked: Rect[],
  ) {
    marker.opacity = Math.max(0, Math.min(1, marker.opacity + ((shown ? 1 : -1) * delta) / 0.15));
    marker.root.setProperties({ display: marker.opacity > 0 ? "flex" : "none" });
    if (!marker.opacity) {
      marker.x = NaN;
      return;
    }
    const v = this.stage.viewport,
      radius = marker.size / 2 + 15;
    const bounds = {
      left: Math.max(12, v.safeArea.left) + radius,
      right: v.width - Math.max(12, v.safeArea.right) - radius,
      top: Math.max(12, v.safeArea.top) + radius,
      bottom: v.height - Math.max(12, v.safeArea.bottom) - radius,
    };
    const angle = Math.atan2(-projection.y * v.height, projection.x * v.width);
    const collides = (x: number, y: number) =>
      blocked.some(
        (rect) =>
          x + radius > rect.left &&
          x - radius < rect.right &&
          y + radius > rect.top &&
          y - radius < rect.bottom,
      );
    let target = edgePoint(angle, bounds, v.width / 2, v.height / 2);
    // Slide around the same inset perimeter to the nearest free arc, never into HUD/touch areas.
    if (collides(target.x, target.y)) {
      for (let step = 1; step <= 180; step++) {
        let found = false;
        for (const sign of [-1, 1]) {
          const candidate = edgePoint(
            angle + (sign * step * Math.PI) / 180,
            bounds,
            v.width / 2,
            v.height / 2,
          );
          if (!collides(candidate.x, candidate.y)) {
            target = candidate;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    if (!Number.isFinite(marker.x)) {
      marker.x = target.x;
      marker.y = target.y;
    } else {
      const cx = v.width / 2,
        cy = v.height / 2;
      const previous = Math.atan2(marker.y - cy, marker.x - cx);
      const next = Math.atan2(target.y - cy, target.x - cx);
      const turn = Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
      const blend = 1 - Math.exp(-delta / 0.08);
      // Interpolate along the perimeter: a Cartesian lerp cuts across the playfield.
      const position = edgePoint(previous + (shown ? turn * blend : 0), bounds, cx, cy);
      const resolved = collides(position.x, position.y) ? target : position;
      marker.x = resolved.x;
      marker.y = resolved.y;
    }
    fade(marker.root, marker.opacity).setProperties({
      positionLeft: marker.x - marker.size / 2,
      positionTop: marker.y - marker.size / 2,
    });
    marker.arrow.setProperties({
      transformTranslateX: Math.cos(angle) * (marker.size / 2 + 8),
      transformTranslateY: Math.sin(angle) * (marker.size / 2 + 8),
      transformRotateZ: (-angle * 180) / Math.PI,
    });
    marker.danger.setProperties({ display: down ? "flex" : "none" });
    marker.halo.setProperties({ display: down ? "flex" : "none" });
    if (down) {
      // A fast heartbeat on the face and a red ring that keeps spreading outwards.
      const beat = 1.12 + 0.1 * Math.sin(this.clock * 9);
      const wave = (this.clock * 1.4) % 1;
      marker.face.setProperties({ transformScaleX: beat, transformScaleY: beat });
      marker.halo.setProperties({
        transformScaleX: 1 + wave * 0.8,
        transformScaleY: 1 + wave * 0.8,
      });
      fade(marker.halo, 1 - wave);
    } else marker.face.setProperties({ transformScaleX: 1, transformScaleY: 1 });
    if (marker.portrait) fade(marker.portrait, down ? 0.55 : 1);
    blocked.push({
      left: marker.x - radius,
      right: marker.x + radius,
      top: marker.y - radius,
      bottom: marker.y + radius,
    });
    this.stage.invalidate();
  }
  dispose() {
    this.root.removeFromParent();
    this.root.dispose();
  }
}

/** Ray/rounded-rectangle intersection, in the HUD's existing logical coordinate space. */
function edgePoint(angle: number, bounds: Rect, cx: number, cy: number) {
  const bx = (bounds.left + bounds.right) / 2,
    by = (bounds.top + bounds.bottom) / 2;
  const hx = (bounds.right - bounds.left) / 2,
    hy = (bounds.bottom - bounds.top) / 2,
    round = 24;
  const dx = Math.cos(angle),
    dy = Math.sin(angle);
  let low = 0,
    // Safe-area insets can move the rounded rectangle away from the viewport center.
    high = Math.hypot(
      Math.max(cx - bounds.left, bounds.right - cx),
      Math.max(cy - bounds.top, bounds.bottom - cy),
    );
  for (let i = 0; i < 14; i++) {
    const t = (low + high) / 2;
    const qx = Math.abs(cx + dx * t - bx) - hx + round,
      qy = Math.abs(cy + dy * t - by) - hy + round;
    const distance =
      Math.hypot(Math.max(0, qx), Math.max(0, qy)) + Math.min(Math.max(qx, qy), 0) - round;
    if (distance > 0) high = t;
    else low = t;
  }
  return { x: cx + dx * low, y: cy + dy * low };
}
