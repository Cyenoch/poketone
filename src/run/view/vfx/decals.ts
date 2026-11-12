import {
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  PlaneGeometry,
  type ShaderMaterial,
} from "three";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { FX_GLSL, fxMaterial, uploadRange, type FxUniforms, type Rgb } from "./gl";
import { compact } from "./pool";
import { ICE_GLSL } from "../environment/ice-surface";

/**
 * Ground shapes. Every shape reads `t` (progress 0..1) and works in units of `radius`
 * (for lanes and fans: their length), so they scale with live upgrade values.
 */
export const Decal = {
  /** Shock ring; p2 = width, p3 = start radius fraction. Expands and fades with t. */
  ring: 0,
  glow: 1,
  /** Burnt blot with dying embers. */
  scorch: 2,
  /** Fan around +forward; p2 = half-angle, p3 = style (0 heat, 1 powder). */
  sector: 3,
  /** Player strike warning that fills toward the rim as t → 1. */
  telegraph: 4,
  /** Enemy lane; p2 = half-width in world units. Fills along as t → 1. */
  danger: 5,
  swirl: 6,
  cracks: 7,
  /** The 大 of Fire Blast; p2 = 1 while burning, 0 for the scorch it leaves. */
  blast: 8,
  /** Beam lane; p2 = half-width in world units, p3 = style (0 sun, 1 water, 2 aim line in colour a). */
  strip: 9,
  ripple: 10,
  whirl: 11,
  /** Enemy fan: p2 = half-angle, p3 = 1 during the active strike. */
  cone: 12,
  /** Finite slippery ice: submerged facets, fine fractures and a snow-covered shore. */
  ice: 13,
} as const;

const STRIDE = 24;

const vertexShader = /* glsl */ `
${TERRAIN_GLSL}
uniform float uLiquidTop;
attribute vec4 iOrigin;
attribute vec4 iRect;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iP;
attribute vec4 iX;
varying vec2 vL;
varying vec4 vA;
varying vec4 vB;
varying vec4 vP;
varying vec4 vX;
void main() {
  vec2 local = mix(iRect.xy, iRect.zw, uv);
  vec2 fwd = vec2(sin(iOrigin.z), cos(iOrigin.z));
  vec2 xz = iOrigin.xy + vec2(-fwd.y, fwd.x) * local.x + fwd * local.y;
  // Over a sea or lava lake the decal lies on the liquid's surface, not on the bed beneath it.
  float base = max(terrainHeight(xz), uLiquidTop);
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, base + iOrigin.w, xz.y, 1.0);
  vL = local;
  vA = iA;
  vB = iB;
  vP = iP;
  vX = iX;
}
`;

