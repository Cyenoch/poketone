import { UiShaderMaterial } from "./ui-shader";
import { Mesh, PlaneGeometry } from "three";

/** Analytic, antialiased focus marker: crisp at every UI scale without a bitmap upload. */
export function createBallMark() {
  return new Mesh(
    new PlaneGeometry(24, 24),
    new UiShaderMaterial("ball-mark", {
      uniforms: { alpha: { value: 1 }, clipBottom: { value: -1e9 }, clipTop: { value: 1e9 } },
      vertexShader: `varying vec2 vUv; varying float worldY; void main(){ vUv=uv; worldY=(modelMatrix*vec4(position,1.)).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
      varying vec2 vUv; varying float worldY;
      uniform float alpha; uniform float clipBottom; uniform float clipTop;
      void main(){
        if(worldY < clipBottom || worldY > clipTop) discard;
        vec2 p=(vUv-.5)*24.; float r=length(p); float aa=.5*fwidth(r);
        float coverage=1.-smoothstep(11.75-aa,11.75+aa,r);
        vec3 ink=vec3(.051,.137,.247); vec3 color=p.y>0.?vec3(.659,.196,.263):vec3(1.);
        float rim=smoothstep(9.25-aa,9.25+aa,r);
        float stripe=1.-smoothstep(1.25-aa,1.25+aa,abs(p.y));
        color=mix(color,ink,max(rim,stripe));
        color=mix(color,ink,1.-smoothstep(4.85-aa,4.85+aa,r));
        color=mix(color,vec3(1.),1.-smoothstep(2.35-aa,2.35+aa,r));
        gl_FragColor=vec4(color,coverage*alpha);
      }`,
    }),
  );
}
