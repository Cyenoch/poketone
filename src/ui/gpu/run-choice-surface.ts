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
import { themeGrain } from "./run-overlays-surface";

/**
 * GPU paint for the choice window (run-screen.css `.run-card`, `.choice-banner`, `.game-button`).
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

/** Element accents (DESIGN.md › type-*): the type colour and its soft face. */
export const typeColors: Record<ElementType, { type: string; soft: string }> = {
  fire: { type: "#f0702e", soft: "#ffe2cf" },
  water: { type: "#2f8fe0", soft: "#d6ecff" },
  grass: { type: "#3e9e3a", soft: "#dcf3d2" },
  electric: { type: "#d9a400", soft: "#fff2c2" },
  normal: { type: "#8a8574", soft: "#efece4" },
  poison: { type: "#9a4fc7", soft: "#f0dcfa" },
  bug: { type: "#7f9a1c", soft: "#eef3cf" },
  flying: { type: "#6f86d0", soft: "#e3e9fa" },
  rock: { type: "#a8913a", soft: "#f2ebcf" },
  ground: { type: "#c07a3e", soft: "#f8e6d4" },
  fighting: { type: "#c4402f", soft: "#f8dcd6" },
  psychic: { type: "#e5487a", soft: "#fde0ea" },
  ghost: { type: "#6b5a9e", soft: "#e6e0f4" },
  fairy: { type: "#e07cb4", soft: "#fce4f1" },
  steel: { type: "#62869c", soft: "#e1e9ef" },
  ice: { type: "#5caab8", soft: "#e3f7fa" },
  dragon: { type: "#5640d8", soft: "#e1dcfb" },
};

export interface ThemeColors {
  theme: string;
  deep: string;
  light: string;
  soft: string;
}
/**
 * The run themes (DESIGN.md › 主题): a starter type's colour and soft face (`typeColors`) with its
 * deep and light steps. Normal and poison are the steps a station paints move types with.
 */
const themeSteps: Partial<Record<ElementType, { deep: string; light: string }>> = {
  fire: { deep: "#9c3412", light: "#ffb36b" },
  grass: { deep: "#1f5e22", light: "#9be07a" },
  water: { deep: "#164f8c", light: "#8fd0ff" },
  electric: { deep: "#7d5a00", light: "#ffe45c" },
  normal: { deep: "#5f5a4e", light: "#d1cabb" },
  poison: { deep: "#60307e", light: "#ddb5ed" },
};
const runThemes = new Map<ElementType, ThemeColors>();

