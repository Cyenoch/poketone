import { HARD_SHADOW, RADIUS, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";
import { Color, Matrix4, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";

/** Full-window ink vignette and the dialog's hard shadow (offset right and down), below UIKit's UI
 *  pass. */
export class DialogBackdrop {
  readonly dim: Mesh;
  readonly shadow: Mesh;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly panelScale = new Vector3();
  private readonly dimMaterial = new UiShaderMaterial("dialog-dim", {
    uniforms: {
      size: { value: new Vector2(1, 1) },
      ink: { value: new Color(ui.ink) },
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
        // Ink vignette: 62% at the centre, 80% at the corners, so the screen below reads as behind.
        vec2 q=(vUv-.5)*size/max(size.x,size.y)*2.;
        gl_FragColor=vec4(ink,mix(.62,.8,smoothstep(.15,1.,length(q)))*alpha);
        #include <colorspace_fragment>
      }`,
  });
  private readonly shadowMaterial = new UiShaderMaterial("dialog-shadow", {
    uniforms: {
      panelSize: { value: new Vector2(1, 1) },
      ink: { value: new Color(ui.ink) },
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
      void main() {
        vec2 p=(vec2(vUv.x,1.-vUv.y)-.5)*(panelSize+vec2(252.))-vec2(${HARD_SHADOW.offset + 1}.);
        vec2 q=abs(p)-(panelSize*.5-vec2(${RADIUS}.));
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-${RADIUS}.;
        float hard=1.-smoothstep(-.5*fwidth(d),.5*fwidth(d),d);
        gl_FragColor=vec4(vec3(0.),hard*${HARD_SHADOW.alpha}*alpha);
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
