import { UiShaderMaterial } from "./ui-shader";
import { Color, Matrix4, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";

/** Full-window radial dimming and the dialog's bounded shadow, below UIKit's UI pass. */
export class DialogBackdrop {
  readonly dim: Mesh;
  readonly shadow: Mesh;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly panelScale = new Vector3();
  private readonly dimMaterial = new UiShaderMaterial("dialog-dim", {
    uniforms: {
      size: { value: new Vector2(1, 1) },
      ink: { value: new Color("#0d233f") },
      alpha: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec2 size;
      uniform vec3 ink;
      uniform float alpha;
      void main() {
        vec2 point=vec2(vUv.x,1.-vUv.y)*size;
        float radius=length(size*vec2(.5,.55));
        float t=clamp(length(point-size*vec2(.5,.45))/(radius*.8),0.,1.);
        gl_FragColor=vec4(ink,mix(.42,.78,t)*alpha);
        #include <colorspace_fragment>
      }`,
  });
  private readonly shadowMaterial = new UiShaderMaterial("dialog-shadow", {
    uniforms: {
      panelSize: { value: new Vector2(1, 1) },
      ink: { value: new Color("#0d233f") },
      alpha: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec2 panelSize;
      uniform vec3 ink;
      uniform float alpha;
      float roundedDistance(vec2 p) {
        vec2 q=abs(p)-(panelSize*.5-vec2(12.));
        return length(max(q,0.))+min(max(q.x,q.y),0.)-12.;
      }
      float erfApprox(float x) {
        float t=1./(1.+.3275911*abs(x));
        return sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t
          -.284496736)*t+.254829592)*t*exp(-x*x));
      }
      void main() {
        vec2 p=(vec2(vUv.x,1.-vUv.y)-.5)*(panelSize+vec2(252.));
        // CSS 70px blur corresponds to sigma=35. The rounded-distance approximation
        // matches straight edges; corner convolution is checked separately in visual QA.
        float soft=.4*.5*(1.-erfApprox(roundedDistance(p-vec2(0.,20.))/49.497475));
        float d=roundedDistance(p-vec2(0.,5.));
        float hard=1.-smoothstep(-.5*fwidth(d),.5*fwidth(d),d);
        gl_FragColor=vec4(ink,(hard+soft*(1.-hard))*alpha);
        #include <colorspace_fragment>
      }`,
  });

  constructor() {
    this.dim = new Mesh(this.geometry, this.dimMaterial);
    this.shadow = new Mesh(this.geometry, this.shadowMaterial);
    this.dim.renderOrder = -2;
    this.shadow.renderOrder = -1;
    this.shadow.matrixAutoUpdate = false;
    this.shadow.visible = false;
  }

  resize(width: number, height: number): void {
    this.dim.scale.set(width, height, 1);
    this.dimMaterial.uniforms.size!.value.set(width, height);
  }

  updatePanel(matrix: Matrix4, width: number, height: number): void {
    this.shadow.visible = true;
    this.shadow.matrix.copy(matrix).scale(this.panelScale.set(width + 252, height + 252, 1));
    this.shadowMaterial.uniforms.panelSize!.value.set(width, height);
  }

  setOpacity(opacity: number): void {
    this.dimMaterial.uniforms.alpha!.value = opacity;
    this.shadowMaterial.uniforms.alpha!.value = opacity;
  }

  dispose(): void {
    this.dim.removeFromParent();
    this.shadow.removeFromParent();
    this.geometry.dispose();
    this.dimMaterial.dispose();
    this.shadowMaterial.dispose();
  }
}
