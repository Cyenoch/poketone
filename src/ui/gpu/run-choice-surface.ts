import { Content, abortableEffect } from "@pmndrs/uikit";
import {
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
} from "three";
import { images } from "../../prepare/images";
import type { ElementType } from "../../run/sim/content/elements";
import { crispLineGlsl } from "./crisp-line";
import { typeColors } from "./run-theme";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, SLANT, ui } from "./tokens";

/**
 * GPU paint for the choice cards.
 * Every surface draws its CSS box-shadows, outlines and decorations outside its own layout box by
 * enlarging its quad in the vertex shader (like box-shadow.ts), so nothing here adds scrollable
 * overflow, and each one draws in its own element's layer: a card's glow covers its neighbour the
 * way the later card's box-shadow does in CSS. All colour math is in sRGB like CSS.
 */

export type CardKind = "move" | "item" | "train";
export type CardTone = "new" | "common" | "rare" | "epic" | "legendary" | "train";
export interface ChoiceCardStyle {
  kind: CardKind;
  tone: CardTone;
  type: ElementType | null;
}

/** A move type's soft face (`--type-soft`). */
export function softOf(type: ElementType): string {
  return typeColors[type].soft;
}
/** The level-up cards' rarity colours, 普通 to 传说 (`rarityNames` order). */
export const rarityTones = {
  common: "#9fb4c6",
  rare: "#3c8ee0",
  epic: "#a35ce0",
  legendary: "#f2a60f",
} as const;
/** `--tone`: the rarity colour, else the type colour (新), else `--line`. */
export function toneColor(style: ChoiceCardStyle): string {
  if (style.tone in rarityTones) return rarityTones[style.tone as keyof typeof rarityTones];
  return style.type ? typeColors[style.type].type : "#92b8d1";
}

/** sRGB components without colour management: the shaders blend in sRGB like CSS. */
export function srgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
function mixHex(a: string, b: string, amountA: number): Vector3 {
  return srgb(a)
    .multiplyScalar(amountA)
    .add(srgb(b).multiplyScalar(1 - amountA));
}

/** Type faces in `public/art/cards`; a move of any other type takes the normal face. */
export const cardFaces: ReadonlySet<ElementType> = new Set<ElementType>([
  "fire",
  "water",
  "grass",
  "electric",
  "normal",
  "ghost",
  "dragon",
  "fighting",
  "poison",
  "flying",
  "psychic",
  "rock",
  "ground",
]);

/** Card art (public/art/cards), loaded once per overlay layer so a deal never shows an empty face. */
export class ChoiceArt {
  private readonly textures = new Map<string, Texture>();
  constructor(onLoad: () => void) {
    for (const name of [...cardFaces, "item", "train"])
      this.textures.set(name, images().texture(`/art/cards/${name}.webp`, "art", onLoad));
  }
  get(name: string): Texture {
    return this.textures.get(name) ?? this.textures.get("normal")!;
  }
  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
  }
}

const prelude = `
  ${crispLineGlsl}
  float sdRoundBox(vec2 p,vec2 h,float r){r=min(r,min(h.x,h.y));vec2 q=abs(p)-h+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
  float erfApprox(float x){float t=1./(1.+.3275911*abs(x));return sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-x*x));}
  float shadowCover(float d,float blur,float aa){if(blur<=.01)return 1.-smoothstep(-aa,aa,d);return .5*(1.-erfApprox(d/(blur*.70710678)));}
  float perimeter(vec2 p,vec2 h,float r){
    float a=h.y-r,b=h.x-r;float quarter=a+b+1.57079633*r;vec2 q=abs(p);
    float s=q.y<a?q.y:q.x>b?a+atan(q.y-a,q.x-b)*r:a+1.57079633*r+b-q.x;
    return p.x>=0.?(p.y>=0.?s:4.*quarter-s):(p.y>=0.?2.*quarter-s:2.*quarter+s);
  }
  vec3 toLinear(vec3 c){return sRGBTransferEOTF(vec4(c,1.)).rgb;}
  vec3 toSrgb(vec3 c){return sRGBTransferOETF(vec4(c,1.)).rgb;}
  void over(inout vec4 acc,vec3 ink,float alpha){acc=vec4(ink*alpha,alpha)+acc*(1.-alpha);}
  vec3 softLight(vec3 b,vec3 s){
    vec3 d=mix(sqrt(b),((16.*b-12.)*b+4.)*b,step(b,vec3(.25)));
    return mix(b+(2.*s-1.)*(d-b),b-(1.-2.*s)*b*(1.-b),step(s,vec3(.5)));
  }
`;

