import {
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  FrontSide,
  IcosahedronGeometry,
  InstancedInterleavedBuffer,
  InstancedMesh,
  InterleavedBufferAttribute,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type ShaderMaterial,
  type Side,
} from "three";
import type { Area } from "../../sim/state/entities";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { FX_GLSL, fxMaterial, uploadRange, type FxUniforms, type Rgb } from "./gl";

const STRIDE = 12;

const vertexShader = /* glsl */ `
#ifdef CONFORM
${TERRAIN_GLSL}
#endif
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iP;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
varying vec4 vA;
varying vec4 vB;
varying vec4 vP;
varying float vLen;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(position, 1.0);
  #ifdef CONFORM
  world.y += terrainHeight(world.xz);
  #endif
  // Plain matrix, not the inverse transpose: exact for the uniform cross-sections these bodies are scaled with.
  vN = normalize(mat3(m) * normal);
  vV = normalize(cameraPosition - world.xyz);
  vObj = position;
  vUv = uv;
  vA = iA;
  vB = iB;
  vP = iP;
  vLen = length(m[2].xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragment = (shade: string) => /* glsl */ `
${FX_GLSL}
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vObj;
varying vec4 vA;
varying vec4 vB;
varying vec4 vP;
varying float vLen;
float fresnel() {
  return 1.0 - abs(dot(normalize(vN), normalize(vV)));
}
${shade}
void main() {
  vec4 c = shade() * vA.a;
  if (c.r + c.g + c.b + c.a < 0.004) discard;
  gl_FragColor = c;
}
`;

/** Fire (style 0): boiling two-tone flame with an inked rim. Electric (1): crackle web and a hot rim. */
const ORB = /* glsl */ `
vec4 shade() {
  float f = fresnel();
  float seed = vP.y;
  if (vP.x < 0.5) {
    vec3 o = vObj * 2.4 + vec3(0.0, -uTime * 3.2, 0.0) + seed * 9.0;
    float heat = (noise3(o) * 0.65 + noise3(o * 2.2) * 0.35) * 0.8 + (1.0 - f) * 0.45;
    vec3 c = mix(vB.rgb, vA.rgb, smoothstep(0.5, 0.6, heat));
    c = mix(c, vec3(1.0, 0.97, 0.84), smoothstep(0.82, 0.9, heat));
    return over(layer(INK, smoothstep(0.82, 0.97, f) * 0.8, 0.0), layer(c, 1.0, 0.15));
  }
  vec3 o = vObj * 2.1 + seed * 9.0 + vec3(uTime * 1.7, uTime * 2.3, -uTime * 1.1);
  float n = noise3(o) * 0.6 + noise3(o * 2.3) * 0.4;
  // Crisp arcs a couple of pixels wide wherever the noise crosses its midline.
  float crack = 1.0 - smoothstep(1.0, 2.6, abs(n - 0.5) / max(fwidth(n), 1e-4));
  vec3 c = mix(mix(vA.rgb, vec3(1.0), crack), vB.rgb, smoothstep(0.5, 0.9, f) * 0.6);
  return over(layer(INK, smoothstep(0.84, 0.97, f) * 0.75, 0.0), layer(c, 1.0, 0.2 + crack * 0.6));
}
`;

/** Fire Spin's tornado: twisted, two-tone flame tongues with dark-red ink edges. */
const FUNNEL = /* glsl */ `
vec4 shade() {
  float h = vObj.y;
  float twist = h * 2.6 - uTime * 3.4;
  vec2 xz = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * vObj.xz;
  vec3 o = vec3(xz * 2.3, h * 3.2 - uTime * 2.6) + vP.y * 7.0;
  float v = noise3(o) * 0.7 + noise3(o * 2.3) * 0.3 + (1.0 - h) * 0.22 - 0.04;
  float body = smoothstep(0.44, 0.5, v);
  float core = smoothstep(0.6, 0.66, v);
  float ink = smoothstep(0.37, 0.43, v) * (1.0 - body);
  float fade = smoothstep(0.0, 0.14, h) * smoothstep(1.0, 0.55, h);
  vec4 c = layer(vec3(0.5, 0.07, 0.03), ink * 0.85, 0.0);
  return over(layer(mix(vB.rgb, vA.rgb, core), body, 0.5), c) * fade;
}
`;

/** Beams: 0 sun core, 1 sun halo, 2 water torrent, 3 water spray shell. */
const BEAM = /* glsl */ `
vec4 shade() {
  float f = fresnel();
  float along = vObj.z;
  float l = along * vLen;
  float ends = smoothstep(0.0, 0.012, along) * smoothstep(1.0, 0.93, along);
  float style = vP.x;
  if (style < 0.5) {
    float pulse = 0.85 + 0.15 * sin(l * 1.3 - uTime * 30.0);
    return layer(mix(vA.rgb, vec3(1.0), 1.0 - f), ends * pulse * (1.0 - f * 0.5), 0.85);
  }
  if (style < 1.5) {
    float rays = 0.7 + 0.3 * sin(vUv.x * 37.7 + l * 0.6 - uTime * 16.0);
    return layer(mix(vA.rgb, vB.rgb, f), pow(1.0 - f, 1.3) * 0.6 * ends * rays, 0.5);
  }
  if (style < 2.5) {
    float swirl = fract(vUv.x * 3.0 + l * 0.22 - uTime * 3.6);
    float band = smoothstep(0.0, 0.1, swirl) * smoothstep(0.55, 0.42, swirl);
    float foam = smoothstep(0.62, 0.78, noise3(vec3(vObj.xy * 2.5, l * 0.7 - uTime * 16.0)));
    vec3 c = mix(vB.rgb, vA.rgb, band * 0.75 + (1.0 - f) * 0.25);
    c = mix(c, vec3(1.0), foam);
    c = mix(c, INK, smoothstep(0.84, 0.98, f) * 0.65);
    return layer(c, 0.92 * ends, 0.1);
  }
  float n = noise3(vec3(vObj.xy * 3.0, l * 0.5 - uTime * 10.0));
  return layer(mix(vA.rgb, vec3(1.0), n), smoothstep(0.45, 0.8, n) * pow(1.0 - f, 0.7) * 0.6 * ends, 0.3);
}
`;

/** Rapid Spin's wind wall: three inked crescents racing round. */
const WHIRL = /* glsl */ `
vec4 shade() {
  float h = vObj.y;
  float s = fract(atan(vObj.z, vObj.x) * 0.4775 - h * 0.35 - uTime * 7.5);
  float blade = smoothstep(0.3, 0.93, s) * smoothstep(1.0, 0.95, s);
  float head = smoothstep(0.88, 0.95, s) * smoothstep(1.0, 0.965, s);
  float fade = smoothstep(0.0, 0.3, h) * smoothstep(1.0, 0.6, h);
  vec4 c = layer(mix(vB.rgb, vA.rgb, blade), blade * 0.85, 0.3);
  return over(layer(INK, head * 0.55, 0.0), c) * fade;
}
`;

const scratch = new Matrix4();
const position = new Vector3();
const scale = new Vector3();
const rotation = new Quaternion();
const turn = new Euler(0, 0, 0, "YXZ");

/** Scratch transform for `Volume.add`: translate, yaw about +y (pitch about the turned x), then scale. */
export function place(
  x: number,
  y: number,
  z: number,
  yaw: number,
  sx: number,
  sy: number,
  sz: number,
  pitch = 0,
): Matrix4 {
  return scratch.compose(
    position.set(x, y, z),
    rotation.setFromEuler(turn.set(pitch, yaw, 0)),
    scale.set(sx, sy, sz),
  );
}

export const BEAM_MOUTH = 0.6;

/** A beam area's straight 3D body from its mouth (0.6 ahead of the caster): matches the sim's line. */
export function beamBody(
  area: Area,
  x: number,
  y: number,
  z: number,
  yaw: number,
  width: number,
): Matrix4 {
  const length = Math.max(0, area.length - BEAM_MOUTH);
  return place(
    x,
    y,
    z,
    yaw,
    width,
    width,
    length * Math.hypot(1, area.rise),
    -Math.atan(area.rise),
  );
}

/** One instanced shader body (orbs, funnels, beams, whirls), re-submitted every frame. */
export class Volume {
  readonly mesh: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly buffer: InstancedInterleavedBuffer;
  private count = 0;

  constructor(
    geometry: BufferGeometry,
    shade: string,
    uniforms: FxUniforms,
    capacity: number,
    side: Side,
    ground?: TerrainUniforms,
  ) {
    this.material = fxMaterial({
      uniforms: { ...uniforms, ...ground },
      defines: ground ? { CONFORM: "" } : {},
      vertexShader,
      fragmentShader: fragment(shade),
      side,
    });
    this.buffer = new InstancedInterleavedBuffer(new Float32Array(capacity * STRIDE), STRIDE);
    this.buffer.setUsage(DynamicDrawUsage);
    geometry.setAttribute("iA", new InterleavedBufferAttribute(this.buffer, 4, 0));
    geometry.setAttribute("iB", new InterleavedBufferAttribute(this.buffer, 4, 4));
    geometry.setAttribute("iP", new InterleavedBufferAttribute(this.buffer, 4, 8));
    this.mesh = new InstancedMesh(geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  begin(): void {
    this.count = 0;
  }

  /** `style` picks the look inside the shader; `fade` scales the whole instance. */
  add(matrix: Matrix4, a: Rgb, fade: number, b: Rgb, style: number, seed = 0): void {
    if (this.count >= this.mesh.instanceMatrix.count) return;
    const i = this.count++;
    this.mesh.setMatrixAt(i, matrix);
    const d = this.buffer.array as Float32Array;
    const o = i * STRIDE;
    d[o] = a[0];
    d[o + 1] = a[1];
    d[o + 2] = a[2];
    d[o + 3] = fade;
    d[o + 4] = b[0];
    d[o + 5] = b[1];
    d[o + 6] = b[2];
    d[o + 8] = style;
    d[o + 9] = seed;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    uploadRange(this.mesh.instanceMatrix, this.count * 16);
    uploadRange(this.buffer, this.count * STRIDE);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

export interface Volumes {
  orbs: Volume;
  funnels: Volume;
  beams: Volume;
  whirls: Volume;
}

export function createVolumes(uniforms: FxUniforms, ground: TerrainUniforms): Volumes {
  return {
    orbs: new Volume(new IcosahedronGeometry(1, 3), ORB, uniforms, 24, FrontSide),
    funnels: new Volume(
      new CylinderGeometry(1, 0.38, 1, 28, 6, true).translate(0, 0.5, 0),
      FUNNEL,
      uniforms,
      16,
      DoubleSide,
    ),
    beams: new Volume(
      new CylinderGeometry(1, 1, 1, 18, 40, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      BEAM,
      uniforms,
      24,
      FrontSide,
    ),
    whirls: new Volume(
      new CylinderGeometry(1, 1, 1, 36, 2, true).translate(0, 0.5, 0),
      WHIRL,
      uniforms,
      4,
      DoubleSide,
      ground,
    ),
  };
}