/** A type's theme steps; types without their own use normal's. */
export function themeColors(type: ElementType): ThemeColors {
  const own: ElementType = themeSteps[type] ? type : "normal";
  let theme = runThemes.get(own);
  if (!theme) {
    const { type: colour, soft } = typeColors[own];
    runThemes.set(own, (theme = { theme: colour, soft, ...themeSteps[own]! }));
  }
  return theme;
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

/** Card art (public/art/cards), loaded once per overlay layer so a deal never shows an empty face. */
export class ChoiceArt {
  private readonly textures = new Map<string, Texture>();
  constructor(onLoad: () => void) {
    for (const name of ["fire", "water", "grass", "electric", "normal", "item", "train"])
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
const windowShadow: ShadowLayer = { y: 12, blur: 32, spread: 0, ink: "#0d233f", alpha: 0.25 };
function writeLayers(layers: ShadowLayer[], shape: Vector3[], ink: Vector4[]): void {
  layers.forEach((layer, i) => {
    shape[i]!.set(layer.y, layer.blur, layer.spread);
    const c = srgb(layer.ink).multiplyScalar(layer.alpha);
    ink[i]!.set(c.x, c.y, c.z, layer.alpha);
  });
}

/** The item flap's lower edge: a half-ellipse (border-radius 0 0 50% 50% / 0 0 14px 14px). */
const flapDistance = `
  float flap(vec2 q,float a,float cy,float w){
    if(q.y<cy)return max(-q.y,max(-q.x,q.x-w));
    vec2 uv=vec2((q.x-a)/a,(q.y-cy)/14.);float f=length(uv);
    vec2 g=vec2(uv.x/a,uv.y/14.)/max(f,1e-4);
    return (f-1.)/max(length(g),1e-4);
  }
`;

/** The card's face, header band, frame, box-shadows (rarity glow, pick flash) and outlines. */
export class ChoiceCardSurface extends BoxSurface {
  private readonly values: {
    veil: { value: number };
    fx: { value: Vector2 };
    fxOn: { value: number };
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
    const face = kind === "move" ? type!.soft : kind === "item" ? "#f3e3c3" : "#e3e8ee";
    // Rarity glows on move and item cards alike (the item keeps its leather face and frame).
    const rated = kind === "move" || kind === "item";
    const legendary = rated && tone === "legendary";
    const common = kind === "move" && tone === "common";
    const fade =
      kind !== "move"
        ? 0
        : tone === "common"
          ? 0.72
          : tone === "epic"
            ? 0.22
            : tone === "legendary"
              ? 0.06
              : 0.5;
    const base: ShadowLayer[] =
      rated && tone === "epic"
        ? [windowShadow, { y: 0, blur: 14, spread: 1, ink: toneHex, alpha: 0.6 }, none]
        : legendary
          ? [
              windowShadow,
              { y: 0, blur: 0, spread: 2, ink: "#ffffff", alpha: 1 },
              { y: 0, blur: 22, spread: 3, ink: toneHex, alpha: 0.7 },
            ]
          : [windowShadow, none, none];
    const picked: ShadowLayer[] = [
      windowShadow,
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
      // 0 0 0 2px color-mix(in srgb, var(--tone) 70%, #fff)
      const ring = mixHex(toneHex, "#ffffff", 0.7);
      inkA[1]!.set(ring.x, ring.y, ring.z, 1);
    }
    const values = {
      veil: { value: 0 },
      fx: { value: new Vector2() },
      fxOn: { value: 0 },
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
      tone: { value: srgb(toneHex) },
      typeInk: { value: srgb(type?.type ?? toneHex) },
      shapeA: { value: shapeA },
      inkA: { value: inkA },
      shapeB: { value: shapeB },
      inkB: { value: inkB },
    };
    const radius = kind === "item" ? 4 : 10;
    const frameInk =
      kind === "item" ? "vec3(.290196,.196078,.094118)" : "vec3(.078431,.184314,.313725)";
    const band =
      kind === "move"
        ? `if(pb.y<band){col=pb.y<5.?tone:typeInk;col=mix(col,navy,step(band-2.,pb.y));}`
        : kind === "train"
          ? `if(pb.y<band){vec2 bs=vec2(ps.x,band);float L=(bs.x+bs.y)*.70710678;
              float m=mod(dot(pb-bs*.5,vec2(-.70710678))+L*.5,16.);
              float stripe=smoothstep(7.5,8.5,m)*(1.-smoothstep(15.5,16.,m));
              col=mix(vec3(.364706,.450980,.537255),vec3(.431373,.517647,.6),stripe);
              col=mix(col,navy,step(band-2.,pb.y));}`
          : `
            float fh=band+6.,a=ps.x*.5,cy=fh-14.;
            float flapIn=1.-smoothstep(-aa,aa,flap(pb,a,cy,ps.x));
            float flapUp=1.-smoothstep(-aa,aa,flap(pb+vec2(0.,2.),a,cy,ps.x));
            float flapDown=1.-smoothstep(-aa,aa,flap(pb-vec2(0.,2.),a,cy,ps.x));
            col=mix(col,vec3(.290196,.196078,.094118),(1.-flapIn)*flapDown*.25);
            vec3 flapInk=${tone === "legendary" ? "vec3(.878431,.603922,.070588)" : "vec3(.611765,.415686,.2)"};
            float r=length(pb-vec2(a,fh-9.));
            vec4 rivet=vec4(1.,.878431,.541176,1.);
            rivet=mix(rivet,vec4(.352941,.227451,.078431,1.),smoothstep(3.,3.5,r));
            rivet.a*=1.-smoothstep(5.,5.5,r);
            flapInk=mix(flapInk,rivet.rgb,rivet.a);
            flapInk=mix(flapInk,vec3(.290196,.196078,.094118),1.-flapUp);
            col=mix(col,flapInk,flapIn);
            float sd=sdRoundBox(pb-ps*.5,ps*.5-4.,2.);
            float seam=smoothstep(-2.-aa,-2.+aa,sd)*(1.-smoothstep(-aa,aa,sd));
            seam*=step(mod(perimeter(pb-ps*.5,ps*.5-5.,1.),10.),6.);
            col=mix(col,vec3(.352941,.227451,.078431),seam*.55);`;
    super(
      `card-${kind}-${tone}`,
      64,
      uniforms,
      `
      vec3 navy=vec3(.078431,.184314,.313725);
      float radius=${radius}.;
      float d=sdRoundBox(c,h,radius);
      for(int i=2;i>=0;i--){
        vec3 g=mix(shapeA[i],shapeB[i],pick);vec4 ink=mix(inkA[i],inkB[i],pick);
        float cover=shadowCover(sdRoundBox(c-vec2(0.,g.x),h,radius)-g.z,g.y,aa)*ink.a;
        over(acc,ink.a>0.?ink.rgb/ink.a:vec3(0.),cover);
      }
      acc*=smoothstep(-aa,aa,d);
      over(acc,vec3(1.,.831373,.356863),focusRing*smoothstep(3.-aa,3.+aa,d)*(1.-smoothstep(6.-aa,6.+aa,d)));
      float dashIn=crispLine(2.,2.*aa),dashOut=dashIn+crispLine(3.,2.*aa);
      float dash=smoothstep(dashIn-aa,dashIn+aa,d)*(1.-smoothstep(dashOut-aa,dashOut+aa,d));
      dash*=step(mod(perimeter(c,h+3.5,radius+3.5),15.),9.);
      over(acc,vec3(.658824,.196078,.262745),banish*dash);
      vec2 pb=p-vec2(frame),ps=boxSize-2.*frame;
      float artSize=${legendary ? "ps.y*1.16" : "max(ps.x,ps.y)"};
      vec2 artUv=(pb-ps*.5)/artSize+.5;
      vec3 art=toSrgb(texture2D(map,vec2(artUv.x,1.-artUv.y)).rgb);
      ${
        common
          ? `float l=dot(art,vec3(.3,.59,.11));vec3 lc=face+(l-dot(face,vec3(.3,.59,.11)));
             float n=min(lc.r,min(lc.g,lc.b)),x=max(lc.r,max(lc.g,lc.b));
             if(n<0.)lc=l+(lc-l)*l/(l-n);if(x>1.)lc=l+(lc-l)*(1.-l)/(x-l);art=lc;`
          : ""
      }
      vec3 col=mix(art,face,${fade.toFixed(2)});
      col=mix(col,vec3(1.),.45*veil);
      vec2 tile=mod(pb-fx,vec2(84.,42.));
      float balls=0.;
      for(int i=0;i<3;i++){
        vec2 q=tile-(i==0?vec2(21.,21.):i==1?vec2(63.,0.):vec2(63.,42.));
        float rings=min(abs(length(q)-13.),abs(length(q)-4.4))-1.;
        float bar=max(abs(q.y)-1.,max(4.5-abs(q.x),abs(q.x)-13.));
        balls=max(balls,1.-smoothstep(-aa,aa,min(rings,bar)));
      }
      col=mix(col,navy,balls*.1*fxOn);
      ${
        legendary
          ? `float sw=ps.x*.45;float xl=pb.x-sweep*sw+.249328*(pb.y-ps.y*.5);
             float t=dot(vec2(xl,pb.y)-vec2(sw,ps.y)*.5,vec2(.984808,.173648))/(sw*.984808+ps.y*.173648)+.5;
             col=mix(col,vec3(1.),.6*max(0.,1.-abs(t*2.-1.))*step(0.,xl)*step(xl,sw));`
          : ""
      }
      ${band}
      float inner=sdRoundBox(c,h-frame,max(radius-frame,0.));
      col=mix(col,${frameInk},smoothstep(-aa,aa,inner));
      float inside=1.-smoothstep(-aa,aa,d);
      acc=vec4(col*inside,inside)+acc*(1.-inside);
    `,
      kind === "item" ? flapDistance : "",
    );
    // The art rides in the material's own map slot (its sampler is `map`), so a context-loss release
    // of the stage sees the textures cards hold; ChoiceArt.releaseUploads covers the rest.
    this.material.map = art.get(kind === "move" ? style.type! : kind);
    this.values = values;
  }
  /** Header band height and frame width for the current layout (run-screen.css `--band`, `--frame`). */
  setMetrics(band: number, frame: number): void {
    this.values.band.value = band;
    this.values.frame.value = frame;
  }
  setVeil(veil: number): void {
    this.values.veil.value = veil;
  }
  /** The drifting Poké Ball layer (`--card-fx`): shown while lit, offset in px. */
  setPattern(on: boolean, x: number, y: number): void {
    this.values.fxOn.value = on ? 1 : 0;
    this.values.fx.value.set(x, y);
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
  /** 0–1 toward the pick keyframe's ring and type glow. */
  setPick(amount: number): void {
    this.values.pick.value = amount;
  }
}

/** `.run-card__icon` plate: the move's round type plate or the item's stitched pocket. */
export class ChoiceIconPlate extends BoxSurface {
  constructor(kind: "move" | "item", type: ElementType | null) {
    const ink = type ? typeColors[type].type : "#92b8d1";
    super(
      `icon-${kind}`,
      2,
      {
        plateEdge: { value: mixHex(ink, "#142f50", 0.7) },
        plateTint: { value: mixHex(ink, "#ffffff", 0.28) },
      },
      kind === "move"
        ? `float d=length(c)-min(h.x,h.y);
           float t=clamp(length(p-boxSize*vec2(.5,.4))/length(boxSize*vec2(.5,.6)),0.,1.);
           vec3 col=mix(vec3(1.),plateTint,t);
           float edge=crispLine(2.,2.*aa);
           col=mix(col,plateEdge,smoothstep(-edge-aa,-edge+aa,d));
           over(acc,col,1.-smoothstep(-aa,aa,d));`
        : `float r=c.y<0.?2.:12.;float d=sdRoundBox(c,h,r);
           float inside=1.-smoothstep(-aa,aa,d);
           over(acc,vec3(1.,.980392,.933333),.9*inside);
           float edge=crispLine(2.,2.*aa);
           float line=smoothstep(-edge-aa,-edge+aa,d)*inside*step(mod(perimeter(c,h-1.,max(r-1.,0.)),10.),6.);
           over(acc,vec3(.541176,.352941,.149020),line);`,
    );
  }
}

/** `.choice-banner__plate`: face, theme grain, sheen, light inner ring, frame, base and drop shadow. */
export class ChoiceBannerPlate extends BoxSurface {
  private readonly values: {
    frame: { value: number };
    depth: { value: number };
    drop: { value: number };
  };
  constructor(theme: ElementType | "chest", face: string, light: string) {
    const grain = themeGrain(theme);
    const values = { frame: { value: 3 }, depth: { value: 5 }, drop: { value: 1 } };
    super(
      `banner-${grain.kind}`,
      64,
      {
        ...values,
        face: { value: srgb(face) },
        light: { value: srgb(light) },
        grainInk: { value: srgb(grain.color) },
      },
      `
      vec3 deep=vec3(.050980,.137255,.247059);
      float d=sdRoundBox(c,h,8.);
      over(acc,deep,.25*drop*shadowCover(sdRoundBox(c-vec2(0.,12.),h,8.),32.,aa));
      over(acc,deep,shadowCover(sdRoundBox(c-vec2(0.,depth),h,8.),0.,aa));
      acc*=smoothstep(-aa,aa,d);
      vec2 pb=p-vec2(frame),ps=boxSize-2.*frame;
      vec3 col=face;
      {vec2 p=pb;float grain=0.;${grain.glsl}col=mix(col,grainInk,grain);}
      col=mix(col,vec3(1.),.48*(1.-clamp(pb.y/(ps.y*.52),0.,1.)));
      float inner=sdRoundBox(c,h-frame,8.-frame);
      col=mix(col,light,.7*smoothstep(-2.-aa,-2.+aa,inner));
      col=mix(col,deep,smoothstep(-aa,aa,inner));
      float inside=1.-smoothstep(-aa,aa,d);
      acc=vec4(col*inside,inside)+acc*(1.-inside);`,
    );
    this.values = values;
  }
  /** Frame width, hard base depth, and whether the window drop shadow shows (desktop only). */
  setMetrics(frame: number, depth: number, drop: boolean): void {
    this.values.frame.value = frame;
    this.values.depth.value = depth;
    this.values.drop.value = drop ? 1 : 0;
  }
}

/** `.choice-banner__tail`: a framed swallowtail, darker toward the fold under the plate. */
export class ChoiceBannerTail extends BoxSurface {
  private readonly values: { frame: { value: number }; notch: { value: number } };
  constructor(side: "start" | "end", face: string, deep: string) {
    const values = { frame: { value: 3 }, notch: { value: 14 } };
    super(
      `tail-${side}`,
      0,
      { ...values, face: { value: srgb(face) }, deep: { value: srgb(deep) } },
      `
      // x measured from the notched end, so both sides share one shape.
      vec2 q=vec2(${side === "start" ? "p.x" : "boxSize.x-p.x"},p.y);
      float slope=sqrt(1.+pow(2.*notch/boxSize.y,2.));
      float outer=min(min(q.y,boxSize.y-q.y),min(boxSize.x-q.x,(q.x-notch*(1.-abs(q.y/boxSize.y*2.-1.)))/slope));
      vec2 iq=q-vec2(frame),ib=boxSize-2.*frame;
      float innerD=min(min(iq.y,ib.y-iq.y),min(ib.x-iq.x,(iq.x-notch*(1.-abs(iq.y/ib.y*2.-1.)))/slope));
      vec3 col=deep;
      col=mix(col,face,.45*(1.-clamp(iq.y/(ib.y*.7),0.,1.)));
      col=mix(col,vec3(.050980,.137255,.247059),.5*clamp((iq.x/ib.x-.5)/.5,0.,1.));
      col=mix(vec3(.050980,.137255,.247059),col,smoothstep(-aa,aa,innerD));
      over(acc,col,smoothstep(-aa,aa,outer));`,
    );
    this.values = values;
  }
  setMetrics(frame: number, notch: number): void {
    this.values.frame.value = frame;
    this.values.notch.value = notch;
  }
}

/** `.choice-banner__sparks i`: a four-point star with a 3px glow in the banner's light colour. */
export class ChoiceSpark extends BoxSurface {
  constructor(fill: string, glow: string) {
    super(
      "spark",
      6,
      { fill: { value: srgb(fill) }, glow: { value: srgb(glow) } },
      `
      vec2 v[8];
      v[0]=vec2(.5,0.);v[1]=vec2(.61,.39);v[2]=vec2(1.,.5);v[3]=vec2(.61,.61);
      v[4]=vec2(.5,1.);v[5]=vec2(.39,.61);v[6]=vec2(0.,.5);v[7]=vec2(.39,.39);
      float dd=1e9;float s=1.;
      for(int i=0,j=7;i<8;j=i,i++){
        vec2 a=v[i]*boxSize,b=v[j]*boxSize,e=b-a,w=p-a;
        vec2 k=w-e*clamp(dot(w,e)/dot(e,e),0.,1.);dd=min(dd,dot(k,k));
        bvec3 cnd=bvec3(p.y>=a.y,p.y<b.y,e.x*w.y>e.y*w.x);
        if(all(cnd)||all(not(cnd)))s*=-1.;
      }
      float d=s*sqrt(dd);
      over(acc,glow,shadowCover(d,3.,aa));
      over(acc,fill,1.-smoothstep(-aa,aa,d));`,
    );
  }
}

/** `.game-button--small` plate: fill, frame, sheen (or the disabled hatch), bevel, base and drop. */
export class ChoiceButtonSkin extends BoxSurface {
  private readonly values: {
    fill: { value: Vector3 };
    border: { value: Vector3 };
    base: { value: Vector3 };
    depth: { value: number };
    press: { value: number };
    hatch: { value: number };
  };
  constructor() {
    const values = {
      fill: { value: srgb("#e9f4fb") },
      border: { value: srgb("#142f50") },
      base: { value: srgb("#0d233f") },
      depth: { value: 2 },
      press: { value: 0 },
      hatch: { value: 0 },
    };
    super(
      "button",
      16,
      values,
      `
      float d=sdRoundBox(c,h,8.);
      over(acc,vec3(.050980,.137255,.247059),.24*shadowCover(sdRoundBox(c-vec2(0.,depth+3.),h,8.),6.,aa));
      over(acc,base,step(.01,depth)*shadowCover(sdRoundBox(c-vec2(0.,depth),h,8.),0.,aa));
      acc*=smoothstep(-aa,aa,d);
      vec2 pb=p-2.,ps=boxSize-4.;
      vec3 col=fill;
      float stripe=step(mod((pb.x+pb.y)*.70710678,9.),4.);
      col=mix(col,vec3(1.),hatch*.5*stripe);
      col=mix(col,vec3(1.),(1.-hatch)*(1.-press)*.48*(1.-clamp(pb.y/(ps.y*.52),0.,1.)));
      col=mix(col,vec3(1.),(1.-press)*.62*(1.-step(2.,pb.y)));
      col=mix(col,vec3(.050980,.137255,.247059),(1.-press)*.12*step(ps.y-2.,pb.y));
      col=mix(col,vec3(.050980,.137255,.247059),press*.18*(1.-step(3.,pb.y)));
      col=mix(col,border,smoothstep(-aa,aa,sdRoundBox(c,h-2.,6.)));
      float inside=1.-smoothstep(-aa,aa,d);
      acc=vec4(col*inside,inside)+acc*(1.-inside);`,
    );
    this.values = values;
  }
  setPaint(fill: Vector3, border: Vector3, base: Vector3, hatch: boolean): void {
    this.values.fill.value.copy(fill);
    this.values.border.value.copy(border);
    this.values.base.value.copy(base);
    this.values.hatch.value = hatch ? 1 : 0;
  }
  setDepth(depth: number, press: number): void {
    this.values.depth.value = depth;
    this.values.press.value = press;
  }
}
