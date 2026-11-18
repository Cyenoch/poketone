import { abortableEffect, Container, Content, Image, Text } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2, Vector3 } from "three";
import type { CodexEntry } from "../../run/codex";
import { typeNames } from "../../run/labels";
import type { CodexThumbs } from "./codex-model";
import type { ElementType } from "../../run/sim/content/elements";
import { itemIcon, moveIcon } from "../../screens/runArt";
import { BallFace, setSilhouette, silhouetteBall } from "./ball";
import { OutlineRing } from "./box-shadow";
import { CardFace } from "./dialog-surface";
import { BALL_STAGE_GLSL } from "./ball-stage";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { inheritedOpacity, stack } from "./layer";
import { LIFT, SNAP, type UiMotion } from "./motion";
import { cardFaces, ChoiceIconPlate } from "./run-choice-surface";
import { typeColors } from "./run-theme";
import { clipMain, clipVertex } from "./screen-parts";
import { SlantPlate } from "./slant-plate";
import type { UiStage } from "./stage";
import { createStationArt } from "./station-art";
import { RADIUS, RADIUS_INNER, slantOf, srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";

const cssEase = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);

/** `--type`; an entry without a type takes the muted ink. */
export function typeInk(type: ElementType | undefined): string {
  return type ? typeColors[type].type : ui.muted;
}

/**
 * `.game-ball--state`, the in-flow marker of tabs and single-select lists: always drawn, grey at 45%
 * when off, full colour when on with a 220ms pop. Same analytic ball as `createBallMark`, drawn as
 * UIKit content so it takes the layout, clipping and fade of the row it sits in.
 */