/** A quad drawn `reach` px beyond its layout box; `boxPoint` is CSS px from the box's top-left. */
abstract class BoxSurface {
  readonly content: Content;
  protected readonly geometry = new PlaneGeometry(1, 1);
  protected readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  protected readonly boxSize = { value: new Vector2(1, 1) };
  constructor(
    key: string,
    reach: number,
    uniforms: Record<string, { value: unknown }>,
    body: string,
    functions = "",
  ) {
    this.material.customProgramCacheKey = () => `poketone-choice-${key}`;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms, { boxSize: this.boxSize });
      shader.vertexShader =
        "uniform vec2 boxSize;varying vec2 boxPoint;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `vec3 transformed=vec3(position.xy*(boxSize+${2 * reach}.)/boxSize,position.z);
          boxPoint=vec2(position.x,-position.y)*(boxSize+${2 * reach}.)+boxSize*.5;`,
        );
      const declarations = Object.entries(uniforms)
        .map(([name, uniform]) => `uniform ${glslType(uniform.value, name)};`)
        .join("");
      shader.fragmentShader =
        `uniform vec2 boxSize;varying vec2 boxPoint;${declarations}${prelude}${functions}\n` +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          vec2 p=boxPoint,h=boxSize*.5,c=p-h;float aa=.5*max(fwidth(p.x),fwidth(p.y));vec4 acc=vec4(0.);
          ${body}
          diffuseColor=vec4(toLinear(acc.a>0.?acc.rgb/acc.a:vec3(0.)),acc.a*opacity);`,
        );
    };
    this.content = new Content({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      keepAspectRatio: false,
      depthTest: false,
    });
    const mesh = new Mesh(this.geometry, this.material);
    // The vertex shader draws past the layout box, so the box alone must not decide culling.
    mesh.frustumCulled = false;
    this.content.add(mesh);
    this.content.notifyAncestorsChanged();
    abortableEffect(() => {
      const size = this.content.size.value;
      if (size) this.boxSize.value.set(Math.max(1, size[0]), Math.max(1, size[1]));
    }, this.content.abortSignal);
  }
  dispose(): void {
    this.content.removeFromParent();
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

function glslType(value: unknown, name: string): string {
  if (Array.isArray(value)) {
    const first = value[0];
    return `${first instanceof Vector4 ? "vec4" : "vec3"} ${name}[${value.length}]`;
  }
  if (value instanceof Vector4) return `vec4 ${name}`;
  if (value instanceof Vector3) return `vec3 ${name}`;
  if (value instanceof Vector2) return `vec2 ${name}`;
  return `float ${name}`;
}

/** One CSS box-shadow layer: y offset, blur radius, spread; premultiplied sRGB ink. */
interface ShadowLayer {
  y: number;
  blur: number;
  spread: number;
  ink: string;
  alpha: number;
}
const none: ShadowLayer = { y: 0, blur: 0, spread: 0, ink: "#000000", alpha: 0 };
function writeLayers(layers: ShadowLayer[], shape: Vector3[], ink: Vector4[]): void {
  layers.forEach((layer, i) => {
    shape[i]!.set(layer.y, layer.blur, layer.spread);
    const c = srgb(layer.ink).multiplyScalar(layer.alpha);
    ink[i]!.set(c.x, c.y, c.z, layer.alpha);
  });
}

/**
 * The card (2026-11 redesign): a paper face tinted by the card art (soft-light), a slanted type
 * plate across the head's left (cut at −14°) carrying the kind chip, a rim in the rarity colour
 * (ink for training and new moves), the hard shadow, the epic/legendary glow and legendary sweep,
 * the pick's white ring and type glow, the banish dashes and a white keyboard focus ring.
 */
export class ChoiceCardSurface extends BoxSurface {
  private readonly values: {
    veil: { value: number };
    sweep: { value: number };
    focusRing: { value: number };
    banish: { value: number };
    pick: { value: number };
    band: { value: number };
    frame: { value: number };
  };
  constructor(style: ChoiceCardStyle, art: ChoiceArt) {
    const { kind, tone } = style;
    const type = style.type ? typeColors[style.type] : null;
    const toneHex = toneColor(style);
    const face = kind === "move" ? type!.soft : kind === "item" ? "#f6eedd" : ui.mist;
    const plate = kind === "move" ? type!.type : kind === "item" ? ui.ink : "#5d7389";
    const rated = kind === "move" || kind === "item";
    const rim = rated && tone in rarityTones ? toneHex : ui.ink;
    const legendary = rated && tone === "legendary";
    const tint = tone === "legendary" ? 0.75 : tone === "epic" ? 0.6 : tone === "rare" ? 0.5 : 0.38;
    const base: ShadowLayer[] =
      rated && tone === "epic"
        ? [none, { y: 0, blur: 14, spread: 1, ink: toneHex, alpha: 0.6 }, none]
        : legendary
          ? [
              none,
              { y: 0, blur: 0, spread: 2, ink: "#ffffff", alpha: 1 },
              { y: 0, blur: 22, spread: 3, ink: toneHex, alpha: 0.7 },
            ]
          : [none, none, none];
    const picked: ShadowLayer[] = [
      none,
      { y: 0, blur: 0, spread: 4, ink: "#ffffff", alpha: 1 },
      { y: 0, blur: 26, spread: 8, ink: type?.type ?? toneHex, alpha: 0.8 },
    ];
    const shapeA = [new Vector3(), new Vector3(), new Vector3()],
      inkA = [new Vector4(), new Vector4(), new Vector4()],
      shapeB = [new Vector3(), new Vector3(), new Vector3()],
      inkB = [new Vector4(), new Vector4(), new Vector4()];
    writeLayers(base, shapeA, inkA);
    writeLayers(picked, shapeB, inkB);
    if (legendary) {
      const ring = mixHex(toneHex, "#ffffff", 0.7);
      inkA[1]!.set(ring.x, ring.y, ring.z, 1);
    }
    const values = {
      veil: { value: 0 },
      sweep: { value: -1.3 },
      focusRing: { value: 0 },
      banish: { value: 0 },
      pick: { value: 0 },
      band: { value: 34 },
      frame: { value: 3 },
    };
    const uniforms = {
      ...values,
      face: { value: srgb(face) },
      plateInk: { value: srgb(plate) },
      rimInk: { value: srgb(rim) },
      shapeA: { value: shapeA },
      inkA: { value: inkA },
      shapeB: { value: shapeB },
      inkB: { value: inkB },
    };
    super(
      `card-${kind}-${tone}`,
      64,
      uniforms,
      `
      float radius=${RADIUS}.;
      float d=sdRoundBox(c,h,radius);
      over(acc,vec3(0.),${HARD_SHADOW.alpha}*(1.-pick)*(1.-smoothstep(-aa,aa,sdRoundBox(c-vec2(${HARD_SHADOW.offset}.),h,radius))));
      for(int i=2;i>=0;i--){
        vec3 g=mix(shapeA[i],shapeB[i],pick);vec4 ink=mix(inkA[i],inkB[i],pick);
        float cover=shadowCover(sdRoundBox(c-vec2(0.,g.x),h,radius)-g.z,g.y,aa)*ink.a;
        over(acc,ink.a>0.?ink.rgb/ink.a:vec3(0.),cover);
      }
      acc*=smoothstep(-aa,aa,d);
      over(acc,vec3(1.),focusRing*smoothstep(3.-aa,3.+aa,d)*(1.-smoothstep(6.-aa,6.+aa,d)));
      float dashIn=crispLine(2.,2.*aa),dashOut=dashIn+crispLine(3.,2.*aa);
      float dash=smoothstep(dashIn-aa,dashIn+aa,d)*(1.-smoothstep(dashOut-aa,dashOut+aa,d));
      dash*=step(mod(perimeter(c,h+3.5,radius+3.5),15.),9.);
      over(acc,vec3(.658824,.196078,.262745),banish*dash);
      vec2 pb=p-vec2(frame),ps=boxSize-2.*frame;
      vec2 artUv=(pb-ps*.5)/max(ps.x,ps.y)+.5;
      vec3 art=toSrgb(texture2D(map,vec2(artUv.x,1.-artUv.y)).rgb);
      vec3 col=mix(face,softLight(face,art),${tint.toFixed(2)});
      col=mix(col,vec3(1.),.3*veil);
      ${
        legendary
          ? `float sw=ps.x*.45;float xl=pb.x-sweep*sw+${SLANT.toFixed(6)}*(pb.y-ps.y*.5);
             float t=dot(vec2(xl,pb.y)-vec2(sw,ps.y)*.5,vec2(.984808,.173648))/(sw*.984808+ps.y*.173648)+.5;
             col=mix(col,vec3(1.),.6*max(0.,1.-abs(t*2.-1.))*step(0.,xl)*step(xl,sw));`
          : ""
      }
      // The head's slanted plate: from the left edge to a −14° cut, the card art over its colour.
      float plateRight=clamp(ps.x*.46,52.,150.)+(band-pb.y)*${SLANT.toFixed(6)};
      float inPlate=(1.-smoothstep(-aa,aa,pb.x-plateRight))*(1.-smoothstep(-aa,aa,pb.y-band));
      vec3 plateCol=mix(plateInk,softLight(plateInk,art),.85);
      col=mix(col,plateCol,inPlate);
      float inner=sdRoundBox(c,h-frame,max(radius-frame,0.));
      col=mix(col,rimInk,smoothstep(-aa,aa,inner));
      float inside=1.-smoothstep(-aa,aa,d);
      acc=vec4(col*inside,inside)+acc*(1.-inside);
    `,
    );
    // The art rides in the material's own map slot (its sampler is `map`), so a context-loss release
    // of the stage sees the textures cards hold; ChoiceArt.releaseUploads covers the rest.
    this.material.map = art.get(kind === "move" ? style.type! : kind);
    this.values = values;
  }
  /** Head plate height and rim width for the current layout. */
  setMetrics(band: number, frame: number): void {
    this.values.band.value = band;
    this.values.frame.value = frame;
  }
  setVeil(veil: number): void {
    this.values.veil.value = veil;
  }
  setSweep(position: number): void {
    this.values.sweep.value = position;
  }
  setFocusRing(on: boolean): void {
    this.values.focusRing.value = on ? 1 : 0;
  }
  setBanish(on: boolean): void {
    this.values.banish.value = on ? 1 : 0;
  }
  /** 0–1 toward the pick's ring and type glow. */
  setPick(amount: number): void {
    this.values.pick.value = amount;
  }
}

/** The card's icon plate: the move's round type plate, the item's paper pocket; ink rims. */
export class ChoiceIconPlate extends BoxSurface {
  constructor(kind: "move" | "item", type: ElementType | null) {
    const ink = type ? typeColors[type].type : "#92b8d1";
    super(
      `icon-${kind}`,
      2,
      {
        plateEdge: { value: mixHex(ink, ui.ink, 0.55) },
        plateTint: { value: mixHex(ink, "#ffffff", 0.28) },
      },
      kind === "move"
        ? `float d=length(c)-min(h.x,h.y);
           float t=clamp(length(p-boxSize*vec2(.5,.4))/length(boxSize*vec2(.5,.6)),0.,1.);
           vec3 col=mix(vec3(1.),plateTint,t);
           float edge=crispLine(2.,2.*aa);
           col=mix(col,plateEdge,smoothstep(-edge-aa,-edge+aa,d));
           over(acc,col,1.-smoothstep(-aa,aa,d));`
        : `float d=sdRoundBox(c,h,${RADIUS_INNER}.);
           vec3 col=vec3(1.);
           float edge=crispLine(2.,2.*aa);
           col=mix(col,${glslHex(ui.ink)},smoothstep(-edge-aa,-edge+aa,d));
           over(acc,col,1.-smoothstep(-aa,aa,d));`,
    );
  }
}

function glslHex(hex: string): string {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
}
