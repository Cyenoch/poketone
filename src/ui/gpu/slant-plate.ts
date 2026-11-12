import { Content, type Container } from "@pmndrs/uikit";
import { Color, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";
import type { ElementType } from "../../run/sim/content/elements";
import { themeGrain } from "./run-overlays-surface";
import { UiShaderMaterial } from "./ui-shader";

/** Room around the plate's box for its base, drop shadow and focus ring. */
const REACH = 28;
/** skewX(−10°): the top edge sits h·tan10° right of the bottom edge. */
const SLANT = Math.tan((10 * Math.PI) / 180);

/** sRGB components (the shader mixes as CSS does, then converts once). */
const srgb = (hex: string) => {
  const c = new Color(hex).convertLinearToSRGB();
  return new Vector3(c.r, c.g, c.b);
};

export interface SlantPlateStyle {
  fill: string;
  /** The theme band variant (名牌缎带): its grain over the fill and its edge shapes along the bottom. */
  theme?: { type: ElementType; deep: string };
  /** A solid inner line along the top edge (出发: 4px emblem-light). */
  topLine?: { color: string; width: number };
  /** The resident ball pattern (出发), inked gold on the yellow face. */
  pattern?: boolean;
}

/**
 * A slanted plate (DESIGN.md名牌缎带, 启程板) drawn in one quad: skewX(−10°) with
 * upright content, a 3px navy-deep frame, a hard navy-deep base of `depth`, a soft drop shadow, and
 * per style the theme grain and edge, a top line and the ball pattern; a 3px blue focus ring follows
 * the slant. Lies behind its box's content; the box keeps its layout size.
 */
export class SlantPlate {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: -REACH,
    positionTop: -REACH,
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
    opacity: { value: number };
  }>;
  private readonly host: Container;
  private size = "";

  constructor(host: Container, style: SlantPlateStyle, radius: number) {
    this.host = host;
    const grain = style.theme ? themeGrain(style.theme.type) : null;
    const f = srgb(style.fill);
    const deep = srgb(style.theme?.deep ?? "#0d233f");
    const top = style.topLine ? srgb(style.topLine.color) : new Vector3();
    const grainInk = grain ? srgb(grain.color) : new Vector3(1, 1, 1);
    const v = (x: Vector3) => `vec3(${x.x.toFixed(4)},${x.y.toFixed(4)},${x.z.toFixed(4)})`;
    const key = `slant-${grain?.kind ?? "x"}-${style.topLine ? 1 : 0}-${style.pattern ? 1 : 0}`;
    this.material = new UiShaderMaterial(`${key}-${style.fill}-${style.theme?.deep ?? ""}`, {
      uniforms: {
        boxSize: { value: new Vector2(1, 1) },
        depth: { value: 0 },
        radius: { value: radius },
        pattern: { value: new Vector2(0, 0) },
        focus: { value: 0 },
        inset: { value: 0 },
        opacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 boxPoint;
        uniform vec2 boxSize;
        #include <clipping_planes_pars_vertex>
        void main() {
          boxPoint = vec2(uv.x, 1. - uv.y) * (boxSize + vec2(${2 * REACH}.)) - vec2(${REACH}.);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
          #include <clipping_planes_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec2 boxSize, pattern;
        uniform float depth, radius, focus, inset, opacity;
        varying vec2 boxPoint;
        #include <clipping_planes_pars_fragment>
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
        float erfApprox(float x) { float t = 1. / (1. + .3275911 * abs(x)); return sign(x) * (1. - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * exp(-x * x)); }
        // The plate's distance at point p (box coordinates, y down), shifted down by dy.
        float plate(vec2 p, float dy) {
          float h = boxSize.y, s = h * ${SLANT.toFixed(5)};
          vec2 u = vec2(p.x - (h - (p.y - dy)) / h * s, p.y - dy);
          vec2 half_ = vec2((boxSize.x - s) * .5, h * .5);
          return roundBox(u - half_, half_, radius) * .985;
        }
        float ballStroke(vec2 p, float aa) {
          float r = length(p);
          float rings = min(abs(r - 13.), abs(r - 4.4)) - 1.;
          float bar = max(abs(p.y) - 1., max(4.5 - abs(p.x), abs(p.x) - 13.));
          return 1. - smoothstep(-aa, aa, min(rings, bar));
        }
        void over(inout vec4 acc, vec3 ink, float a) { acc = vec4(ink * a + acc.rgb * (1. - a), a + acc.a * (1. - a)); }
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = boxPoint;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          vec3 navyDeep = vec3(.051, .137, .247);
          vec4 acc = vec4(0.);
          // Drop shadow (0 10px 16px navy-deep 28%) and the hard base.
          float sh = plate(p, depth + 6.);
          over(acc, navyDeep, .28 * .5 * (1. - erfApprox(sh / 11.3)));
          over(acc, navyDeep, 1. - smoothstep(-aa, aa, plate(p, depth)));
          float d = plate(p, 0.);
          if (d < aa) {
            vec3 col = ${v(f)};
            ${
              grain
                ? `{
              vec2 q = p; float grain = 0.;
              { vec2 p = q; ${grain.glsl} }
              col = mix(col, ${v(grainInk)}, grain * .7);
              float h = boxSize.y, s = h * ${SLANT.toFixed(5)};
              float ux = p.x - (h - p.y) / h * s;
              float depthIn = h - 3. - p.y;
              float edge = 0.;
              ${
                grain.kind === 0
                  ? `vec2 e=vec2((mod(ux,9.)-4.5)/3.6,depthIn/8.);edge=step(dot(e,e),1.);`
                  : grain.kind === 1
                    ? `vec2 e=vec2(mod(ux,14.)/14.,depthIn/6.4);edge=step(dot(e,e),.49);`
                    : grain.kind === 2
                      ? `vec2 e=vec2((mod(ux,16.)-8.)/9.6,depthIn/5.6);edge=step(dot(e,e),1.);`
                      : `edge=step(depthIn,8.-abs(mod(ux,14.)-7.));`
              }
              col = mix(col, ${v(deep)}, .6 * edge * step(0., depthIn));
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
                ? `col = mix(col, ${v(top)}, smoothstep(-aa, aa, plate(p, ${(3 + style.topLine.width).toFixed(1)})));`
                : ""
            }
            // Pressed: inset 0 3px 0 rgb(13 35 63 / 18%).
            col = mix(col, navyDeep, .18 * inset * smoothstep(-aa, aa, plate(p, 6.)));
            // The 3px navy-deep frame.
            col = mix(col, navyDeep, smoothstep(-3. - aa, -3. + aa, d));
            over(acc, col, 1. - smoothstep(-aa, aa, d));
          }
          // Focus: 3px blue, 4 out, following the slant.
          float ring = abs(d - 5.5) - 1.5;
          over(acc, vec3(.129, .396, .643), focus * (1. - smoothstep(-aa, aa, ring)));
          if (acc.a <= 0.) discard;
          gl_FragColor = vec4(toLinear(acc.rgb / acc.a), acc.a * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  /** Hard base depth, pattern phase (tiles) and strength (0–1), focus and pressed shade (0–1). */
  set(state: {
    depth?: number;
    phase?: number;
    strength?: number;
    focus?: number;
    inset?: number;
  }): void {
    const u = this.material.uniforms;
    if (state.depth !== undefined) u.depth.value = state.depth;
    if (state.phase !== undefined) u.pattern.value.x = state.phase;
    if (state.strength !== undefined) u.pattern.value.y = state.strength;
    if (state.focus !== undefined) u.focus.value = state.focus;
    if (state.inset !== undefined) u.inset.value = state.inset;
  }

  /** Follows its host box (after layout). */
  update(): void {
    const s = this.host.size.value;
    if (!s) return;
    const key = `${s[0]},${s[1]}`;
    if (key === this.size) return;
    this.size = key;
    this.material.uniforms.boxSize.value.set(s[0], s[1]);
    this.content.setProperties({ width: s[0] + 2 * REACH, height: s[1] + 2 * REACH });
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The plate's slant at height `h` (how far its top edge sits right of its bottom edge). */
export const slantOf = (h: number) => h * SLANT;
