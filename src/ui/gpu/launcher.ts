import { Container, Content, Text, type FontFamilies } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry, Vector2, Vector3, Vector4, type Texture } from "three";
import { images } from "../../prepare/images";
import { fade, stack } from "./layer";
import { LINE_BALL_GLSL } from "./line-ball";
import { idleTicked, PATTERN_DRIFT, patternDrift, SNAP } from "./motion";
import { ProgressBar } from "./progress-bar";
import { UiStage } from "./stage";
import { SLANT, srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";
import type { UiInsets } from "./viewport";

/** One turn of the emblem (ms), stepped on the idle clock at 15Hz. */
const TURN_MS = 12_000;
/** The exit: the ground splits along the slant and its halves leave, as the curtain opens (ms). */
const EXIT_MS = 300;
/** How soon the centred content is gone in the exit (ms): before the split is wide. */
const CONTENT_OUT_MS = 90;

/** A CSS colour as a GLSL vec3 of its sRGB components (the shaders blend in display space). */
const glslColour = (hex: string): string =>
  `vec3(${srgb(hex)
    .toArray()
    .map((c) => c.toFixed(5))
    .join(", ")})`;

const COLOURS = /* glsl */ `
  vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
  vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }`;

const PATTERN = "/art/transition-pattern.webp";

/**
 * What the app shows from its first frame until the lobby and the run it opens on are in: the
 * curtain's ink slab with its hatch, the paper and ball-red slabs waiting at the right edge, a
 * Poké Ball, the wordmark (once its 6 KB font page is in) and the load's bar. Behind them, as on
 * the closed curtain: the ball/cloud/star pattern whitened and drifting, and the opening partner's
 * silhouette. Pure shaders: the first frame needs nothing from the network; the pattern and the
 * silhouette fade in when their images arrive. It leaves by itself (`exit`): the ground splits
 * along the slant and both halves slide off, the lobby already drawn beneath.
 */
export class GpuLauncher {
  readonly stage = new UiStage();
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly field = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly pattern: Texture;
  private partner: Texture | null = null;
  private readonly fieldMaterial = new UiShaderMaterial("launcher-field", {
    uniforms: {
      fieldSize: { value: new Vector2(1, 1) },
      edge: { value: 1 },
      pattern: { value: null as Texture | null },
      patternOn: { value: 0 },
      drift: { value: new Vector2() },
      partner: { value: null as Texture | null },
      partnerOn: { value: 0 },
      partnerBox: { value: new Vector4(0, 0, 1, 1) },
      split: { value: 0 },
      wedgeMark: { value: new Vector3(0, 0, 1) },
      lineWidth: { value: 2 },
    },
    vertexShader: /* glsl */ `
      varying vec2 fieldPoint;
      uniform vec2 fieldSize;
      void main() {
        fieldPoint = vec2(uv.x, 1. - uv.y) * fieldSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 fieldSize, drift;
      uniform float edge, patternOn, partnerOn, lineWidth, split;
      uniform sampler2D pattern, partner;
      uniform vec4 partnerBox; // left, top, w, h
      uniform vec3 wedgeMark; // centre, radius
      varying vec2 fieldPoint;
      ${COLOURS}
      ${LINE_BALL_GLSL}
      void main() {
        vec2 p = fieldPoint;
        float aa = .5 * max(fwidth(p.x), fwidth(p.y));
        // x with the slant taken out, as on the curtain's slabs.
        float ux = p.x - (fieldSize.y - p.y) * ${SLANT.toFixed(6)};
        // Leaving: split along the slant through the middle, each half carried off its own side.
        if (split > 0.) {
          float middle = .5 * (fieldSize.x - fieldSize.y * ${SLANT.toFixed(6)});
          float away = split * (middle + fieldSize.y * ${SLANT.toFixed(6)});
          float side = ux < middle ? 1. : -1.;
          if (abs(ux - middle) < away) discard;
          p.x += side * away;
          ux += side * away;
        }
        vec3 col = ${glslColour(ui.ink)};
        float lane = mod(ux * ${Math.cos((14 * Math.PI) / 180).toFixed(5)}, 26.);
        col = mix(col, vec3(1.), .035 * (1. - smoothstep(2. - aa, 2. + aa, lane)));
        // The pattern's motifs (darker than its paper) drawn in white.
        if (patternOn > 0.) {
          vec3 t = toSrgb(texture2D(pattern, (p - drift) / ${PATTERN_DRIFT.tile}.).rgb);
          float motif = smoothstep(.03, .2, .97 - dot(t, vec3(.299, .587, .114)));
          col = mix(col, vec3(1.), .07 * patternOn * motif);
        }
        // The partner, a shade lighter than the ink: who is it?
        // Sampled everywhere at clamped coordinates, then masked: a lookup inside the bounds test
        // breaks its derivatives at the box edge, and the blurred top mip leaks in as a line.
        vec2 su = (p - partnerBox.xy) / partnerBox.zw;
        float within = step(0., su.x) * step(su.x, 1.) * step(0., su.y) * step(su.y, 1.);
        float body = texture2D(partner, clamp(vec2(su.x, 1. - su.y), 0., 1.)).a;
        col = mix(col, vec3(1.), .06 * partnerOn * within * body);
        // The curtain's next slabs at the right edge: a paper sliver leading, ball red behind it
        // from the top-right corner.
        float right = fieldSize.x - fieldSize.y * ${SLANT.toFixed(6)};
        float paper = smoothstep(-aa, aa, ux - (right - edge));
        float red = smoothstep(-aa, aa, ux - right);
        col = mix(col, ${glslColour(ui.paper)}, paper);
        col = mix(col, ${glslColour(ui.ball)}, red);
        vec2 wedge = lineBall(p, wedgeMark, lineWidth, aa);
        col = mix(col, vec3(1.), .5 * red * max(wedge.x, wedge.y));
        gl_FragColor = vec4(toLinear(col), 1.);
        #include <colorspace_fragment>
      }`,
  });
  private readonly emblem = new Content({
    keepAspectRatio: false,
    depthTest: false,
    flexShrink: 0,
  });
  private readonly emblemMaterial = new UiShaderMaterial("launcher-ball", {
    uniforms: { ballSize: { value: 1 }, turn: { value: 0 }, ballOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 ballPoint;
      uniform float ballSize;
      void main() {
        ballPoint = (vec2(uv.x, 1. - uv.y) - .5) * ballSize;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: /* glsl */ `
      uniform float ballSize, turn, ballOpacity;
      varying vec2 ballPoint;
      ${COLOURS}
      void main() {
        float r = .5 * ballSize;
        float aa = .5 * max(fwidth(ballPoint.x), fwidth(ballPoint.y));
        float c = cos(turn), s = sin(turn);
        vec2 p = vec2(c * ballPoint.x - s * ballPoint.y, s * ballPoint.x + c * ballPoint.y);
        float d = length(p);
        float inside = 1. - smoothstep(r - aa, r + aa, d);
        if (inside <= 0.) discard;
        // Ball red above the band, paper below; the ink band and the button's ink ring cut both.
        vec3 col = mix(${glslColour(ui.paper)}, ${glslColour(ui.ball)}, smoothstep(-aa, aa, -p.y));
        float band = 1. - smoothstep(.07 * r - aa, .07 * r + aa, abs(p.y));
        float ring = 1. - smoothstep(.34 * r - aa, .34 * r + aa, d);
        float button = 1. - smoothstep(.22 * r - aa, .22 * r + aa, d);
        vec3 ink = ${glslColour(ui.ink)};
        col = mix(col, ink, max(band, ring));
        col = mix(col, vec3(1.), button);
        gl_FragColor = vec4(toLinear(col), inside * ballOpacity);
        #include <colorspace_fragment>
      }`,
  });
  private readonly wordmark = new Container({ flexDirection: "row", flexShrink: 0 });
  private readonly words: Text[];
  readonly bar = new ProgressBar();
  private turned = 0;
  private readonly column: Container;
  /** ms into the exit; null while it stays. */
  private leaving: number | null = null;

  constructor(fonts: FontFamilies) {
    this.stage.root.setProperties({ fontFamilies: fonts });
    this.pattern = images().texture(PATTERN, "pattern", () => this.fadeIn("patternOn"));
    this.fieldMaterial.uniforms.pattern.value = this.pattern;
    for (const [content, material] of [
      [this.field, this.fieldMaterial],
      [this.emblem, this.emblemMaterial],
    ] as const) {
      const mesh = new Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      content.add(mesh);
      content.notifyAncestorsChanged();
    }
    this.words = [
      ["poke", ui.white],
      ["tone", ui.ball],
    ].map(
      ([text, color]) =>
        new Text({
          text,
          color,
          fontFamily: "Poketone Display",
          fontWeight: 400,
          lineHeight: "110%",
        }),
    );
    this.wordmark.add(...this.words);
    fade(this.wordmark, 0);
    const column = (this.column = new Container({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    }));
    column.add(this.emblem, this.wordmark, this.bar.content);
    this.stage.root.add(this.field, stack(column, 1));
  }

  /** The opening partner (a form id): its portrait's silhouette, once the image is in. */
  setPartner(form: string): void {
    if (this.partner) return;
    this.partner = images().texture(`/art/portraits/${form}.webp`, "art", () =>
      this.fadeIn("partnerOn"),
    );
    this.fieldMaterial.uniforms.partner.value = this.partner;
  }

  /** Decoration fades in over 400ms from its image's arrival, on the frames update() draws. */
  private readonly fading = new Set<"patternOn" | "partnerOn">();
  private fadeIn(uniform: "patternOn" | "partnerOn"): void {
    this.fading.add(uniform);
    this.stage.invalidate();
  }

  /** Starts leaving: from here the ground beneath may draw. */
  exit(): void {
    this.leaving ??= 0;
  }

  get exiting(): boolean {
    return this.leaving !== null;
  }

  /** The exit has finished: nothing of the launcher is on screen. */
  get gone(): boolean {
    return this.leaving !== null && this.leaving >= EXIT_MS;
  }

  /** The wordmark shows once its font page is in (until then its place is held). */
  showWordmark(shown: boolean): void {
    fade(this.wordmark, shown ? 1 : 0);
    this.stage.invalidate();
  }

  resize(width: number, height: number, scale: number, safeArea: UiInsets): void {
    this.stage.resize(width, height, scale, safeArea);
    const v = this.stage.viewport;
    this.field.setProperties({ width: v.width, height: v.height });
    this.fieldMaterial.uniforms.fieldSize.value.set(v.width, v.height);
    const u = this.fieldMaterial.uniforms;
    u.edge.value = Math.max(8, Math.round(0.012 * v.width));
    u.lineWidth.value = Math.max(2, Math.round(0.006 * v.height));
    u.wedgeMark.value.set(v.width - 0.1 * v.height, 0.9 * v.height, 0.085 * v.height);
    const side = 0.8 * v.height;
    u.partnerBox.value.set(0.8 * v.width - side / 2, 0.24 * v.height, side, side);
    // The curtain title's size: the bar is the curtain's own.
    const size = Math.min(96, Math.max(36, 0.12 * v.height));
    const ball = Math.round(size * 1.25);
    this.emblem.setProperties({ width: ball, height: ball, marginBottom: Math.round(size * 0.3) });
    this.emblemMaterial.uniforms.ballSize.value = ball;
    for (const word of this.words) word.setProperties({ fontSize: size * 0.8 });
    this.wordmark.setProperties({ height: Math.round(size * 0.88) });
    this.bar.resize(ProgressBar.sizeFor(size, v.width));
    this.bar.content.setProperties({ marginTop: Math.round(size * 0.35) });
  }

  /** Steps the emblem on the idle clock and the bar's easing; true when the picture changed. */
  update(deltaMs: number): boolean {
    let changed = this.bar.update(deltaMs);
    this.turned += deltaMs;
    const u = this.fieldMaterial.uniforms;
    for (const uniform of this.fading) {
      u[uniform].value = Math.min(1, u[uniform].value + deltaMs / 400);
      if (u[uniform].value === 1) this.fading.delete(uniform);
      changed = true;
    }
    if (this.leaving !== null) {
      this.leaving = Math.min(EXIT_MS, this.leaving + deltaMs);
      const k = SNAP(this.leaving / EXIT_MS);
      u.split.value = k;
      // The ball, the wordmark and the bar ride out on the left half and are gone before the split
      // has opened wide: they sit across it, so they could not stay inside one half.
      const v = this.stage.viewport;
      const away = 0.5 * (v.width - v.height * SLANT) + v.height * SLANT;
      const shown = Math.max(0, 1 - this.leaving / CONTENT_OUT_MS);
      this.column.setProperties({ transformTranslateX: -k * away });
      fade(this.column, shown);
      this.emblemMaterial.uniforms.ballOpacity.value = shown;
      this.bar.setOpacity(shown);
      changed = true;
    }
    if (idleTicked(15)) {
      this.emblemMaterial.uniforms.turn.value = ((this.turned % TURN_MS) / TURN_MS) * 2 * Math.PI;
      u.drift.value.set(...patternDrift());
      changed = true;
    }
    return this.stage.update(deltaMs) || changed;
  }

  dispose(): void {
    this.bar.dispose();
    this.pattern.dispose();
    this.partner?.dispose();
    this.geometry.dispose();
    this.fieldMaterial.dispose();
    this.emblemMaterial.dispose();
    this.stage.dispose();
  }
}
