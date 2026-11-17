import { Container, Image } from "@pmndrs/uikit";
import { Vector3, type PerspectiveCamera } from "three";
import { atExit } from "../../run/sim/currentZone";
import type { PlayerId } from "../../run/sim/state/entities";
import type { ZoneExit } from "../../run/sim/state/route";
import type { World } from "../../run/sim/state/world";
import { heightAt } from "../../run/sim/terrain";
import { exitAccent, exitName, markerIcons } from "../../run/view/routeLook";
import { ballGlyph } from "./ball";
import { fade, stack } from "./layer";
import { OutlinedText } from "./outlined-text";
import type { UiStage } from "./stage";
import { ui } from "./tokens";

/** World height of a crown's foot above its exit: over a standing form's head and seat tag, yet
 *  close enough to its ring that the near crown clears the clock on a phone. */
const RISE = 3.4;
const POOL = 3;
/** Warm yellow: the exit the local player is about to take (selection, DESIGN.md). */
const CHOSEN = "#ffd45b";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Crown {
  root: Container;
  disc: Container;
  art: { dispose(): void } | null;
  name: OutlinedText;
  key: string;
  compact: boolean | null;
  opacity: number;
  /** Last laid-out size, kept while hidden: a hidden crown measures nothing, which would let it
   *  blink back in. Null until a newly dressed crown has been laid out once. */
  size: [number, number] | null;
}

/**
 * Over each exit a fallen guardian opened: its marker art in a disc rimmed with the target map's
 * accent, the map's name under it (离开 for the expedition's end). Projected from the same camera
 * as the scene in the HUD's world-anchored layer; read-only. A crown hides off screen (the maps and
 * compass take over), fades where it would cover the HUD, and two close crowns stack apart. The
 * exit the local player stands in is ringed in warm yellow.
 */
