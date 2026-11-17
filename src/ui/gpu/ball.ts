import { abortableEffect, Container, Content, Image, type ImageOutProperties } from "@pmndrs/uikit";

/** Any uikit Image (its `src` type aside). */
type AnyImage = Image<ImageOutProperties<unknown>>;
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2, Vector3 } from "three";
import { inheritedOpacity, stack } from "./layer";
import { LIFT, SNAP, type UiMotion } from "./motion";
import { srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

/** Room around the ball for its type ring, focus ring and corner mark. */
const REACH = 14;

export interface BallLook {
  /** Upper and lower halves. */
  top: string;
  bottom: string;
  /** Rim, middle band and button ring. */
  ink: string;
  /** Rim and band width (px). */
  line: number;
  /** The centre button's outer radius (px; 0: none) and face. */
  button: number;
  buttonFace: string;
}

/** A corner mark on a badge: cleared (green dot) or locked (ink dot with a padlock). */
export type BallMark = "clear" | "lock" | null;

/**
 * A Poké Ball drawn in one quad behind its host box's content (the host is square): two halves, an
 * ink rim and middle band, an optional centre button, and outside it a type ring (selected), an ink
 * focus ring and a corner mark. Follows its host's size and fade on its own.
 */
export class BallFace {
  readonly content = new Content({
    positionType: "absolute",
    // The host's own size (no scroll overflow); the vertex shader grows the quad by REACH.
    positionLeft: 0,
    positionTop: 0,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    boxSize: { value: Vector2 };
    top: { value: Vector3 };
    bottom: { value: Vector3 };
    ink: { value: Vector3 };
    line: { value: number };
    button: { value: Vector2 };
    buttonFace: { value: Vector3 };
    ring: { value: Vector3 };
    ringOn: { value: number };
    focus: { value: number };
    mark: { value: number };
    opacity: { value: number };
  }>;
  private readonly host: Container;

  constructor(host: Container, look: BallLook) {
    this.host = host;
    this.material = new UiShaderMaterial("ball-face", {
      uniforms: {
        boxSize: { value: new Vector2(1, 1) },
        top: { value: srgb(look.top) },
        bottom: { value: srgb(look.bottom) },
        ink: { value: srgb(look.ink) },
        line: { value: look.line },
        button: { value: new Vector2(look.button, 0) },
        buttonFace: { value: srgb(look.buttonFace) },
        ring: { value: srgb(ui.ball) },
        ringOn: { value: 0 },
        focus: { value: 0 },
        mark: { value: 0 },
        opacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 ballPoint;
        uniform vec2 boxSize;
        #include <clipping_planes_pars_vertex>
        void main() {
          ballPoint = (vec2(uv.x, 1. - uv.y) - .5) * (boxSize + vec2(${2 * REACH}.));
          vec3 grown = vec3(position.xy * (boxSize + vec2(${2 * REACH}.)) / boxSize, position.z);
          vec4 mvPosition = modelViewMatrix * vec4(grown, 1.);
          #include <clipping_planes_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 boxSize, button;
        uniform vec3 top, bottom, ink, buttonFace, ring;
        uniform float line, ringOn, focus, mark, opacity;
        varying vec2 ballPoint;
        #include <clipping_planes_pars_fragment>
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        void over(inout vec4 acc, vec3 c, float a) { acc = vec4(c * a + acc.rgb * (1. - a), a + acc.a * (1. - a)); }
        float fillIn(float d, float aa) { return 1. - smoothstep(-aa, aa, d); }
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = ballPoint;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float R = .5 * min(boxSize.x, boxSize.y);
          float r = length(p);
          vec4 acc = vec4(0.);
          // Selected: a 3px type ring 3px out; focus: a 2.5px ink ring outside that.
          over(acc, ring, ringOn * fillIn(abs(r - R - 4.5) - 1.5, aa));
          over(acc, ${srgbGlsl(ui.ink)}, focus * fillIn(abs(r - R - (ringOn > .5 ? 9.25 : 4.25)) - 1.25, aa));
          vec3 col = p.y < 0. ? top : bottom;
          float lineCover = max(fillIn(abs(p.y) - .5 * line, aa), 1. - fillIn(r - R + line, aa));
          if (button.x > 0.) {
            lineCover = max(lineCover * (1. - fillIn(r - button.x, aa)), fillIn(abs(r - button.x + .5 * line) - .5 * line, aa));
            col = mix(col, buttonFace, fillIn(r - button.x + line, aa));
          }
          col = mix(col, ink, lineCover);
          over(acc, col, fillIn(r - R, aa));
          if (mark > .5) {
            vec2 m = p - vec2(.72, -.72) * R;
            float mr = length(m);
            vec3 dot_ = mark < 1.5 ? ${srgbGlsl(ui.success)} : ${srgbGlsl(ui.ink)};
            vec3 mc = mix(vec3(1.), dot_, fillIn(mr - 6., aa));
            if (mark > 1.5) {
              // The padlock: a body and a shackle, white.
              float body = max(abs(m.x) - 2.6, abs(m.y - 1.2) - 1.9);
              float shackle = max(abs(length(m - vec2(0., -1.)) - 1.9) - .6, m.y + .2);
              mc = mix(mc, vec3(1.), fillIn(min(body, shackle), aa));
            }
            over(acc, mc, fillIn(mr - 8., aa));
          }
          if (acc.a <= 0.) discard;
          gl_FragColor = vec4(toLinear(acc.rgb / acc.a), acc.a * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    abortableEffect(() => {
      this.material.uniforms.opacity.value = inheritedOpacity(this.content);
      const s = this.host.size.value;
      if (!s) return;
      this.material.uniforms.boxSize.value.set(Math.max(1, s[0]), Math.max(1, s[1]));
      this.content.setProperties({ width: s[0], height: s[1] });
    }, this.content.abortSignal);
  }

  setLook(look: Partial<BallLook>): void {
    const u = this.material.uniforms;
    if (look.top !== undefined) srgb(look.top, u.top.value);
    if (look.bottom !== undefined) srgb(look.bottom, u.bottom.value);
    if (look.ink !== undefined) srgb(look.ink, u.ink.value);
    if (look.line !== undefined) u.line.value = look.line;
    if (look.button !== undefined) u.button.value.x = look.button;
    if (look.buttonFace !== undefined) srgb(look.buttonFace, u.buttonFace.value);
  }

  /** The selected type ring (its colour; null hides it), the focus ring (0–1) and the corner mark. */
  set(state: { ring?: string | null; focus?: number; mark?: BallMark }): void {
    const u = this.material.uniforms;
    if (state.ring !== undefined) {
      u.ringOn.value = state.ring ? 1 : 0;
      if (state.ring) srgb(state.ring, u.ring.value);
    }
    if (state.focus !== undefined) u.focus.value = state.focus;
    if (state.mark !== undefined) u.mark.value = state.mark === "clear" ? 1 : state.mark ? 2 : 0;
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function srgbGlsl(hex: string): string {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
}

/** The primary button's ball mark (and any small ball glyph): white halves, ink band and button. */
export function ballGlyph(size = 30): { glyph: Container; dispose(): void } {
  const glyph = new Container({ width: size, height: size, flexShrink: 0 });
  const face = new BallFace(glyph, {
    top: ui.white,
    bottom: ui.white,
    ink: ui.ink,
    line: Math.max(2, size / 10),
    button: size * 0.24,
    buttonFace: ui.white,
  });
  glyph.add(face.content);
  return { glyph, dispose: () => face.dispose() };
}

/**
 * An Image material that draws its picture as a flat ink silhouette: the colour becomes ink and the
 * alpha is kept as is (straight, as both platforms decode it). `setSilhouette` swaps an Image to it
 * and back; every silhouette shares one program.
 */
export class SilhouetteImageMaterial extends MeshBasicMaterial {
  constructor() {
    super();
    const ink = { value: new Color(ui.ink) };
    this.onBeforeCompile = (shader) => {
      shader.uniforms.silhouetteInk = ink;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec3 silhouetteInk;\nvoid main() {")
        .replace(
          "#include <map_fragment>",
          "#include <map_fragment>\ndiffuseColor.rgb = silhouetteInk;",
        );
    };
    this.customProgramCacheKey = () => "poketone-silhouette-image";
  }
}

/** A form's portrait, in its shiny colours when its player wears the line's shiny look. */
export const portraitSrc = (form: string, shiny: boolean): string =>
  `/art/portraits/${form}${shiny ? "-shiny" : ""}.webp`;

/**
 * Portraits whose figure stands in an opaque haze (Gastly's gas): their silhouette draws a mask of
 * the body instead (`public/art/portraits/silhouettes/`).
 */
const masked = new Set(["gastly"]);

/** Draws a uikit Image showing the portrait `src` as its ink silhouette, or as itself again. */
export function setSilhouette(image: AnyImage, on: boolean, src: string): void {
  const form = /\/art\/portraits\/([\w-]+)\.webp$/.exec(src)?.[1];
  image.setProperties({
    src: on && form && masked.has(form) ? `/art/portraits/silhouettes/${form}.webp` : src,
    panelMaterialClass: on ? SilhouetteImageMaterial : MeshBasicMaterial,
  });
}

export const silhouetteBall: Partial<BallLook> = {
  top: "#e4e6ea",
  bottom: "#e4e6ea",
  ink: "#c4c8cf",
  buttonFace: "#e4e6ea",
};

export interface BallBadgeState {
  selected: boolean;
  /** Not yet available: a grey empty ball (no lift, no type ring). */
  locked: boolean;
  /**
   * Not yet available but still to be looked at: a grey ball under the `portrait` drawn as an ink
   * silhouette; it lifts, rings and takes focus like any badge.
   */
  silhouette: boolean;
  hovered: boolean;
  focused: boolean;
  focusVisible: boolean;
  pressed: boolean;
  /** The type colour of the selected outline. */
  type: string;
  mark: BallMark;
}

const resting = { top: ui.white, bottom: ui.white, ink: ui.ink, buttonFace: ui.white };
const lockedLook = silhouetteBall;

/**
 * A Poké Ball badge (a partner in a list, an evolution step): a 54px ball whose upper half turns
 * ball-red with a type-coloured outline when selected; hover lifts it 3px, selected 5px, a press
 * sinks it 1px (SNAP 160ms). A locked badge is a grey empty ball; a silhouette badge a grey ball
 * under its portrait in ink. The owner gives the portrait with `portrait` (or adds its own content
 * to `panel`, drawn over the ball) and wires input like any control.
 */
export class BallBadge {
  readonly panel: Container;
  private readonly face: BallFace;
  private readonly motion: UiMotion;
  private readonly invalidate: () => void;
  private readonly pose = { lift: 0 };
  private portraitImage: { image: AnyImage; src: string } | null = null;
  private state: BallBadgeState = {
    selected: false,
    locked: false,
    silhouette: false,
    hovered: false,
    focused: false,
    focusVisible: false,
    pressed: false,
    type: ui.ball,
    mark: null,
  };
  private target = 0;

  constructor(motion: UiMotion, invalidate: () => void, size = 54) {
    this.motion = motion;
    this.invalidate = invalidate;
    this.panel = new Container({
      width: size,
      height: size,
      flexShrink: 0,
      alignItems: "center",
      justifyContent: "center",
    });
    this.face = new BallFace(this.panel, {
      ...resting,
      line: 3,
      button: 0,
    });
    this.panel.add(this.face.content);
  }

  /** The slot for the portrait, stacked over the ball. */
  add(child: Content | Container): void {
    this.panel.add(stack(child, 1));
  }

  /** The portrait over the ball (`scale` of the badge), drawn in ink while `silhouette`. */
  portrait(src: string, scale = 0.8): void {
    const size = `${scale * 100}%` as const;
    const box = new Container({ width: size, height: size });
    const image = new Image({ src, width: "100%", height: "100%" });
    box.add(image);
    this.add(box);
    setSilhouette(image, this.state.silhouette, src);
    this.portraitImage = { image, src };
  }

  /** Swaps the portrait's picture (a partner's normal or shiny look), keeping its silhouette state. */
  setPortrait(src: string): void {
    const shown = this.portraitImage;
    if (!shown || shown.src === src) return;
    shown.src = src;
    setSilhouette(shown.image, this.state.silhouette, src);
  }

  set(next: Partial<BallBadgeState>): void {
    const was = this.state;
    this.state = { ...was, ...next };
    const s = this.state;
    const locked = s.locked;
    this.face.setLook(
      locked
        ? { ...lockedLook, button: 9 }
        : s.silhouette
          ? { ...silhouetteBall, button: 0 }
          : { ...resting, top: s.selected ? ui.ball : ui.white, button: 0 },
    );
    if (this.portraitImage && s.silhouette !== was.silhouette)
      setSilhouette(this.portraitImage.image, s.silhouette, this.portraitImage.src);
    this.face.set({
      ring: s.selected && !locked ? s.type : null,
      focus: s.focused && s.focusVisible ? 1 : 0,
      mark: s.mark,
    });
    const lift =
      s.pressed && !locked
        ? -LIFT.press
        : s.selected && !locked
          ? LIFT.picked
          : s.hovered && !locked
            ? LIFT.hover
            : 0;
    if (lift !== this.target) {
      this.target = lift;
      this.motion.animate(
        this.pose,
        { lift },
        LIFT.ms,
        () => {
          this.panel.setProperties({ transformTranslateY: -this.pose.lift });
          this.invalidate();
        },
        SNAP,
      );
    }
    this.invalidate();
  }

  /** Touch rule: at least `minTarget` stage units (`viewport.minTarget`) each way. */
  fitTouch(minTarget: number): void {
    this.panel.setProperties({ minWidth: minTarget, minHeight: minTarget });
  }

  setHovered(hovered: boolean): void {
    this.set({ hovered });
  }
  setFocused(focused: boolean): void {
    this.set({ focused });
  }
  setFocusVisible(focusVisible: boolean): void {
    this.set({ focusVisible });
  }
  setPressed(pressed: boolean): void {
    this.set({ pressed });
  }

  dispose(): void {
    this.motion.cancel(this.pose);
    this.face.dispose();
  }
}
