import { Container, Text } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry, Vector2 } from "three";
import { images } from "../../prepare/images";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { stack } from "./layer";
import { idleTicked, patternDrift, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { HARD_SHADOW, slantOf, srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

const glsl = (hex: string) => {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
};

/**
 * The frame a screen past the lobby shares: the lobby's paper ground (the ball/cloud/star pattern,
 * drifting with the lobby's)
 * and the top line: a back key, the screen's title on the ink slanted
 * plate (unrolled from the left as the screen opens), whatever the screen adds (研究所's balance)
 * and the settings key at the far end. The screen fills `body`.
 */
export class InnerScreenFrame {
  readonly topline = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  });
  /** Between the title and the settings key. */
  readonly extra = new Container({ flexDirection: "row", alignItems: "center", flexShrink: 1 });
  readonly body = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
  readonly back: GameButton;
  readonly settings: GameButton;
  private readonly titleBox: Container;
  private readonly titlePlate: SlantPlate;
  private readonly title: Text;
  private readonly stage: UiStage;
  private readonly unroll = { reveal: 0 };
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    viewSize: { value: Vector2 };
    drift: { value: Vector2 };
    patternOn: { value: number };
  }>;
  private readonly backdrop: Mesh;

  constructor(stage: UiStage, headline: string) {
    this.stage = stage;
    const pattern = images().texture("/art/transition-pattern.webp", "pattern", () => {
      this.material.uniforms.patternOn.value = 1;
      stage.invalidate();
    });
    this.material = new UiShaderMaterial("inner-backdrop", {
      uniforms: {
        pattern: { value: pattern },
        viewSize: { value: new Vector2(1, 1) },
        drift: { value: new Vector2(...patternDrift()) },
        patternOn: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 viewUv;
        void main() {
          viewUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D pattern;
        uniform vec2 viewSize, drift;
        uniform float patternOn;
        varying vec2 viewUv;
        vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        void main() {
          vec2 p = vec2(viewUv.x, 1. - viewUv.y) * viewSize;
          // The lobby's ground: paper with the pattern at 28% (360px tiles), drifting as it does.
          vec3 col = ${glsl(ui.paper)};
          vec2 q = p - drift;
          col = mix(col, toSrgb(texture2D(pattern, vec2(q.x, -q.y) / 360.).rgb), .28 * patternOn);
          gl_FragColor = vec4(toLinear(col), 1.);
          #include <colorspace_fragment>
        }`,
    });
    this.backdrop = new Mesh(this.geometry, this.material);
    this.backdrop.renderOrder = -20;
    this.backdrop.frustumCulled = false;
    stage.scene.add(this.backdrop);

    this.back = new GameButton(stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: createMenuIcon("back"),
    });
    this.settings = new GameButton(stage, {
      tone: "secondary",
      size: "small",
      square: true,
      icon: createMenuIcon("settings"),
    });
    // The title plate: its text on the plate's centre, the same room both sides of the slant.
    this.titleBox = new Container({
      flexShrink: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
    });
    this.titlePlate = new SlantPlate(this.titleBox, { fill: ui.ink });
    this.titlePlate.set({ depth: HARD_SHADOW.offset, reveal: 0 });
    this.title = stack(
      new Text({
        text: headline,
        fontWeight: 900,
        letterSpacing: 2,
        lineHeight: 1.2,
        color: ui.white,
        whiteSpace: "pre",
      }),
      1,
    );
    this.titleBox.add(this.titlePlate.content, this.title);
    this.settings.panel.setProperties({ marginLeft: "auto" });
    this.topline.add(
      stack(this.back.panel, 1),
      stack(this.titleBox, 1),
      stack(this.extra, 1),
      stack(this.settings.panel, 1),
    );
    stage.motion.enter(
      this.unroll,
      { reveal: 0 },
      { reveal: 1 },
      400,
      () => {
        this.titlePlate.set({ reveal: this.unroll.reveal });
        stage.invalidate();
      },
      SNAP,
      180,
    );
  }

  /** The top line at this viewport; `compact` is short landscape. */
  resize(compact: boolean): void {
    const v = this.stage.viewport;
    const edge = compact ? 16 : 28;
    const height = compact ? 40 : 50;
    this.titleBox.setProperties({ height, paddingX: (compact ? 18 : 24) + slantOf(height) / 2 });
    this.title.setProperties({ fontSize: compact ? 19 : 24 });
    this.topline.setProperties({
      gap: compact ? 12 : 18,
      paddingTop: Math.max(compact ? 10 : 24, v.safeArea.top),
      paddingBottom: compact ? 8 : 16,
      paddingLeft: Math.max(edge, v.safeArea.left),
      paddingRight: Math.max(edge, v.safeArea.right),
    });
    this.back.fitTouch();
    this.settings.fitTouch();
    this.material.uniforms.viewSize.value.set(v.width, v.height);
    this.backdrop.scale.set(v.width, v.height, 1);
    this.backdrop.position.set(
      this.stage.camera.left + v.width / 2,
      this.stage.camera.top - v.height / 2,
      0,
    );
  }

  /** Each frame: the ground's drift steps on the 15Hz idle clock; the screen's control loop
   *  advances the two keys' time. */
  update(): void {
    if (idleTicked(15)) {
      this.material.uniforms.drift.value.set(...patternDrift());
      this.stage.invalidate();
    }
    this.back.update(0);
    this.settings.update(0);
  }

  dispose(): void {
    this.stage.motion.cancel(this.unroll);
    this.back.dispose();
    this.settings.dispose();
    this.titlePlate.dispose();
    this.backdrop.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