export class GpuExitLabels {
  private readonly root = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    positionRight: 0,
    positionBottom: 0,
  });
  private readonly crowns: Crown[];
  private readonly point = new Vector3();
  private readonly stage: UiStage;
  private readonly obstacles: () => readonly Container[];

  constructor(stage: UiStage, obstacles: () => readonly Container[]) {
    this.stage = stage;
    this.obstacles = obstacles;
    stage.root.add(stack(this.root, -1));
    this.crowns = Array.from({ length: POOL }, () => {
      const root = new Container({
        positionType: "absolute",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        display: "none",
      });
      const disc = new Container({
        borderRadius: 999,
        backgroundColor: ui.ink,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      });
      const name = new OutlinedText(
        { text: "", fontWeight: 800, color: ui.white, wordBreak: "keep-all" },
        { width: 3, color: ui.ink },
      );
      root.add(disc, name.root);
      this.root.add(root);
      return {
        root,
        disc,
        art: null,
        name,
        key: "",
        compact: null,
        opacity: 0,
        size: null,
      };
    });
  }

  update(
    world: World,
    local: PlayerId,
    camera: PerspectiveCamera,
    delta: number,
    visible: boolean,
  ): void {
    const exits = visible && world.zone.phase === "cleared" ? world.zone.exits : [];
    this.root.setProperties({ display: exits.length ? "flex" : "none" });
    const v = this.stage.viewport;
    const compact = v.height <= 480;
    const player = world.players.find((candidate) => candidate.id === local);
    const here = player?.alive ? atExit(world, player) : null;
    const blocked = this.blocked();
    const placed: Rect[] = [];
    // Nearer exits (lower on screen) claim their spot first; farther ones step up out of the way.
    const order = exits
      .map((exit, index) => ({ exit, index, at: this.project(world, camera, exit) }))
      .sort((a, b) => b.at.y - a.at.y);
    const used = new Set<number>();
    for (const { exit, index, at } of order) {
      const crown = this.crowns[index];
      if (!crown) continue;
      used.add(index);
      // Read before dressing: the layout is the last frame's, for the text it had then.
      const measured = crown.root.size.value;
      if (crown.root.displayed.value && measured && measured[0] > 0)
        crown.size = [measured[0], measured[1]];
      this.dress(crown, exit, compact, here === index);
      const size = crown.size;
      if (!size) {
        // First shown or renamed: laid out unseen for a frame, then placed by its real size.
        crown.opacity = 0;
        fade(crown.root, 0).setProperties({ display: "flex" });
        continue;
      }
      const onScreen = at.front && Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1;
      // Slid in whole beside a pillar at the screen's edge rather than cut or dropped.
      let left = Math.max(
        v.safeArea.left,
        Math.min(v.width - v.safeArea.right - size[0], ((at.x + 1) * v.width) / 2 - size[0] / 2),
      );
      let top = ((1 - at.y) * v.height) / 2 - size[1];
      for (const rect of placed)
        if (
          left < rect.right &&
          left + size[0] > rect.left &&
          top < rect.bottom &&
          top + size[1] > rect.top
        )
          top = rect.top - size[1] - 4;
      const box = { left, top, right: left + size[0], bottom: top + size[1] };
      placed.push(box);
      const covered = blocked.some(
        (rect) =>
          box.left < rect.right &&
          box.right > rect.left &&
          box.top < rect.bottom &&
          box.bottom > rect.top,
      );
      // Whole or not at all: a crown cut by the screen's top or bottom reads as a glitch.
      const inside =
        box.top >= Math.max(4, v.safeArea.top) && box.bottom <= v.height - v.safeArea.bottom;
      const target = onScreen && inside && !covered ? 1 : 0;
      crown.opacity = Math.max(0, Math.min(1, crown.opacity + ((target ? 1 : -1) * delta) / 0.15));
      if (!onScreen || !inside) crown.opacity = 0;
      crown.root.setProperties({ display: crown.opacity > 0 ? "flex" : "none" });
      if (crown.opacity > 0) {
        left = Math.round(left);
        top = Math.round(top);
        fade(crown.root, crown.opacity).setProperties({ positionLeft: left, positionTop: top });
      }
    }
    for (const [index, crown] of this.crowns.entries())
      if (!used.has(index)) {
        crown.opacity = 0;
        crown.root.setProperties({ display: "none" });
      }
  }

  /** The disc's art and rim, the name and the sizes; rebuilt only when the exit or size changes. */
  private dress(crown: Crown, exit: ZoneExit, compact: boolean, chosen: boolean): void {
    const key = `${exit.to}:${exit.marker}`;
    const disc = compact ? 26 : 30;
    if (crown.key !== key || crown.compact !== compact) {
      crown.key = key;
      crown.compact = compact;
      crown.art?.dispose();
      crown.art = null;
      for (const child of crown.disc.children.slice()) {
        child.removeFromParent();
        (child as Container).dispose?.();
      }
      const inset = Math.round(disc * 0.74);
      if (exit.marker === "chests") {
        const ball = ballGlyph(inset);
        crown.disc.add(ball.glyph);
        crown.art = ball;
      } else if (exit.marker) {
        const url = markerIcons[exit.marker];
        if (url) crown.disc.add(new Image({ src: url, width: inset, height: inset }));
      }
      crown.disc.setProperties({
        display: exit.marker ? "flex" : "none",
        width: disc,
        height: disc,
      });
      crown.name.set({ text: exitName(exit), fontSize: compact ? 13 : 15 });
      crown.size = null;
    }
    crown.disc.setProperties({
      borderWidth: 3,
      borderColor: chosen ? CHOSEN : exitAccent(exit).light,
    });
    crown.root.setProperties({
      transformScale: chosen ? 1.1 : 1,
      transformOriginY: "bottom",
    });
  }

  private project(world: World, camera: PerspectiveCamera, exit: ZoneExit) {
    this.point
      .set(exit.x, heightAt(world.map.terrain, exit.x, exit.z) + RISE, exit.z)
      .applyMatrix4(camera.matrixWorldInverse);
    const front = this.point.z < -camera.near;
    const depth = Math.max(camera.near, Math.abs(this.point.z));
    return {
      x: (this.point.x * camera.projectionMatrix.elements[0]!) / depth,
      y: (this.point.y * camera.projectionMatrix.elements[5]!) / depth,
      front,
    };
  }

  /** Drawn HUD pieces and the floating stick's region (as run-edge-indicators). */
  private blocked(): Rect[] {
    const v = this.stage.viewport;
    const rects: Rect[] = [];
    for (const node of this.obstacles()) {
      const m = node.globalMatrix.value,
        size = node.size.value;
      if (!node.displayed.value || !m || !size) continue;
      rects.push({
        left: m.elements[12]! + v.width / 2 - size[0] / 2,
        right: m.elements[12]! + v.width / 2 + size[0] / 2,
        top: v.height / 2 - m.elements[13]! - size[1] / 2,
        bottom: v.height / 2 - m.elements[13]! + size[1] / 2,
      });
    }
    rects.push({
      left: 0,
      top: v.height - 180,
      right: Math.max(v.safeArea.left + 170, v.width * 0.25),
      bottom: v.height,
    });
    return rects;
  }

  dispose(): void {
    for (const crown of this.crowns) {
      crown.art?.dispose();
      crown.name.dispose();
    }
    this.root.removeFromParent();
    this.root.dispose();
  }
}
