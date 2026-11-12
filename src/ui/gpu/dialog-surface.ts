import { Content } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";

/** Authored game plate details, in logical pixels; UIKit owns placement and clipping. */

export class DialogSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly uniforms = {
    plateSize: { value: new Vector2(1, 1) },
    plateTime: { value: 0 },
    plateDisabled: { value: 0 },
  };

  private readonly kind: "header" | "knob" | "track";

  constructor(kind: "header" | "knob" | "track") {
    this.kind = kind;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 plateUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nplateUv=uv;",
      );
      shader.fragmentShader =
        `
        varying vec2 plateUv;
        uniform vec2 plateSize;
        uniform float plateTime;
        uniform float plateDisabled;
        float stroke(float d,float width,float aa) { return 1.-smoothstep(width-aa,width+aa,abs(d)); }
      ` + shader.fragmentShader;
      const header = `
        vec3 top=vec3(0.1294,0.3137,0.4980);
        vec3 bottom=vec3(0.0784,0.1843,0.3137);
        vec3 base=mix(top,bottom,clamp(p.y/(plateSize.y*.74),0.,1.));
        float stripe=1.-step(2.,mod(p.x*.819152+p.y*.573576-plateTime*(8./3.),8.));
        base=mix(base,vec3(1.),stripe*.05);
        vec2 ball=p-vec2(plateSize.x-30.,plateSize.y*.5);
        float angle=-plateTime*6.2831853/40.;
        ball=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*ball;
        ball*=24./92.;
        float ink=max(stroke(length(ball)-10.4,1.1,aa*24./92.),stroke(length(ball)-3.6,1.1,aa*24./92.));
        ink=max(ink,stroke(ball.y,1.1,aa*24./92.)*step(3.6,abs(ball.x))*step(abs(ball.x),10.4));
        base=mix(base,vec3(1.),ink*.13);
        base=mix(base,vec3(1.),(1.-step(1.,p.y))*.22);
        base=mix(base,vec3(.0510,.1373,.2471),step(plateSize.y-3.,p.y));
        diffuseColor=vec4(sRGBTransferEOTF(vec4(base,1.)).rgb,1.);
      `;
      const knob = `
        float sheen=.48*(1.-clamp(p.y/(plateSize.y*.52),0.,1.));
        float bevel=(1.-step(2.,p.y))*.62;
        float shade=step(plateSize.y-2.,p.y)*.12;
        float hatch=(1.-step(4.,mod(p.x-p.y,9.)))*.5;
        float alpha=plateDisabled>.5 ? hatch : max(sheen,bevel);
        diffuseColor=vec4(vec3(1.),alpha);
        if(shade>0.) diffuseColor=vec4(sRGBTransferEOTF(vec4(.051,.137,.247,1.)).rgb,shade);
      `;
      const track = `diffuseColor=vec4(0.,0.,0.,(1.-smoothstep(0.,3.,p.y))*.35);`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(plateUv.x,1.-plateUv.y)*plateSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        ${this.kind === "header" ? header : this.kind === "knob" ? knob : track}
        float radius=${this.kind === "header" ? "6." : this.kind === "knob" ? "5." : "6."};
        vec2 q=abs(p-plateSize*.5)-(plateSize*.5-vec2(radius));
        float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
        diffuseColor.a*=opacity*(1.-smoothstep(-aa,aa,edge));
      `,
      );
    };
    this.material.customProgramCacheKey = () => `poketone-dialog-${kind}`;
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

  /**
   * Advances the band's drift; true when it needs a redraw. The stripes move under 3 px/s and the
   * mark turns once in 40s, so 15 redraws a second step them under 0.2 px instead of keeping the
   * whole window drawing every frame.
   */
  /** Advances the band's drift; true for a surface that moves on its own (a header band), which
   *  its owner redraws on the stage's 15Hz idle clock (`UiMotion.ticked`). */
  update(deltaMs: number): boolean {
    const size = this.content.size.value;
    if (size) this.uniforms.plateSize.value.set(size[0], size[1]);
    this.uniforms.plateTime.value = (this.uniforms.plateTime.value + deltaMs / 1000) % 120;
    return this.kind === "header";
  }

  setDisabled(disabled: boolean): void {
    this.uniforms.plateDisabled.value = disabled ? 1 : 0;
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
