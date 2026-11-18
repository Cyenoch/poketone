import { Container, Content } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry } from "three";
import { bondMilestones } from "../../run/sim/content/bonds";
import { clipMain, clipVertex } from "./screen-parts";
import { srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";
import type { UiStage } from "./stage";
import { POP } from "./motion";

/**
 * One heart of the bond scale: an ink outline over a white body, the reached share filled ball red
 * from the bottom up (a whole heart once its level is reached).
 */
class Heart {
  readonly panel = new Container({ flexShrink: 0 });
  private readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new UiShaderMaterial("bond-heart", {
    uniforms: {
      amount: { value: 0 },
      /** Outline width and the box's width, in layout units. */
      edge: { value: 1.5 },
      box: { value: 16 },
      fill: { value: srgb(ui.ball) },
      outline: { value: srgb(ui.ink) },
      body: { value: srgb(ui.white) },
    },
    vertexShader: `
      varying vec2 heartUv;
      ${clipVertex}
      void main() { heartUv = uv; ${clipMain} }`,
    fragmentShader: `
      uniform float amount, edge, box;
      uniform vec3 fill, outline, body;
      // The material's own opacity: uikit writes the inherited fade there.
      uniform float opacity;
      varying vec2 heartUv;
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
      float dot2(vec2 v) { return dot(v, v); }
      // Inigo Quilez's exact heart: the tip at the origin, the lobes about y = .75.
      float heart(vec2 p) {
        p.x = abs(p.x);
        if (p.y + p.x > 1.) return sqrt(dot2(p - vec2(.25, .75))) - sqrt(2.) / 4.;
        return sqrt(min(dot2(p - vec2(0., 1.)), dot2(p - .5 * max(p.x + p.y, 0.)))) * sign(p.x - p.y);
      }
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        // The heart spans 1.21 × 1.10 units; fit it in the box with a little room for the stroke.
        float unit = 1.16;
        vec2 p = vec2((heartUv.x - .5) * 1.21, heartUv.y * 1.10) * unit - vec2(0., .07);
        // Distance in layout units, so the outline keeps its width at any pixel ratio.
        float d = heart(p) * box / (1.21 * unit);
        float aa = .6 * fwidth(d);
        float inside = 1. - smoothstep(-aa, aa, d);
        if (inside <= 0.) discard;
        // The reached share fills from the tip up to the top of the lobes.
        float level = mix(-.02, 1.11, amount);
        vec3 col = p.y <= level && amount > 0. ? fill : body;
        col = mix(col, outline, smoothstep(-edge - aa, -edge + aa, d));
        gl_FragColor = vec4(toLinear(col), inside * opacity);
        #include <colorspace_fragment>
      }`,
  });

  constructor() {
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    this.panel.add(this.content);
  }

  /** `amount` 0–1: how much of this level is reached. */
  set(amount: number): void {
    this.material.uniforms.amount.value = amount;
  }

  size(width: number, edge: number): void {
    this.panel.setProperties({ width, height: Math.round(width * 0.92) });
    this.material.uniforms.box.value = width;
    this.material.uniforms.edge.value = edge;
  }

  dispose(): void {
    this.panel.dispose();
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The bond scale (`sim/content/bonds.ts`): one heart per level, the reached ones full, the next
 * one filled by the points made towards it. A level reached pops its heart (1.4 → 1, POP).
 */
export class HeartGauge {
  readonly panel = new Container({ flexDirection: "row", alignItems: "center", flexShrink: 0 });
  private readonly hearts = bondMilestones.map(() => new Heart());
  private readonly pops = bondMilestones.map(() => ({ s: 1 }));
  private readonly stage: UiStage;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.panel.add(...this.hearts.map((heart) => heart.panel));
  }

  /** Heart size and gap in layout units. */
  size(heart: number, gap: number): void {
    this.panel.setProperties({ gap });
    for (const one of this.hearts) one.size(heart, heart >= 16 ? 1.75 : 1.4);
  }

  /** Fills the hearts for a points total (fractional while the scale animates). */
  set(points: number): void {
    let below = 0;
    for (const [i, milestone] of bondMilestones.entries()) {
      const amount = Math.max(0, Math.min(1, (points - below) / (milestone.points - below)));
      this.hearts[i]!.set(amount);
      below = milestone.points;
    }
    this.stage.invalidate();
  }

  /** The heart of `level` (1-based) pops. */
  pop(level: number): void {
    const pose = this.pops[level - 1];
    const panel = this.hearts[level - 1]?.panel;
    if (!pose || !panel) return;
    this.stage.motion.enter(
      pose,
      { s: 1.45 },
      { s: 1 },
      320,
      () => {
        panel.setProperties({ transformScaleX: pose.s, transformScaleY: pose.s });
        this.stage.invalidate();
      },
      POP,
    );
  }

  dispose(): void {
    for (const pose of this.pops) this.stage.motion.cancel(pose);
    for (const heart of this.hearts) heart.dispose();
    this.panel.dispose();
  }
}
