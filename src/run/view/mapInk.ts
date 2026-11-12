import { Content } from "@pmndrs/uikit";
import { releaseUploads } from "../../rendering/releaseUploads";
import {
  Color,
  DynamicDrawUsage,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  type Texture,
} from "three";

/** Map-domain shapes share one instanced draw; the fixed quad keeps UIKit's measured bounds stable. */
export class MapInk {
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
    inkSize: { value: new Vector2(1, 1) },
    inkOpacity: { value: 1 },
    inkMask: { value: 0 },
    inkTexture: { value: null as Texture | null },
  };
  private readonly geometry = new InstancedBufferGeometry();
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  private readonly color = new Color();
  private capacity = 0;
  private count = 0;
  private data!: InstancedBufferAttribute;
  private fill!: InstancedBufferAttribute;
  private edge!: InstancedBufferAttribute;
  private mesh: Mesh;
  constructor(texture?: Texture) {
    const quad = new PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.attributes = quad.attributes;
    this.geometry.boundingBox = quad.boundingBox;
    this.geometry.instanceCount = 0;
    if (texture) this.uniforms.inkTexture.value = texture;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        `attribute vec4 inkPose; attribute vec4 inkStyle; attribute vec4 inkFill; attribute vec3 inkEdge;
        varying vec2 inkUv; varying vec2 inkPoint; varying vec4 inkSettings; varying vec4 inkColor; varying vec3 inkOutline;
        uniform vec2 inkSize;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        inkUv=(uv-.5)*2.; inkSettings=inkStyle; inkColor=inkFill; inkOutline=inkEdge;
        vec2 q=position.xy*inkPose.zw;
        float c=cos(inkStyle.y),s=sin(inkStyle.y);
        vec2 p=inkPose.xy+vec2(c*q.x-s*q.y,s*q.x+c*q.y);
        inkPoint=p/inkSize;
        vec3 transformed=vec3(p.x/inkSize.x,-p.y/inkSize.y,0.);
      `,
      );
      shader.fragmentShader =
        `varying vec2 inkUv; varying vec2 inkPoint; varying vec4 inkSettings; varying vec4 inkColor; varying vec3 inkOutline;
        uniform float inkOpacity; uniform float inkMask; uniform sampler2D inkTexture;
        float segmentDistance(vec2 p,vec2 a,vec2 b){ vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.)); }
        float triangleDistance(vec2 p,vec2 a,vec2 b,vec2 c){
          float d=min(segmentDistance(p,a,b),min(segmentDistance(p,b,c),segmentDistance(p,c,a)));
          vec2 v0=b-a,v1=c-b,v2=a-c; vec2 w0=p-a,w1=p-b,w2=p-c;
          float s0=v0.x*w0.y-v0.y*w0.x,s1=v1.x*w1.y-v1.y*w1.x,s2=v2.x*w2.y-v2.y*w2.x;
          return (s0>=0.&&s1>=0.&&s2>=0.)||(s0<=0.&&s1<=0.&&s2<=0.) ? -d : d;
        }\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=inkUv; float kind=inkSettings.x; float aa=max(fwidth(p.x),fwidth(p.y));
        float d=length(p)-1.; float coverage=1.; vec3 color=inkColor.rgb;
        if(kind<.5) { d=length(p)-1.; }
        else if(kind<1.5) { d=(abs(p.x)+abs(p.y)-1.)*.70710678; }
        else if(kind<2.5) { vec2 q=abs(p)-vec2(.65);d=length(max(q,0.))+min(max(q.x,q.y),0.)-.35; }
        else if(kind<3.5) { d=triangleDistance(p,vec2(1.,0.),vec2(-.40057,.29924),vec2(-.40057,-.29924)); }
        else if(kind<4.5) { d=abs(length(p)-(1.-inkSettings.z*.5))-inkSettings.z*.5; }
        else if(kind<5.5) { float r=length(p); coverage=r<.45?mix(1.,.85,r/.45):.85*(1.-clamp((r-.45)/.55,0.,1.));d=-1.; }
        else if(kind<6.5) { float r=length(p); coverage=(1.-clamp(r,0.,1.))*step(abs(atan(p.y,p.x)),.55);d=r-1.; }
        else if(kind<7.5) { d=triangleDistance(p,vec2(1.,0.),vec2(-.58,.863),vec2(-.58,-.863)); }
        else if(kind<8.5) { d=max(abs(p.x),abs(p.y))-1.; }
        else { vec4 texel=texture2D(inkTexture,vec2((p.x+1.)*.5,(1.-p.y)*.5));color=texel.rgb;coverage=texel.a;d=kind<9.5?-1.:length(p)-1.; }
        coverage*=1.-smoothstep(-aa,aa,d);
        if(kind<4.5 || (kind>6.5 && kind>9.5)) color=mix(color,inkOutline,smoothstep(-inkSettings.z-aa,-inkSettings.z+aa,d));
        if(inkMask>.5 && inkMask<1.5) coverage*=1.-clamp((length(inkPoint)*2.-.66)/.34,0.,1.);
        if(inkMask>1.5 && inkMask<2.5) coverage*=clamp((.5-abs(inkPoint.x))/.04,0.,1.)*clamp((.5-abs(inkPoint.y))/.04,0.,1.);
        if(inkMask>2.5 && inkMask<3.5) coverage*=step(length(inkPoint),.5);
        if(inkMask>3.5) coverage*=step(abs(inkPoint.x),.5)*step(abs(inkPoint.y),.5);
        diffuseColor=vec4(color,coverage*inkColor.a*inkOpacity);
      `,
      );
    };
    this.material.customProgramCacheKey = () => "run-map-ink";
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // One invisible measuring plane; instance positions never become a second layout model.
    const measure = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ visible: false }));
    this.content.add(measure, this.mesh);
    this.content.notifyAncestorsChanged();
  }
  begin(): void {
    this.count = 0;
  }
  add(
    x: number,
    y: number,
    width: number,
    height: number,
    kind: number,
    fill: string,
    outline = "#0d233f",
    stroke = 1.25,
    angle = 0,
    opacity = 1,
  ): void {
    if (this.count === this.capacity) this.grow();
    const i = this.count++;
    const size = this.uniforms.inkSize.value;
    (this.geometry.getAttribute("inkPose") as InstancedBufferAttribute).setXYZW(
      i,
      x - size.x / 2,
      y - size.y / 2,
      width,
      height,
    );
    this.data.setXYZW(i, kind, angle, (stroke / Math.min(width, height)) * 2, 0);
    this.color.set(fill);
    this.fill.setXYZW(i, this.color.r, this.color.g, this.color.b, opacity);
    this.color.set(outline);
    this.edge.setXYZ(i, this.color.r, this.color.g, this.color.b);
  }
  private grow(): void {
    if (this.capacity > 0) this.geometry.dispose();
    this.capacity = Math.max(64, this.capacity * 2);
    for (const [name, components] of [
      ["inkPose", 4],
      ["inkStyle", 4],
      ["inkFill", 4],
      ["inkEdge", 3],
    ] as const) {
      const prior = this.geometry.getAttribute(name);
      const attribute = new InstancedBufferAttribute(
        new Float32Array(this.capacity * components),
        components,
      ).setUsage(DynamicDrawUsage);
      if (prior) (attribute.array as Float32Array).set(prior.array);
      this.geometry.setAttribute(name, attribute);
    }
    this.data = this.geometry.getAttribute("inkStyle") as InstancedBufferAttribute;
    this.fill = this.geometry.getAttribute("inkFill") as InstancedBufferAttribute;
    this.edge = this.geometry.getAttribute("inkEdge") as InstancedBufferAttribute;
  }
  end(): void {
    this.geometry.instanceCount = this.count;
    for (const attribute of Object.values(this.geometry.attributes))
      if (attribute instanceof InstancedBufferAttribute) attribute.needsUpdate = true;
  }
  afterLayout(): void {
    const s = this.content.size.value;
    if (s) this.uniforms.inkSize.value.set(s[0], s[1]);
  }
  restore(): void {
    this.material.needsUpdate = true;
    for (const a of Object.values(this.geometry.attributes)) a.needsUpdate = true;
  }
  releaseUploads(): void {
    releaseUploads(this.content);
  }
  dispose(): void {
    this.releaseUploads();
    this.content.removeFromParent();
    this.content.dispose();
  }
}
