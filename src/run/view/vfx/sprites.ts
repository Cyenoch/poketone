import {
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  PlaneGeometry,
  type ShaderMaterial,
} from "three";
import { FX_GLSL, fxMaterial, uploadRange, type FxUniforms, type Rgb } from "./gl";
import { compact } from "./pool";

/** Procedural sprite silhouettes, drawn in the fragment shader (no textures). */
export const Shape = {
  glow: 0,
  flame: 1,
  spark: 2,
  star: 3,
  /** Inked cartoon smoke. */
  puff: 4,
  drop: 5,
  bubble: 6,
  leaf: 7,
  ring: 8,
  shard: 9,
  ball: 10,
  crescent: 11,
  /** Soft, un-inked cloud. */
  cloud: 12,
  /** Inked letter Z (sleep). */
  zed: 13,
  /** Inked exclamation mark (a dangerous wind-up). */
  bang: 14,
  /** Inked stinger pointing along its motion (+x): accent spine, body flanks. */
  needle: 15,
  /** Singing uses a note, never the sleep Z. */
  note: 16,
} as const;

/** A particle or sprite recipe. Sizes are half-extents in world units, scaled by the size passed in. */
export interface SpriteSpec {
  shape: number;
  /** Seconds; each particle gets ±25 %. */
  life: number;
  /** Size multiplier reached at the end of life. */
  grow: number;
  /** Body colour at birth and at death. */
  from: Rgb;
  to: Rgb;
  /** Second colour: hot core, rim or shadow depending on the shape. */
  accent: Rgb;
  alpha: number;
  /** 0 = alpha blended, 1 = additive. */
  add: number;
  gravity: number;
  drag: number;
  /** Seconds of velocity added to the length; negative aligns to the motion without stretching. */
  stretch: number;
  /** Random spin speed range (rad/s). */
  spin: number;
}

/** A spec with quiet defaults: one colour, no motion, alpha blended. */
export function sprite(spec: Partial<SpriteSpec> & Pick<SpriteSpec, "shape" | "from">): SpriteSpec {
  return {
    life: 0.5,
    grow: 1,
    to: spec.from,
    accent: spec.from,
    alpha: 1,
    add: 0,
    gravity: 0,
    drag: 0,
    stretch: 0,
    spin: 0,
    ...spec,
  };
}

interface Particle {
  spec: SpriteSpec;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  floor: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  spinSpeed: number;
  seed: number;
}

const STRIDE = 20;

const vertexShader = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iForm;
attribute vec4 iBody;
attribute vec4 iAccent;
attribute vec2 iAge;
varying vec2 vP;
varying vec4 vBody;
varying vec4 vAccent;
varying vec3 vMeta;
void main() {
  vec4 center = viewMatrix * vec4(iPos, 1.0);
  float size = iForm.x;
  vec2 axis = vec2(cos(iForm.z), sin(iForm.z));
  float len = size;
  if (iForm.y != 0.0) {
    vec2 v = (mat3(viewMatrix) * iVel).xy;
    float speed = length(v);
    if (speed > 1e-3) {
      axis = v / speed;
      if (iForm.y > 0.0) len = size + speed * iForm.y;
    }
  }
  vec4 view = center;
  view.xy += axis * position.x * len + vec2(-axis.y, axis.x) * position.y * size;
  // Slide along the view ray toward the camera by the sprite's reach: same screen footprint,
  // but big sprites near the ground no longer clip into the terrain.
  view.xyz *= max(0.1, 1.0 - min(len, 4.0) / -center.z);
  gl_Position = projectionMatrix * view;
  vP = position.xy;
  vBody = iBody;
  vAccent = iAccent;
  vMeta = vec3(iForm.w, iAge);
}
`;

const fragmentShader = /* glsl */ `
${FX_GLSL}
varying vec2 vP;
varying vec4 vBody;
varying vec4 vAccent;
varying vec3 vMeta;

vec4 glow(vec2 p, float add) {
  float r = length(p);
  float a = pow(max(0.0, 1.0 - r), 2.2);
  return layer(mix(vBody.rgb, vAccent.rgb, exp(-r * r * 9.0)), a, add);
}