export class CodexBall {
  readonly content = new Content({
    width: 18,
    height: 18,
    flexShrink: 0,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly uniforms = { ballOn: { value: 0 } };
  private readonly state = { on: 0 };
  private readonly pop = { scale: 1 };
  private on = false;
  private readonly motion: UiMotion;
  private readonly invalidate: () => void;

  constructor(motion: UiMotion, invalidate: () => void) {
    this.motion = motion;
    this.invalidate = invalidate;
    this.material.customProgramCacheKey = () => "poketone-codex-ball";
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        "varying vec2 ballUv;\n" +
        shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\nballUv=uv;");
      shader.fragmentShader =
        "varying vec2 ballUv;\nuniform float ballOn;\n" +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          `vec2 p=(ballUv-.5)*24.; float r=length(p); float aa=.5*fwidth(r);
          float coverage=1.-smoothstep(11.75-aa,11.75+aa,r);
          vec3 deep=vec3(.051,.137,.247); vec3 col=p.y>0.?vec3(.659,.196,.263):vec3(1.);
          col=mix(col,deep,max(smoothstep(9.25-aa,9.25+aa,r),1.-smoothstep(1.25-aa,1.25+aa,abs(p.y))));
          col=mix(col,deep,1.-smoothstep(4.85-aa,4.85+aa,r));
          col=mix(col,vec3(1.),1.-smoothstep(2.35-aa,2.35+aa,r));
          col=mix(vec3(dot(col,vec3(.2126,.7152,.0722))),col,ballOn);
          diffuseColor=vec4(sRGBTransferEOTF(vec4(col,1.)).rgb,coverage*mix(.45,1.,ballOn)*opacity);`,
        );
    };
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  set(on: boolean, animate: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.motion.animate(
      this.state,
      { on: on ? 1 : 0 },
      animate ? 160 : 0,
      () => {
        this.uniforms.ballOn.value = this.state.on;
        this.invalidate();
      },
      cssEase,
    );
    if (on && animate) {
      this.pop.scale = 1.35;
      this.motion.animate(
        this.pop,
        { scale: 1 },
        220,
        () => {
          this.content.setProperties({
            transformScaleX: this.pop.scale,
            transformScaleY: this.pop.scale,
          });
          this.invalidate();
        },
        uiEaseOut,
      );
    }
  }

  dispose(): void {
    this.motion.cancel(this.state);
    this.motion.cancel(this.pop);
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The entry's picture at `size`: icon on its plate, portrait, model still, or a type initial. A
 * `silhouette` portrait or model still is drawn in ink (a partner not yet unlocked, a species
 * never met).
 */
export function createArt(
  entry: Pick<CodexEntry, "art" | "types" | "name" | "model">,
  size: number,
  thumbs: CodexThumbs,
  silhouette = false,
): { root: Container; dispose(): void } {
  const { art, types } = entry;
  if (art.kind === "station") return createStationArt(art.station, size);
  const root = new Container({
    width: size,
    height: size,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  });
  const themed = types[0] ?? null;
  let plate: ChoiceIconPlate | undefined;
  // Everything but a portrait sits on a plate; lab upgrades share the items' pocket (one list).
  if (art.kind !== "portrait") {
    plate = new ChoiceIconPlate(
      art.kind === "item" || art.kind === "lab" ? "item" : "move",
      themed,
    );
    root.add(plate.content);
  }
  if (art.kind === "model") {
    const inset = Math.round(size * 0.9);
    const still = stack(new Container({ width: inset, height: inset }), 1);
    still.add(thumbs.mount(entry.model!, silhouette));
    root.add(still);
  } else if (art.kind === "mark")
    root.add(
      stack(
        new Text({
          text: entry.name.slice(0, 1),
          fontSize: Math.round(size * 0.42),
          fontWeight: 800,
          color: typeInk(types[0]),
        }),
        1,
      ),
    );
  else {
    const src =
      art.kind === "move"
        ? moveIcon(art.move)
        : art.kind === "item"
          ? itemIcon(art.item)
          : art.kind === "lab"
            ? `/art/icons/lab/${art.lab}.webp`
            : `/art/portraits/${art.form}.webp`;
    const inset = art.kind === "portrait" ? 1 : 0.72;
    const image = new Image({
      src,
      width: Math.round(size * inset),
      height: Math.round(size * inset),
      keepAspectRatio: false,
    });
    if (silhouette) setSilhouette(image, true, src);
    root.add(stack(image, 1));
  }
  return { root, dispose: () => plate?.dispose() };
}

/** Types with a crest (`public/art/icons/crests`): every card face but the normal one. */
const crested = new Set<ElementType>([...cardFaces].filter((type) => type !== "normal"));

/** What a 图鉴 control shows: pointer, keyboard and gamepad state, and whether it is the pick. */
export interface CodexPaint {
  selected: boolean;
  hovered: boolean;
  focused: boolean;
  focusVisible: boolean;
  pressed: boolean;
}

/**
 * A list row: an upright white card (radius 6, hard shadow) holding the entry's picture and name.
 * A Pokémon stands on its Poké Ball badge, whose upper half turns ball red with a type ring when
 * picked. Hover lifts the row 3px; the pick turns it ink (label white) and lifts it 5px; a press
 * sinks it 1px; keyboard focus rings it.
 */
export class CodexRow {
  readonly panel: Container;
  private readonly face: CardFace;
  private readonly ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
  private readonly label: Text;
  private readonly ball: BallFace | null = null;
  private readonly art: { dispose(): void };
  private readonly stage: UiStage;
  private readonly pose = { ink: 0, lift: 0 };
  private readonly silhouette: boolean;
  private target = "";

  /** `silhouette`: a partner not yet unlocked, its portrait in ink on a grey ball. */
  constructor(stage: UiStage, entry: CodexEntry, thumbs: CodexThumbs, silhouette = false) {
    this.silhouette = silhouette;
    this.stage = stage;
    this.panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingX: 10,
      paddingY: 4,
      flexShrink: 0,
    });
    this.face = new CardFace(this.panel, { fill: ui.white });
    this.face.set({ depth: 2 });
    this.ring.content.setProperties({ display: "none" });
    this.panel.add(this.face.content, stack(this.ring.content, 2));
    if (entry.art.kind === "portrait") {
      // The badge: a ball with the portrait standing on it, over its rim.
      const badge = stack(
        new Container({
          width: 36,
          height: 36,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
        }),
        1,
      );
      this.ball = new BallFace(badge, {
        top: ui.white,
        bottom: ui.white,
        ink: ui.ink,
        line: 2.5,
        button: 0,
        buttonFace: ui.white,
        ...(silhouette ? silhouetteBall : {}),
      });
      // A silhouette stays inside its grey ball, so the picked (ink) row does not swallow it.
      const art = createArt(entry, silhouette ? 30 : 42, thumbs, silhouette);
      if (!silhouette) art.root.setProperties({ marginTop: -10 });
      badge.add(this.ball.content, stack(art.root, 1));
      this.art = art;
      this.panel.add(badge);
    } else {
      const art = createArt(entry, 36, thumbs, silhouette);
      this.art = art;
      this.panel.add(stack(art.root, 1));
    }
    this.label = stack(
      new Text({
        text: entry.name,
        fontSize: 15,
        fontWeight: 800,
        color: ui.ink,
        flexShrink: 1,
        minWidth: 0,
      }),
      1,
    );
    this.panel.add(this.label);
  }

  /** Touch rule: at least `minTarget` stage units tall. */
  fitTouch(minTarget: number): void {
    this.panel.setProperties({ minHeight: Math.max(48, minTarget) });
  }

  paint(state: CodexPaint, animate: boolean): void {
    const { selected, hovered, focused, focusVisible, pressed } = state;
    this.ring.content.setProperties({ display: focused && focusVisible ? "flex" : "none" });
    if (!this.silhouette) this.ball?.setLook({ top: selected ? ui.ball : ui.white });
    const lift = pressed ? -LIFT.press : selected ? LIFT.picked : hovered ? LIFT.hover : 0;
    const ink = selected ? 1 : 0;
    const key = `${lift}|${ink}`;
    if (key === this.target) return this.stage.invalidate();
    // The first paint lands on the state; later changes move.
    const duration = !animate || this.target === "" ? 0 : ink !== this.pose.ink ? 220 : LIFT.ms;
    this.target = key;
    this.stage.motion.animate(this.pose, { ink, lift }, duration, this.apply, SNAP);
  }

  private readonly apply = (): void => {
    // UIKit compares colours by reference: a new one per change.
    const fill = new Color(ui.white).lerp(new Color(ui.ink), this.pose.ink);
    this.face.set({ fill: `#${fill.getHexString()}`, depth: 2 + Math.max(0, this.pose.lift) });
    this.panel.setProperties({ transformTranslateY: -this.pose.lift });
    this.label.setProperties({ color: new Color(ui.ink).lerp(new Color(ui.white), this.pose.ink) });
    this.stage.invalidate();
  };

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    this.face.dispose();
    this.ring.dispose();
    this.ball?.dispose();
    this.art.dispose();
  }
}

