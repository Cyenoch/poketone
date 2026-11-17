import { abortableEffect, Container, Content, Text } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector2, Vector3 } from "three";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { InputGlyph } from "./input-glyph";
import { inheritedOpacity, stack } from "./layer";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, RADIUS, SLANT, slantOf, srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

/**
 * A window's legacy band pieces (the 图鉴 still draws its header band and button sheen with them),
 * in the redesign's flat language: the header an ink band with white slant hatching, the knob and
 * track no paint of their own (a disabled knob keeps its hatch). Nothing here moves on its own.
 */
export class DialogSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly uniforms = {
    plateSize: { value: new Vector2(1, 1) },
    plateDisabled: { value: 0 },
  };

  private readonly kind: "header" | "knob" | "track";

  constructor(kind: "header" | "knob" | "track") {
    this.kind = kind;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 plateUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nplateUv=uv;",
      );
      shader.fragmentShader =
        `
        varying vec2 plateUv;
        uniform vec2 plateSize;
        uniform float plateDisabled;
      ` + shader.fragmentShader;
      const ink = srgb(ui.ink);
      const header = `
        vec3 base=vec3(${ink.x.toFixed(4)},${ink.y.toFixed(4)},${ink.z.toFixed(4)});
        float lane=mod((p.x-(plateSize.y-p.y)*${SLANT.toFixed(5)})*${Math.cos((14 * Math.PI) / 180).toFixed(5)},14.);
        base=mix(base,vec3(1.),.07*(1.-smoothstep(2.-aa,2.+aa,lane)));
        diffuseColor=vec4(sRGBTransferEOTF(vec4(base,1.)).rgb,1.);
      `;
      const knob = `
        float hatch=(1.-step(4.,mod(p.x-p.y,9.)))*.5;
        diffuseColor=vec4(vec3(1.),plateDisabled>.5 ? hatch : 0.);
      `;
      const track = `diffuseColor=vec4(0.);`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(plateUv.x,1.-plateUv.y)*plateSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        ${this.kind === "header" ? header : this.kind === "knob" ? knob : track}
        float radius=${RADIUS.toFixed(1)};
        vec2 q=abs(p-plateSize*.5)-(plateSize*.5-vec2(radius));
        float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
        diffuseColor.a*=opacity*(1.-smoothstep(-aa,aa,edge));
      `,
      );
    };
    this.material.customProgramCacheKey = () => `poketone-dialog2-${kind}`;
    this.content = new Content({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      keepAspectRatio: false,
      depthTest: false,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  /** Follows the surface's size; false: nothing here moves on its own, so it never asks for an
   *  idle redraw. */
  update(_deltaMs: number): boolean {
    const size = this.content.size.value;
    if (size) this.uniforms.plateSize.value.set(size[0], size[1]);
    return false;
  }

  setDisabled(disabled: boolean): void {
    this.uniforms.plateDisabled.value = disabled ? 1 : 0;
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Room around a card for its hard shadow. */
const CARD_REACH = 12;

export interface CardFaceStyle {
  fill: string;
  /** Frame inside the edge; `dash` breaks it into 10px dashes (an empty seat). */
  border?: { color: string; width: number; dash?: boolean };
  radius?: number;
}

/**
 * A straight card in one quad behind its box's content (a window, a seat): radius 6, the hard
 * shadow offset right and down (black 22%), an optional solid or dashed frame. Follows its host's size and fade on its own.
 */
export class CardFace {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: -CARD_REACH,
    positionTop: -CARD_REACH,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    boxSize: { value: Vector2 };
    depth: { value: number };
    fill: { value: Vector3 };
    border: { value: Vector3 };
    borderWidth: { value: number };
    opacity: { value: number };
  }>;
  private readonly host: Container;
  private size = "";

  constructor(host: Container, style: CardFaceStyle) {
    this.host = host;
    const radius = (style.radius ?? RADIUS).toFixed(1);
    const dash = style.border?.dash ?? false;
    this.material = new UiShaderMaterial(`card-face-${dash ? "d" : "s"}`, {
      uniforms: {
        boxSize: { value: new Vector2(1, 1) },
        depth: { value: HARD_SHADOW.offset },
        fill: { value: srgb(style.fill) },
        border: { value: srgb(style.border?.color ?? ui.ink) },
        borderWidth: { value: style.border?.width ?? 0 },
        opacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 boxPoint;
        uniform vec2 boxSize;
        #include <clipping_planes_pars_vertex>
        void main() {
          boxPoint = vec2(uv.x, 1. - uv.y) * (boxSize + vec2(${2 * CARD_REACH}.)) - vec2(${CARD_REACH}.);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
          #include <clipping_planes_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 boxSize;
        uniform float depth, borderWidth, opacity;
        uniform vec3 fill, border;
        varying vec2 boxPoint;
        #include <clipping_planes_pars_fragment>
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        float box(vec2 p) {
          vec2 q = abs(p - boxSize * .5) - boxSize * .5 + ${radius};
          return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - ${radius};
        }
        void over(inout vec4 acc, vec3 ink, float a) { acc = vec4(ink * a + acc.rgb * (1. - a), a + acc.a * (1. - a)); }
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = boxPoint;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          vec4 acc = vec4(0.);
          if (depth > 0.) over(acc, vec3(0.), ${HARD_SHADOW.alpha} * (1. - smoothstep(-aa, aa, box(p - vec2(depth)))));
          float d = box(p);
          vec3 col = fill;
          if (borderWidth > 0.) {
            float frame = smoothstep(-borderWidth - aa, -borderWidth + aa, d);
            ${
              dash
                ? `{
              // Dashes run along the perimeter: x on the long edges, y on the short ones.
              vec2 e = min(p, boxSize - p);
              float along = e.y < e.x ? p.x : p.y;
              frame *= step(mod(along, 16.), 10.);
            }`
                : ""
            }
            col = mix(col, border, frame);
          }
          over(acc, col, 1. - smoothstep(-aa, aa, d));
          if (acc.a <= 0.) discard;
          gl_FragColor = vec4(toLinear(acc.rgb / acc.a), acc.a * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    abortableEffect(() => this.update(), this.content.abortSignal);
  }

  set(state: { fill?: string; border?: string; borderWidth?: number; depth?: number }): void {
    const u = this.material.uniforms;
    if (state.fill !== undefined) srgb(state.fill, u.fill.value);
    if (state.border !== undefined) srgb(state.border, u.border.value);
    if (state.borderWidth !== undefined) u.borderWidth.value = state.borderWidth;
    if (state.depth !== undefined) u.depth.value = state.depth;
  }

  update(): void {
    this.material.uniforms.opacity.value = inheritedOpacity(this.content);
    const s = this.host.size.value;
    if (!s) return;
    const key = `${s[0]},${s[1]}`;
    if (key === this.size) return;
    this.size = key;
    this.material.uniforms.boxSize.value.set(s[0], s[1]);
    this.content.setProperties({ width: s[0] + 2 * CARD_REACH, height: s[1] + 2 * CARD_REACH });
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The shared window shell (联机, 设置, 存档): an upright paper card, the title
 * on an ink slanted plate (the window's one slanted accent) set over its top-left corner, and the close key (a secondary
 * square with its Esc cap) at the top right. `extra` sits between them (the room code). Owners add
 * their body after `header` and route the close key's input themselves.
 */
export class DialogFrame {
  readonly panel: Container;
  readonly header = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    paddingTop: 12,
    paddingRight: 12,
  });
  readonly extra = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  });
  readonly close: GameButton;
  /** The Esc cap's slot; owners hide it under a coarse pointer. */
  readonly escBadge = new Container({
    positionType: "absolute",
    positionRight: -4,
    positionBottom: -6,
  });
  private readonly face: CardFace;
  private readonly titleBox: Container;
  private readonly titlePlate: SlantPlate;
  private readonly title: Text;
  /** The title plate sits inside the header row instead of hanging over the top-left corner. */
  private seated = false;

  constructor(stage: UiStage, title: string, width: number) {
    this.panel = new Container({
      width,
      maxWidth: "100%",
      maxHeight: "100%",
      minHeight: 0,
      flexDirection: "column",
      color: ui.ink,
    });
    // The window's hard shadow is the backdrop's (it follows the panel below the UI pass).
    this.face = new CardFace(this.panel, { fill: ui.paper });
    this.face.set({ depth: 0 });
    this.titleBox = new Container({
      height: 44,
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      marginLeft: -12,
      marginTop: -22,
      // Even padding: the title sits on the parallelogram's centre.
      paddingLeft: 20 + slantOf(44) / 2,
      paddingRight: 20 + slantOf(44) / 2,
    });
    this.titlePlate = new SlantPlate(this.titleBox, {
      fill: ui.ink,
      hatch: { color: ui.white, alpha: 0.08 },
    });
    this.titlePlate.set({ depth: HARD_SHADOW.offset });
    this.title = stack(
      new Text({
        text: title,
        fontSize: 20,
        fontWeight: 800,
        letterSpacing: 2,
        // The tracking trails the last glyph: the same indent before the first keeps it centred.
        paddingLeft: 2,
        color: ui.white,
        whiteSpace: "pre",
        wordBreak: "keep-all",
      }),
      1,
    );
    this.titleBox.add(this.titlePlate.content, this.title);
    this.close = new GameButton(stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: createMenuIcon("close"),
    });
    this.escBadge.add(new InputGlyph("cancel", "Esc"));
    this.close.panel.add(stack(this.escBadge, 3));
    this.header.add(stack(this.titleBox, 2), this.extra, stack(this.close.panel, 1));
    this.panel.add(this.face.content, this.header);
  }

  setTitle(text: string): void {
    this.title.setProperties({ text });
  }

  /** Seats the title plate in the header row (a window whose header has its own tabs). */
  seatTitle(): void {
    this.seated = true;
  }

  /** Short screens: a 36px title plate. */
  resize(compact: boolean): void {
    const height = compact ? 36 : 44;
    this.titleBox.setProperties({
      height,
      marginLeft: this.seated ? 0 : -12,
      marginTop: this.seated ? 0 : compact ? -16 : -22,
      paddingLeft: 17 + slantOf(height) / 2,
      paddingRight: 17 + slantOf(height) / 2,
    });
    this.title.setProperties({ fontSize: compact ? 17 : 20 });
    this.header.setProperties({ paddingTop: compact ? 8 : 12, paddingRight: compact ? 8 : 12 });
    this.close.fitTouch();
  }

  dispose(): void {
    this.close.dispose();
    this.titlePlate.dispose();
    this.face.dispose();
  }
}
