import { Component, Container, Content, Image, Text, withOpacity } from "@pmndrs/uikit";
import { Box3, Color, Mesh, MeshBasicMaterial, Path, PlaneGeometry, Vector2, Vector3 } from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { RunOverlayControl } from "./run-overlays-control";
import type { RunResult } from "../../run/createRun";
import { starters } from "../../run/sim/content/lines/index";
import { items, type ItemId } from "../../run/sim/content/items";
import { moves } from "../../run/sim/content/moves";
import { difficulties } from "../../run/sim/content/difficulties";
import { formatTime } from "../../run/labels";
import { itemIcon, moveIcon } from "../../screens/runArt";
import type { UiStage } from "./stage";
import { wrapLines } from "./text-fit";
import { uiEaseOut } from "./focus-mark";
import { HoverPattern } from "./hover-pattern";
import { fade, stack } from "./layer";
import { GpuCurrency } from "./currency";
import { softOf } from "./run-choice-surface";

export interface ResultContentState {
  result: RunResult;
  note: string | null;
  backpackSize: number | null;
}
export interface ResultContentCallbacks {
  keepItems(items: ItemId[]): boolean;
  retry(): void;
  exit(): void;
  invalidate(): void;
}

/** Raised action faces retain the authored sheen, bevel and hard base. */
class ResultSkin {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  readonly press = { value: 0 };
  readonly hover = { value: 0 };
  private readonly size = { value: new Vector2(1, 1) };
  constructor(primary: boolean) {
    this.content = new Content({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      keepAspectRatio: false,
      depthTest: false,
    });
    this.material.customProgramCacheKey = () => `run-result-plate-${primary}`;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        resultSize: this.size,
        resultPress: this.press,
        resultHover: this.hover,
        resultFace: { value: new Color(primary ? "#ffd45b" : "#e9f4fb") },
      });
      shader.vertexShader = "varying vec2 resultUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nresultUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 resultUv;uniform vec2 resultSize;uniform float resultPress,resultHover;uniform vec3 resultFace;
        float rounded(vec2 p,vec2 size,float radius){vec2 q=abs(p-size*.5)-(size*.5-vec2(radius));return length(max(q,0.))+min(max(q.x,q.y),0.)-radius;}\n` +
        shader.fragmentShader;
      const plate = `
        vec2 p=vec2(resultUv.x,1.-resultUv.y)*resultSize;
        vec2 faceSize=vec2(resultSize.x,resultSize.y-3.);
        float depth=3.*(1.-resultPress)+resultHover;
        float base=1.-smoothstep(-aa,aa,rounded(p-vec2(0.,depth),faceSize,8.));
        float face=1.-smoothstep(-aa,aa,rounded(p,faceSize,8.));
        float inner=1.-smoothstep(-aa,aa,rounded(p-vec2(2.),faceSize-vec2(4.),6.));
        vec3 ink=resultFace;
        float sheen=.48*(1.-clamp((p.y-2.)/(faceSize.y*.52),0.,1.))*(1.-resultPress);
        ink=mix(ink,vec3(1.),max(sheen,(1.-step(4.,p.y))*.62*(1.-resultPress)));
        ink*=1.-step(faceSize.y-4.,p.y)*.12;
        ink=mix(vec3(.006995,.028426,.08022),ink,inner);
        diffuseColor=vec4(mix(vec3(.004025,.016807,.049707),ink,face),max(base,face)*opacity);
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat aa=.5*max(fwidth(resultUv.x*resultSize.x),fwidth(resultUv.y*resultSize.y));\n${plate}`,
      );
    };
    const mesh = new Mesh(this.geometry, this.material);
    mesh.onBeforeRender = () => {
      const size = this.content.size.value;
      if (size) this.size.value.set(size[0], size[1]);
    };
    this.content.add(mesh);
    this.content.notifyAncestorsChanged();
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function actionIcon(kind: "retry" | "exit"): Content {
  const paths =
    kind === "retry"
      ? [
          new Path().absarc(12, 12, 8, -2.8966, 2.64, false),
          new Path().moveTo(4, 4).lineTo(4, 10).lineTo(10, 10),
        ]
      : [
          new Path().moveTo(20, 12).lineTo(4, 12),
          new Path().moveTo(10, 6).lineTo(4, 12).lineTo(10, 18),
        ];
  const parts = paths.map((path) =>
    SVGLoader.pointsToStroke(
      path.getPoints(40),
      SVGLoader.getStrokeStyle(2.5, "#142f50", "round", "round"),
    )!,
  );
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.translate(-12, -12, 0);
  geometry.boundingBox = new Box3(new Vector3(-12, -12, 0), new Vector3(12, 12, 0));
  const material = new MeshBasicMaterial({
    color: "#142f50",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.y = -1;
  const content = stack(
    new Content({
      width: 24,
      height: 24,
      flexShrink: 0,
      depthTest: false,
    }),
    2,
  );
  content.add(mesh);
  content.notifyAncestorsChanged();
  content.abortSignal.addEventListener("abort", () => {
    geometry.dispose();
    material.dispose();
  });
  return content;
}

export class GpuResultContent {
  readonly root = new Container({ width: "100%", flexDirection: "column", gap: 12, flexShrink: 0 });
  /** `CurrencyCounter gain` in the title band (`.run-modal__head`), right of the title. */
  private readonly purse: GpuCurrency;
  readonly headerCurrency: Container;
  controls: RunOverlayControl[] = [];
  private state: ResultContentState;
  private readonly callbacks: ResultContentCallbacks;
  private readonly stage: UiStage;
  private kept: ItemId[] = [];
  private resultIdentity: RunResult | null = null;
  private signature = "";
  private viewportKey = "";
  private readonly tiles: { id: ItemId; panel: Container }[] = [];
  private bagLabel: Text | null = null;
  private rows: Container[] = [];
  private meta: Text | null = null;
  private noteText: { node: Text; full: string } | null = null;
  private actionPanels: Container[] = [];
  private resources: { dispose(): void }[] = [];
  private animations: { update(deltaMs: number): void; dispose(): void }[] = [];

  constructor(state: ResultContentState, callbacks: ResultContentCallbacks, stage: UiStage) {
    this.state = state;
    this.callbacks = callbacks;
    this.stage = stage;
    this.purse = new GpuCurrency(stage, true);
    this.headerCurrency = this.purse.root;
    this.headerCurrency.setProperties({ marginLeft: "auto" });
    this.update(state);
  }
  update(state: ResultContentState): void {
    this.state = state;
    if (state.result !== this.resultIdentity) {
      this.resultIdentity = state.result;
      this.kept = [];
      this.signature = "";
    }
    const signature = JSON.stringify(state);
    if (signature === this.signature) return;
    this.signature = signature;
    this.build();
    this.afterLayout(0);
  }
  private build(): void {
    this.clear();
    const { result: r } = this.state;
    this.meta = this.text(
      `${starters[r.starter].stages[0].form.name} · ${difficulties[r.difficulty].name} · ${formatTime(r.time)} · Lv.${r.level} · 击倒 ${r.kills}`,
      13,
      "#536b82",
      600,
    );
    this.root.add(this.meta);
    const rewards = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    });
    this.purse.set(r.stardust);
    if (this.state.backpackSize !== null && r.items.length) {
      const bag = new Container({
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        // `.run-result__bag`: the legend first, the items after it, from the left.
        justifyContent: "flex-start",
        gap: 8,
      });
      this.bagLabel = this.text("", 16);
      bag.add(this.bagLabel);
      for (const id of r.items) {
        // The touch target is the tile's size (a fixed 40 under the min-height made its row short).
        const tile = new Container({
          minWidth: Math.max(40, this.stage.viewport.minTarget),
          minHeight: Math.max(40, this.stage.viewport.minTarget),
          flexShrink: 0,
          borderWidth: 2,
          borderColor: "#0d233f",
          borderRadius: 8,
          backgroundColor: "#e9f4fb",
          alignItems: "center",
          justifyContent: "center",
        });
        tile.add(this.image(itemIcon(id), 32));
        this.tiles.push({ id, panel: tile });
        const enabled = () => this.kept.includes(id) || this.kept.length < this.state.backpackSize!;
        this.controls.push({
          panel: tile,
          enabled,
          action: () => this.toggle(id),
          selected: () => this.kept.includes(id),
        });
        this.controls.find((control) => control.panel === tile)!.tip = items[id].name;
        bag.add(tile);
      }
      rewards.add(bag);
      this.paintBag();
      this.root.add(rewards);
    }
    const damage = new Container({ width: "100%", flexDirection: "column", gap: 4 });
    const total = r.moves.reduce((sum, move) => sum + move.damage, 0) || 1;
    for (const move of [...r.moves].sort((a, b) => b.damage - a.damage)) {
      const row = new Container({
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingX: 12,
        paddingY: 8,
        borderRadius: 6,
        backgroundColor: withOpacity("#ffffff", 0.7),
        overflow: "hidden",
      });
      row.add(
        new Container({
          positionType: "absolute",
          positionLeft: 0,
          positionTop: 0,
          width: `${(move.damage / total) * 100}%`,
          height: "100%",
          backgroundColor: softOf(moves[move.id].type),
        }),
      );
      const label = stack(
        new Container({
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }),
        1,
      );
      const name = this.text(moves[move.id].name, 16);
      name.setProperties({ flexShrink: 1 });
      label.add(
        this.image(moveIcon(move.id), 24),
        name,
        this.text(`Lv.${move.level}`, 13, "#536b82", 600),
      );
      const amount = this.text(Math.round(move.damage).toLocaleString("zh-CN"), 16);
      stack(amount, 1).setProperties({ textAlign: "right" });
      row.add(label, amount);
      this.rows.push(row);
      damage.add(row);
    }
    this.root.add(damage);
    if (this.state.note) {
      const note = new Container({
        paddingX: 12,
        paddingY: 8,
        borderRadius: 6,
        backgroundColor: "#ffd45b",
        width: "100%",
      });
      // A sentence of Chinese has no spaces to wrap at: broken to its width in `afterLayout`.
      const text = this.text(this.state.note, 16);
      text.setProperties({ width: "100%", wordBreak: "keep-all", whiteSpace: "pre-line" });
      this.noteText = { node: text, full: this.state.note };
      note.add(text);
      this.root.add(note);
    }
    const actions = new Container({
      width: "100%",
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 12,
      paddingBottom: 3,
    });
    actions.add(
      this.button("再来一局", "retry", () => this.callbacks.retry(), true),
      this.button("返回大厅", "exit", () => this.callbacks.exit(), false),
    );
    this.root.add(actions);
    this.viewportKey = "";
  }
  private toggle(id: ItemId): void {
    const next = this.kept.includes(id)
      ? this.kept.filter((other) => other !== id)
      : [...this.kept, id];
    if (next.length > this.state.backpackSize! || !this.callbacks.keepItems(next)) return;
    this.kept = next;
    this.paintBag();
    this.callbacks.invalidate();
  }
  private paintBag(): void {
    this.bagLabel?.setProperties({ text: `背包 ${this.kept.length}/${this.state.backpackSize}` });
    for (const { id, panel } of this.tiles) {
      const on = this.kept.includes(id),
        enabled = on || this.kept.length < this.state.backpackSize!;
      fade(panel, enabled ? 1 : 0.45).setProperties({
        backgroundColor: on ? "#ffd45b" : "#e9f4fb",
      });
    }
  }
  private text(text: string, fontSize = 16, color = "#142f50", fontWeight = 800): Text {
    return new Text({
      text,
      fontSize,
      fontWeight,
      color,
      minWidth: 0,
      maxWidth: "100%",
      flexShrink: 0,
    });
  }
  private image(src: string, size: number) {
    return stack(new Image({ src, width: size, height: size, flexShrink: 0 }), 1);
  }
  private button(
    label: string,
    kind: "retry" | "exit",
    action: () => void,
    primary: boolean,
  ): Container {
    const panel = new Container({
      flexGrow: 1,
      flexBasis: 0,
      minWidth: 120,
      minHeight: 50,
      paddingX: 22,
      paddingY: 11,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    });
    const skin = new ResultSkin(primary);
    skin.content.setProperties({ positionBottom: -3, height: undefined });
    this.resources.push(skin);
    panel.add(skin.content);
    const pattern = new HoverPattern(this.stage.motion, () => this.stage.invalidate(), "#ffd45b");
    panel.add(pattern.content);
    const ink = this.text(label);
    stack(ink, 2);
    panel.add(actionIcon(kind), ink);
    const hover = { value: 0 },
      press = { value: 0 };
    let focused = false,
      pressed = false;
    const apply = () => {
      skin.press.value = press.value;
      skin.hover.value = hover.value;
      panel.setProperties({
        transformTranslateY: 3 * press.value - hover.value,
        transformScaleX: 1 + 0.012 * press.value,
        transformScaleY: 1 - 0.03 * press.value,
      });
      this.stage.invalidate();
    };
    this.controls.push({
      panel,
      enabled: () => true,
      action,
      // The window lights, drifts and disposes it with every other control's.
      pattern,
      setFocused: (next) => {
        if (focused === next) return;
        focused = next;
        this.stage.motion.animate(hover, { value: next ? 1 : 0 }, 140, apply, uiEaseOut);
      },
      setPressed: (next) => {
        if (pressed === next) return;
        pressed = next;
        this.stage.motion.animate(
          press,
          { value: next ? 1 : 0 },
          next ? 60 : 140,
          apply,
          uiEaseOut,
        );
      },
    });
    this.actionPanels.push(panel);
    this.animations.push({
      update: () => {},
      dispose: () => {
        for (const state of [hover, press]) this.stage.motion.cancel(state);
      },
    });
    return panel;
  }
  afterLayout(deltaMs: number): void {
    for (const animation of this.animations) animation.update(deltaMs);
    if (this.noteText) {
      const lines = wrapLines(this.noteText.node, this.noteText.full);
      if (lines !== undefined && lines !== this.noteText.node.properties.value.text)
        this.noteText.node.setProperties({ text: lines });
    }
    const v = this.stage.viewport,
      key = [v.width, v.height, v.scale].join(",");
    if (key === this.viewportKey) return;
    this.viewportKey = key;
    const compact = v.height <= 480 && v.width > v.height;
    this.root.setProperties({ gap: compact ? 8 : 12 });
    for (const row of this.rows) row.setProperties({ paddingY: compact ? 4 : 8 });
    for (const panel of this.actionPanels)
      panel.setProperties({
        minHeight: Math.max(v.minTarget, compact ? 44 : 50),
        paddingY: compact ? 8 : 11,
      });
    for (const tile of this.tiles)
      tile.panel.setProperties({ minWidth: v.minTarget, minHeight: v.minTarget });
    this.stage.invalidate();
  }
  private clear(): void {
    for (const animation of this.animations) animation.dispose();
    this.animations = [];
    for (const resource of this.resources) resource.dispose();
    this.resources = [];
    const parts: { dispose(): void }[] = [];
    this.controls = [];
    this.tiles.length = 0;
    this.rows = [];
    this.actionPanels = [];
    this.meta = null;
    this.noteText = null;
    this.bagLabel = null;
    for (const child of this.root.children.slice()) {
      child.traverse((o) => {
        if (o instanceof Component) parts.push(o);
      });
      child.removeFromParent();
    }
    for (const part of parts.reverse()) part.dispose();
  }
  dispose(): void {
    this.root.removeFromParent();
    this.headerCurrency.removeFromParent();
    this.purse.dispose();
    this.clear();
    this.root.dispose();
    this.headerCurrency.dispose();
  }
}