vec4 flame(vec2 p, float age, float seed, float add) {
  float t = uTime * 9.0 + seed * 40.0;
  p.x += sin(p.y * 3.2 - t) * 0.12 * (p.y + 1.0);
  float y = p.y;
  float w = y < -0.3
    ? sqrt(max(0.0, 1.0 - (y + 0.3) * (y + 0.3) / 0.49)) * 0.66
    : 0.66 * pow(max(0.0, 1.0 - (y + 0.3) / 1.3), 0.85);
  // Burns out by shrinking rather than going translucent.
  float d = w * (1.0 - age * age * 0.75) - abs(p.x);
  float a = smoothstep(0.0, 0.05, d);
  // Cartoon bands: dark rim, body, and a small hot core that is the only additive part.
  float rim = (1.0 - smoothstep(0.05, 0.11, d)) * (1.0 - age);
  float core = smoothstep(0.24, 0.3, d) * smoothstep(0.3, -0.6, y) * (1.0 - age);
  vec3 c = mix(mix(vBody.rgb, vAccent.rgb, core), mix(vBody.rgb, vec3(0.72, 0.12, 0.04), 0.65), rim);
  return layer(c, a, add * core);
}

vec4 spark(vec2 p, float add) {
  float r = length(p);
  float a = smoothstep(1.0, 0.25, r);
  float core = smoothstep(0.5, 0.0, abs(p.y)) * smoothstep(0.95, 0.2, abs(p.x));
  return layer(mix(vBody.rgb, vAccent.rgb, core), a, add);
}

vec4 star(vec2 p, float add) {
  float rays = max(exp(-abs(p.y) * 11.0) * (1.0 - abs(p.x)), exp(-abs(p.x) * 11.0) * (1.0 - abs(p.y)));
  float core = exp(-dot(p, p) * 10.0);
  return layer(mix(vBody.rgb, vAccent.rgb, core), clamp(rays * 1.4 + core, 0.0, 1.0), add);
}

vec4 puff(vec2 p, float age, float seed, bool inked) {
  float ang = atan(p.y, p.x);
  float r = length(p);
  float edge = (0.8 + 0.08 * sin(ang * 5.0 + seed * 6.28) + 0.04 * sin(ang * 9.0 - seed * 3.0));
  float holes = noise2(p * 2.6 + seed * 17.0);
  float body = smoothstep(edge, edge - 0.06, r) * smoothstep(age * 1.25 - 0.3, age * 1.25 - 0.2, holes);
  float light = smoothstep(-0.7, 0.8, dot(p, vec2(-0.55, 0.8)));
  vec3 c = mix(vAccent.rgb, vBody.rgb, light);
  if (inked) c = mix(c, INK, smoothstep(edge - 0.2, edge - 0.12, r) * 0.9);
  return layer(c, body, 0.0);
}

vec4 cloud(vec2 p, float age, float seed, float add) {
  float n = noise2(p * 2.2 + seed * 13.0 + uTime * 0.7);
  float r = length(p) + (n - 0.5) * 0.45;
  return layer(mix(vBody.rgb, vAccent.rgb, n), smoothstep(1.0, 0.3, r), add);
}

vec4 drop(vec2 p) {
  float x = p.x;
  float w = x > 0.3 ? sqrt(max(0.0, 0.4225 - (x - 0.3) * (x - 0.3))) : 0.65 * pow(max(0.0, (x + 1.0) / 1.3), 1.4);
  float d = w - abs(p.y);
  float a = smoothstep(0.0, 0.06, d);
  float rim = 1.0 - smoothstep(0.08, 0.16, d);
  float shine = smoothstep(0.17, 0.07, length(p - vec2(0.42, 0.24)));
  vec3 c = mix(mix(vBody.rgb, vAccent.rgb, rim), vec3(1.0), shine);
  return layer(c, a, 0.0);
}

vec4 bubble(vec2 p, float seed) {
  float w = sin(uTime * 8.0 + seed * 20.0) * 0.08;
  p *= vec2(1.0 + w, 1.0 - w);
  float r = length(p);
  float a = smoothstep(1.0, 0.93, r);
  float rim = smoothstep(0.55, 0.9, r);
  float ink = smoothstep(0.86, 0.94, r);
  float shine = smoothstep(0.24, 0.1, length(p - vec2(-0.36, 0.38))) + smoothstep(0.1, 0.03, length(p - vec2(0.32, -0.42))) * 0.7;
  vec3 c = mix(mix(vBody.rgb, vAccent.rgb, ink), vec3(1.0), clamp(shine, 0.0, 1.0));
  return layer(c, a * clamp(0.25 + 0.75 * max(rim, shine), 0.0, 1.0), 0.0);
}

