import { Container, Content, Text, type FontFamilies } from "@pmndrs/uikit";
import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Path,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from "three";
import { images } from "../../prepare/images";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { cubicBezier } from "./focus-mark";
import { UiStage } from "./stage";
import { SCENE_TRANSITION_TIMING, type SceneTransitionPhase } from "../scene-transition";
import { UiShaderMaterial } from "./ui-shader";
import type { UiInsets } from "./viewport";

const coverEase = (t: number) => cubicBezier(t, 0.22, 0.75, 0.25, 1);
const revealEase = (t: number) => cubicBezier(t, 0.4, 0, 0.24, 1);
const SKY = "#f5fbff";

/**
 * What the app draws over everything: the scene transition (a sky-white cloud curtain sweeping
 * left to right, its Poké Ball / route-map pattern drifting against it) and, on a phone held
 * upright, the 请横屏使用 notice. Both block input while shown.
 */
export class GpuShell {
  readonly stage = new UiStage();
  private readonly curtain = new Group();
  private readonly sheet: Mesh;
  private readonly sheetMaterial: UiShaderMaterial<{
    sheetSize: { value: Vector2 };
    drift: { value: Vector2 };
    pattern: { value: unknown };
    sky: { value: Color };
  }>;
  private readonly sheetGeometry = new PlaneGeometry(1, 1);
  private readonly edgeGeometry: BufferGeometry;
  private readonly edgeMaterial = new MeshBasicMaterial({
    color: SKY,
    // The edges are mirrored by negative scales.
    side: DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly leading: Mesh;
  private readonly trailing: Mesh;
  private readonly pattern = images().texture("/art/transition-pattern.webp", "pattern", () =>
    this.stage.invalidate(),
  );
  private readonly notice = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    backgroundColor: "#0d233f",
    display: "none",
  });
  private phase: SceneTransitionPhase = "idle";
  /** ms since the cover started; the pattern drifts across cover and reveal as one motion. */
  private age = 0;
  private phaseAge = 0;
  private portrait = false;

