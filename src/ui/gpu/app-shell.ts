import { Container, Content, Text, type FontFamilies } from "@pmndrs/uikit";
import {
  Box3,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Path,
  Vector2,
  Vector3,
  type Texture,
} from "three";
import { images } from "../../prepare/images";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { stack } from "./layer";
import { LINE_BALL_GLSL } from "./line-ball";
import { PATTERN_DRIFT, patternDrift, SNAP } from "./motion";
import { ProgressBar } from "./progress-bar";
import { UiStage } from "./stage";
import { CURTAIN, type SceneTransitionPhase } from "../scene-transition";
import { UiShaderMaterial } from "./ui-shader";
import { SLANT, srgb, ui } from "./tokens";
import type { UiInsets } from "./viewport";

/** The three slabs, in the order they close: paper (hatched, the ball/cloud/star pattern), ball red
 *  (half a line-drawn ball on its leading edge, in white), and ink (hatched, the pattern's motifs
 *  in white drifting, carrying the page title): the ink one closed is the launcher's ground. They
 *  open in the reverse order. `motif` is the pattern's motifs in white; `rim` the line ball's rim
 *  colour and `ball` its rim's and inner lines' alpha (none: no ball). */
const SLABS = [
  {
    fill: ui.paper,
    line: ui.ink,
    lineAlpha: 0.05,
    step: 22,
    pattern: 0.2,
    motif: 0,
    rim: ui.white,
    ball: [0, 0],
  },
  {
    fill: ui.ball,
    line: ui.ball,
    lineAlpha: 0,
    step: 22,
    pattern: 0,
    motif: 0,
    rim: ui.white,
    ball: [0.35, 0.35],
  },
  {
    fill: ui.ink,
    line: ui.white,
    lineAlpha: 0.035,
    step: 26,
    pattern: 0,
    motif: 0.07,
    rim: ui.white,
    ball: [0, 0],
  },
] as const;

type SlabMaterial = UiShaderMaterial<{
  slabSize: { value: Vector2 };
  lean: { value: number };
  fill: { value: Vector3 };
  line: { value: Vector3 };
  lineAlpha: { value: number };
  lineStep: { value: number };
  pattern: { value: Texture };
  patternAlpha: { value: number };
  patternOn: { value: number };
  motifAlpha: { value: number };
  drift: { value: Vector2 };
  mark: { value: Vector3 };
  markRim: { value: Vector3 };
  markAlpha: { value: Vector2 };
  lineWidth: { value: number };
}>;

/**
 * What the app draws over everything: the page curtain (three −14° slabs sweeping in from the
 * right one after another, then out to the left, the ink one carrying the destination's title)
 * and, on a phone held upright, the 请横屏使用 notice. Both block input while shown.
 */