vec4 leaf(vec2 p, float seed) {
  float flip = 0.25 + 0.75 * abs(cos(uTime * 10.0 + seed * 30.0));
  p.y /= flip;
  float w = 0.5 * (1.0 - p.x * p.x);
  float d = w - abs(p.y);
  float a = smoothstep(0.0, 0.05, d) * step(abs(p.x), 1.0);
  float ink = 1.0 - smoothstep(0.06, 0.12, d);
  float rib = smoothstep(0.045, 0.0, abs(p.y)) * step(p.x, 0.85);
  vec3 c = p.y > 0.0 ? vBody.rgb : mix(vBody.rgb, vAccent.rgb, 0.6);
  c = mix(c, vAccent.rgb, rib * 0.8);
  return layer(mix(c, INK, ink), a, 0.0);
}

vec4 ring(vec2 p, float age, float add) {
  float width = mix(0.3, 0.05, age);
  float a = smoothstep(width, 0.0, abs(length(p) - 0.8));
  return layer(mix(vBody.rgb, vAccent.rgb, a), a, add);
}

vec4 shard(vec2 p) {
  float d = max(abs(p.x) * 0.866 + p.y * 0.5, -p.y) - 0.5;
  float a = smoothstep(0.03, -0.02, d);
  vec3 c = mix(vBody.rgb, vAccent.rgb, step(0.0, p.x));
  return layer(mix(c, INK, smoothstep(-0.16, -0.1, d)), a, 0.0);
}

vec4 ball(vec2 p) {
  float r = length(p);
  float a = smoothstep(1.0, 0.93, r);
  float light = smoothstep(-0.8, 0.8, dot(p, vec2(-0.6, 0.65)));
  vec3 c = mix(vAccent.rgb, vBody.rgb, light);
  c = mix(c, vec3(1.0), smoothstep(0.2, 0.1, length(p - vec2(-0.32, 0.36))));
  return layer(mix(c, INK, smoothstep(0.76, 0.86, r)), a, 0.0);
}

