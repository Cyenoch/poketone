import { Content } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import type { ElementType } from "../../run/sim/content/elements";
import { themeEdge, themeGrain } from "./run-theme";

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
  constructor(theme: ElementType, top: string, bottom: string, edge: boolean) {
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
        {${grain.glsl}}
        ink=mix(ink,bandGrain,grain);
        float depth=bandSize.y-2.-p.y;
        float edge=0.;
        ${themeEdge(theme, "p.x", "depth")}
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
