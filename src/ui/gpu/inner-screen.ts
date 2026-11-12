import { Container, Text } from "@pmndrs/uikit";
import { Mesh, PlaneGeometry, Vector2, type Texture } from "three";
import { GameButton } from "./game-button";
import { createMenuIcon } from "./icons";
import { stack } from "./layer";
import type { UiStage } from "./stage";
import { UiShaderMaterial } from "./ui-shader";

/**
 * The frame every screen past the menu shares (App.tsx `.inner-screen`): the coastal art over the
 * sky with the menu's shading (`.journey-backdrop` + `.menu-light`), and the top line: a back key,
 * the screen's headline, whatever the screen adds (研究所's coins) and the settings key at the far
 * end. The screen fills `body`.
 */
export class InnerScreenFrame {
  readonly topline = new Container({
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  });
  /** Between the headline and the settings key. */
  readonly extra = new Container({ flexDirection: "row", alignItems: "center", flexShrink: 0 });
  readonly body = new Container({ flexGrow: 1, minHeight: 0, flexDirection: "column" });
  readonly back: GameButton;
  readonly settings: GameButton;
  private readonly title: Text;
  private readonly titleShadow: Text;
  private readonly stage: UiStage;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    art: { value: Texture };
    artSize: { value: Vector2 };
    viewSize: { value: Vector2 };
  }>;
  private readonly backdrop: Mesh;

  /** `headline` null: the root screen (大厅), with neither a back key nor a headline. */
  constructor(stage: UiStage, art: Texture, headline: string | null) {
    this.stage = stage;
    const image = art.image as { width: number; height: number };
    this.material = new UiShaderMaterial("inner-backdrop", {
      uniforms: {
        art: { value: art },
        artSize: { value: new Vector2(image.width, image.height) },
        viewSize: { value: new Vector2(1, 1) },
      },
      vertexShader: `
        varying vec2 viewUv;
        void main() {
          viewUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: `
        uniform sampler2D art;
        uniform vec2 artSize;
        uniform vec2 viewSize;
        varying vec2 viewUv;
        void main() {
          // center / cover
          float scale = max(viewSize.x / artSize.x, viewSize.y / artSize.y);
          vec2 uv = (viewUv - .5) * viewSize / (artSize * scale) + .5;
          vec3 col = texture2D(art, uv).rgb;
          // .menu-light: navy 28% fading to nothing by 65% across and 34% up.
          float across = .28 * max(0., 1. - viewUv.x / .65);
          float up = .28 * max(0., 1. - viewUv.y / .34);
          vec3 navy = vec3(.004025, .016807, .049707);
          col = mix(col, navy, across);
          col = mix(col, navy, up);
          gl_FragColor = vec4(col, 1.);
          #include <colorspace_fragment>
        }`,
    });
    this.backdrop = new Mesh(this.geometry, this.material);
    this.backdrop.renderOrder = -20;
    this.backdrop.frustumCulled = false;
    stage.scene.add(this.backdrop);

    this.back = new GameButton(stage, {
      tone: "navy",
      size: "small",
      square: true,
      icon: createMenuIcon("back"),
    });
    this.settings = new GameButton(stage, {
      tone: "navy",
      size: "small",
      square: true,
      icon: createMenuIcon("settings"),
    });
    // `.game-topline h1`: ice, `text-shadow: 0 2px 0 navy-deep, 0 0 14px rgb(13 35 63 / 45%)`.
    const heading = new Container({ flexShrink: 0 });
    this.titleShadow = new Text({
      text: headline ?? "",
      fontWeight: 800,
      lineHeight: 1.2,
      color: "#0d233f",
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 2,
    });
    this.title = stack(
      new Text({ text: headline ?? "", fontWeight: 800, lineHeight: 1.2, color: "#d8effb" }),
      1,
    );
    heading.add(this.titleShadow, this.title);
    this.settings.panel.setProperties({ marginLeft: "auto" });
    if (headline === null) this.topline.add(this.extra, this.settings.panel);
    else this.topline.add(this.back.panel, heading, this.extra, this.settings.panel);
  }

  /** `.game-topline` and `.inner-screen` at this viewport; `compact` is short landscape. */
  resize(compact: boolean): void {
    const v = this.stage.viewport;
    const edge = compact ? 16 : 28;
    // --type-headline: clamp(24px, 2.6vw, 32px); 20px in short landscape.
    const headline = compact ? 20 : Math.min(32, Math.max(24, 0.026 * v.width * v.scale));
    this.title.setProperties({ fontSize: headline });
    this.titleShadow.setProperties({ fontSize: headline });
    this.topline.setProperties({
      gap: compact ? 12 : 20,
      minHeight: compact ? 0 : 100,
      paddingTop: Math.max(compact ? 8 : 20, v.safeArea.top),
      paddingBottom: compact ? 8 : 12,
      paddingLeft: Math.max(edge, v.safeArea.left),
      paddingRight: Math.max(edge, v.safeArea.right),
    });
    // `.game-topline` keys are 48 square; minimums only, raised by the touch rule at small scales.
    const key = Math.max(48, v.minTarget);
    for (const button of [this.back, this.settings])
      button.panel.setProperties({ minWidth: key, minHeight: key });
    this.material.uniforms.viewSize.value.set(v.width, v.height);
    this.backdrop.scale.set(v.width, v.height, 1);
    this.backdrop.position.set(
      this.stage.camera.left + v.width / 2,
      this.stage.camera.top - v.height / 2,
      0,
    );
  }

  /** Placement only: the screen's control loop advances the two keys' time. */
  update(): void {
    this.back.update(0);
    this.settings.update(0);
  }

  dispose(): void {
    this.back.dispose();
    this.settings.dispose();
    this.backdrop.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
