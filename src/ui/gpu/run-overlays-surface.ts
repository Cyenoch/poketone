import { Content } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import type { ElementType } from "../../run/sim/content/elements";

/** The theme's `--theme-grain` (run-theme.css) as GLSL: sets `grain` (0–1) at padding-box point `p`. */
export function themeGrain(theme: ElementType | "chest"): {
  kind: number;
  color: string;
  glsl: string;
} {
  const kind =
    theme === "fire"
      ? 0
      : theme === "grass"
        ? 1
        : theme === "water"
          ? 2
          : theme === "chest"
            ? 4
            : 3;
  const glsl =
    kind === 0
      ? `
          float a=length(mod(p,vec2(11.,9.))-vec2(2.75,6.75));
          float b=length(mod(p,vec2(7.))-vec2(4.9,2.1));
          grain=max((1.-smoothstep(1.5-aa,2.+aa,a))*.55,(1.-smoothstep(1.-aa,1.5+aa,b))*.35);
        `
      : kind === 1
        ? `grain=(1.-smoothstep(2.-aa,2.+aa,mod(-p.x*.819152+p.y*.573576,9.)))*.3;`
        : kind === 2
          ? `float d=length(mod(p,vec2(12.,7.))-vec2(6.,9.1));grain=(1.-smoothstep(.5-aa,1.+aa,abs(d-5.5)))*.4;`
          : kind === 4
            ? `grain=(1.-smoothstep(1.5-aa,2.+aa,length(mod(p,vec2(10.,9.))-vec2(3.,6.3))))*.45;`
            : `vec2 q=mod(p+vec2(4.,0.),8.);grain=max(step(q.x+q.y,4.),step(8.,q.x-q.y+4.))*.34;`;
  return {
    kind,
    color: ["#ffecaa", "#e8ffd6", "#e1f5ff", "#fffcdc", "#ffffff"][kind]!,
    glsl,
  };
}

/** The existing run-theme.css band's grain and bottom silhouettes, evaluated in logical pixels. */
export class RunHeaderSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly size = { value: new Vector2(1, 1) };
  constructor(theme: ElementType | "chest", top: string, bottom: string, edge: boolean) {
    const grain = themeGrain(theme),
      kind = grain.kind;
    this.material.customProgramCacheKey = () => `poketone-run-header-${kind}-${edge}`;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        bandSize: this.size,
        bandTop: { value: new Color(top) },
        bandBottom: { value: new Color(bottom) },
        bandGrain: { value: new Color(grain.color) },
      });
      shader.vertexShader = "varying vec2 bandUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nbandUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 bandUv; uniform vec2 bandSize; uniform vec3 bandTop; uniform vec3 bandBottom; uniform vec3 bandGrain;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(bandUv.x,1.-bandUv.y)*bandSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        vec3 ink=mix(bandTop,bandBottom,clamp(p.y/bandSize.y,0.,1.));
        float grain=0.;
        ${grain.glsl}
        ink=mix(ink,bandGrain,grain);
        float depth=bandSize.y-2.-p.y;
        float edge=0.;
        ${
          kind === 0
            ? `vec2 q=vec2((mod(p.x,9.)-4.5)/3.6,depth/8.);edge=step(dot(q,q),1.);`
            : kind === 1
              ? `vec2 q=vec2(mod(p.x,14.)/14.,depth/6.4);edge=step(dot(q,q),.49);`
              : kind === 2
                ? `vec2 q=vec2((mod(p.x,16.)-8.)/9.6,depth/5.6);edge=step(dot(q,q),1.);`
                : `edge=step(depth,8.-abs(mod(p.x,14.)-7.));`
        }
        ink=mix(ink,vec3(1.),edge*step(0.,depth)*step(depth,8.)*${edge ? ".3" : "0."});
        ink=mix(ink,vec3(.004025,.016807,.049707),step(bandSize.y-2.,p.y)*${edge ? "1." : "0."});
        float radius=p.y<bandSize.y*.5?6.:3.;
        vec2 corner=abs(p-bandSize*.5)-(bandSize*.5-vec2(radius));
        float edgeDistance=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-radius;
        diffuseColor=vec4(ink,opacity*(1.-smoothstep(-aa,aa,edgeDistance)));
      `,
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
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  update(): void {
    const s = this.content.size.value;
    if (s) this.size.value.set(s[0], s[1]);
  }
  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Existing raised plate sheen, bevel and pressure shading, evaluated at the actual control size. */
export class RunButtonSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly size = { value: new Vector2(1, 1) };
  private readonly pressure = { value: 0 };
  constructor() {
    this.material.customProgramCacheKey = () => "run-button-plate";
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { buttonSize: this.size, buttonPressure: this.pressure });
      shader.vertexShader = "varying vec2 buttonUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nbuttonUv=uv;",
      );
      shader.fragmentShader =
        "varying vec2 buttonUv; uniform vec2 buttonSize; uniform float buttonPressure;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(buttonUv.x,1.-buttonUv.y)*buttonSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        float radius=6.; vec2 q=abs(p-buttonSize*.5)-(buttonSize*.5-vec2(radius));
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
        float top=max(.48*(1.-clamp(p.y/(buttonSize.y*.52),0.,1.)),(1.-step(2.,p.y))*.62);
        float bottom=step(buttonSize.y-2.,p.y)*.12;
        float pressed=(1.-step(3.,p.y))*.18;
        vec3 ink=vec3(1.); float alpha=top;
        if(bottom>0.) {ink=sRGBTransferEOTF(vec4(.051,.137,.247,1.)).rgb;alpha=bottom;}
        if(buttonPressure>.5) {ink=sRGBTransferEOTF(vec4(.051,.137,.247,1.)).rgb;alpha=pressed;}
        diffuseColor=vec4(ink,alpha*opacity*(1.-smoothstep(-aa,aa,d)));
      `,
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
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  setPressed(pressed: boolean): void {
    this.pressure.value = pressed ? 1 : 0;
  }
  update(): void {
    const s = this.content.size.value;
    if (s) this.size.value.set(s[0], s[1]);
  }
  dispose(): void {
    this.content.removeFromParent();
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
