import { Content } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import { images } from "../../prepare/images";
import type { ElementType } from "../../run/sim/content/elements";
import { stack } from "./layer";
import { themeColors } from "./run-choice-surface";

export type StationSurfaceKind =
  | "tile"
  | "plate"
  | "glass"
  | "pips"
  | "pipe"
  | "port"
  | "separator"
  | "button"
  | "ball";
/** Original station CSS paint expressed in map-independent logical pixels and analytic geometry. */
export class StationSurface {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  readonly uniforms = {
    stationSize: { value: new Vector2(1, 1) },
    stationTime: { value: 0 },
    stationOn: { value: 0 },
    stationOwned: { value: 1 },
    stationLevel: { value: 0 },
    stationSide: { value: 1 },
    stationTint: { value: new Color("#f0702e") },
    stationDeep: { value: new Color("#9c3412") },
    stationLight: { value: new Color("#ffb36b") },
    stationSoft: { value: new Color("#f3e3c3") },
  };
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  constructor(kind: StationSurfaceKind, type: ElementType | null) {
    if (type) {
      const p = themeColors(type);
      this.uniforms.stationTint.value.set(p.theme);
      this.uniforms.stationDeep.value.set(p.deep);
      this.uniforms.stationLight.value.set(p.light);
      this.uniforms.stationSoft.value.set(p.soft);
    }
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 stationUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nstationUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 stationUv;uniform vec2 stationSize;uniform float stationTime;uniform float stationOn;uniform float stationOwned;uniform float stationLevel;uniform float stationSide;
        uniform vec3 stationTint;uniform vec3 stationDeep;uniform vec3 stationLight;uniform vec3 stationSoft;
        vec3 linearInk(vec3 c){return sRGBTransferEOTF(vec4(c,1.)).rgb;}
        float roundedDistance(vec2 p,vec2 size,float radius){vec2 q=abs(p-size*.5)-(size*.5-vec2(radius));return length(max(q,0.))+min(max(q.x,q.y),0.)-radius;}
        vec3 gray(vec3 c){return vec3(dot(c,vec3(.2126,.7152,.0722)));}\n` + shader.fragmentShader;
      const paint: Record<StationSurfaceKind, string> = {
        tile: `
          float d=roundedDistance(p,stationSize,8.);float r=length(p-stationSize*vec2(.2,.5))/(length(stationSize*vec2(.8,.5))*.7);
          color=mix(vec3(1.),stationSoft,clamp(r,0.,1.));
          if(stationOn>.5)color=linearInk(vec3(1.,.83137,.35686));
          color=mix(color,stationOn>.5?deep:navy,smoothstep(-2.-aa,-2.+aa,d));
          if(stationOn>.5)color=mix(color,gold,smoothstep(-4.-aa,-4.+aa,d)*(1.-smoothstep(-2.-aa,-2.+aa,d)));
          if(stationOwned<.5){color=gray(color);alpha*=.5;}
          alpha*=1.-smoothstep(-aa,aa,d);
        `,
        plate: `
          color=mix(linearInk(vec3(.95686,.97647,.98824)),linearInk(vec3(.81176,.89020,.93725)),1.-stationUv.y);
          color=mix(color,navy,step(22.,mod(p.x,24.))*.06);
          float d=roundedDistance(p,stationSize,10.);color=mix(color,navy,smoothstep(-2.-aa,-2.+aa,d));
          color=mix(color,vec3(1.),(1.-smoothstep(2.-aa,2.+aa,p.y))*step(d,-2.));alpha*=1.-smoothstep(-aa,aa,d);
        `,
        glass: `
          float radius=p.y<stationSize.y*.5?stationSize.x*.5:10.;float d=roundedDistance(p,stationSize,radius);
          float r=length(p-stationSize*vec2(.5,.4))/(length(stationSize*vec2(.5,.6))*.7);
          color=mix(vec3(1.),stationSoft,clamp(r,0.,1.));
          if(stationOwned<.5)color=linearInk(vec3(.88627,.92157,.94510));
          float sheen=step((p.x*.906307+p.y*.422618)/(stationSize.x*.906307+stationSize.y*.422618),.18);
          color=mix(color,vec3(1.),sheen*(stationOwned<.5?.6:.7));
          color=mix(color,deep,step(stationSize.y-10.,p.y));color=mix(color,linearInk(vec3(.62353,.71373,.77647)),step(stationSize.y-8.,p.y));
          float border=smoothstep(-2.-aa,-2.+aa,d);
          if(stationOwned<.5)border*=step(mod((atan(p.y-stationSize.y*.5,p.x-stationSize.x*.5)+3.141593)*stationSize.x*.55,10.),6.);
          color=mix(color,deep,border);alpha*=1.-smoothstep(-aa,aa,d);
        `,
        pips: `
          float outer=roundedDistance(p,stationSize,4.);color=deep;alpha*=1.-smoothstep(-aa,aa,outer);
          vec2 q=p-vec2(3.5);float cell=floor(q.x/9.);vec2 lamp=vec2(mod(q.x,9.),q.y);
          float lampD=roundedDistance(lamp,vec2(7.,9.),1.);
          if(cell>=0.&&cell<8.)color=mix(color,cell<stationLevel?mix(stationLight,stationTint,clamp(lamp.y/9.,0.,1.)):linearInk(vec3(.21176,.31373,.41961)),1.-smoothstep(-aa,aa,lampD));
        `,
        pipe: `
          float t=p.y/stationSize.y; color=t<.45?mix(linearInk(vec3(.55686,.65490,.72549)),linearInk(vec3(.85098,.90588,.94118)),t/.45):mix(linearInk(vec3(.85098,.90588,.94118)),linearInk(vec3(.55686,.65490,.72549)),(t-.45)/.55);
          if(stationOn>.5&&p.y>4.&&p.y<stationSize.y-4.){
            float flow=mod(p.x-stationSide*stationTime*40.,24.);
            if(flow<12.)color=flow<8.?stationLight:stationTint;
          }
          color=mix(color,deep,step(min(p.y,stationSize.y-p.y),2.));
        `,
        port: `
          vec2 q=p-stationSize*.5;float radius=stationSize.x*.5-6.;float r=length(q);
          color=deep;float inner=radius-3.;
          float t=length((q+vec2(0.,radius*.3)))/(radius*1.5);
          vec3 fill=mix(linearInk(vec3(.09020,.24706,.43922)),deep,clamp(t/.75,0.,1.));
          if(stationOn>.5){float u=clamp(t/.55,0.,1.);fill=mix(stationLight,stationTint,u);fill=mix(fill,stationDeep,clamp((t-.55)/.45,0.,1.));
            float grain=0.;
            ${type === "fire" ? "float a=length(mod(p,vec2(11.,9.))-vec2(2.75,6.75));float b=length(mod(p,vec2(7.))-vec2(4.9,2.1));grain=max((1.-smoothstep(1.5-aa,2.+aa,a))*.55,(1.-smoothstep(1.-aa,1.5+aa,b))*.35);" : type === "grass" ? "grain=(1.-smoothstep(2.-aa,2.+aa,mod(-p.x*.819152+p.y*.573576,9.)))*.3;" : type === "water" ? "float d=length(mod(p,vec2(12.,7.))-vec2(6.,9.1));grain=(1.-smoothstep(.5-aa,1.+aa,abs(d-5.5)))*.4;" : "vec2 g=mod(p+vec2(4.,0.),8.);grain=max(step(g.x+g.y,4.),step(8.,g.x-g.y+4.))*.34;"}
            fill=mix(fill,linearInk(vec3(${type === "fire" ? "1.,.92549,.66667" : type === "grass" ? ".90980,1.,.83922" : type === "water" ? ".88235,.96078,1." : "1.,.98824,.86275"})),grain);
          }
          color=mix(color,fill,1.-smoothstep(inner-aa,inner+aa,r));
          color=mix(color,linearInk(vec3(.62353,.71373,.77647)),smoothstep(radius-aa,radius+aa,r)*(1.-smoothstep(radius+4.-aa,radius+4.+aa,r)));
          alpha*=1.-smoothstep(radius+6.-aa,radius+6.+aa,r);
        `,
        ball: `vec2 b=(stationUv-.5)*24.;float r=length(b);float rings=max(1.-smoothstep(1.1-aa,1.1+aa,abs(r-10.4)),1.-smoothstep(1.1-aa,1.1+aa,abs(r-3.6)));float stripe=(1.-smoothstep(1.1-aa,1.1+aa,abs(b.y)))*step(3.6,abs(b.x))*step(abs(b.x),10.4);color=b.y>0.?linearInk(vec3(.65882,.19608,.26275)):vec3(1.);color=mix(color,deep,max(rings,stripe));color=mix(color,vec3(1.),1.-smoothstep(2.35-aa,2.35+aa,r));if(stationOn<.5){color=gray(color);alpha*=.45;}alpha*=1.-smoothstep(11.75-aa,11.75+aa,r);`,
        separator: `color=navy;alpha*=.22*step(mod(p.x,8.),5.);`,
        button: `float d=roundedDistance(p,stationSize,8.);color=stationOwned>.5?stationSoft:linearInk(vec3(.81569,.87451,.92157));if(stationOwned<.5){float h=mod(-(p.x+p.y)*.70710678,9.);color=mix(color,vec3(1.),(smoothstep(-aa,aa,h)-smoothstep(4.-aa,4.+aa,h))*.5);}color=mix(color,vec3(1.),(1.-smoothstep(1.5-aa,1.5+aa,p.y))*.5);color=mix(color,stationDeep,step(stationSize.y-2.,p.y)*.12);color=mix(color,stationOwned>.5?stationTint:linearInk(vec3(.70196,.78431,.84706)),smoothstep(-2.-aa,-2.+aa,d));alpha*=1.-smoothstep(-aa,aa,d);`,
      };
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 p=vec2(stationUv.x,1.-stationUv.y)*stationSize;float aa=.5*max(fwidth(p.x),fwidth(p.y));
        vec3 navy=linearInk(vec3(.07843,.18431,.31373)),deep=linearInk(vec3(.05098,.13725,.24706)),gold=linearInk(vec3(.70588,.50588,.16078));
        vec3 color=navy;float alpha=opacity;${paint[kind]}diffuseColor=vec4(color,alpha);`,
      );
    };
    this.material.customProgramCacheKey = () => `run-station-${kind}`;
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  update(time: number): void {
    const size = this.content.size.value;
    if (size) this.uniforms.stationSize.value.set(size[0], size[1]);
    this.uniforms.stationTime.value = time;
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.content.removeFromParent();
    this.content.dispose();
  }
}

