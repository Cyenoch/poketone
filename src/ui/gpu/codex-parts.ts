import { Container, Content, Image, Text } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from "three";
import type { CodexEntry } from "../../run/codex";
import type { CodexThumbs } from "./codex-model";
import type { ElementType } from "../../run/sim/content/elements";
import { itemIcon, moveIcon } from "../../screens/runArt";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { stack } from "./layer";
import type { UiMotion } from "./motion";
import { ChoiceIconPlate, typeColors } from "./run-choice-surface";
import { createStationArt } from "./station-art";

export const ink = {
  navy: "#142f50",
  deep: "#0d233f",
  blue: "#2165a4",
  blueDeep: "#173f70",
  surface: "#e9f4fb",
  ice: "#d8effb",
  line: "#92b8d1",
  muted: "#536b82",
  yellow: "#ffd45b",
  danger: "#a83243",
} as const;

const cssEase = (t: number) => cubicBezier(t, 0.25, 0.1, 0.25, 1);

/** `--type`; an entry without a type takes the muted ink. */
export function typeInk(type: ElementType | undefined): string {
  return type ? typeColors[type].type : ink.muted;
}

/** Type faces in `public/art/cards` (the set `ChoiceArt` loads). */
const cardFaces = new Set<ElementType>(["fire", "water", "grass", "electric", "normal"]);

/** Card art (`public/art/cards`): the item and training faces, else the first themed type's. */
export function cardArt(entry: Pick<CodexEntry, "art" | "types">): string {
  const face =
    entry.art.kind === "item"
      ? "item"
      : entry.art.kind === "lab"
        ? "train"
        : (entry.types.find((type) => cardFaces.has(type)) ?? "normal");
  return `/art/cards/${face}.webp`;
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

/** The entry's picture at `size`: icon on its plate, portrait, model still, or a type initial. */
export function createArt(
  entry: Pick<CodexEntry, "art" | "types" | "name" | "model">,
  size: number,
  thumbs: CodexThumbs,
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
    still.add(thumbs.mount(entry.model!));
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
    root.add(
      stack(
        new Image({
          src,
          width: Math.round(size * inset),
          height: Math.round(size * inset),
          keepAspectRatio: false,
        }),
        1,
      ),
    );
  }
  return { root, dispose: () => plate?.dispose() };
}

/** Colour properties eased like the CSS `transition: color 120ms` they replace. */
export class ColorTween {
  private readonly tracks = new Map<
    object,
    Map<string, { target: string; value: { r: number; g: number; b: number; a: number } }>
  >();
  private readonly linear = new Color();
  private readonly motion: UiMotion;
  private readonly invalidate: () => void;

  constructor(motion: UiMotion, invalidate: () => void) {
    this.motion = motion;
    this.invalidate = invalidate;
  }

  set(
    target: { setProperties(properties: Record<string, unknown>): void },
    property: "color" | "backgroundColor" | "borderColor",
    hex: string,
    animate: boolean,
  ): void {
    let properties = this.tracks.get(target);
    if (!properties) this.tracks.set(target, (properties = new Map()));
    let track = properties.get(property);
    if (track?.target === hex) return;
    const clear = hex === "transparent";
    const rgb = new Color(clear ? (track ? "#000000" : ink.navy) : hex).getRGB(
      { r: 0, g: 0, b: 0 },
      SRGBColorSpace,
    );
    const next = { ...(clear && track ? track.value : rgb), a: clear ? 0 : 1 };
    if (!track) properties.set(property, (track = { target: hex, value: { ...next } }));
    track.target = hex;
    const value = track.value;
    this.motion.animate(
      value,
      next,
      animate ? 120 : 0,
      () => {
        this.linear.setRGB(value.r, value.g, value.b, SRGBColorSpace);
        target.setProperties({
          [property]: [this.linear.r, this.linear.g, this.linear.b, value.a],
        });
        this.invalidate();
      },
      cssEase,
    );
  }

  forget(target: object): void {
    for (const track of this.tracks.get(target)?.values() ?? []) this.motion.cancel(track.value);
    this.tracks.delete(target);
  }
}
