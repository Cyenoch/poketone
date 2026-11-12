import { Content } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";

/** Toast-only ribbon and medallion paint; its parent owns Yoga layout and opacity. */
export class ToastSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly size = { value: new Vector2(1, 1) };
  private width = -1;
  private height = -1;

  private readonly kind: "ribbon" | "medallion";

  constructor(kind: "ribbon" | "medallion") {
    this.kind = kind;
    this.material.customProgramCacheKey = () => `poketone-toast-${kind}`;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.toastSize = this.size;
      shader.vertexShader = "varying vec2 toastUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\ntoastUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 toastUv; uniform vec2 toastSize;
        float ribbonDistance(vec2 p,vec2 size,float notch) {
          float side=notch*abs(2.*p.y/size.y-1.);
          float sideDistance=max(side-p.x,p.x-(size.x-side))/length(vec2(1.,2.*notch/size.y));
          return max(sideDistance,max(-p.y,p.y-size.y));
        }
        float erfApprox(float x) {
          float t=1./(1.+.3275911*abs(x));
          return sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t
            -.284496736)*t+.254829592)*t*exp(-x*x));
        }\n` + shader.fragmentShader;
      const ribbon = `
        vec2 p=vec2(toastUv.x,1.-toastUv.y)*(toastSize+120.)-60.;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        float edge=ribbonDistance(p,toastSize,18.);
        float outer=1.-smoothstep(-aa,aa,edge);
        float inner=1.-smoothstep(-aa,aa,ribbonDistance(p-vec2(4.,3.),toastSize-vec2(8.,6.),16.));
        vec3 navy=vec3(.051,.1373,.2471);
        vec3 band=mix(vec3(.1294,.3137,.4980),vec3(.0784,.1843,.3137),clamp((p.y-3.)/((toastSize.y-6.)*.74),0.,1.));
        float stripe=1.-step(2.,mod(p.x*.819152+p.y*.573576,8.));
        band=mix(band,vec3(1.),stripe*.05);
        band=mix(band,vec3(1.,.8314,.3569),(1.-smoothstep(3.,5.,p.y))*.55);
        float hard=1.-smoothstep(-aa,aa,ribbonDistance(p-vec2(0.,4.),toastSize,18.));
        // The second CSS drop-shadow includes the original ribbon and its 4px hard shadow.
        // Signed-distance Gaussian integration matches straight edges; pointed corners are approximate.
        float softDistance=min(ribbonDistance(p-vec2(0.,12.),toastSize,18.),
          ribbonDistance(p-vec2(0.,16.),toastSize,18.));
        float blur=.15*(1.-erfApprox(softDistance/25.455844));
        float solid=1.-(1.-outer)*(1.-hard);
        vec3 ink=mix(navy,band,inner);
        diffuseColor=vec4(sRGBTransferEOTF(vec4(ink,1.)).rgb,(solid+blur*(1.-solid))*opacity);
      `;
      const medallion = `
        vec2 p=vec2(toastUv.x,1.-toastUv.y)*toastSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        float d=length(p-toastSize*.5)-toastSize.x*.5;
        float fill=1.-smoothstep(-2.-aa,-2.+aa,d);
        float radius=length(p-toastSize*vec2(.5,.35))/(toastSize.x*.82);
        vec3 gold=radius<.55 ? mix(vec3(1.,.902,.5608),vec3(1.,.8314,.3569),radius/.55)
          : mix(vec3(1.,.8314,.3569),vec3(.949,.71,.1647),clamp((radius-.55)/.45,0.,1.));
        gold=mix(gold,vec3(.051,.1373,.2471),step(toastSize.y-4.,p.y)*.18);
        vec3 ink=mix(vec3(.051,.1373,.2471),gold,fill);
        diffuseColor=vec4(sRGBTransferEOTF(vec4(ink,1.)).rgb,(1.-smoothstep(-aa,aa,d))*opacity);
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\n${kind === "ribbon" ? ribbon : medallion}`,
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

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.size.value.set(width, height);
    if (this.kind === "ribbon")
      this.content.setProperties({
        positionLeft: -60,
        positionTop: -60,
        width: width + 120,
        height: height + 120,
      });
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