/** Same source art, with the original missing-part silhouette and unready-core filters on the GPU. */
export class StationArt {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly texture;
  private readonly material: MeshBasicMaterial;
  constructor(
    src: string,
    size: number,
    gray: number,
    brightness: number,
    opacity: number,
    shadow: number,
  ) {
    // The window redraws as it opens and on every change, which picks the art up once decoded.
    this.texture = images().texture(src, "art", () => {});
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `#include <map_fragment>\nfloat value=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(value),${gray.toFixed(2)})*${brightness.toFixed(2)};diffuseColor.a*=${opacity.toFixed(2)};
        ${shadow > 0 ? `float shadowAlpha=texture2D(map,vMapUv+vec2(0.,${(shadow / size).toFixed(6)})).a*opacity;float combined=diffuseColor.a+shadowAlpha*(1.-diffuseColor.a);diffuseColor=vec4((diffuseColor.rgb*diffuseColor.a+sRGBTransferEOTF(vec4(.05098,.13725,.24706,1.)).rgb*shadowAlpha*(1.-diffuseColor.a))/max(combined,.0001),combined);` : ""}`,
      );
    };
    this.material.customProgramCacheKey = () =>
      `station-art-${gray}-${brightness}-${opacity}-${shadow}-${size}`;
    this.content = stack(
      new Content({
        width: size,
        height: size,
        color: "#ffffff",
        keepAspectRatio: false,
        depthTest: false,
      }),
      3,
    );
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  dispose(): void {
    this.texture.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.content.removeFromParent();
    this.content.dispose();
  }
}
