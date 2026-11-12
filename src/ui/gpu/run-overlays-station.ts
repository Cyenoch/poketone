import { Component, Container, Image, Text } from "@pmndrs/uikit";
import { Easing, Tween } from "@tweenjs/tween.js";
import type { RunOverlayControl } from "./run-overlays-control";
import type { StationView } from "../../run/createRun";
import type { LocalCommand } from "../../run/createRun";
import type { Command } from "../../run/sim/state/commands";
import { items } from "../../run/sim/content/items";
import { moves } from "../../run/sim/content/moves";
import { MAX_MOVE_LEVEL } from "../../run/sim/content/params/cards";
import { forgetLock, fusionLock } from "../../run/locks";
import { itemIcon, moveIcon } from "../../screens/runArt";
import { StationArt, StationSurface } from "./run-station-surface";
import { UiMotion } from "./motion";
import { createMenuIcon } from "./icons";
import { uiEaseOut } from "./focus-mark";
import { fade, stack } from "./layer";
import { CURRENCY_ICON, GpuCurrency } from "./currency";
import type { UiStage } from "./stage";
import { uiViewport } from "./viewport";
import { ellipsize } from "./text-fit";

export interface StationContentCallbacks {
  send(command: LocalCommand): void;
  invalidate(): void;
}
interface Tile {
  panel: Container;
  art: StationArt;
  name: Text;
  level: Text;
}
/** Both station contents preserve their selection and real-time animation across the host's rebuilds. */
export class GpuStationContent {
  readonly root = new Container({
    width: "100%",
    flexDirection: "column",
    gap: 12,
    flexShrink: 0,
    minWidth: 0,
  });
  /** The 引梦貘人's purse in the title band (`CurrencyCounter`). */
  private readonly purse: GpuCurrency;
  readonly headerCurrency: Container;
  controls: RunOverlayControl[] = [];
  private readonly motion = new UiMotion();
  private readonly surfaces: StationSurface[] = [];
  private readonly arts: StationArt[] = [];
  private readonly lifts: { y: number }[] = [];
  private readonly groups: Container[] = [];
  private readonly tiles: Tile[] = [];
  private readonly glasses: Container[] = [];
  private readonly names: Text[] = [];
  private readonly labels: { node: Text; full: string; key: string }[] = [];
  private readonly pipes: Container[] = [];
  private machine: Container | null = null;
  private port: Container | null = null;
  private halo: Container | null = null;
  private swing: Tween<{ angle: number }> | null = null;
  private selectedForget: Extract<Command, { t: "forget" }>["target"] | null = null;
  private signature = "";
  private view: StationView;
  private readonly callbacks: StationContentCallbacks;
  private compact = false;
  private minTarget = 44;
  private elapsed = 0;
  private haloStarted = 0;
  constructor(view: StationView, callbacks: StationContentCallbacks, stage: UiStage) {
    this.view = view;
    this.callbacks = callbacks;
    this.purse = new GpuCurrency(stage, true);
    this.headerCurrency = this.purse.root;
    this.headerCurrency.setProperties({ marginLeft: "auto" });
    this.update(view);
  }
  update(view: StationView): void {
    this.view = view;
    this.headerCurrency.setProperties({ display: view.kind === "hypno" ? "flex" : "none" });
    if (view.kind === "hypno") this.purse.set(view.stardust);
    const signature = JSON.stringify(view);
    if (signature === this.signature) return;
    this.signature = signature;
    this.build();
  }
  private surface(
    kind: ConstructorParameters<typeof StationSurface>[0],
    type: ConstructorParameters<typeof StationSurface>[1],
  ): StationSurface {
    const surface = new StationSurface(kind, type);
    this.surfaces.push(surface);
    return surface;
  }
  private art(
    src: string,
    size: number,
    gray = 0,
    brightness = 1,
    opacity = 1,
    shadow = 0,
  ): StationArt {
    const art = new StationArt(src, size, gray, brightness, opacity, shadow);
    this.arts.push(art);
    return art;
  }
  private build(): void {
    this.clear();
    const view = this.view;
    if (view.kind === "hypno") {
      const entries = [
        ...view.moves.map((m) => ({
          target: { kind: "move" as const, id: m.id },
          name: moves[m.id].name,
          icon: moveIcon(m.id),
          type: moves[m.id].type,
          level: moves[m.id].fusion ? `★${m.level}` : `Lv.${m.level}`,
          refund: m.refund,
          lock: forgetLock("move", view.moves.length),
        })),
        ...view.items.map((i) => ({
          target: { kind: "item" as const, id: i.id },
          name: items[i.id].name,
          icon: itemIcon(i.id),
          type: null,
          level: `Lv.${i.level}`,
          refund: i.refund,
          lock: forgetLock("item", view.moves.length),
        })),
      ];
      const selected = entries.find(
        (e) =>
          e.target.kind === this.selectedForget?.kind &&
          e.target.id === this.selectedForget.id &&
          !e.lock,
      );
      if (!selected) this.selectedForget = null;
      for (const kind of ["move", "item"] as const) {
        const groupEntries = entries.filter((entry) => entry.target.kind === kind);
        if (!groupEntries.length) continue;
        if (kind === "item") {
          const rule = new Container({ width: "100%", height: 2, marginTop: 0 });
          rule.add(this.surface("separator", null).content);
          this.root.add(rule);
        }
        const group = new Container({
          width: "100%",
          minWidth: 0,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 8,
        });
        this.groups.push(group);
        this.root.add(group);
        for (const entry of groupEntries) {
          const on = entry === selected,
            enabled = entry.lock === null;
          const panel = new Container({
            width: 160,
            minWidth: 0,
            minHeight: 52,
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 4,
            paddingRight: 22,
          });
          const paint = this.surface("tile", entry.type);
          paint.uniforms.stationOn.value = on ? 1 : 0;
          paint.uniforms.stationOwned.value = enabled ? 1 : 0;
          panel.add(paint.content);
          const art = this.art(entry.icon, 40, enabled ? 0 : 1, 1, enabled ? 1 : 0.5);
          const copy = new Container({
            flexDirection: "column",
            minWidth: 0,
            flexGrow: 1,
            flexShrink: 1,
          });
          const name = this.label(entry.name, 16),
            level = this.text(entry.level, 13, "#536b82");
          name.setProperties({ maxHeight: 23, overflow: "hidden" });
          if (!enabled) {
            fade(name, 0.5).setProperties({ color: "#3e3e3e" });
            fade(level, 0.5).setProperties({ color: "#686868" });
          }
          copy.add(name, level);
          panel.add(art.content, copy);
          const ball = stack(
            new Container({
              positionType: "absolute",
              positionRight: 4,
              positionTop: 4,
              width: 16,
              height: 16,
            }),
            4,
          );
          const ballPaint = this.surface("ball", null);
          ballPaint.uniforms.stationOn.value = on ? 1 : 0;
          ball.add(ballPaint.content);
          panel.add(ball);
          if (on) {
            const pop = { y: 1.3 };
            this.lifts.push(pop);
            this.motion.animate(
              pop,
              { y: 1 },
              220,
              () => ball.setProperties({ transformScaleX: pop.y, transformScaleY: pop.y }),
              uiEaseOut,
            );
          }
          const lift = { y: 0 };
          this.lifts.push(lift);
          const control: RunOverlayControl = {
            panel,
            enabled: () => true,
            locked: () => !enabled,
            selected: () => on,
            action: () => {
              this.selectedForget = on ? null : entry.target;
              this.signature = "";
              this.callbacks.invalidate();
            },
            setFocused: (focused) => {
              this.motion.animate(
                lift,
                { y: focused && enabled ? -2 : 0 },
                140,
                () => panel.setProperties({ transformTranslateY: lift.y }),
                uiEaseOut,
              );
            },
            setPressed: () => {},
          };
          this.controls.push(control);
          if (entry.lock) control.tip = entry.lock;
          this.tiles.push({ panel, art, name, level });
          group.add(panel);
          if (on) {
            const pose = { angle: -10 };
            this.swing = new Tween(pose, this.motion.group)
              .to({ angle: 10 }, 1100)
              .easing(Easing.Sinusoidal.InOut)
              .repeat(Infinity)
              .yoyo(true)
              .onUpdate(() => art.content.setProperties({ transformRotateZ: pose.angle }))
              .start(this.elapsed);
            art.content.setProperties({ transformRotateZ: -10 });
          }
        }
      }
      const action = this.button(
        () => {
          if (!this.selectedForget) return;
          this.callbacks.send({
            t: "forget",
            dialog: view.id,
            target: this.selectedForget,
          });
          this.selectedForget = null;
        },
        !!selected,
        "danger",
      );
      action.add(this.text("忘记", 16, selected ? "#a83243" : "#657b91"));
      if (selected) {
        const name = this.label(selected.name, 16, "#a83243");
        name.setProperties({ flexShrink: 1, minWidth: 0, maxHeight: 23, overflow: "hidden" });
        action.add(
          name,
          this.text(`+${selected.refund}`, 16, "#a83243"),
          stack(
            new Image({
              src: CURRENCY_ICON,
              width: 20,
              height: 20,
              flexShrink: 0,
            }),
            3,
          ),
        );
      } else this.controls.at(-1)!.tip = "先选一个要忘记的招式或道具";
      this.root.add(action);
    } else {
      this.machine = new Container({
        width: "100%",
        minWidth: 0,
        padding: 12,
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
      });
      this.machine.add(this.surface("plate", null).content);
      const chambers = view.parts.map((part) => {
        const chamber = new Container({
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          flexGrow: 1,
          flexBasis: 0,
          minWidth: 0,
        });
        const glass = new Container({
          width: 64,
          height: 72,
          alignItems: "center",
          justifyContent: "center",
        });
        this.glasses.push(glass);
        const shell = this.surface("glass", moves[part.id].type);
        shell.uniforms.stationOwned.value = part.owned ? 1 : 0;
        glass.add(shell.content);
        const art = this.art(moveIcon(part.id), 44, 0, part.owned ? 1 : 0, part.owned ? 1 : 0.3);
        art.content.setProperties({ marginBottom: 8 });
        glass.add(art.content);
        const name = this.label(moves[part.id].name, 16);
        name.setProperties({ textAlign: "center", maxHeight: 23, overflow: "hidden" });
        this.names.push(name);
        const pips = new Container({ width: 77, height: 16, flexShrink: 0 });
        const lamps = this.surface("pips", moves[part.id].type);
        lamps.uniforms.stationLevel.value = part.owned ? Math.min(MAX_MOVE_LEVEL, part.level) : 0;
        pips.add(lamps.content);
        if (part.owned && part.level >= MAX_MOVE_LEVEL)
          pips.setProperties({
            borderColor: lamps.uniforms.stationLight.value,
            borderWidth: 2,
            borderRadius: 6,
            width: 81,
            height: 20,
            padding: 2,
          });
        chamber.add(glass, name, pips);
        return chamber;
      });
      const core = new Container({
        flexDirection: "column",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        flexShrink: 0,
      });
      this.port = new Container({
        width: 88,
        height: 88,
        alignItems: "center",
        justifyContent: "center",
      });
      const portPaint = this.surface("port", moves[view.move].type);
      portPaint.uniforms.stationOn.value = view.ready ? 1 : 0;
      stack(portPaint.content, 1).setProperties({
        positionLeft: -6,
        positionTop: -6,
        width: 100,
        height: 100,
      });
      this.port.add(portPaint.content);
      const art = this.art(
        moveIcon(view.move),
        56,
        view.ready ? 0 : 0.85,
        view.ready ? 1 : 0.6,
        1,
        view.ready ? 2 : 0,
      );
      this.port.add(art.content);
      const name = this.label(moves[view.move].name, 16);
      name.setProperties({ textAlign: "center", maxWidth: 120, maxHeight: 23, overflow: "hidden" });
      this.names.push(name);
      core.add(this.port, name);
      if (view.ready) {
        this.haloStarted = this.elapsed;
        this.halo = stack(
          new Container({
            positionType: "absolute",
            positionLeft: -10,
            positionTop: -10,
            width: 108,
            height: 108,
            borderWidth: 3,
            borderColor: portPaint.uniforms.stationLight.value,
            borderRadius: 54,
          }),
          0,
        );
        this.port.add(this.halo);
      }
      for (let i = 0; i < 2; i++) {
        const pipe = new Container({
          height: 16,
          minWidth: 12,
          maxWidth: 56,
          flexGrow: 1,
          flexBasis: 28,
          marginLeft: -6,
          marginRight: -6,
          marginBottom: 34,
        });
        this.pipes.push(pipe);
        const flow = this.surface("pipe", moves[view.parts[i]!.id].type);
        flow.uniforms.stationOn.value =
          view.parts[i]!.owned && view.parts[i]!.level >= MAX_MOVE_LEVEL ? 1 : 0;
        flow.uniforms.stationSide.value = i === 0 ? 1 : -1;
        pipe.add(flow.content);
        this.machine.add(i === 0 ? chambers[0]! : core, pipe);
      }
      this.machine.add(chambers[1]!);
      this.root.add(this.machine);
      const fuse = this.button(
        () => this.callbacks.send({ t: "fuse", dialog: view.id }),
        view.ready,
        "primary",
      );
      const spark = createMenuIcon("spark");
      spark.setProperties({ width: 24, height: 24, color: view.ready ? "#0d233f" : "#657b91" });
      // `.game-button--wide`: the icon pinned 22px in from the left, the label centred.
      const iconSlot = stack(
        new Container({
          positionType: "absolute",
          positionLeft: 22,
          positionTop: 0,
          positionBottom: 0,
          alignItems: "center",
          justifyContent: "center",
        }),
        3,
      );
      iconSlot.add(spark);
      fuse.add(iconSlot, this.text("融合", 16, view.ready ? "#0d233f" : "#657b91"));
      const lock = fusionLock(view.parts);
      if (lock) this.controls.at(-1)!.tip = lock;
      this.root.add(fuse);
    }
    this.applySizes();
  }
  private text(text: string, fontSize: number, color = "#142f50"): Text {
    return stack(
      new Text({
        text,
        fontSize,
        fontWeight: 800,
        lineHeight: "140%",
        color,
        minWidth: 0,
        maxWidth: "100%",
        flexShrink: 0,
      }),
      3,
    );
  }
  private label(value: string, size: number, color = "#142f50"): Text {
    const node = this.text(value, size, color);
    node.setProperties({ width: "100%", flexShrink: 1 });
    this.labels.push({ node, full: value, key: "" });
    return node;
  }
  private button(action: () => void, enabled: boolean, tone: "danger" | "primary"): Container {
    const panel = new Container({
      width: "100%",
      minHeight: 50,
      paddingX: 22,
      paddingY: 11,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginBottom: 4,
      minWidth: 0,
      // `.game-button`: a 2px navy (danger: red) border; a locked one keeps the grey plate's edge.
      borderWidth: 2,
      borderRadius: 8,
      borderColor: enabled ? (tone === "danger" ? "#a83243" : "#142f50") : "#9fb4c6",
    });
    const paint = this.surface("button", null);
    stack(paint.content, 1);
    paint.uniforms.stationSoft.value.set(tone === "danger" ? "#fce5e5" : "#ffd45b");
    paint.uniforms.stationTint.value.set(tone === "danger" ? "#a83243" : "#b48129");
    paint.uniforms.stationDeep.value.set(tone === "danger" ? "#6b1a27" : "#7c5c16");
    paint.uniforms.stationOwned.value = enabled ? 1 : 0;
    const shadow = stack(
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 4,
        width: "100%",
        height: "100%",
        borderRadius: 8,
        // The hard base under the plate: navy-deep (danger: #6b1a27).
        backgroundColor: enabled ? (tone === "danger" ? "#6b1a27" : "#0d233f") : "#9fb4c6",
      }),
      0,
    );
    panel.add(shadow, paint.content);
    const pose = { y: 0 };
    this.lifts.push(pose);
    this.controls.push({
      panel,
      enabled: () => true,
      locked: () => !enabled,
      command: tone,
      action,
      setPressed: (pressed) =>
        this.motion.animate(
          pose,
          { y: pressed ? 4 : 0 },
          pressed ? 60 : 140,
          () => {
            paint.content.setProperties({ transformTranslateY: pose.y });
            for (const child of panel.children)
              if (child !== paint.content && child !== shadow && child instanceof Component)
                child.setProperties({ transformTranslateY: pose.y });
          },
          uiEaseOut,
        ),
    });
    return panel;
  }
  resize(hostWidth: number, hostHeight: number, scale: number): void {
    this.compact = hostHeight / scale <= 480;
    this.minTarget = uiViewport(hostWidth, hostHeight, scale).minTarget;
    this.root.setProperties({ maxWidth: Math.max(0, hostWidth / scale - 32) });
    this.applySizes();
  }
  private applySizes(): void {
    for (const tile of this.tiles) {
      tile.panel.setProperties({ minHeight: Math.max(this.minTarget, this.compact ? 44 : 52) });
      tile.art.content.setProperties({
        width: this.compact ? 32 : 40,
        height: this.compact ? 32 : 40,
      });
      // --type-label: 16px, not reduced in short landscape.
      tile.name.setProperties({ fontSize: 16 });
      tile.level.setProperties({ fontSize: this.compact ? 12 : 13 });
    }
    for (const glass of this.glasses)
      glass.setProperties({ width: this.compact ? 52 : 64, height: this.compact ? 58 : 72 });
    for (const art of this.arts)
      if (!this.tiles.some((tile) => tile.art === art))
        art.content.setProperties({
          width: this.compact
            ? art === this.arts.at(-1)
              ? 44
              : 36
            : art === this.arts.at(-1)
              ? 56
              : 44,
          height: this.compact
            ? art === this.arts.at(-1)
              ? 44
              : 36
            : art === this.arts.at(-1)
              ? 56
              : 44,
        });
    for (const name of this.names) name.setProperties({ fontSize: 16 });
    const portSize = this.compact ? 70 : 88;
    this.port?.setProperties({ width: portSize, height: portSize });
    if (this.port)
      for (const surface of this.surfaces)
        if (surface.content.parent === this.port)
          surface.content.setProperties({ width: portSize + 12, height: portSize + 12 });
    this.halo?.setProperties({
      width: portSize + 20,
      height: portSize + 20,
      borderRadius: (portSize + 20) / 2,
    });
    this.machine?.setProperties({ paddingY: this.compact ? 8 : 12 });
    for (const pipe of this.pipes) pipe.setProperties({ marginBottom: this.compact ? 30 : 34 });
    for (const control of this.controls)
      control.panel.setProperties({
        minHeight: Math.max(
          this.minTarget,
          this.tiles.some((tile) => tile.panel === control.panel) ? (this.compact ? 44 : 52) : 50,
        ),
      });
  }
  afterLayout(deltaMs: number): boolean {
    this.elapsed += deltaMs;
    let changed = this.motion.update(deltaMs);
    for (const surface of this.surfaces) surface.update(this.elapsed / 1000);
    for (const group of this.groups) {
      const width = group.size.value?.[0];
      if (!width) continue;
      const columns = this.compact
        ? Math.max(1, Math.min(4, Math.floor((width + 8) / 96)))
        : Math.max(1, Math.floor((width + 8) / 168));
      const key = `${width}:${columns}`;
      if (group.userData.stationColumns !== key) {
        group.userData.stationColumns = key;
        for (const child of group.children)
          if (child instanceof Container)
            child.setProperties({ width: (width - 8 * (columns - 1)) / columns });
        changed = true;
      }
    }
    for (const label of this.labels) {
      const width = label.node.size.value?.[0],
        layout = label.node.textLayout.value;
      if (width === undefined || !layout) continue;
      const key = `${width}:${layout.fontSize}:${layout.letterSpacing}`;
      if (key === label.key) continue;
      const value = ellipsize(label.node, label.full);
      if (value === undefined) continue;
      label.key = key;
      if (label.node.properties.value.text !== value) {
        label.node.setProperties({ text: value });
        changed = true;
      }
    }
    if (this.halo) {
      const t = uiEaseOut(((this.elapsed - this.haloStarted) % 1200) / 1200);
      fade(this.halo, 1 - t).setProperties({
        transformScaleX: 0.92 + 0.48 * t,
        transformScaleY: 0.92 + 0.48 * t,
      });
      changed = true;
    }
    if (
      this.view.kind === "bill" &&
      this.view.parts.some((part) => part.owned && part.level >= MAX_MOVE_LEVEL)
    )
      changed = true;
    return changed;
  }
  private clear(): void {
    if (this.swing) {
      this.swing.stop();
      this.motion.group.remove(this.swing);
      this.swing = null;
    }
    for (const pose of this.lifts) this.motion.cancel(pose);
    this.lifts.length = 0;
    for (const surface of this.surfaces) surface.dispose();
    this.surfaces.length = 0;
    for (const art of this.arts) art.dispose();
    this.arts.length = 0;
    this.controls = [];
    this.tiles.length = 0;
    this.groups.length = 0;
    this.glasses.length = 0;
    this.names.length = 0;
    this.labels.length = 0;
    this.pipes.length = 0;
    this.machine = null;
    this.port = null;
    this.halo = null;
    const components: { dispose(): void }[] = [];
    for (const child of this.root.children.slice()) {
      child.traverse((o) => {
        if (o instanceof Component) components.push(o);
      });
      child.removeFromParent();
    }
    for (const component of components.reverse()) component.dispose();
  }
  dispose(): void {
    this.root.removeFromParent();
    this.clear();
    this.root.dispose();
    this.motion.dispose();
    this.headerCurrency.removeFromParent();
    this.purse.dispose();
    this.headerCurrency.dispose();
  }
}
