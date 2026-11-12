import { Content } from "@pmndrs/uikit";
import {
  Box3,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import type { ElementType } from "../../run/sim/content/elements";
import { themeGrain } from "./run-overlays-surface";
import { fade } from "./layer";
import { crispLineGlsl } from "./crisp-line";
import { UiShaderMaterial } from "./ui-shader";

const fill = {
  positionType: "absolute",
  positionLeft: 0,
  positionTop: 0,
  width: "100%",
  height: "100%",
  keepAspectRatio: false,
  depthTest: false,
} as const;

/**
 * Three's clipping-plane chunks for hand-written shaders: UIKit clips content in a scrolling box
 * with `material.clippingPlanes`, which only shaders that include these honour.
 */
export const clipVertex = "#include <clipping_planes_pars_vertex>";
export const clipMain = `vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
  #include <clipping_planes_vertex>
  gl_Position = projectionMatrix * mvPosition;`;

/** sRGB components of a CSS colour, for shaders that mix as CSS does. */
const srgb = (hex: string) => {
  const c = new Color(hex).convertLinearToSRGB();
  return new Color(c.r, c.g, c.b);
};

const prelude = `
  uniform float opacity;
  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
  float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
  ${crispLineGlsl}
`;

export interface RadialFaceOptions {
  /** Gradient centre as a fraction of the box (`circle at 50% 30%`). */
  at: [number, number];
  /** Colour stops at 0, at `mid`, and (if given) at 100% of the farthest corner. */
  inner: string;
  middle: string;
  mid: number;
  outer?: string;
  /** Corner radius in px; a circle when omitted. */
  radius?: number;
  /** An inset ring (`box-shadow: inset 0 0 0 Wpx C`), or a border of that width. */
  ring?: { width: number; color: string };
  /** The theme grain over the gradient (`var(--theme-grain), radial-gradient(...)`). */
  grain?: ElementType;
}

/**
 * A `radial-gradient(circle at X Y, a, b M%, c)` face (farthest-corner, as CSS sizes a circle), in
 * a circle or a rounded box, with an optional inset ring and theme grain: the starter screen's
 * medallions, move cards, ultimate badge and carry slots.
 */
export class RadialFace {
  readonly content = new Content(fill);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<Record<string, { value: unknown }>>;
  private readonly size = { value: new Vector2(1, 1) };

  constructor(options: RadialFaceOptions) {
    const grain = options.grain ? themeGrain(options.grain) : null;
    const key = `radial-face-${options.radius === undefined ? "circle" : "box"}-${grain?.kind ?? "plain"}`;
    this.material = new UiShaderMaterial(key, {
      uniforms: {
        faceSize: this.size,
        faceAt: { value: new Vector2(...options.at) },
        c0: { value: srgb(options.inner) },
        c1: { value: srgb(options.middle) },
        c2: { value: srgb(options.outer ?? options.middle) },
        mid: { value: options.mid },
        corner: { value: options.radius ?? 0 },
        ringWidth: { value: options.ring?.width ?? 0 },
        ringInk: { value: srgb(options.ring?.color ?? "#000000") },
        grainInk: { value: srgb(grain?.color ?? "#ffffff") },
      },
      vertexShader: `
        varying vec2 faceUv;
        ${clipVertex}
        void main() { faceUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 faceSize, faceAt;
        uniform vec3 c0, c1, c2, ringInk, grainInk;
        uniform float mid, corner, ringWidth;
        varying vec2 faceUv;
        ${prelude}
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(faceUv.x, 1. - faceUv.y) * faceSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          vec2 h = faceSize * .5;
          float d = ${options.radius === undefined ? "length(p - h) - min(h.x, h.y)" : "roundBox(p - h, h, corner)"};
          if (d > aa) discard;
          vec2 o = faceSize * faceAt;
          vec2 far = max(o, faceSize - o);
          float t = length(p - o) / length(far);
          vec3 col = t < mid ? mix(c0, c1, t / mid) : mix(c1, c2, min(1., (t - mid) / (1. - mid)));
          ${grain ? `float grain = 0.; { ${grain.glsl} } col = mix(col, grainInk, grain);` : ""}
          float ring = crispLine(ringWidth, fwidth(p.y));
          col = mix(col, ringInk, step(.001, ring) * smoothstep(-ring - aa, -ring + aa, d));
          gl_FragColor = vec4(toLinear(col), opacity * (1. - smoothstep(-aa, aa, d)));
          #include <colorspace_fragment>
        }`,
    });
    // `opacity` is the material's own uniform (UIKit fades content through it).
    this.material.uniforms.opacity = { value: 1 };
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  /** Call after layout. */
  update(): void {
    const s = this.content.size.value;
    if (s) this.size.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * `.starter-gauge__cells`: ten 1px-round cells (2px gaps) in a 4px-round navy-deep track with a 2px
 * inset; lit cells run light → theme top to bottom, the rest stay dim.
 */
export class GaugeStrip {
  readonly content = new Content(fill);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    stripSize: { value: Vector2 };
    lit: { value: number };
    light: { value: Color };
    theme: { value: Color };
    opacity: { value: number };
  }>;

  constructor(lit: number, light: string, theme: string, cells = 10) {
    this.material = new UiShaderMaterial("gauge-strip", {
      uniforms: {
        stripSize: { value: new Vector2(1, 1) },
        lit: { value: lit },
        light: { value: srgb(light) },
        theme: { value: srgb(theme) },
        opacity: { value: 1 },
      },
      vertexShader: `
        varying vec2 stripUv;
        ${clipVertex}
        void main() { stripUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 stripSize;
        uniform float lit;
        uniform vec3 light, theme;
        varying vec2 stripUv;
        ${prelude}
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(stripUv.x, 1. - stripUv.y) * stripSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float track = roundBox(p - stripSize * .5, stripSize * .5, 4.);
          if (track > aa) discard;
          vec3 col = vec3(.051, .137, .247);
          vec2 inner = stripSize - 4.;
          float w = (inner.x - 2. * ${cells - 1}.) / ${cells}.;
          float x = p.x - 2.;
          float i = floor(x / (w + 2.));
          float cx = x - i * (w + 2.);
          if (i >= 0. && i < ${cells}.) {
            float cell = roundBox(vec2(cx, p.y - 2.) - vec2(w, inner.y) * .5, vec2(w, inner.y) * .5, 1.);
            vec3 face = i < lit ? mix(light, theme, clamp((p.y - 2.) / inner.y, 0., 1.)) : vec3(.173, .271, .384);
            col = mix(col, face, 1. - smoothstep(-aa, aa, cell));
          }
          gl_FragColor = vec4(toLinear(col), opacity * (1. - smoothstep(-aa, aa, track)));
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.material.uniforms.stripSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A solid right-pointing triangle (`clip-path: polygon(0 0, 100% 50%, 0 100%)`). */
export function createTriangleMark(color: string): Content {
  const shape = new Shape().moveTo(0, 0).lineTo(1, 0.5).lineTo(0, 1).closePath();
  const geometry = new ShapeGeometry(shape);
  geometry.translate(-0.5, -0.5, 0);
  geometry.boundingBox = new Box3(new Vector3(-0.5, -0.5, 0), new Vector3(0.5, 0.5, 0));
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const content = new Content({ flexShrink: 0, keepAspectRatio: false, depthTest: false });
  content.add(new Mesh(geometry, material));
  content.notifyAncestorsChanged();
  content.abortSignal.addEventListener("abort", () => {
    geometry.dispose();
    material.dispose();
  });
  return content;
}

/**
 * `repeating-linear-gradient(-45deg, rgb(255 255 255 / a) 0 4px, transparent 4px 9px)` inside rounded
 * corners: an unavailable segment (7%), a price you cannot pay yet (`--hatch`, 50%).
 */
export class HatchFill {
  readonly content = new Content(fill);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    hatchSize: { value: Vector2 };
    opacity: { value: number };
    strength: { value: number };
    corner: { value: number };
  }>;

  constructor(strength = 0.07, radius = 6) {
    this.material = new UiShaderMaterial("hatch-fill", {
      uniforms: {
        hatchSize: { value: new Vector2(1, 1) },
        opacity: { value: 1 },
        strength: { value: strength },
        corner: { value: radius },
      },
      vertexShader: `
        varying vec2 hatchUv;
        ${clipVertex}
        void main() { hatchUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 hatchSize;
        uniform float strength, corner;
        varying vec2 hatchUv;
        ${prelude}
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(hatchUv.x, 1. - hatchUv.y) * hatchSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float box = roundBox(p - hatchSize * .5, hatchSize * .5, corner);
          float m = mod((p.x + p.y) * .70710678, 9.);
          float stripe = 1. - smoothstep(4. - aa, 4. + aa, m);
          gl_FragColor = vec4(1., 1., 1., strength * stripe * opacity * (1. - smoothstep(-aa, aa, box)));
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.material.uniforms.hatchSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * `box-shadow: inset 0 <depth>px 0 <color>`: the lip a pressed or sunk face shows under its top
 * edge. Lies over the face, inside its border; `radius` is the face's inner radius.
 */
export class InsetShade {
  readonly content = new Content(fill);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    shadeSize: { value: Vector2 };
    opacity: { value: number };
    depth: { value: number };
    corner: { value: number };
    shade: { value: Color };
    strength: { value: number };
  }>;

  constructor(depth: number, color: string, alpha: number, radius: number) {
    this.material = new UiShaderMaterial("inset-shade", {
      uniforms: {
        shadeSize: { value: new Vector2(1, 1) },
        opacity: { value: 1 },
        depth: { value: depth },
        corner: { value: radius },
        shade: { value: new Color(color) },
        strength: { value: alpha },
      },
      vertexShader: `
        varying vec2 shadeUv;
        ${clipVertex}
        void main() { shadeUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 shadeSize;
        uniform float depth, corner, strength;
        uniform vec3 shade;
        varying vec2 shadeUv;
        ${prelude}
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(shadeUv.x, 1. - shadeUv.y) * shadeSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          vec2 hs = shadeSize * .5;
          float face = 1. - smoothstep(-aa, aa, roundBox(p - hs, hs, corner));
          float lip = crispLine(depth, fwidth(p.y));
          float lit = 1. - smoothstep(-aa, aa, roundBox(p - hs - vec2(0., lip), hs, corner));
          gl_FragColor = vec4(shade, strength * opacity * face * (1. - lit));
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.material.uniforms.shadeSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * `.game-text-input`'s recessed face: `linear-gradient(180deg, <top>, <bottom> 45%)` under the
 * `--well` lip (`inset 0 3px 0` navy-deep 14%). Lies inside the frame; `radius` is the inner one.
 */
export class WellFace {
  readonly content = new Content(fill);
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    wellSize: { value: Vector2 };
    opacity: { value: number };
    corner: { value: number };
    top: { value: Color };
    bottom: { value: Color };
  }>;

  constructor(radius: number) {
    this.material = new UiShaderMaterial("well-face", {
      uniforms: {
        wellSize: { value: new Vector2(1, 1) },
        opacity: { value: 1 },
        corner: { value: radius },
        top: { value: new Color() },
        bottom: { value: new Color() },
      },
      vertexShader: `
        varying vec2 wellUv;
        ${clipVertex}
        void main() { wellUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 wellSize;
        uniform float corner;
        uniform vec3 top, bottom;
        varying vec2 wellUv;
        ${prelude}
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(wellUv.x, 1. - wellUv.y) * wellSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          vec2 hs = wellSize * .5;
          float face = 1. - smoothstep(-aa, aa, roundBox(p - hs, hs, corner));
          float lit = 1. - smoothstep(-aa, aa, roundBox(p - hs - vec2(0., crispLine(3., fwidth(p.y))), hs, corner));
          // CSS mixes gradients in sRGB.
          vec3 c = mix(top, bottom, clamp(p.y / (wellSize.y * .45), 0., 1.));
          c = mix(c, vec3(.051, .137, .247), .14 * (1. - lit));
          gl_FragColor = vec4(toLinear(c), opacity * face);
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  setColors(top: string, bottom: string): void {
    this.material.uniforms.top.value.copy(srgb(top));
    this.material.uniforms.bottom.value.copy(srgb(bottom));
  }

  update(): void {
    const s = this.content.size.value;
    if (s) this.material.uniforms.wellSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** An image drawn in black at `alpha` (`filter: brightness(0) opacity(alpha)`): a locked line's outline. */
export class Silhouette {
  // UIKit writes a content's (inherited) `color` into its meshes' material colour: black here, or
  // the root's ink would tint the picture back in.
  readonly content = new Content({
    flexShrink: 0,
    keepAspectRatio: false,
    depthTest: false,
    color: "#000000",
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: MeshBasicMaterial;

  constructor(texture: Texture, alpha: number) {
    this.material = new MeshBasicMaterial({
      map: texture,
      color: "#000000",
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    // UIKit owns content opacity; its 40% goes through the property, not the material.
    fade(this.content, alpha);
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