export class GpuShell {
  readonly stage = new UiStage();
  private readonly geometry = new PlaneGeometry(1, 1);
  /** Shared by every slab: no pattern is sampled before its image is in. */
  private readonly patternOn = { value: 0 };
  private readonly pattern = images().texture("/art/transition-pattern.webp", "pattern", () => {
    this.patternOn.value = 1;
    this.stage.invalidate();
  });
  private readonly slabs: { content: Content; material: SlabMaterial }[];
  private readonly titleBox = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    display: "none",
  });
  private readonly title: Text;
  private readonly titleShadow: Text;
  /** The load's progress under the title; it never goes back within one closing. */
  private readonly gauge = new ProgressBar();
  /** The last reported progress (null: no bar). */
  private progressTarget: number | null = null;
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
    backgroundColor: ui.ink,
    display: "none",
  });
  private phase: SceneTransitionPhase = "idle";
  private phaseAge = 0;
  private phaseStart = 0;
  private portrait = false;

  constructor(fonts: FontFamilies) {
    this.stage.root.setProperties({ fontFamilies: fonts });
    this.slabs = SLABS.map((look, i) => {
      const material: SlabMaterial = new UiShaderMaterial("shell-slab", {
        uniforms: {
          slabSize: { value: new Vector2(1, 1) },
          lean: { value: 0 },
          fill: { value: srgb(look.fill) },
          line: { value: srgb(look.line) },
          lineAlpha: { value: look.lineAlpha },
          lineStep: { value: look.step },
          pattern: { value: this.pattern },
          patternAlpha: { value: look.pattern },
          patternOn: this.patternOn,
          motifAlpha: { value: look.motif },
          drift: { value: new Vector2() },
          mark: { value: new Vector3(0, 0, 1) },
          markRim: { value: srgb(look.rim) },
          markAlpha: { value: new Vector2(...look.ball) },
          lineWidth: { value: 2 },
        },
        vertexShader: /* glsl */ `
          varying vec2 slabPoint;
          uniform vec2 slabSize;
          void main() {
            slabPoint = vec2(uv.x, 1. - uv.y) * slabSize;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec2 slabSize;
          uniform float lean, lineAlpha, lineStep, patternAlpha, patternOn, motifAlpha, lineWidth;
          uniform vec2 drift, markAlpha;
          uniform vec3 fill, line, mark, markRim;
          uniform sampler2D pattern;
          varying vec2 slabPoint;
          vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
          vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
          ${LINE_BALL_GLSL}
          void main() {
            vec2 p = slabPoint;
            float aa = .5 * max(fwidth(p.x), fwidth(p.y));
            // x with the slant taken out: the top edge sits lean right of the bottom edge.
            float ux = p.x - (slabSize.y - p.y) * ${SLANT.toFixed(6)};
            float w = slabSize.x - lean;
            float cover = (1. - smoothstep(-aa, aa, -ux)) * (1. - smoothstep(-aa, aa, ux - w));
            if (cover <= 0.) discard;
            vec3 col = fill;
            if (patternAlpha > 0.) col = mix(col, toSrgb(texture2D(pattern, p / 360.).rgb), patternAlpha * patternOn);
            // The motifs (darker than the pattern's paper) in white, at the launcher's place once closed.
            if (motifAlpha > 0.) {
              vec3 t = toSrgb(texture2D(pattern, (p - vec2(lean, 0.) - drift) / ${PATTERN_DRIFT.tile}.).rgb);
              float motif = smoothstep(.03, .2, .97 - dot(t, vec3(.299, .587, .114)));
              col = mix(col, vec3(1.), motifAlpha * patternOn * motif);
            }
            if (markAlpha.x > 0.) {
              vec2 ball = lineBall(p, mark, lineWidth, aa);
              col = mix(col, markRim, markAlpha.x * ball.x);
              col = mix(col, vec3(1.), markAlpha.y * ball.y);
            }
            float lane = mod(ux * ${Math.cos((14 * Math.PI) / 180).toFixed(5)}, lineStep);
            col = mix(col, line, lineAlpha * (1. - smoothstep(2. - aa, 2. + aa, lane)));
            gl_FragColor = vec4(toLinear(col), cover);
            #include <colorspace_fragment>
          }`,
      });
      const content = new Content({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        keepAspectRatio: false,
        depthTest: false,
      });
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      content.add(mesh);
      content.notifyAncestorsChanged();
      this.stage.root.add(stack(content, 1 + i));
      return { content, material };
    });
    // The title on the ink slab: upright, wide-tracked, with a hard ball-red shadow.
    const heading = new Container({ flexShrink: 0 });
    this.titleShadow = new Text({
      text: "",
      fontWeight: 800,
      color: ui.ball,
      positionType: "absolute",
      positionLeft: 5,
      positionTop: 5,
    });
    this.title = stack(new Text({ text: "", fontWeight: 800, color: ui.white }), 1);
    heading.add(this.titleShadow, this.title);
    this.gauge.content.setProperties({ display: "none" });
    this.titleBox.add(heading, this.gauge.content);
    this.stage.root.add(stack(this.titleBox, 4));
    this.showCurtain(false);

    const glyph = createRotateGlyph();
    glyph.setProperties({ width: 100, height: 100, color: ui.ball });
    const message = new Container({
      width: "100%",
      flexDirection: "column",
      alignItems: "center",
      gap: 8,
    });
    message.add(
      new Text({ text: "请横屏使用", fontSize: 24, fontWeight: 800, color: ui.white }),
      new Text({
        text: "iPhone：关闭竖排方向锁定\nAndroid：开启自动旋转",
        width: "100%",
        fontSize: 14,
        lineHeight: "150%",
        color: ui.line,
        textAlign: "center",
        whiteSpace: "pre-line",
      }),
    );
    this.notice.add(glyph, message);
    this.stage.root.add(stack(this.notice, 5));
  }

  /** Hidden through its materials, so the host still compiles it before the first sweep. */
  private showCurtain(shown: boolean): void {
    for (const slab of this.slabs) slab.material.visible = shown;
    this.titleBox.setProperties({ display: shown ? "flex" : "none" });
  }

  /** True while the shell covers the app and owns its input. */
  get blocking(): boolean {
    return this.portrait || this.phase !== "idle";
  }

  /** `title` names the page coming on (shown on the ink slab while it covers); `progress` (0–1) is
   *  how far it has loaded, drawn under the title (null: no bar). */
  setTransition(phase: SceneTransitionPhase, title = "", progress: number | null = null): void {
    if (phase !== "revealing" && (phase !== this.phase || progress !== this.progressTarget)) {
      if (phase !== this.phase || this.progressTarget === null) this.gauge.reset(progress ?? 0);
      else if (progress !== null) this.gauge.set(progress);
      this.progressTarget = progress;
      this.gauge.content.setProperties({ display: progress === null ? "none" : "flex" });
      this.stage.invalidate();
    }
    if (phase === "covering" && title !== this.title.properties.peek().text) {
      this.title.setProperties({ text: title });
      this.titleShadow.setProperties({ text: title });
    }
    if (phase === this.phase) return;
    this.phase = phase;
    this.phaseStart = performance.now();
    this.phaseAge = 0;
    this.showCurtain(phase !== "idle" && !this.portrait);
    this.place();
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
    const lean = v.height * SLANT;
    for (const slab of this.slabs) {
      slab.content.setProperties({ width: v.width + 2 * lean, height: v.height });
      slab.material.uniforms.slabSize.value.set(v.width + 2 * lean, v.height);
      slab.material.uniforms.lean.value = lean;
      slab.material.uniforms.lineWidth.value = Math.max(2, Math.round(0.006 * v.height));
    }
    // Red: half a ball on its leading edge.
    this.slabs[1]!.material.uniforms.mark.value.set(0.5 * lean, 0.5 * v.height, 0.42 * v.height);
    const size = Math.min(96, Math.max(36, 0.12 * v.height));
    this.title.setProperties({ fontSize: size, letterSpacing: 0.24 * size });
    this.titleShadow.setProperties({ fontSize: size, letterSpacing: 0.24 * size });
    this.gauge.resize(ProgressBar.sizeFor(size, v.width));
    this.gauge.content.setProperties({ marginTop: Math.round(size * 0.35) });
    this.place();
  }

  /** Each slab's place: 1 off to the right, 0 covering, −1 off to the left (the left edge of a
   *  slab 2·lean wider than the screen, so a covering slab leaves no corner open). */
  private place(): void {
    const v = this.stage.viewport;
    const lean = v.height * SLANT;
    const covering = this.phase === "covering";
    const ms = covering ? CURTAIN.cover : CURTAIN.reveal;
    this.slabs.forEach((slab, i) => {
      // Closing: paper first, ink last (on top); opening: ink first.
      const order = covering ? i : SLABS.length - 1 - i;
      const k = SNAP(Math.min(1, Math.max(0, (this.phaseAge - order * CURTAIN.stagger) / ms)));
      const at = covering ? 1 - k : -k;
      const x = -lean + at * (v.width + lean);
      slab.content.setProperties({ transformTranslateX: x });
      if (i === SLABS.length - 1) this.titleBox.setProperties({ transformTranslateX: x + lean });
    });
  }

  /** Moves the curtain; call every frame before drawing. */
  update(deltaMs: number): void {
    if (this.phase === "idle") return;
    // Wall time, like SceneTransition's timers: capped frame deltas would leave slabs behind them.
    this.phaseAge = performance.now() - this.phaseStart;
    this.slabs[2]!.material.uniforms.drift.value.set(...patternDrift());
    if (this.progressTarget !== null) this.gauge.update(deltaMs);
    this.place();
    this.stage.invalidate();
  }

  /** Context lost: the stage (the image store re-uploads the curtain pattern). */
  releaseUploads(): void {
    this.stage.releaseUploads();
  }

  dispose(): void {
    this.geometry.dispose();
    for (const slab of this.slabs) slab.material.dispose();
    this.gauge.dispose();
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
  const style = SVGLoader.getStrokeStyle(3, ui.ball, "round", "round");
  const parts = paths
    .map((sub) => SVGLoader.pointsToStroke(sub.getPoints(24), style)!)
    .filter(Boolean);
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.translate(-50, -50, 0);
  geometry.boundingBox = new Box3(new Vector3(-50, -50, 0), new Vector3(50, 50, 0));
  const material = new MeshBasicMaterial({
    color: ui.ball,
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