/**
 * A link on a page (an evolution, a learner, a fusion): an upright white card with a line frame,
 * the target's picture and name. Hover lifts it 3px and inks its frame; a press sinks it 1px;
 * keyboard focus rings it. The page's own entry is the ink card and not a link.
 */
export class CodexChip {
  readonly panel: Container;
  private readonly face: CardFace;
  private readonly ring = new OutlineRing(RADIUS, ui.ink, 2.5, 3);
  private readonly stage: UiStage;
  private readonly pose = { lift: 0 };
  private readonly self: boolean;
  private target = "";
  private readonly owned: { dispose(): void }[] = [];

  constructor(
    stage: UiStage,
    target: CodexEntry | undefined,
    text: string,
    note: string | undefined,
    self: boolean,
    thumbs: CodexThumbs,
    silhouette = false,
  ) {
    this.stage = stage;
    this.self = self;
    // An ink silhouette would vanish on the page's own ink card: that card shows the name only.
    const art = target && !(self && silhouette);
    this.panel = new Container({
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingLeft: art ? 6 : 12,
      paddingRight: 12,
      flexShrink: 0,
    });
    this.face = new CardFace(this.panel, {
      fill: self ? ui.ink : ui.white,
      border: { color: self ? ui.ink : ui.line, width: 2 },
    });
    this.face.set({ depth: 2 });
    this.ring.content.setProperties({ display: "none" });
    this.panel.add(this.face.content, stack(this.ring.content, 2));
    this.owned.push(this.face, this.ring);
    if (art) {
      const picture = createArt(target, 30, thumbs, silhouette);
      this.owned.push(picture);
      this.panel.add(stack(picture.root, 1));
    }
    this.panel.add(
      stack(
        new Text({
          text,
          fontSize: 15,
          fontWeight: 800,
          color: self ? ui.white : ui.ink,
          wordBreak: "keep-all",
        }),
        1,
      ),
    );
    if (note)
      this.panel.add(
        stack(
          new Text({
            text: note,
            fontSize: 12,
            fontWeight: 700,
            color: self ? ui.line : ui.muted,
            wordBreak: "keep-all",
          }),
          1,
        ),
      );
  }