  constructor(fonts: FontFamilies) {
    this.stage.root.setProperties({ fontFamilies: fonts });
    this.sheetMaterial = new UiShaderMaterial("shell-curtain", {
      uniforms: {
        sheetSize: { value: new Vector2(1, 1) },
        drift: { value: new Vector2() },
        pattern: { value: this.pattern },
        sky: { value: new Color(SKY) },
      },
      vertexShader: `
        varying vec2 sheetUv;
        void main() {
          sheetUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: `
        uniform vec2 sheetSize;
        uniform vec2 drift;
        uniform sampler2D pattern;
        uniform vec3 sky;
        varying vec2 sheetUv;
        void main() {
          // background: url(pattern) 0 0 / 256px repeat on a layer inset -96px, translated by drift.
          vec2 p = vec2(sheetUv.x, 1. - sheetUv.y) * sheetSize - (vec2(-96.) + drift);
          vec4 tile = texture2D(pattern, p / 256.);
          gl_FragColor = vec4(mix(sky, tile.rgb, tile.a), 1.);
          #include <colorspace_fragment>
        }`,
    });
    this.sheet = new Mesh(this.sheetGeometry, this.sheetMaterial);
    // Original 120 × 800 curtain path, tessellated without an XML/DOM parser.
    const edge = new Shape()
      .moveTo(0, 0)
      .lineTo(30, 0)
      .bezierCurveTo(104, 12, 117, 90, 73, 139)
      .bezierCurveTo(125, 179, 125, 258, 60, 293)
      .bezierCurveTo(118, 329, 124, 408, 78, 456)
      .bezierCurveTo(124, 503, 118, 578, 57, 612)
      .bezierCurveTo(115, 650, 112, 741, 32, 800)
      .lineTo(0, 800);
    edge.closePath();
    this.edgeGeometry = new ShapeGeometry(edge, 24);
    // SVG y runs down; the edge meshes flip it with their scale.
    this.leading = new Mesh(this.edgeGeometry, this.edgeMaterial);
    this.trailing = new Mesh(this.edgeGeometry, this.edgeMaterial);
    this.curtain.add(this.sheet, this.leading, this.trailing);
    for (const mesh of [this.sheet, this.leading, this.trailing]) mesh.frustumCulled = false;
    this.curtain.renderOrder = 100;
    this.showCurtain(false);
    this.stage.scene.add(this.curtain);

    const glyph = createRotateGlyph();
    glyph.setProperties({ width: 100, height: 100, color: "#ffd45b" });
    const message = new Container({
      width: "100%",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
    });
    message.add(
      new Text({ text: "请横屏使用", fontSize: 24, fontWeight: 800, color: "#d8effb" }),
      new Text({
        text: "iPhone：关闭竖排方向锁定\nAndroid：开启自动旋转",
        width: "100%",
        fontSize: 14,
        lineHeight: "150%",
        color: "#b9e4f5",
        textAlign: "center",
        whiteSpace: "pre-line",
      }),
    );
    this.notice.add(glyph, message);
    this.stage.root.add(this.notice);
  }

  /** Hidden through its materials, so the host still compiles it before the first sweep. */
  private showCurtain(shown: boolean): void {
    this.sheetMaterial.visible = this.edgeMaterial.visible = shown;
  }

  /** True while the shell covers the app and owns its input. */
  get blocking(): boolean {
    return this.portrait || this.phase !== "idle";
  }

  setTransition(phase: SceneTransitionPhase): void {
    if (phase === this.phase) return;
    if (phase === "covering") this.age = 0;
    this.phase = phase;
    this.phaseAge = 0;
    this.showCurtain(phase !== "idle" && !this.portrait);
    this.stage.invalidate();
  }

  setPortrait(portrait: boolean): void {
    if (portrait === this.portrait) return;
    this.portrait = portrait;
    this.notice.setProperties({ display: portrait ? "flex" : "none" });
    // The notice was a top-layer dialog, over the transition as well.
    this.showCurtain(this.phase !== "idle" && !portrait);
    this.stage.invalidate();
  }

  resize(width: number, height: number, scale: number, safeArea: UiInsets): void {
    this.stage.resize(width, height, scale, safeArea);
    const v = this.stage.viewport;
    this.notice.setProperties({
      paddingTop: Math.max(32, v.safeArea.top),
      paddingRight: Math.max(24, v.safeArea.right),
      paddingBottom: Math.max(32, v.safeArea.bottom),
      paddingLeft: Math.max(24, v.safeArea.left),
    });
  }

  /** Moves the curtain; call every frame before drawing. */
  update(deltaMs: number): void {
    if (this.phase === "idle") return;
    this.age += deltaMs;
    this.phaseAge += deltaMs;
    const v = this.stage.viewport;
    // The stage is in UI units; the curtain keeps the CSS px sizes of the original.
    const unit = 1 / v.scale,
      width = v.width,
      height = v.height;
    const covering = this.phase === "covering";
    const t = Math.min(
      1,
      this.phaseAge / (covering ? SCENE_TRANSITION_TIMING.cover : SCENE_TRANSITION_TIMING.reveal),
    );
    const shift = covering ? -1.25 + 1.25 * coverEase(t) : 1.25 * revealEase(t);
    const left = this.stage.camera.left + shift * width,
      top = this.stage.camera.top;
    this.sheet.scale.set(width, height, 1);
    this.sheet.position.set(left + width / 2, top - height / 2, 0);
    const drift = Math.min(
      1,
      this.age / (SCENE_TRANSITION_TIMING.cover + SCENE_TRANSITION_TIMING.reveal),
    );
    this.sheetMaterial.uniforms.sheetSize.value.set(width / unit, height / unit);
    this.sheetMaterial.uniforms.drift.value.set(48 - 72 * drift, 24 - 36 * drift);
    // width: clamp(80px, 15vw, 220px); height: 100% + 2px; 1px into the sheet on each side.
    const edge = Math.min(220, Math.max(80, (0.15 * width) / unit)) * unit;
    const sx = edge / 120,
      sy = (height + 2 * unit) / 800;
    this.leading.scale.set(sx, -sy, 1);
    this.leading.position.set(left + width - unit, top + unit, 0);
    this.trailing.scale.set(-sx, sy, 1);
    this.trailing.position.set(left + unit, top - height - unit, 0);
    this.stage.invalidate();
  }

  /** Context lost: the stage (the image store re-uploads the curtain pattern). */
  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    this.sheetGeometry.dispose();
    this.sheetMaterial.dispose();
    this.edgeGeometry.dispose();
    this.edgeMaterial.dispose();
    this.pattern.dispose();
    this.stage.dispose();
  }
}

/** LandscapeNotice's 100px glyph: a phone on its side with two turning arrows, 3px round strokes. */
function createRotateGlyph(): Content {
  const inset = 5 * (1 - 0.551915024494);
  const phone = new Path()
    .moveTo(26, 35)
    .lineTo(74, 35)
    .bezierCurveTo(79 - inset, 35, 79, 35 + inset, 79, 40)
    .lineTo(79, 64)
    .bezierCurveTo(79, 69 - inset, 79 - inset, 69, 74, 69)
    .lineTo(26, 69)
    .bezierCurveTo(21 + inset, 69, 21, 69 - inset, 21, 64)
    .lineTo(21, 40)
    .bezierCurveTo(21, 35 + inset, 21 + inset, 35, 26, 35);
  // The two original radius-34 SVG arcs, related by a half-turn around (50, 52).
  const offset = Math.sqrt(34 ** 2 - 26 ** 2 - 2 ** 2) / Math.hypot(52, 4);
  const cx = 54 - 4 * offset,
    cy = 24 + 52 * offset;
  const start = Math.atan2(22 - cy, 28 - cx),
    end = Math.atan2(26 - cy, 80 - cx);
  const paths = [
    phone,
    new Path().moveTo(29, 43).lineTo(29, 61),
    new Path().moveTo(71, 52).lineTo(72, 52),
    new Path().absarc(cx, cy, 34, start, end, false),
    new Path().moveTo(80, 14).lineTo(80, 27).lineTo(67, 27),
    new Path().absarc(100 - cx, 104 - cy, 34, start + Math.PI, end + Math.PI, false),
    new Path().moveTo(20, 90).lineTo(20, 77).lineTo(33, 77),
  ];
  const style = SVGLoader.getStrokeStyle(3, "#ffd45b", "round", "round");
  const parts = paths
    .map((sub) => SVGLoader.pointsToStroke(sub.getPoints(24), style)!)
    .filter(Boolean);
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.translate(-50, -50, 0);
  geometry.boundingBox = new Box3(new Vector3(-50, -50, 0), new Vector3(50, 50, 0));
  const material = new MeshBasicMaterial({
    color: "#ffd45b",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.y = -1;
  const content = new Content({ flexShrink: 0, depthTest: false, keepAspectRatio: false });
  content.add(mesh);
  content.notifyAncestorsChanged();
  content.abortSignal.addEventListener("abort", () => {
    geometry.dispose();
    material.dispose();
  });
  return content;
}