float boxDistance(vec2 p, vec2 extent) {
  vec2 d = abs(p) - extent;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec4 zed(vec2 p) {
  vec2 pa = p - vec2(0.5, 0.48);
  vec2 ba = vec2(-1.0, -0.96);
  float slash = length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - 0.15;
  float bars = min(boxDistance(p - vec2(0.0, 0.62), vec2(0.6, 0.13)), boxDistance(p + vec2(0.0, 0.62), vec2(0.6, 0.13)));
  float d = min(slash, bars);
  float fill = smoothstep(0.03, -0.03, d);
  vec3 c = mix(INK, mix(vAccent.rgb, vBody.rgb, smoothstep(-0.7, 0.7, p.y)), fill);
  return layer(c, smoothstep(0.21, 0.15, d), 0.0);
}

vec4 bang(vec2 p) {
  float bar = boxDistance(p - vec2(0.0, 0.3), vec2(0.1 + 0.05 * p.y, 0.44)) - 0.07;
  float dot_ = length(p - vec2(0.0, -0.66)) - 0.16;
  float d = min(bar, dot_);
  float fill = smoothstep(0.03, -0.03, d);
  vec3 c = mix(INK, mix(vAccent.rgb, vBody.rgb, smoothstep(0.9, -0.2, p.y)), fill);
  return layer(c, smoothstep(0.21, 0.15, d), 0.0);
}

vec4 needle(vec2 p) {
  float x = p.x;
  float b = x + 0.4;
  float w = x > -0.4 ? 0.36 * (0.96 - x) / 1.36 : 0.36 * sqrt(max(0.0, 1.0 - b * b / 0.3025));
  float a = smoothstep(0.0, 0.04, w - abs(p.y));
  // Bands relative to the local width keep the bright spine running out to the tip.
  float q = abs(p.y) / max(w, 1e-3);
  vec3 c = mix(vBody.rgb, vAccent.rgb, 1.0 - smoothstep(0.15, 0.38, q));
  return layer(mix(c, INK, smoothstep(0.5, 0.66, q)), a, 0.0);
}

vec4 crescent(vec2 p) {
  float d = max(length(p) - 0.95, 0.82 - length(p - vec2(-0.5, 0.0)));
  float a = smoothstep(0.03, -0.03, d);
  float core = smoothstep(-0.06, -0.2, d);
  return layer(mix(vAccent.rgb, vBody.rgb, core), a, 0.0);
}

vec4 note(vec2 p) {
  float head = length((p - vec2(-0.16,-0.5)) / vec2(0.42,0.28));
  float stem = max(abs(p.x-0.18)/0.09, abs(p.y+0.02)/0.58);
  float flag = max(abs(p.x-0.39)/0.3, abs(p.y-0.52+(p.x-0.18)*0.55)/0.1);
  float d = min(head,min(stem,flag));
  return layer(mix(vBody.rgb,INK,smoothstep(0.72,1.0,d)),1.0-smoothstep(0.9,1.1,d),0.0);
}

void main() {
  float shape = vMeta.x;
  float age = vMeta.y;
  float seed = vMeta.z;
  float add = vAccent.a;
  vec2 p = vP;
  vec4 c;
  if (shape < 0.5) c = glow(p, add);
  else if (shape < 1.5) c = flame(p, age, seed, add);
  else if (shape < 2.5) c = spark(p, add);
  else if (shape < 3.5) c = star(p, add);
  else if (shape < 4.5) c = puff(p, age, seed, true);
  else if (shape < 5.5) c = drop(p);
  else if (shape < 6.5) c = bubble(p, seed);
  else if (shape < 7.5) c = leaf(p, seed);
  else if (shape < 8.5) c = ring(p, age, add);
  else if (shape < 9.5) c = shard(p);
  else if (shape < 10.5) c = ball(p);
  else if (shape < 11.5) c = crescent(p);
  else if (shape < 12.5) c = cloud(p, age, seed, add);
  else if (shape < 13.5) c = zed(p);
  else if (shape < 14.5) c = bang(p);
  else if (shape < 15.5) c = needle(p);
  else c = note(p);
  c *= vBody.a;
  if (c.r + c.g + c.b + c.a < 0.004) discard;
  gl_FragColor = c;
}
`;

/**
 * Every billboard in one instanced draw: simulated particles first, then this frame's immediate
 * sprites (projectile heads, hazards) in call order, so later calls paint on top.
 */
export class Sprites {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly material: ShaderMaterial;
  private readonly buffer: InstancedInterleavedBuffer;
  private readonly pool: Particle[] = [];
  private live = 0;
  private readonly immediate: Float32Array;
  private drawn = 0;
  /** This frame's dt, read by `advance`. */
  private step = 0;
  private readonly capacity: number;
  private readonly immediateCapacity: number;
  /** Immediate slots held back from ordinary draws until `release`, so last-drawn marks keep their budget. */
  private readonly reserved: number;
  private held: number;

  constructor(uniforms: FxUniforms, capacity: number, immediateCapacity: number, reserved = 0) {
    this.capacity = capacity;
    this.immediateCapacity = immediateCapacity;
    this.reserved = reserved;
    this.held = reserved;
    const quad = new PlaneGeometry(2, 2);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute("position", quad.getAttribute("position"));
    this.buffer = new InstancedInterleavedBuffer(
      new Float32Array((capacity + immediateCapacity) * STRIDE),
      STRIDE,
    );
    this.buffer.setUsage(DynamicDrawUsage);
    const view = (size: number, offset: number) =>
      new InterleavedBufferAttribute(this.buffer, size, offset);
    this.geometry.setAttribute("iPos", view(3, 0));
    this.geometry.setAttribute("iVel", view(3, 3));
    this.geometry.setAttribute("iForm", view(4, 6));
    this.geometry.setAttribute("iBody", view(4, 10));
    this.geometry.setAttribute("iAccent", view(4, 14));
    this.geometry.setAttribute("iAge", view(2, 18));
    this.geometry.instanceCount = 0;
    this.immediate = new Float32Array(immediateCapacity * STRIDE);
    this.material = fxMaterial({ uniforms: { ...uniforms }, vertexShader, fragmentShader });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Fraction of the particle pool in use; recipes thin out optional sparkle when it runs high. */
  get load(): number {
    return this.live / this.capacity;
  }

  emit(
    spec: SpriteSpec,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    floor = -Infinity,
  ): void {
    if (this.live >= this.capacity) return;
    // The pool only grows; dead particles are swapped past `live` and reused.
    let p = this.pool[this.live];
    if (!p) {
      p = {
        spec,
        x,
        y,
        z,
        vx,
        vy,
        vz,
        floor,
        age: 0,
        life: 1,
        size,
        spin: 0,
        spinSpeed: 0,
        seed: 0,
      };
      this.pool.push(p);
    }
    this.live++;
    p.spec = spec;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.floor = floor;
    p.age = 0;
    p.life = spec.life * (0.75 + Math.random() * 0.5);
    p.size = size;
    p.spin = Math.random() * Math.PI * 2;
    p.spinSpeed = (Math.random() - 0.5) * 2 * spec.spin;
    p.seed = Math.random();
  }

  /**
   * One-frame sprite at `age` (0..1) along the spec's colour ramp and shape ageing, so a looped mark can
   * age like a particle without one; velocity only steers stretched shapes.
   */
  draw(
    spec: SpriteSpec,
    x: number,
    y: number,
    z: number,
    size: number,
    alpha = 1,
    vx = 0,
    vz = 0,
    spin = 0,
    seed = 0,
    age = 0,
  ): void {
    if (this.drawn >= this.immediateCapacity - this.held) return;
    write(
      this.immediate,
      this.drawn++ * STRIDE,
      spec,
      x,
      y,
      z,
      vx,
      0,
      vz,
      size,
      spin,
      alpha * spec.alpha,
      age,
      seed,
    );
  }

  /** Opens the held-back slots for the marks drawn last this frame (they paint on top). */
  release(): void {
    this.held = 0;
  }

  update(dt: number): void {
    this.held = this.reserved;
    this.step = dt;
    this.live = compact(this.pool, this.live, this.advance);
    const data = this.buffer.array as Float32Array;
    const base = this.live * STRIDE;
    const drawn = this.drawn * STRIDE;
    for (let i = 0; i < drawn; i++) data[base + i] = this.immediate[i]!;
    const count = this.live + this.drawn;
    uploadRange(this.buffer, count * STRIDE);
    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    this.drawn = 0;
  }

  /** Ages, moves and writes one particle into `slot`; false once it has burnt out. */
  private readonly advance = (p: Particle, slot: number): boolean => {
    const dt = this.step;
    p.age += dt / p.life;
    if (p.age >= 1) return false;
    const { spec } = p;
    const damp = Math.max(0, 1 - spec.drag * dt);
    p.vx *= damp;
    p.vz *= damp;
    p.vy = p.vy * damp - spec.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.y < p.floor) {
      p.y = p.floor;
      p.vy = 0;
      p.vx *= 0.6;
      p.vz *= 0.6;
    }
    p.spin += p.spinSpeed * dt;
    const t = p.age;
    const size = p.size * (1 + (spec.grow - 1) * (1 - (1 - t) * (1 - t)));
    const alpha = spec.alpha * Math.min(1, t * 14) * (1 - t * t * t);
    write(
      this.buffer.array as Float32Array,
      slot * STRIDE,
      spec,
      p.x,
      p.y,
      p.z,
      p.vx,
      p.vy,
      p.vz,
      size,
      p.spin,
      alpha,
      t,
      p.seed,
    );
    return true;
  };

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function write(
  data: Float32Array,
  o: number,
  spec: SpriteSpec,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  size: number,
  spin: number,
  alpha: number,
  age: number,
  seed: number,
): void {
  const { from, to, accent } = spec;
  data[o] = x;
  data[o + 1] = y;
  data[o + 2] = z;
  data[o + 3] = vx;
  data[o + 4] = vy;
  data[o + 5] = vz;
  data[o + 6] = size;
  data[o + 7] = spec.stretch;
  data[o + 8] = spin;
  data[o + 9] = spec.shape;
  data[o + 10] = from[0] + (to[0] - from[0]) * age;
  data[o + 11] = from[1] + (to[1] - from[1]) * age;
  data[o + 12] = from[2] + (to[2] - from[2]) * age;
  data[o + 13] = alpha;
  data[o + 14] = accent[0];
  data[o + 15] = accent[1];
  data[o + 16] = accent[2];
  data[o + 17] = spec.add;
  data[o + 18] = age;
  data[o + 19] = seed;
}