const fragmentShader = /* glsl */ `
${FX_GLSL}
varying vec2 vL;
varying vec4 vA;
varying vec4 vB;
varying vec4 vP;
varying vec4 vX;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

vec4 ring(vec2 q, float t, float width, float start) {
  float grow = 1.0 - (1.0 - t) * (1.0 - t);
  float radius = mix(start, 1.0, grow);
  float w = width * (1.0 - 0.6 * t);
  float band = smoothstep(w, w * 0.25, abs(length(q) - radius + w));
  return layer(mix(vB.rgb, vA.rgb, band), band * (1.0 - t * t), vB.a);
}

vec4 glow(vec2 q) {
  float r = length(q);
  return layer(mix(vA.rgb, vB.rgb, smoothstep(0.6, 0.0, r)), pow(max(0.0, 1.0 - r), 1.6), vB.a);
}

vec4 scorch(vec2 q, float t, float seed) {
  float r = length(q) + (fbm2(q * 2.2 + seed * 31.0) - 0.5) * 0.55;
  float burnt = smoothstep(1.0, 0.7, r) * (1.0 - smoothstep(0.45, 1.0, t));
  float ember = smoothstep(0.7, 0.8, noise2(q * 7.0 + seed * 13.0)) * smoothstep(0.9, 0.3, r) * (1.0 - smoothstep(0.0, 0.55, t));
  return over(layer(vB.rgb, ember, 1.0), layer(vA.rgb, burnt * 0.5, 0.0));
}

vec4 sector(vec2 q, float halfAngle, float style, float seed) {
  float r = length(q);
  float ang = atan(q.x, q.y);
  float inside = smoothstep(halfAngle + 0.03, halfAngle - 0.08, abs(ang)) * smoothstep(1.02, 0.9, r) * smoothstep(0.04, 0.25, r);
  if (style < 0.5) {
    float n = fbm2(vec2(ang * 4.0 + seed * 9.0, r * 5.0 - uTime * 5.0));
    float heat = inside * (0.25 + 0.75 * smoothstep(0.42, 0.72, n)) * (1.15 - r * 0.7);
    return layer(mix(vA.rgb, vB.rgb, n), heat, vB.a);
  }
  float n = fbm2(q * 3.0 + vec2(0.0, -uTime * 0.9) + seed * 5.0);
  float dots = smoothstep(0.8, 0.92, noise2(q * 16.0 + vec2(uTime * 0.7, -uTime * 1.6) + seed));
  return over(layer(vec3(1.0), inside * dots, 1.0), layer(mix(vA.rgb, vB.rgb, n), inside * (0.35 + 0.65 * n), vB.a));
}

vec4 telegraph(vec2 q, float t) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  float dash = step(0.45, fract(ang * 1.9099 + uTime * 0.8));
  float rim = smoothstep(0.075, 0.035, abs(r - 0.94)) * mix(1.0, dash, 0.7);
  float front = smoothstep(0.05, 0.0, abs(r - t)) * step(r, 1.0);
  float fill = smoothstep(t + 0.02, t - 0.02, r) * 0.32;
  float cross = max(smoothstep(0.03, 0.0, abs(q.x)), smoothstep(0.03, 0.0, abs(q.y))) * step(r, 0.3);
  vec4 c = layer(vB.rgb, fill + cross * 0.6, 0.4);
  c = over(layer(vA.rgb, front * 0.9, 0.5), c);
  return over(layer(vA.rgb, rim, 0.2), layer(INK, smoothstep(0.12, 0.06, abs(r - 0.94)) * 0.5, 0.0) + c);
}

vec4 danger(vec2 l, float t, float halfWidth, float length) {
  float across = abs(l.x) / halfWidth;
  float along = l.y / length;
  float inside = smoothstep(1.04, 0.98, across) * smoothstep(-0.02, 0.01, along) * smoothstep(1.02, 0.98, along);
  float pulse = 0.8 + 0.2 * sin(uTime * 12.0);
  float border = smoothstep(0.78, 0.88, across) * inside;
  float fill = smoothstep(t + 0.01, t - 0.01, along) * inside;
  float chevron = step(0.6, fract((l.y - abs(l.x) * 0.9) * 0.55 - uTime * 2.2)) * inside * (1.0 - border);
  vec4 c = layer(vA.rgb, inside * 0.22 + fill * 0.38 + chevron * 0.22, 0.0);
  // Two values inside the existing hitbox keep the rim legible on pale sand and dark ground.
  float edge = smoothstep(0.94, 0.99, across) * inside;
  float tip = smoothstep(0.95, 0.985, along) * inside;
  c = over(layer(INK, max(border, tip) * 0.9, 0.0), c);
  c = over(layer(vB.rgb, border * pulse, 0.0), c);
  return over(layer(mix(vA.rgb, vec3(1.0), 0.72), max(edge, tip) * pulse, 0.0), c);
}

vec4 swirl(vec2 q, float t, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  float spiral = fract(ang * 0.4775 + r * 1.3 - uTime * 1.7 + seed);
  float arms = smoothstep(0.5, 0.78, spiral) * smoothstep(1.0, 0.9, spiral);
  float disc = smoothstep(1.0, 0.82, r);
  float rim = smoothstep(0.07, 0.0, abs(r - 0.93));
  vec4 c = layer(vec3(0.24, 0.07, 0.04), disc * 0.3 * t, 0.0);
  c = over(layer(mix(vA.rgb, vB.rgb, smoothstep(0.8, 0.2, r)), arms * disc * t, vB.a), c);
  return over(layer(vB.rgb, rim * t, vB.a), c);
}

vec4 cracks(vec2 q, float t, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x) * 1.1141 + seed * 6.0;
  float jag = (noise2(vec2(r * 7.0, seed * 17.0 + floor(ang))) - 0.5) * 0.7;
  float line = abs(fract(ang + jag) - 0.5) * r * 5.64;
  float reach = 0.55 + 0.45 * hash12(vec2(floor(ang + jag), seed));
  float crack = smoothstep(0.05, 0.015, line) * smoothstep(reach, reach - 0.2, r) * smoothstep(0.08, 0.18, r);
  float fade = 1.0 - smoothstep(0.55, 1.0, t);
  vec4 c = layer(vec3(0.13, 0.12, 0.16), (crack * 0.8 + smoothstep(0.55, 0.0, r) * 0.25) * fade, 0.0);
  return over(layer(vA.rgb, crack * (1.0 - smoothstep(0.0, 0.3, t)), 1.0), c);
}

vec4 blast(vec2 q, float t, float burning, float seed) {
  float d = min(min(segment(q, vec2(-0.85, 0.32), vec2(0.85, 0.32)), segment(q, vec2(0.0, 0.95), vec2(0.0, 0.32))),
    min(segment(q, vec2(0.0, 0.32), vec2(-0.8, -0.88)), segment(q, vec2(0.0, 0.32), vec2(0.8, -0.88))));
  d -= (fbm2(q * 5.0 + vec2(0.0, -uTime * 3.0) + seed * 7.0) - 0.5) * 0.1;
  float r = length(q);
  if (burning < 0.5) {
    float w = 0.14;
    float stroke = smoothstep(w, w - 0.04, d);
    float ember = smoothstep(0.68, 0.78, noise2(q * 8.0 + seed * 3.0)) * stroke * (1.0 - smoothstep(0.0, 0.5, t));
    return over(layer(vB.rgb, ember, 1.0), layer(vec3(0.2, 0.08, 0.05), stroke * 0.38 * (1.0 - smoothstep(0.4, 1.0, t)), 0.0));
  }
  float reach = smoothstep(0.0, 0.4, t) * 1.25;
  float reveal = smoothstep(reach, reach - 0.12, r) * (1.0 - smoothstep(0.75, 1.0, t));
  float w = 0.17;
  float stroke = smoothstep(w, w - 0.03, d) * reveal;
  float core = smoothstep(w * 0.45, w * 0.22, d) * reveal;
  float ink = smoothstep(w + 0.06, w + 0.02, d) * reveal;
  vec4 c = layer(vec3(0.45, 0.06, 0.03), ink, 0.0);
  c = over(layer(vA.rgb, stroke, 0.35), c);
  return over(layer(vB.rgb, core, 1.0), c);
}

vec4 strip(vec2 l, float halfWidth, float length, float style, float seed) {
  float across = abs(l.x) / halfWidth;
  float along = l.y / length;
  float ends = smoothstep(0.0, 0.02, along) * smoothstep(1.0, 0.85, along);
  if (style < 0.5) {
    float pulse = 0.8 + 0.2 * sin(l.y * 1.6 - uTime * 24.0);
    vec4 c = layer(vA.rgb, exp(-across * across * 1.6) * 0.45 * ends * pulse, 1.0);
    return over(layer(vB.rgb, exp(-across * across * 14.0) * 0.55 * ends, 1.0), c);
  }
  if (style < 1.5) {
    float foam = smoothstep(0.72, 0.9, noise2(vec2(l.x * 2.5 + seed * 9.0, l.y * 0.9 - uTime * 14.0)));
    vec4 c = layer(vA.rgb, smoothstep(1.25, 0.55, across) * 0.3 * ends, 0.0);
    return over(layer(vB.rgb, foam * smoothstep(1.1, 0.3, across) * ends * 0.7, 0.4), c);
  }
  float dash = step(0.45, fract(l.y * 0.9 - uTime * 5.0));
  return layer(vA.rgb, smoothstep(0.1, 0.03, abs(l.x)) * dash * ends, vB.a);
}

vec4 ripple(vec2 q, float t) {
  float r = length(q);
  float wave = 0.0;
  for (int i = 0; i < 3; i++) {
    float rr = t * 1.1 - float(i) * 0.22;
    wave += smoothstep(0.07, 0.0, abs(r - rr)) * step(0.0, rr) * (1.0 - float(i) * 0.3);
  }
  return layer(mix(vB.rgb, vA.rgb, wave), clamp(wave, 0.0, 1.0) * (1.0 - t), vB.a);
}

vec4 whirl(vec2 q, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  float band = smoothstep(0.45, 0.78, r) * smoothstep(1.05, 0.92, r);
  float streak = smoothstep(0.55, 1.0, fract(ang * 0.9549 - uTime * 2.6 + noise2(vec2(r * 5.0, seed)) * 0.4));
  return over(layer(vA.rgb, band * streak * 0.8, vB.a), layer(vB.rgb, band * 0.4, 0.0));
}

vec4 cone(vec2 q, float t, float halfAngle, float striking) {
  float r = length(q);
  float a = abs(atan(q.x,q.y));
  float inside = step(r,1.0) * step(a,halfAngle);
  float edge = max(smoothstep(0.04,0.012,abs(r-0.97)),
    smoothstep(0.04,0.01,abs(a-halfAngle)) * smoothstep(0.04,0.2,r)) * inside;
  float dash = step(0.4,fract(r*9.0-uTime*1.4));
  float front = smoothstep(0.035,0.0,abs(r-t)) * inside;
  vec4 c = layer(vB.rgb,inside*(0.12+striking*0.22),0.0);
  c = over(layer(INK,edge*0.8,0.0),c);
  return over(layer(vA.rgb,(edge*(0.4+dash*0.6)+front*0.3)*0.9,0.0),c);
}

${ICE_GLSL}

void main() {
  float shape = vP.x;
  float t = vP.y;
  float radius = vX.x;
  float seed = vX.y;
  vec2 q = vL / radius;
  vec4 c;
  if (shape < 0.5) c = ring(q, t, vP.z, vP.w);
  else if (shape < 1.5) c = glow(q);
  else if (shape < 2.5) c = scorch(q, t, seed);
  else if (shape < 3.5) c = sector(q, vP.z, vP.w, seed);
  else if (shape < 4.5) c = telegraph(q, t);
  else if (shape < 5.5) c = danger(vL, t, vP.z, radius);
  else if (shape < 6.5) c = swirl(q, t, seed);
  else if (shape < 7.5) c = cracks(q, t, seed);
  else if (shape < 8.5) c = blast(q, t, vP.z, seed);
  else if (shape < 9.5) c = strip(vL, vP.z, radius, vP.w, seed);
  else if (shape < 10.5) c = ripple(q, t);
  else if (shape < 11.5) c = whirl(q, seed);
  else if (shape < 12.5) c = cone(q,t,vP.z,vP.w);
  else {
    vec4 ice = iceSurface(q, seed, vP.z, vP.w, vA.rgb, vB.rgb);
    c = layer(ice.rgb, ice.a, 0.0);
  }
  c *= vA.a;
  if (c.r + c.g + c.b + c.a < 0.004) discard;
  gl_FragColor = c;
}
`;

