import { Mesh, PlaneGeometry } from "three";
import { cubicBezier } from "./focus-mark";
import type { UiStage } from "./stage";
import { UiShaderMaterial } from "./ui-shader";

const HURT_MS = 380;
const LOW_HP_MS = 1100;
const easeOut = (t: number) => cubicBezier(t, 0, 0, 0.58, 1);
const easeInOut = (t: number) => cubicBezier(t, 0.42, 0, 0.58, 1);

/**
 * `.run-overlay::before` / `::after`: red edges only, so the arena stays readable. A hurt flashes
 * `radial-gradient(ellipse at center, transparent 55%, rgb(200 30 50 / 55%))` out over 380ms
 * (ease-out); low HP pulses `transparent 62% → / 35%` between 35% and full opacity every 1.1s
 * (ease-in-out, alternate) for as long as it lasts. The flash sits under the damage numbers and
 * the pulse over them, as the pseudo-elements sit around the numbers layer.
 */
export class GpuEdgeGlow {
  private readonly stage: UiStage;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly hurt: Edge;
  private readonly lowHp: Edge;
  private hurtAge = HURT_MS;
  private low = false;
  private lowAge = 0;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.hurt = new Edge(this.geometry, 0.55, 0.55, -11);
    this.lowHp = new Edge(this.geometry, 0.62, 0.35, -9);
    stage.scene.add(this.hurt.mesh, this.lowHp.mesh);
  }

  flash(): void {
    this.hurtAge = 0;
    this.stage.invalidate();
  }

  setLowHp(low: boolean): void {
    if (low === this.low) return;
    this.low = low;
    this.lowAge = 0;
    this.stage.invalidate();
  }

  /** Advances both; call every frame. `idleStep`: the HUD's 15Hz tick for continuous loops, so
   *  every idle loop on the HUD redraws on the same frame. */
  update(deltaMs: number, idleStep: boolean): void {
    const v = this.stage.viewport;
    for (const edge of [this.hurt, this.lowHp]) edge.fit(this.stage, v.width, v.height);
    if (this.hurtAge < HURT_MS) {
      this.hurtAge = Math.min(HURT_MS, this.hurtAge + deltaMs);
      this.hurt.set(1 - easeOut(this.hurtAge / HURT_MS));
      this.stage.invalidate();
    } else this.hurt.set(0);
    if (this.low) {
      this.lowAge = (this.lowAge + deltaMs) % (LOW_HP_MS * 2);
      if (!idleStep) return;
      const leg = this.lowAge / LOW_HP_MS;
      const t = easeInOut(leg < 1 ? leg : 2 - leg);
      this.lowHp.set(0.35 + 0.65 * t);
      this.stage.invalidate();
    } else this.lowHp.set(0);
  }

  dispose(): void {
    this.hurt.dispose();
    this.lowHp.dispose();
    this.geometry.dispose();
  }
}

class Edge {
  readonly mesh: Mesh;
  private readonly material: UiShaderMaterial<{
    edgeStart: { value: number };
    edgeAlpha: { value: number };
    edgeOpacity: { value: number };
  }>;

  constructor(geometry: PlaneGeometry, start: number, alpha: number, order: number) {
    this.material = new UiShaderMaterial("edge-glow", {
      uniforms: {
        edgeStart: { value: start },
        edgeAlpha: { value: alpha },
        edgeOpacity: { value: 0 },
      },
      vertexShader: `
        varying vec2 edgeUv;
        void main() {
          edgeUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: `
        uniform float edgeStart;
        uniform float edgeAlpha;
        uniform float edgeOpacity;
        varying vec2 edgeUv;
        void main() {
          // An ellipse at the centre sized to the farthest corner (CSS's default), so 100% is a corner.
          vec2 q = (edgeUv - .5) * 1.41421356;
          float stop = clamp((length(q) - edgeStart) / (1. - edgeStart), 0., 1.);
          float a = edgeAlpha * stop * edgeOpacity;
          if (a <= .002) discard;
          // rgb(200 30 50) in linear light.
          gl_FragColor = vec4(.577580, .012983, .031896, a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    // Hidden through the material: the stage still compiles it with the HUD, never on the first hit.
    this.material.visible = false;
  }

  fit(stage: UiStage, width: number, height: number): void {
    this.mesh.scale.set(width, height, 1);
    this.mesh.position.set(stage.camera.left + width / 2, stage.camera.top - height / 2, 0);
  }

  set(opacity: number): void {
    this.material.uniforms.edgeOpacity.value = opacity;
    this.material.visible = opacity > 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.material.dispose();
  }
}
