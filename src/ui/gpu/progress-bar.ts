import { Content } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry, Vector2 } from "three";
import { SLANT } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

/** How long the shown fill takes to close most of its gap to a new value (ms). */
const EASE_MS = 120;

/**
 * A load's progress on an ink plate: a −14° bar, its track white at 16% and its fill white. The
 * shown fill eases toward the reported value and never moves back; `reset` starts a new load.
 */
export class ProgressBar {
  readonly content = new Content({ keepAspectRatio: false, depthTest: false, flexShrink: 0 });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new UiShaderMaterial("progress-bar", {
    uniforms: {
      barSize: { value: new Vector2(1, 1) },
      barFill: { value: 0 },
      barOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 barPoint;
      uniform vec2 barSize;
      void main() {
        barPoint = vec2(uv.x, 1. - uv.y) * barSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 barSize;
      uniform float barFill, barOpacity;
      varying vec2 barPoint;
      void main() {
        vec2 p = barPoint;
        float aa = .5 * max(fwidth(p.x), fwidth(p.y));
        float ux = p.x - (barSize.y - p.y) * ${SLANT.toFixed(6)};
        float w = barSize.x - barSize.y * ${SLANT.toFixed(6)};
        float inside = (1. - smoothstep(-aa, aa, -ux)) * (1. - smoothstep(-aa, aa, ux - w));
        if (inside <= 0.) discard;
        float lit = 1. - smoothstep(-aa, aa, ux - barFill * w);
        gl_FragColor = vec4(vec3(1.), barOpacity * inside * mix(.16, 1., lit));
        #include <colorspace_fragment>
      }`,
  });
  private shown = 0;
  private target = 0;

  constructor() {
    const mesh = new Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.content.add(mesh);
    this.content.notifyAncestorsChanged();
  }

  /** The bar's size for a heading of `fontSize` px on a `width`-px screen (the curtain's rule). */
  static sizeFor(fontSize: number, width: number): { width: number; height: number } {
    return { width: Math.min(360, 0.4 * width), height: Math.max(8, Math.round(fontSize / 6)) };
  }

  resize(size: { width: number; height: number }): void {
    this.content.setProperties(size);
    this.material.uniforms.barSize.value.set(size.width, size.height);
  }

  /** How far the load has come (0–1); a lower value than one already shown is held. */
  set(progress: number): void {
    this.target = Math.max(this.target, Math.min(1, Math.max(0, progress)));
  }

  /** A new load: the bar starts from `progress` at once. */
  reset(progress = 0): void {
    this.shown = this.target = Math.min(1, Math.max(0, progress));
    this.material.uniforms.barFill.value = this.shown;
  }

  /** Eases the shown fill; true while it still moves (its owner draws another frame). */
  update(deltaMs: number): boolean {
    if (this.shown >= this.target) return false;
    this.shown += (this.target - this.shown) * Math.min(1, deltaMs / EASE_MS);
    if (this.target - this.shown < 0.001) this.shown = this.target;
    this.material.uniforms.barFill.value = this.shown;
    return true;
  }

  /** The whole bar's opacity (its shader takes no uikit opacity). */
  setOpacity(opacity: number): void {
    this.material.uniforms.barOpacity.value = opacity;
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
