import { Mesh, PlaneGeometry, Vector2, Vector4, type Texture } from "three";
import { images } from "../../prepare/images";
import type { UiStage } from "./stage";
import { UiShaderMaterial } from "./ui-shader";

/** The lab art (`public/art/lab/lab.provenance.json`). */
const ART = { src: "/art/lab/backdrop.webp", width: 1672, height: 941 } as const;

export type Place = "shelf" | "bench" | "badges";
export const places: readonly Place[] = ["shelf", "bench", "badges"];

/** Each place's object in the art, as source UV `[u0, v0, u1, v1]` (v down). */
const SPOTS: Record<Place, readonly [number, number, number, number]> = {
  shelf: [0.0, 0.16, 0.254, 0.88],
  bench: [0.245, 0.46, 0.757, 0.88],
  badges: [0.757, 0.22, 0.987, 0.51],
};

/** The right edge (u) a narrow view still shows: the badge case's frame. */
const KEEP_RIGHT = 0.99;

/** The badge case's eight holes (source UV centres, row by row) and their diameter in u. */
export const CASE_HOLES = {
  u: [0.812, 0.856, 0.9, 0.945],
  v: [0.321, 0.409],
  diameter: 0.035,
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The 研究所's room: the lab art cover-fit over the whole view (drawn over the frame's paper ground),
 * dimmed while a place is open, with the hovered or focused place's object lit and outlined.
 */
export class LabBackdrop {
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    art: { value: Texture };
    artOn: { value: number };
    viewSize: { value: Vector2 };
    crop: { value: Vector4 };
    spot: { value: Vector4 };
    lit: { value: number };
    dim: { value: number };
  }>;
  private readonly mesh: Mesh;
  private readonly stage: UiStage;
  private readonly texture: Texture;
  /** Visible source rect: u0, v0, u span, v span. */
  private readonly crop = new Vector4(0, 0, 1, 1);
  private width = 1;
  private height = 1;

  constructor(stage: UiStage) {
    this.stage = stage;
    this.texture = images().texture(ART.src, "art", () => {
      this.material.uniforms.artOn.value = 1;
      stage.invalidate();
    });
    this.material = new UiShaderMaterial("lab-backdrop", {
      uniforms: {
        art: { value: this.texture },
        artOn: { value: 0 },
        viewSize: { value: new Vector2(1, 1) },
        crop: { value: this.crop },
        spot: { value: new Vector4(0, 0, 0, 0) },
        lit: { value: 0 },
        dim: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 viewUv;
        void main() {
          viewUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D art;
        uniform float artOn, lit, dim;
        uniform vec2 viewSize;
        uniform vec4 crop, spot;
        varying vec2 viewUv;
        float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
        void main() {
          // View and source rects run top-down; the texture's v runs bottom-up.
          vec2 v = vec2(viewUv.x, 1. - viewUv.y);
          vec2 src = crop.xy + v * crop.zw;
          vec3 col = mix(vec3(.82, .76, .66), texture2D(art, vec2(src.x, 1. - src.y)).rgb, artOn);
          // The lit place: brighter inside, a soft white rim around its object.
          vec2 p = v * viewSize;
          vec2 c = (spot.xy + spot.zw * .5);
          float d = roundBox(p - c, spot.zw * .5, 14.);
          float inside = 1. - smoothstep(-2., 2., d);
          float rim = (1. - smoothstep(0., 3., abs(d))) + .35 * (1. - smoothstep(0., 18., abs(d)));
          col = mix(col, col * 1.12 + .03, inside * lit);
          col = mix(col, vec3(1.), clamp(rim, 0., 1.) * lit * .9);
          // An open place pulls the room back.
          col = mix(col, col * vec3(.34, .38, .48), dim);
          gl_FragColor = vec4(col, 1.);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    // Over the frame's paper ground (-20), under every UI layer.
    this.mesh.renderOrder = -19;
    this.mesh.frustumCulled = false;
    stage.scene.add(this.mesh);
  }

  /** Covers the view; call after the stage's resize. */
  resize(): void {
    const v = this.stage.viewport;
    this.width = v.width;
    this.height = v.height;
    const view = v.width / v.height,
      art = ART.width / ART.height;
    // A narrower view than the art loses width: keep the badge case whole, the shelf's outer
    // edge goes first. A wider one loses height evenly (ceiling and floor).
    if (view > art) this.crop.set(0, (1 - art / view) / 2, 1, art / view);
    else {
      const span = view / art;
      this.crop.set(Math.max(0, Math.min(1 - span, KEEP_RIGHT - span)), 0, span, 1);
    }
    this.material.uniforms.viewSize.value.set(v.width, v.height);
    this.mesh.scale.set(v.width, v.height, 1);
    this.mesh.position.set(
      this.stage.camera.left + v.width / 2,
      this.stage.camera.top - v.height / 2,
      0,
    );
  }

  /** Source UV to the view's logical units. */
  point(u: number, v: number): { x: number; y: number } {
    return {
      x: ((u - this.crop.x) / this.crop.z) * this.width,
      y: ((v - this.crop.y) / this.crop.w) * this.height,
    };
  }

  /** A place's object in the view's logical units, cut to the view. */
  spot(place: Place): Rect {
    const [u0, v0, u1, v1] = SPOTS[place];
    const a = this.point(u0, v0),
      b = this.point(u1, v1);
    const x = Math.max(0, a.x),
      right = Math.min(this.width, b.x);
    return { x, y: a.y, width: right - x, height: b.y - a.y };
  }

  /** Lights `place`'s object at `amount` (0–1), or nothing. */
  light(place: Place | null, amount: number): void {
    const u = this.material.uniforms;
    if (place) {
      const r = this.spot(place);
      u.spot.value.set(r.x, r.y, r.width, r.height);
    }
    u.lit.value = place ? amount : 0;
  }

  setDim(amount: number): void {
    this.material.uniforms.dim.value = amount;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
