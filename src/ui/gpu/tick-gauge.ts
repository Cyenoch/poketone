import { Content } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry, Vector2, Vector3 } from "three";
import { clipMain, clipVertex } from "./screen-parts";
import { srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

/**
 * A measuring scale: one upright tick per step. A reached tick is a full-height bar in `fill`
 * (a part-reached one fills from the bottom), the next one to reach stands full height in ball
 * red, and the rest are short line-coloured stubs on the baseline, so an empty scale still reads
 * as a ruler. The 研究所's instruments (lab levels) and the 图鉴's research points share it.
 */
export class TickGauge {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    stripSize: { value: Vector2 };
    lit: { value: number };
    next: { value: number };
    count: { value: number };
    tick: { value: Vector2 };
    gap: { value: number };
    fill: { value: Vector3 };
  }>;
  private readonly count: number;
  private tickWidth = 6;
  private gapWidth = 3;

  constructor(count: number) {
    this.count = count;
    this.material = new UiShaderMaterial("tick-gauge", {
      uniforms: {
        stripSize: { value: new Vector2(1, 1) },
        lit: { value: 0 },
        next: { value: -1 },
        count: { value: count },
        tick: { value: new Vector2(6, 14) },
        gap: { value: 3 },
        fill: { value: srgb(ui.ink) },
      },
      vertexShader: `
        varying vec2 tickUv;
        ${clipVertex}
        void main() { tickUv = uv; ${clipMain} }`,
      fragmentShader: `
        uniform vec2 stripSize, tick;
        uniform float lit, next, count, gap;
        uniform vec3 fill;
        varying vec2 tickUv;
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          // y grows upward from the baseline.
          vec2 p = vec2(tickUv.x, tickUv.y) * stripSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float i = floor(p.x / (tick.x + gap));
          float x = p.x - i * (tick.x + gap);
          if (i >= count || x > tick.x) discard;
          float reached = clamp(lit - i, 0., 1.);
          vec2 hb = tick * .5;
          float bar = roundBox(vec2(x, p.y) - hb, hb, 1.5);
          vec3 col = ${glsl(ui.line)};
          float d;
          if (reached > 0. || i == next) {
            d = bar;
            // Part reached: the reached share in fill, the rest as the empty bar.
            col = i == next && reached == 0. ? ${glsl(ui.ball)} : (p.y <= tick.y * reached ? fill : ${glsl(ui.line)});
          } else {
            float stub = tick.y * .38;
            d = roundBox(vec2(x, p.y) - vec2(hb.x, stub * .5), vec2(hb.x, stub * .5), 1.5);
          }
          gl_FragColor = vec4(toLinear(col), 1. - smoothstep(-aa, aa, d));
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  /** `lit` steps reached (fractional fills a tick part-way); `next`: the tick to show as next, or -1. */
  set(lit: number, next = -1, fill: string = ui.ink): void {
    const u = this.material.uniforms;
    u.lit.value = lit;
    u.next.value = next;
    srgb(fill, u.fill.value);
  }

  /** Tick size in layout units; the gauge's box should be `width()` × `height`. */
  setSize(tickWidth: number, height: number, gap: number): void {
    this.tickWidth = tickWidth;
    this.gapWidth = gap;
    this.material.uniforms.tick.value.set(tickWidth, height);
    this.material.uniforms.gap.value = gap;
  }

  width(): number {
    return this.count * this.tickWidth + (this.count - 1) * this.gapWidth;
  }

  /** Follows the laid-out box (call after layout). */
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

function glsl(hex: string): string {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
}