  fitTouch(minTarget: number): void {
    this.panel.setProperties({ minHeight: Math.max(44, minTarget) });
  }

  paint(state: CodexPaint, animate: boolean): void {
    if (this.self) return;
    const { hovered, focused, focusVisible, pressed } = state;
    const keyed = focused && focusVisible;
    this.ring.content.setProperties({ display: keyed ? "flex" : "none" });
    this.face.set({ border: hovered || keyed ? ui.ink : ui.line });
    const lift = pressed ? -LIFT.press : hovered ? LIFT.hover : 0;
    const key = `${lift}`;
    if (key === this.target) return this.stage.invalidate();
    const duration = !animate || this.target === "" ? 0 : LIFT.ms;
    this.target = key;
    this.stage.motion.animate(
      this.pose,
      { lift },
      duration,
      () => {
        this.face.set({ depth: 2 + Math.max(0, this.pose.lift) });
        this.panel.setProperties({ transformTranslateY: -this.pose.lift });
        this.stage.invalidate();
      },
      SNAP,
    );
  }

  dispose(): void {
    this.stage.motion.cancel(this.pose);
    for (const owned of this.owned) owned.dispose();
  }
}

/** A type label: an ink slanted chip with the type's crest (else a gem in its colour) and name. */
export function typeChip(type: ElementType, compact: boolean): { tag: Container; dispose(): void } {
  const height = compact ? 26 : 30;
  const lean = slantOf(height) / 2;
  const crest = crested.has(type);
  const tag = new Container({
    height,
    paddingX: 10 + lean,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
  });
  const plate = new SlantPlate(tag, { fill: ui.ink }, RADIUS_INNER);
  plate.set({ depth: 3 });
  tag.add(plate.content);
  // The crest, or (a type without one) a gem in the type's colour.
  tag.add(
    stack(
      crest
        ? new Image({
            src: `/art/icons/crests/${type}.webp`,
            width: compact ? 20 : 22,
            height: compact ? 20 : 22,
            flexShrink: 0,
          })
        : new Container({
            width: 9,
            height: 9,
            backgroundColor: typeColors[type].type,
            transformRotateZ: 45,
            flexShrink: 0,
          }),
      1,
    ),
  );
  tag.add(
    stack(
      new Text({
        text: typeNames[type],
        fontSize: compact ? 13 : 14,
        fontWeight: 800,
        color: ui.white,
        wordBreak: "keep-all",
      }),
      1,
    ),
  );
  return { tag, dispose: () => plate.dispose() };
}

/**
 * The ground a page's model or portrait stands on: the lobby's line-drawn Poké Ball stage (pool of
 * type light, dashed ring, red rim, ink seam and button), still, at the bottom of its box. Only
 * what differs from the paper is drawn; it follows its box's size, fade and the pane's clipping.
 */
export class BallGround {
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
    boxSize: { value: Vector2 };
    typeColor: { value: Vector3 };
    opacity: { value: number };
  }>;

  constructor(type: string) {
    this.material = new UiShaderMaterial("codex-ground", {
      uniforms: {
        boxSize: { value: new Vector2(1, 1) },
        typeColor: { value: srgb(type) },
        opacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 groundUv;
        ${clipVertex}
        void main() { groundUv = uv; ${clipMain} }`,
      fragmentShader: /* glsl */ `
        uniform vec2 boxSize;
        uniform vec3 typeColor;
        uniform float opacity;
        varying vec2 groundUv;
        #include <clipping_planes_pars_fragment>
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        ${BALL_STAGE_GLSL}
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(groundUv.x, 1. - groundUv.y) * boxSize;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float rx = min(boxSize.x * .4, boxSize.y * .6);
          vec2 centre = vec2(boxSize.x * .5, boxSize.y - .46 * rx - 2.);
          vec3 paper = ${glslColor(ui.paper)};
          vec3 col = ballStage(paper, p, centre, rx, 0., typeColor, aa);
          float a = clamp(length(col - paper) * 8., 0., 1.);
          if (a <= 0.) discard;
          gl_FragColor = vec4(toLinear(col), a * opacity);
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    abortableEffect(() => {
      this.material.uniforms.opacity.value = inheritedOpacity(this.content);
      const s = this.content.size.value;
      if (s) this.material.uniforms.boxSize.value.set(s[0], s[1]);
    }, this.content.abortSignal);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function glslColor(hex: string): string {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
}
