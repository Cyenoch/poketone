import { Content } from "@pmndrs/uikit";
import { crispLineGlsl } from "./crisp-line";
import { HARD_SHADOW, RADIUS } from "./tokens";
import { themeGrainSwitch } from "./run-theme";
import { images } from "../../prepare/images";
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  type Texture,
} from "three";

/** Linear ink (#16161d) and the near-black track every bar runs on. */
const INK = "vec3(.008,.008,.0123)";
const TRACK = "vec3(.004,.004,.006)";
/** Display-space ink, for shaders that blend in sRGB. */
const INK_SRGB = "vec3(.086,.086,.114)";

/** GLSL `roundBox(p, size, r)`: the distance to a `size` box with corner radius r (p in px). */
const roundBoxGlsl = `float roundBox(vec2 p,vec2 size,float r){
  vec2 q=abs(p-size*.5)-size*.5+r;
  return length(max(q,0.))+min(max(q.x,q.y),0.)-r;
}`;

/**
 * Small shader plates keep gauges, cooldown sectors and HP chips on the GPU. Bars and slots are
 * upright rounded boxes; only the name plate around them is slanted.
 */
export class RunHudSurface {
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
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  readonly uniforms = {
    hudSize: { value: new Vector2(1, 1) },
    hudFill: { value: 1 },
    hudTrail: { value: 1 },
    hudChip: { value: 0 },
    hudTime: { value: 0 },
    hudReady: { value: 0 },
    hudSwell: { value: 0 },
    /** HP: the heal's target, drawn ahead of the fill until the fill reaches it. */
    hudLead: { value: 0 },
    /** HP: tick positions along the bar (0–1); a negative one is not drawn. */
    hudTicks: { value: new Vector3(0.25, 0.5, 0.75) },
    /** HP: a heal's bright leading cap; XP: the level beat's flash; ultimate: a crisis gain's
     *  flash (all 1 → 0). */
    hudGlow: { value: 0 },
    /** HP: the shield's share of the bar along its top; negative draws none. */
    hudShield: { value: -1 },
    /** HP: the frame (ink, flashing on a hurt or a big heal). */
    hudFrame: { value: new Color("#16161d") },
    hudColor: { value: new Color("#59c8ff") },
    hudDeep: { value: new Color("#3a3a46") },
    hudLight: { value: new Color("#ffffff") },
    hudGrain: { value: new Color("#ffffff") },
    /** The theme colour itself, for faces painted light → theme → deep. */
    hudTheme: { value: new Color("#ffffff") },
    hudThemeDeep: { value: new Color("#ffffff") },
    hudKind: { value: 0 },
  };
  constructor(
    kind: "hp" | "chip" | "bar" | "ring" | "glyph" | "halo" | "cooldown" | "slot" | "medal",
    glyph = 0,
  ) {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 hudUv;uniform float hudSwell;\n" + shader.vertexShader;
      if (kind === "chip")
        shader.vertexShader = shader.vertexShader.replace(
          "#include <begin_vertex>",
          "vec3 transformed=vec3(position);transformed.y*=1.+hudSwell;",
        );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nhudUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 hudUv;
        ${crispLineGlsl}
        ${roundBoxGlsl}
        uniform vec2 hudSize; uniform float hudFill; uniform float hudTrail; uniform float hudChip;
        uniform float hudTime; uniform float hudReady; uniform float hudLead; uniform vec3 hudTicks; uniform float hudGlow;
        uniform float hudShield; uniform vec3 hudFrame; uniform vec3 hudColor; uniform vec3 hudDeep;
        uniform vec3 hudLight; uniform vec3 hudGrain; uniform vec3 hudTheme; uniform vec3 hudThemeDeep; uniform float hudKind;
        float segment(vec2 p,vec2 a,vec2 b,float w,float aa){vec2 v=b-a;return 1.-smoothstep(w-aa,w+aa,length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.)));}
      ` + shader.fragmentShader;
      // Bars: p in px (y down), px one device pixel, x the distance along the bar.
      const bar = `
        vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;
        float px=max(fwidth(p.x),fwidth(p.y));
        float len=hudSize.x;
        float x=p.x;
      `;
      const hp = `${bar}
        float d=roundBox(p,hudSize,min(${RADIUS}.,hudSize.y*.5));
        float mask=1.-smoothstep(-.5*px,.5*px,d);
        float vy=1.-p.y/hudSize.y;
        vec3 ink=${TRACK};
        vec3 fill=mix(hudDeep,hudColor,vy);
        // Enamel gloss: a soft light strip across the upper third of the fill.
        // Halved on the low-HP gradient, which it would wash to pink.
        fill=mix(fill,vec3(1.),(.3-.15*hudReady)*smoothstep(.58,.68,vy)*(1.-smoothstep(.82,.9,vy)));
        fill*=1.+hudReady*.35*(.5-.5*cos(hudTime*4.48799));
        float filled=1.-smoothstep(-.5*px,.5*px,x-hudFill*len);
        vec3 c=mix(ink,fill,filled);
        // A heal still filling in: the gain shows at once as a ghost of the fill, the fill eases into it.
        float lead=(1.-filled)*step(x,hudLead*len);
        vec3 ghost=mix(mix(ink,hudColor,.6),vec3(1.),.5*step(p.y,4.));
        c=mix(c,ghost,lead);
        // While a heal sweeps in, the fill's end carries a white cap that fades with the glow.
        float cap=filled*step(hudFill*len-2.-4.*hudGlow,x)*step(.001,hudGlow);
        c=mix(c,vec3(1.),cap*hudGlow);
        float tick=0.;
        for(int i=0;i<3;i++){
          float t=hudTicks[i];
          tick=max(tick,step(0.,t)*(1.-smoothstep(.5,.5+px,abs(x-t*len))));
        }
        c*=1.-tick*.45;
        // Shield: an ice band along the top, its length the share of the max left.
        float shield=step(0.,hudShield)*step(x,hudShield*len)*step(p.y,hudSize.y*.42);
        c=mix(c,vec3(.52,.82,1.),shield);
        c=mix(c,${TRACK},shield*step(hudSize.y*.42-1.5,p.y));
        float frameW=crispLine(2.,px);
        c=mix(c,hudFrame,smoothstep(-frameW-.5*px,-frameW+.5*px,d));
        diffuseColor=vec4(c,mask*opacity);
      `;
      const chip = `${bar}
        float mask=1.-smoothstep(-.5*px,.5*px,roundBox(p,hudSize,min(${RADIUS}.,hudSize.y*.5)));
        float band=step(hudFill*len+.5,x)*step(x,hudTrail*len);
        diffuseColor=vec4(mix(vec3(1.,.66,.1),vec3(1.),hudChip),band*mask*opacity);
      `;
      // XP and teammates' HP: a thin pill gauge; the arc just gained in hudLight until its tail
      // catches up, and the level beat's flash over the fill.
      const gauge = `${bar}
        float mask=1.-smoothstep(-.5*px,.5*px,roundBox(p,hudSize,hudSize.y*.5));
        float on=1.-smoothstep(-.5*px,.5*px,x-hudFill*len);
        vec3 col=mix(hudColor,hudLight,step(hudTrail*len,x));
        col=mix(col,vec3(1.),hudGlow*.85);
        diffuseColor=vec4(mix(${TRACK},col,on),mask*opacity);
      `;
      const glyphs = `
        ${glyph === 1 ? "float ink=segment(p,vec2(-.2,-.3),vec2(-.2,.3),.075,aa)+segment(p,vec2(.2,-.3),vec2(.2,.3),.075,aa);" : ""}
        ${glyph === 2 ? "vec2 q=p/.88+.5;float ink=segment(q,vec2(13.,19.)/24.,vec2(20.,12.)/24.,.052083333,aa*2.272727)+segment(q,vec2(20.,12.)/24.,vec2(13.,5.)/24.,.052083333,aa*2.272727)+segment(q,vec2(3.,16.)/24.,vec2(10.,16.)/24.,.052083333,aa*2.272727)+segment(q,vec2(1.5,12.)/24.,vec2(11.,12.)/24.,.052083333,aa*2.272727)+segment(q,vec2(3.,8.)/24.,vec2(10.,8.)/24.,.052083333,aa*2.272727);" : ""}
        ${glyph === 3 || glyph === 4 ? `vec2 q=p*vec2(${glyph === 3 ? "1." : "-1."},1.);float a=atan(q.y,q.x);float ink=(1.-smoothstep(.055,.055+aa,abs(length(q)-.33)))*step(-2.1,a)*step(a,2.);ink=max(ink,segment(q,vec2(-.23,.24),vec2(-.38,.17),.07,aa));` : ""}
      `;
      // The pause and turn keys' white glyph alone; their face is an upright plate under it.
      const glyphOnly = `
        vec2 p=(hudUv-.5)*2.;
        ${glyphs}
        diffuseColor=vec4(vec3(1.),clamp(ink,0.,1.)*opacity);
      `;
      // The thumb keys (dash, ultimate): an ink disc whose 6px outer ring is the gauge.
      const ring = `
        vec2 p=(hudUv-.5)*2.;float r=length(p);
        float angle=mod(atan(p.x,p.y)+6.2831853,6.2831853)/6.2831853;
        float circle=1.-smoothstep(1.-aa,1.+aa,r);
        vec3 c=mix(${TRACK},hudDeep,clamp((hudUv.y-.15)*1.5,0.,1.));
        ${
          glyph === 0
            ? `// Ready: the disc takes theme grain over a radial light → theme → deep face.
        if(hudReady>.5&&r<.79){
          float t=length(p-vec2(0.,.316))/1.359;
          vec3 l=sRGBTransferOETF(vec4(hudLight,1.)).rgb,m=sRGBTransferOETF(vec4(hudTheme,1.)).rgb,dk=sRGBTransferOETF(vec4(hudThemeDeep,1.)).rgb;
          vec3 face=t<.55?mix(l,m,t/.55):mix(m,dk,(t-.55)/.45);
          {
            vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;float pa=fwidth(p.x);float grain=0.;
            {float aa=pa;${themeGrainSwitch("hudKind")}}
            face=mix(face,sRGBTransferOETF(vec4(hudGrain,1.)).rgb,grain);
          }
          face=mix(face,${INK_SRGB},smoothstep(.79-4./hudSize.x-aa,.79-4./hudSize.x+aa,r));
          c=sRGBTransferEOTF(vec4(face,1.)).rgb;
        }`
            : ""
        }
        float ring=step(.79,r)*step(r,.95);
        vec3 arc=mix(${TRACK},hudColor,step(angle,hudFill));
        // Crisis charge (hudGlow 1 → 0): the arc just gained from hudTrail flashes white, the rest
        // of the fill brightens with it.
        arc=mix(arc,vec3(1.),hudGlow*step(angle,hudFill)*(.3+.7*step(hudTrail,angle)));
        c=mix(c,arc,ring);
        c=mix(c,${INK},step(.95,r));
        ${glyph === 2 ? `${glyphs}c=mix(c,vec3(1.),clamp(ink,0.,1.)*(.55+.45*hudReady));` : ""}
        diffuseColor=vec4(c,circle*opacity);
      `;
      const halo = `
        vec2 p=(hudUv-.5)*3.;float radius=.92+hudTime*.48;
        float ink=1.-smoothstep(.025,.025+aa,abs(length(p)-radius));
        diffuseColor=vec4(hudColor,ink*(1.-hudTime)*opacity);
      `;
      // A move or item slot: the rounded plate 3px inside its box, with the hard shadow in those 3px;
      // a 3px ink frame, a 2px inner rim (hudDeep) and a radial face from white at 50% 35% to
      // hudColor. Empty (hudReady 0): a see-through ink face inside a light line, no shadow.
      const slot = `
        vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;
        float px=max(fwidth(p.x),fwidth(p.y));
        vec2 S=hudSize-vec2(3.);
        float d=roundBox(p,S,${RADIUS}.);
        float inside=1.-smoothstep(-.5*px,.5*px,d);
        float shadow=1.-smoothstep(-.5*px,.5*px,roundBox(p-vec2(3.),S,${RADIUS}.));
        float frameW=crispLine(3.,px),frame=smoothstep(-frameW-.5*px,-frameW+.5*px,d);
        vec4 c;
        if(hudReady>.5){
          vec2 o=p-S*vec2(.5,.35);
          float far=length(S*vec2(.5,.65));
          vec3 tone=sRGBTransferOETF(vec4(hudColor,1.)).rgb,rimInk=sRGBTransferOETF(vec4(hudDeep,1.)).rgb;
          vec3 face=mix(vec3(1.),tone,clamp(length(o)/(far*.7),0.,1.));
          float rimW=frameW+crispLine(2.,px),rim=smoothstep(-rimW-.5*px,-rimW+.5*px,d);
          c=vec4(mix(mix(face,rimInk,rim),${INK_SRGB},frame),1.);
        }else{
          float lineW=crispLine(1.5,px),line=smoothstep(-lineW-.5*px,-lineW+.5*px,d);
          c=mix(vec4(${INK_SRGB},.38),vec4(1.,1.,1.,.6),line);
        }
        float a=c.a*inside,s=${HARD_SHADOW.alpha}*shadow*hudReady*(1.-a),A=a+s;
        diffuseColor=vec4(sRGBTransferEOTF(vec4(A>0.?c.rgb*a/A:vec3(0.),1.)).rgb,A*opacity);
      `;
      // The portrait medal: theme grain over a radial light → theme → deep face in a 2px ink ring.
      const medal = `
        vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;
        float R=hudSize.x*.5;float r=length(p-vec2(R));float pa=.5*fwidth(r);
        float inside=1.-smoothstep(R-pa,R+pa,r);
        vec2 o=p-hudSize*vec2(.5,.3);float far=length(hudSize*vec2(.5,.7));float t=length(o)/far;
        vec3 l=sRGBTransferOETF(vec4(hudLight,1.)).rgb,m=sRGBTransferOETF(vec4(hudColor,1.)).rgb,dk=sRGBTransferOETF(vec4(hudDeep,1.)).rgb;
        vec3 ink=t<.55?mix(l,m,t/.55):mix(m,dk,(t-.55)/.45);
        float grain=0.;
        {float aa=pa;${themeGrainSwitch("hudKind")}}
        ink=mix(ink,sRGBTransferOETF(vec4(hudGrain,1.)).rgb,grain);
        ink=mix(ink,${INK_SRGB},smoothstep(R-3.-pa,R-3.+pa,r));
        diffuseColor=vec4(sRGBTransferEOTF(vec4(ink,1.)).rgb,inside*opacity);
      `;
      // The cooldown sector inside the slot's frame, from 12 o'clock clockwise.
      const cooldown = `
        vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;
        vec2 S=hudSize-vec2(3.);
        float mask=1.-smoothstep(-3.5,-2.5,roundBox(p,S,${RADIUS}.));
        vec2 o=(p-S*.5)*vec2(1.,-1.);
        float angle=mod(atan(o.x,o.y)+6.2831853,6.2831853)/6.2831853;
        // Shaded where angle < the share still cooling (angle is in [0, 1)): a strict test, so a
        // full fill shades nothing and none shades all.
        diffuseColor=vec4(${TRACK},(1.-step(1.-hudFill,angle))*.6*mask*opacity);
      `;
      const body = { hp, chip, bar: gauge, ring, glyph: glyphOnly, halo, slot, medal, cooldown }[
        kind
      ];
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat aa=max(fwidth(hudUv.x),fwidth(hudUv.y))*1.5;\n${body}`,
      );
    };
    this.material.customProgramCacheKey = () => `run-hud-${kind}-${glyph}`;
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  afterLayout(): void {
    const size = this.content.size.value;
    if (size) this.uniforms.hudSize.value.set(size[0], size[1]);
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A HUD picture with CSS `saturate(1 - gray) brightness(bright)` as uniforms, so it can transition. */
export class RunHudArt {
  readonly content: Content;
  readonly uniforms = { artGray: { value: 0 }, artBright: { value: 1 } };
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly texture: Texture;
  private readonly material: MeshBasicMaterial;
  constructor(src: string, onLoad: () => void) {
    this.texture = images().texture(src, "art", onLoad);
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.material.customProgramCacheKey = () => "run-hud-art";
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader =
        "uniform float artGray; uniform float artBright;\n" +
        shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          vec3 s=sRGBTransferOETF(vec4(diffuseColor.rgb,1.)).rgb;
          float luma=dot(s,vec3(.2126,.7152,.0722));
          s=mix(s,vec3(luma),artGray)*artBright;
          diffuseColor.rgb=sRGBTransferEOTF(vec4(s,1.)).rgb;`,
        );
    };
    this.content = new Content({ keepAspectRatio: false, depthTest: false, color: "#ffffff" });
    this.content.add(new Mesh(this.geometry, this.material));
  }
  dispose(): void {
    this.texture.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
