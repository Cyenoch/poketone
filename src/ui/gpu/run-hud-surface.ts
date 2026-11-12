import { Content } from "@pmndrs/uikit";
import { crispLineGlsl } from "./crisp-line";
import { themeGrain } from "./run-overlays-surface";
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

/** Small shader plates keep ring gauges, cooldown sectors and HP chips on the GPU. */
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
    /** HP: a heal's bright leading cap; XP ring: the level beat's flash (both 1 → 0). */
    hudGlow: { value: 0 },
    hudColor: { value: new Color("#59c8ff") },
    hudDeep: { value: new Color("#173f70") },
    hudLight: { value: new Color("#ffffff") },
    hudGrain: { value: new Color("#ffffff") },
    /** The theme colour itself, for faces painted light → theme → deep. */
    hudTheme: { value: new Color("#ffffff") },
    hudThemeDeep: { value: new Color("#ffffff") },
    hudKind: { value: 0 },
  };
  constructor(
    kind: "hp" | "chip" | "ring" | "halo" | "cooldown" | "button" | "slot" | "medal" | "plate",
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
        uniform vec2 hudSize; uniform float hudFill; uniform float hudTrail; uniform float hudChip;
        uniform float hudTime; uniform float hudReady; uniform float hudLead; uniform vec3 hudTicks; uniform float hudGlow; uniform vec3 hudColor; uniform vec3 hudDeep;
        uniform vec3 hudLight; uniform vec3 hudGrain; uniform vec3 hudTheme; uniform vec3 hudThemeDeep; uniform float hudKind;
        float segment(vec2 p,vec2 a,vec2 b,float w,float aa){vec2 v=b-a;return 1.-smoothstep(w-aa,w+aa,length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.)));}
      ` + shader.fragmentShader;
      const hp = `
        vec2 p=hudUv*hudSize;
        float edge=length(max(abs(p-hudSize*.5)-(hudSize*.5-vec2(5.)),0.))-5.;
        float mask=1.-smoothstep(-aa,aa,edge);
        vec3 ink=vec3(.004,.008,.018);
        vec3 fill=mix(hudDeep,hudColor,hudUv.y);
        // Enamel gloss: a soft light strip across the upper third of the fill.
        // Halved on the low-HP gradient, which it would wash to pink.
        fill=mix(fill,vec3(1.),(.3-.15*hudReady)*smoothstep(.58,.68,hudUv.y)*(1.-smoothstep(.82,.9,hudUv.y)));
        fill*=1.+hudReady*.35*(.5-.5*cos(hudTime*4.48799));
        float filled=step(hudUv.x,hudFill);
        vec3 c=mix(ink,fill,filled);
        // A heal still filling in: the gain shows at once as a ghost of the fill, the fill eases into it.
        float lead=step(hudFill,hudUv.x)*step(hudUv.x,hudLead);
        // Incoming HP: the fill's colour at 60% with a light top edge.
        vec3 ghost=mix(mix(ink,hudColor,.6),vec3(1.),.5*step(hudSize.y-p.y,4.));
        c=mix(c,ghost,lead);
        // While a heal sweeps in, the fill's end carries a white cap that fades with the glow.
        float cap=filled*step(hudFill*hudSize.x-2.-4.*hudGlow,p.x)*step(.001,hudGlow);
        c=mix(c,vec3(1.),cap*hudGlow);
        float tick=0.;
        for(int i=0;i<3;i++){
          float x=hudTicks[i];
          tick=max(tick,step(0.,x)*(1.-smoothstep(.5,.5+aa,abs(p.x-x*hudSize.x))));
        }
        c*=1.-tick*.45;
        c=mix(c,vec3(.008,.018,.04),step(min(min(p.x,p.y),min(hudSize.x-p.x,hudSize.y-p.y)),2.));
        diffuseColor=vec4(c,mask*opacity);
      `;
      const ring = `
        vec2 p=(hudUv-.5)*2.;float r=length(p);
        float angle=mod(atan(p.x,p.y)+6.2831853,6.2831853)/6.2831853;
        float circle=1.-smoothstep(1.-aa,1.+aa,r);
        vec3 c=mix(vec3(.004,.012,.03),hudDeep,clamp((hudUv.y-.15)*1.5,0.,1.));
        ${
          glyph === 0
            ? `// .run-ult[data-ready]::before: the disc takes theme grain over radial-gradient(circle at
        // 50% 30%, theme-light, theme 55%, theme-deep) inside its 2px navy-deep rim.
        if(hudReady>.5&&r<.79){
          float t=length(p-vec2(0.,.316))/1.359;
          vec3 l=sRGBTransferOETF(vec4(hudLight,1.)).rgb,m=sRGBTransferOETF(vec4(hudTheme,1.)).rgb,dk=sRGBTransferOETF(vec4(hudThemeDeep,1.)).rgb;
          vec3 face=t<.55?mix(l,m,t/.55):mix(m,dk,(t-.55)/.45);
          {
            vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;float pa=fwidth(p.x);float grain=0.;
            if(hudKind<.5){float aa=pa;${themeGrain("fire").glsl}}
            else if(hudKind<1.5){float aa=pa;${themeGrain("grass").glsl}}
            else if(hudKind<2.5){float aa=pa;${themeGrain("water").glsl}}
            else{float aa=pa;${themeGrain("electric").glsl}}
            face=mix(face,sRGBTransferOETF(vec4(hudGrain,1.)).rgb,grain);
          }
          face=mix(face,vec3(.051,.137,.247),smoothstep(.79-4./hudSize.x-aa,.79-4./hudSize.x+aa,r));
          c=sRGBTransferEOTF(vec4(face,1.)).rgb;
        }`
            : ""
        }
        float ring=step(.79,r)*step(r,.95);
        vec3 arc=mix(vec3(.008,.02,.04),hudColor,step(angle,hudFill));
        ${
          kind === "ring"
            ? `// XP: the arc just gained in xp-light (hudLight) until its tail catches up; the level beat
        // flashes the full ring white.
        arc=mix(arc,hudLight,step(hudTrail,angle)*step(angle,hudFill));
        arc=mix(arc,vec3(1.),hudGlow*.85*step(angle,hudFill));`
            : ""
        }
        c=mix(c,arc,ring);
        c=mix(c,vec3(.004,.012,.03),step(.95,r));
        ${glyph === 1 ? "float ink=segment(p,vec2(-.2,-.3),vec2(-.2,.3),.075,aa)+segment(p,vec2(.2,-.3),vec2(.2,.3),.075,aa);c=mix(c,vec3(1.),clamp(ink,0.,1.));" : ""}
        ${glyph === 2 ? "vec2 q=p/.88+.5;float ink=segment(q,vec2(13.,19.)/24.,vec2(20.,12.)/24.,.052083333,aa*2.272727)+segment(q,vec2(20.,12.)/24.,vec2(13.,5.)/24.,.052083333,aa*2.272727)+segment(q,vec2(3.,16.)/24.,vec2(10.,16.)/24.,.052083333,aa*2.272727)+segment(q,vec2(1.5,12.)/24.,vec2(11.,12.)/24.,.052083333,aa*2.272727)+segment(q,vec2(3.,8.)/24.,vec2(10.,8.)/24.,.052083333,aa*2.272727);c=mix(c,vec3(1.),clamp(ink,0.,1.)*(.55+.45*hudReady));" : ""}
        ${glyph === 3 || glyph === 4 ? `vec2 q=p*vec2(${glyph === 3 ? "1." : "-1."},1.);float a=atan(q.y,q.x);float ink=(1.-smoothstep(.055,.055+aa,abs(length(q)-.33)))*step(-2.1,a)*step(a,2.);ink=max(ink,segment(q,vec2(-.23,.24),vec2(-.38,.17),.07,aa));c=mix(c,vec3(1.),ink);` : ""}
        ${
          glyph === 1 || glyph === 3 || glyph === 4 || glyph === 5
            ? `// See-through round HUD key (pause, turn): a 55% navy scrim, a 2px 75% ice border.
        float rim=step(1.-2./(hudSize.x*.5),r);
        vec4 key=mix(vec4(.006,.017,.049,.55),vec4(.687,.863,.965,.75),rim);
        key=mix(key,vec4(1.),${glyph === 5 ? "0." : "clamp(ink,0.,1.)"});
        diffuseColor=vec4(key.rgb,key.a*circle*opacity);`
            : "diffuseColor=vec4(c,circle*opacity);"
        }
      `;
      const halo = `
        vec2 p=(hudUv-.5)*3.;float radius=.92+hudTime*.48;
        float ink=1.-smoothstep(.025,.025+aa,abs(length(p)-radius));
        diffuseColor=vec4(hudColor,ink*(1.-hudTime)*opacity);
      `;
      const chip = `
        float band=step(hudFill+.001,hudUv.x)*step(hudUv.x,hudTrail);
        diffuseColor=vec4(mix(vec3(1.,.66,.1),vec3(1.),hudChip),band*opacity);
      `;
      // `.run-slot`: a 3px navy-deep frame, a 2px inner rim (hudDeep) and a radial face from white at
      // 50% 35% to hudColor at 70% of the farthest corner. Empty (hudReady 0): a dashed 45% navy frame
      // over a 35% surface face.
      const slot = `
        vec2 p=(vec2(hudUv.x,1.-hudUv.y)-.5)*hudSize;
        vec2 q=abs(p)-(hudSize*.5-vec2(8.));
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-8.;
        float pa=.5*fwidth(d);
        float inside=1.-smoothstep(-pa,pa,d);
        float frameW=crispLine(3.,2.*pa),frame=smoothstep(-frameW-pa,-frameW+pa,d);
        vec4 c;
        if(hudReady>.5){
          vec2 o=vec2(hudUv.x,1.-hudUv.y)*hudSize-hudSize*vec2(.5,.35);
          float far=length(hudSize*vec2(.5,.65));
          vec3 tone=sRGBTransferOETF(vec4(hudColor,1.)).rgb,rimInk=sRGBTransferOETF(vec4(hudDeep,1.)).rgb;
          vec3 face=mix(vec3(1.),tone,clamp(length(o)/(far*.7),0.,1.));
          float rimW=frameW+crispLine(2.,2.*pa),rim=smoothstep(-rimW-pa,-rimW+pa,d);
          c=vec4(mix(mix(face,rimInk,rim),vec3(.051,.137,.247),frame),1.);
        }else{
          vec2 h=hudSize*.5,a2=abs(p);float ea=h.y-8.,eb=h.x-8.;
          float s2=a2.y<ea?a2.y:a2.x>eb?ea+atan(a2.y-ea,a2.x-eb)*8.:ea+1.5707963*8.+eb-a2.x;
          float dash=step(mod(s2,9.),5.);
          c=mix(vec4(.914,.957,.984,.35),vec4(.078,.184,.314,.45*dash),frame);
        }
        diffuseColor=vec4(sRGBTransferEOTF(vec4(c.rgb,1.)).rgb,c.a*inside*opacity);
      `;
      // `.run-level__face`: theme grain over radial-gradient(circle at 50% 30%, theme-light, theme
      // 55%, theme-deep) inside a 2px navy-deep ring. All four themes' grain in one program.
      const medal = `
        vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;
        float R=hudSize.x*.5;float r=length(p-vec2(R));float pa=.5*fwidth(r);
        float inside=1.-smoothstep(R-pa,R+pa,r);
        vec2 o=p-hudSize*vec2(.5,.3);float far=length(hudSize*vec2(.5,.7));float t=length(o)/far;
        vec3 l=sRGBTransferOETF(vec4(hudLight,1.)).rgb,m=sRGBTransferOETF(vec4(hudColor,1.)).rgb,dk=sRGBTransferOETF(vec4(hudDeep,1.)).rgb;
        vec3 ink=t<.55?mix(l,m,t/.55):mix(m,dk,(t-.55)/.45);
        float grain=0.;
        if(hudKind<.5){float aa=pa;${themeGrain("fire").glsl}}
        else if(hudKind<1.5){float aa=pa;${themeGrain("grass").glsl}}
        else if(hudKind<2.5){float aa=pa;${themeGrain("water").glsl}}
        else{float aa=pa;${themeGrain("electric").glsl}}
        ink=mix(ink,sRGBTransferOETF(vec4(hudGrain,1.)).rgb,grain);
        ink=mix(ink,vec3(.051,.137,.247),smoothstep(R-2.-pa,R-2.+pa,r));
        diffuseColor=vec4(sRGBTransferEOTF(vec4(ink,1.)).rgb,inside*opacity);
      `;
      // The vitals' name plate: a navy slab whose right end leans back (a parallelogram's), tinted
      // toward the theme's deep step at the top, inside a 1.5px ice rim. Its left end sits under the
      // portrait medal, so it stays square.
      const plate = `
        vec2 p=vec2(hudUv.x,1.-hudUv.y)*hudSize;float pa=fwidth(p.x);
        float slope=.3;
        float lean=(hudSize.x-slope*p.y-p.x)/sqrt(1.+slope*slope);
        float e=min(min(p.x,p.y),min(hudSize.y-p.y,lean));
        float inside=smoothstep(0.,pa,e);
        vec3 navy=vec3(.051,.137,.247),deep=sRGBTransferOETF(vec4(hudDeep,1.)).rgb;
        vec3 c=mix(mix(vec3(.09,.2,.35),deep,.4),navy,smoothstep(0.,hudSize.y,p.y));
        c=mix(c,vec3(.847,.937,.984),.32*(1.-smoothstep(1.5-pa,1.5+pa,e)));
        diffuseColor=vec4(sRGBTransferEOTF(vec4(c,1.)).rgb,inside*.88*opacity);
      `;
      const cooldown = `
        vec2 p=hudUv-.5;float angle=mod(atan(p.x,p.y)+6.2831853,6.2831853)/6.2831853;
        // Shaded where angle < the share still cooling (angle is in [0, 1)): a strict test, so a
        // full fill shades nothing (step(angle, 0) lit the atan seam at the top) and none shades all.
        diffuseColor=vec4(vec3(.004,.015,.035),(1.-step(1.-hudFill,angle))*.55*opacity);
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat aa=max(fwidth(hudUv.x),fwidth(hudUv.y))*1.5;\n${kind === "hp" ? hp : kind === "chip" ? chip : kind === "halo" ? halo : kind === "cooldown" ? cooldown : kind === "slot" ? slot : kind === "medal" ? medal : kind === "plate" ? plate : ring}`,
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
