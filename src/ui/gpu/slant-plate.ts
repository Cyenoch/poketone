import { abortableEffect, Content, type Container } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry, Vector2, Vector3, type Texture } from "three";
import type { ElementType } from "../../run/sim/content/elements";
import { images } from "../../prepare/images";
import { inheritedOpacity } from "./layer";
import { themeEdge, themeGrain } from "./run-theme";
import { HARD_SHADOW, RADIUS, SLANT, srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

export { slantOf } from "./tokens";

/** Room around the plate's box for its shadow and focus ring. */
const REACH = 28;
/** How far the focus ring reaches past the plate's edge (4px out, 3px wide, its slanted corner). */
export const RING_ROOM = 8;

export interface SlantPlateStyle {
  fill: string;
  /** A solid frame inside the edge (the secondary button's ink line). */
  border?: { color: string; width: number };
  /** A solid band along the left edge, leaning with it (a tab's 6px ball-red stripe). */
  stripe?: { color: string; width: number };
  /** The colour `set({ push })` fills in from the left (a tab's hover/focus ink). */
  push?: string;
  /** Thin lines along the slant over the fill (CSS 104°: 2px of `color` at `alpha` every `step`px). */
  hatch?: { color: string; alpha: number; step?: number };
  /** The type's card face blended soft-light over the fill (`public/art/cards/<type>.webp`, 520px
   *  tiles); `loaded` asks for a redraw once the image arrives. */
  card?: { type: ElementType; loaded: () => void };
  /** Legacy 名牌缎带: the run theme's grain over the fill and its edge along the bottom. */
  theme?: { type: ElementType; deep: string };
  /** Legacy 启程板: a solid inner line along the top edge. */
  topLine?: { color: string; width: number };
  /** Legacy 启程板: the resident gold ball pattern. */
  pattern?: boolean;
  /** No slant: an upright box with the same radius, shadow, frame and focus ring (the redesign
   *  slants only accents; ordinary panels, keys and chips stand upright). */
  upright?: boolean;
  /** Room kept inside the host box left and right (px): the plate is drawn that much narrower, so
   *  its focus ring stays within the host's layout bounds (a key at a column's edge). */
  insetX?: number;
}

export interface SlantPlateState {
  /** Hard shadow offset (px, right and down). */
  depth?: number;
  /** Legacy ball pattern phase (tiles) and strength (0–1). */
  phase?: number;
  strength?: number;
  /** The focus ring (0–1). */
  focus?: number;
  /** Pressed shade (0–1). */
  inset?: number;
  /** The light sweep's position (0–1; negative hides it). */
  shine?: number;
  /** How much of the push colour has filled in from the left (0–1). */
  push?: number;
  /** The face and its shadow (0–1); the focus ring is drawn regardless. */
  face?: number;
  /** The unrolled share of the plate from the left, its cut edge leaning with the slant (0–1). */
  reveal?: number;
  /** Fill, border and push colours (they change without a new program). */
  fill?: string;
  border?: string;
  pushColor?: string;
}

const glslVec = (x: Vector3) => `vec3(${x.x.toFixed(4)},${x.y.toFixed(4)},${x.z.toFixed(4)})`;

/**
 * The slanted plate every redesign surface is cut from, drawn in one quad behind its box's content:
 * skewX(−14°) with upright content, radius 6, a hard black 22% shadow offset right and down, and per
 * style a border, a left stripe, a push fill from the left, slant hatching, the type card face
 * (soft-light), a light sweep, a reveal from the left and an ink focus ring with a white keyline,
 * following the slant.
 * The box keeps its layout size; the slant fits inside it (bottom-left and top-right corners).
 */
export class SlantPlate {
  // Laid out at the host's own size (a larger box would count as scroll overflow in a scroll body);
  // the vertex shader grows the quad by REACH each way for the shadow and focus ring.
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    boxSize: { value: Vector2 };
    depth: { value: number };
    radius: { value: number };
    pattern: { value: Vector2 };
    focus: { value: number };
    inset: { value: number };
    shine: { value: number };
    push: { value: number };
    face: { value: number };
    reveal: { value: number };
    opacity: { value: number };
    fill: { value: Vector3 };
    border: { value: Vector3 };
    pushColor: { value: Vector3 };
    card: { value: Texture | null };
  }>;
  private readonly cardTexture: Texture | null;
  private readonly host: Container;
  private readonly insetX: number;
  private size = "";

  constructor(host: Container, style: SlantPlateStyle, radius = RADIUS) {
    this.host = host;
    this.insetX = style.insetX ?? 0;
    const grain = style.theme ? themeGrain(style.theme.type) : null;
    const deep = srgb(style.theme?.deep ?? ui.ink);
    const top = style.topLine ? srgb(style.topLine.color) : new Vector3();
    const grainInk = grain ? srgb(grain.color) : new Vector3(1, 1, 1);
    const stripe = style.stripe ? srgb(style.stripe.color) : new Vector3();
    const hatch = style.hatch ? srgb(style.hatch.color) : new Vector3();
    this.cardTexture = style.card
      ? images().texture(`/art/cards/${style.card.type}.webp`, "pattern", style.card.loaded)
      : null;
    const key = [
      "slant",
      grain?.kind ?? "x",
      style.topLine ? `t${style.topLine.width}${style.topLine.color}` : "",
      style.pattern ? "p" : "",
      style.border ? `b${style.border.width}` : "",
      style.stripe ? `s${style.stripe.width}${style.stripe.color}` : "",
      style.hatch ? `h${style.hatch.color}${style.hatch.alpha}${style.hatch.step ?? 14}` : "",
      style.card ? "c" : "",
      style.theme?.deep ?? "",
      style.upright ? "u" : "",
    ].join("-");
    this.material = new UiShaderMaterial(key, {
      uniforms: {
        boxSize: { value: new Vector2(1, 1) },
        depth: { value: HARD_SHADOW.offset },
        radius: { value: radius },
        pattern: { value: new Vector2(0, 0) },
        focus: { value: 0 },
        inset: { value: 0 },
        shine: { value: -1 },
        push: { value: 0 },
        face: { value: 1 },
        reveal: { value: 1 },
        opacity: { value: 1 },
        fill: { value: srgb(style.fill) },
        border: { value: srgb(style.border?.color ?? ui.ink) },
        pushColor: { value: srgb(style.push ?? ui.ink) },
        card: { value: this.cardTexture },
      },
      vertexShader: /* glsl */ `
        varying vec2 boxPoint;
        uniform vec2 boxSize;
        #include <clipping_planes_pars_vertex>
        void main() {
          boxPoint = vec2(uv.x, 1. - uv.y) * (boxSize + vec2(${2 * REACH}.)) - vec2(${REACH}.);
          vec3 grown = vec3(position.xy * (boxSize + vec2(${2 * REACH}.)) / boxSize, position.z);
          vec4 mvPosition = modelViewMatrix * vec4(grown, 1.);
          #include <clipping_planes_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 boxSize, pattern;
        uniform float depth, radius, focus, inset, shine, push, face, reveal, opacity;
        uniform vec3 fill, border, pushColor;
        uniform sampler2D card;
        varying vec2 boxPoint;
        #include <clipping_planes_pars_fragment>
        const float SLANT = ${(style.upright ? 0 : SLANT).toFixed(6)};
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
        float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
        // x along the plate with the slant taken out: 0 on the left edge at every height.
        float unslant(vec2 p) { return p.x - (boxSize.y - p.y) * SLANT; }
        // The plate's distance at p (box coordinates, y down), shifted by o.
        float plate(vec2 p, vec2 o) {
          p -= o;
          float s = boxSize.y * SLANT;
          vec2 u = vec2(unslant(p), p.y);
          vec2 half_ = vec2((boxSize.x - s) * .5, boxSize.y * .5);
          return roundBox(u - half_, half_, radius) * ${Math.cos((14 * Math.PI) / 180).toFixed(5)};
        }
        float ballStroke(vec2 p, float aa) {
          float r = length(p);
          float rings = min(abs(r - 13.), abs(r - 4.4)) - 1.;
          float bar = max(abs(p.y) - 1., max(4.5 - abs(p.x), abs(p.x) - 13.));
          return 1. - smoothstep(-aa, aa, min(rings, bar));
        }
        vec3 softLight(vec3 b, vec3 s) {
          vec3 d = mix(sqrt(b), ((16. * b - 12.) * b + 4.) * b, step(b, vec3(.25)));
          return mix(b + (2. * s - 1.) * (d - b), b - (1. - 2. * s) * b * (1. - b), step(s, vec3(.5)));
        }
        void over(inout vec4 acc, vec3 ink, float a) { acc = vec4(ink * a + acc.rgb * (1. - a), a + acc.a * (1. - a)); }
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = boxPoint;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float ux = unslant(p);
          float width = boxSize.x - boxSize.y * SLANT;
          // The reveal's cut edge leans with the slant, so it runs along u (shadow included).
          float shown = 1. - smoothstep(-aa, aa, ux - reveal * (width + 2. * depth + 2.));
          vec4 acc = vec4(0.);
          over(acc, vec3(0.), ${HARD_SHADOW.alpha} * face * shown * (1. - smoothstep(-aa, aa, plate(p, vec2(depth)))));
          float d = plate(p, vec2(0.));
          if (d < aa && face > 0.) {
            vec3 col = fill;
            ${
              style.card
                ? `col = mix(col, softLight(col, toSrgb(texture2D(card, p / 520.).rgb)), .9);`
                : ""
            }
            ${
              style.hatch
                ? `{
              float lane = mod(ux * ${Math.cos((14 * Math.PI) / 180).toFixed(5)}, ${(style.hatch.step ?? 14).toFixed(1)});
              float line = 1. - smoothstep(2. - aa, 2. + aa, lane);
              col = mix(col, ${glslVec(hatch)}, ${style.hatch.alpha.toFixed(3)} * line);
            }`
                : ""
            }
            ${
              grain
                ? `{
              vec2 q = p; float grain = 0.;
              { vec2 p = q; ${grain.glsl} }
              col = mix(col, ${glslVec(grainInk)}, grain * .7);
              float depthIn = boxSize.y - 3. - p.y;
              float edge = 0.;
              ${themeEdge(style.theme!.type, "ux", "depthIn")}
              col = mix(col, ${glslVec(deep)}, .6 * edge * step(0., depthIn));
            }`
                : ""
            }
            ${
              style.pattern
                ? `{
              vec2 tile = mod(p - pattern.x * vec2(84., 42.), vec2(84., 42.));
              float mask = max(ballStroke(tile - vec2(21.), aa), max(ballStroke(tile - vec2(63., 0.), aa), ballStroke(tile - vec2(63., 42.), aa)));
              col = mix(col, vec3(.706, .506, .161), .34 * pattern.y * mask);
            }`
                : ""
            }
            ${
              style.topLine
                ? `col = mix(col, ${glslVec(top)}, smoothstep(-aa, aa, plate(p, vec2(0., ${style.topLine.width.toFixed(1)}))));`
                : ""
            }
            // The push fill from the left, its front edge leaning with the slant.
            col = mix(col, pushColor, 1. - smoothstep(-aa, aa, ux - push * (width + 2.)));
            ${
              style.stripe
                ? `col = mix(col, ${glslVec(stripe)}, 1. - smoothstep(-aa, aa, ux - ${style.stripe.width.toFixed(1)}));`
                : ""
            }
            // The light sweep: 30% of the width, white 40% at its middle, leaning with the slant.
            if (shine >= 0.) {
              float c = mix(-.4, 1.2, shine) * boxSize.x;
              float k = (ux - c) / (.15 * boxSize.x);
              col = mix(col, vec3(1.), .4 * max(0., 1. - abs(k)));
            }
            col = mix(col, vec3(0.), .14 * inset);
            ${
              style.border
                ? `col = mix(col, border, smoothstep(-${style.border.width.toFixed(1)} - aa, -${style.border.width.toFixed(1)} + aa, d));`
                : ""
            }
            over(acc, col, face * (1. - smoothstep(-aa, aa, d)));
          }
          acc *= shown;
          // Focus: a 3px ink ring 4px out, following the slant, over a 2px white keyline just inside
          // it, so the ring reads on light grounds and the keyline on dark ones (an ink tray).
          float keyline = abs(d - 3.) - 1.;
          over(acc, vec3(1.), focus * (1. - smoothstep(-aa, aa, keyline)));
          float ring = abs(d - 5.5) - 1.5;
          over(acc, ${glslVec(srgb(ui.ink))}, focus * (1. - smoothstep(-aa, aa, ring)));
          if (acc.a <= 0.) discard;
          gl_FragColor = vec4(toLinear(acc.rgb / acc.a), acc.a * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    abortableEffect(() => this.update(), this.content.abortSignal);
  }

  set(state: SlantPlateState): void {
    const u = this.material.uniforms;
    if (state.depth !== undefined) u.depth.value = state.depth;
    if (state.phase !== undefined) u.pattern.value.x = state.phase;
    if (state.strength !== undefined) u.pattern.value.y = state.strength;
    if (state.focus !== undefined) u.focus.value = state.focus;
    if (state.inset !== undefined) u.inset.value = state.inset;
    if (state.shine !== undefined) u.shine.value = state.shine;
    if (state.push !== undefined) u.push.value = state.push;
    if (state.face !== undefined) u.face.value = state.face;
    if (state.reveal !== undefined) u.reveal.value = state.reveal;
    if (state.fill !== undefined) srgb(state.fill, u.fill.value);
    if (state.border !== undefined) srgb(state.border, u.border.value);
    if (state.pushColor !== undefined) srgb(state.pushColor, u.pushColor.value);
  }

  /** Follows its host box and fade; it tracks both on its own, owners may still call it after layout. */
  update(): void {
    this.material.uniforms.opacity.value = inheritedOpacity(this.content);
    const s = this.host.size.value;
    if (!s) return;
    const key = `${s[0]},${s[1]}`;
    if (key === this.size) return;
    this.size = key;
    const width = Math.max(0, s[0] - 2 * this.insetX);
    this.material.uniforms.boxSize.value.set(Math.max(1, width), Math.max(1, s[1]));
    this.content.setProperties({ positionLeft: this.insetX, width, height: s[1] });
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.cardTexture?.dispose();
  }
}