interface Stamp {
  shape: number;
  x: number;
  z: number;
  radius: number;
  yaw: number;
  seed: number;
  age: number;
  life: number;
  a: Rgb;
  alpha: number;
  b: Rgb;
  add: number;
  p2: number;
  p3: number;
}

/**
 * Terrain-hugging shapes in one instanced draw. Live shapes are re-submitted every frame with
 * `put`; `stamp` leaves a shape behind (scorch, cracks, ripples) that ages on its own.
 */
export class Decals {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly data: Float32Array;
  private readonly stamps: Stamp[] = [];
  private stamped = 0;
  /** This frame's dt, read by `restamp`. */
  private step = 0;
  private count = 0;
  private readonly capacity: number;
  private readonly lift: number;
  private o = 0;

  constructor(material: ShaderMaterial, capacity: number, lift: number) {
    this.capacity = capacity;
    this.lift = lift;
    const plane = new PlaneGeometry(1, 1, 20, 20);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = plane.index;
    this.geometry.setAttribute("position", plane.getAttribute("position"));
    this.geometry.setAttribute("uv", plane.getAttribute("uv"));
    this.data = new Float32Array(capacity * STRIDE);
    this.buffer = new InstancedInterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(DynamicDrawUsage);
    const view = (offset: number) => new InterleavedBufferAttribute(this.buffer, 4, offset);
    this.geometry.setAttribute("iOrigin", view(0));
    this.geometry.setAttribute("iRect", view(4));
    this.geometry.setAttribute("iA", view(8));
    this.geometry.setAttribute("iB", view(12));
    this.geometry.setAttribute("iP", view(16));
    this.geometry.setAttribute("iX", view(20));
    this.geometry.instanceCount = 0;
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  static material(uniforms: FxUniforms, ground: TerrainUniforms): ShaderMaterial {
    return fxMaterial({
      uniforms: { ...uniforms, ...ground },
      vertexShader,
      fragmentShader,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
  }

  /** Starts a frame: ages and re-submits the stamps underneath this frame's live shapes. */
  begin(dt: number): void {
    this.count = 0;
    this.step = dt;
    this.stamped = compact(this.stamps, this.stamped, this.restamp);
  }

  /** Ages one stamp and re-submits it; false once it has faded out. Stamps keep their order. */
  private readonly restamp = (s: Stamp): boolean => {
    s.age += this.step;
    if (s.age >= s.life) return false;
    this.put(s.shape, s.x, s.z, s.radius, s.yaw, s.seed)
      .tint(s.a, s.alpha, s.b, s.add)
      .args(s.age / s.life, s.p2, s.p3);
    return true;
  };

  /** Adds a shape centred on (x, z) covering ±radius; chain `rect`, `tint` and `args` to fill it in. */
  put(shape: number, x: number, z: number, radius: number, yaw = 0, seed = 0): this {
    if (this.count >= this.capacity) {
      this.o = -1;
      return this;
    }
    const d = this.data;
    const o = (this.o = this.count++ * STRIDE);
    d[o] = x;
    d[o + 1] = z;
    d[o + 2] = yaw;
    d[o + 3] = this.lift;
    d[o + 4] = -radius;
    d[o + 5] = -radius;
    d[o + 6] = radius;
    d[o + 7] = radius;
    d[o + 16] = shape;
    d[o + 17] = 0;
    d[o + 18] = 0;
    d[o + 19] = 0;
    d[o + 20] = radius;
    d[o + 21] = seed;
    return this;
  }

  /** Overrides the covered rectangle (local units; +z is forward). */
  rect(minX: number, minZ: number, maxX: number, maxZ: number): this {
    const o = this.o;
    if (o < 0) return this;
    this.data[o + 4] = minX;
    this.data[o + 5] = minZ;
    this.data[o + 6] = maxX;
    this.data[o + 7] = maxZ;
    return this;
  }

  tint(a: Rgb, alpha: number, b: Rgb, add: number): this {
    const o = this.o;
    if (o < 0) return this;
    const d = this.data;
    d[o + 8] = a[0];
    d[o + 9] = a[1];
    d[o + 10] = a[2];
    d[o + 11] = alpha;
    d[o + 12] = b[0];
    d[o + 13] = b[1];
    d[o + 14] = b[2];
    d[o + 15] = add;
    return this;
  }

  args(t: number, p2 = 0, p3 = 0): this {
    const o = this.o;
    if (o < 0) return this;
    this.data[o + 17] = t;
    this.data[o + 18] = p2;
    this.data[o + 19] = p3;
    return this;
  }

  /** Leaves a self-ageing shape behind; `t` runs 0 → 1 over `life` seconds. Its yaw is fixed here (random by default). */
  stamp(
    shape: number,
    x: number,
    z: number,
    radius: number,
    life: number,
    a: Rgb,
    alpha: number,
    b: Rgb,
    add: number,
    p2 = 0,
    p3 = 0,
    yaw = Math.random() * Math.PI * 2,
  ): void {
    if (this.stamped >= this.capacity / 2) return;
    const stamp: Stamp = {
      shape,
      x,
      z,
      radius,
      yaw,
      seed: Math.random(),
      age: 0,
      life,
      a,
      alpha,
      b,
      add,
      p2,
      p3,
    };
    // Reuse a faded slot when there is one; stamps are per event, so the object itself is cheap.
    if (this.stamped < this.stamps.length) this.stamps[this.stamped] = stamp;
    else this.stamps.push(stamp);
    this.stamped++;
  }

  end(): void {
    uploadRange(this.buffer, this.count * STRIDE);
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
