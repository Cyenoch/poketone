import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type ShaderMaterial,
} from "three";
import { FX_GLSL, fxMaterial, uploadRange, type FxUniforms, type Rgb } from "./gl";
import { ink } from "./palette";

/** Cross-section looks for camera-facing strips. */
export const Ribbon = {
  /** White-hot core fading to the colour at the edges (lightning). */
  bolt: 0,
  /** Solid, inked rope with a highlight (vines). */
  vine: 1,
  /** Soft smear that brightens toward the head (swipes, trails). */
  streak: 2,
  /** Flat colour with a soft edge (ink backing). */
  solid: 3,
  /** Soft falloff from the centre line (halos). */
  glow: 4,
} as const;

const STRIDE = 18;
const MAX_POINTS = 96;

const vertexShader = /* glsl */ `
attribute vec3 prev;
attribute vec3 next;
attribute vec4 color;
attribute vec4 meta;
attribute float add;
varying vec4 vColor;
varying vec3 vMeta;
varying float vAdd;
void main() {
  vec4 c = viewMatrix * vec4(position, 1.0);
  vec2 d1 = c.xy - (viewMatrix * vec4(prev, 1.0)).xy;
  vec2 d2 = (viewMatrix * vec4(next, 1.0)).xy - c.xy;
  vec2 dir = (dot(d1, d1) > 1e-8 ? normalize(d1) : vec2(0.0)) + (dot(d2, d2) > 1e-8 ? normalize(d2) : vec2(0.0));
  dir = dot(dir, dir) > 1e-8 ? normalize(dir) : vec2(1.0, 0.0);
  c.xy += vec2(-dir.y, dir.x) * meta.x * meta.y;
  // Toward the camera along the view ray, so strips skimming the ground are not cut by it.
  c.xyz *= max(0.1, 1.0 - 0.4 / -c.z);
  gl_Position = projectionMatrix * c;
  vColor = color;
  vMeta = vec3(meta.x, meta.z, meta.w);
  vAdd = add;
}
`;

const fragmentShader = /* glsl */ `
${FX_GLSL}
varying vec4 vColor;
varying vec3 vMeta;
varying float vAdd;
void main() {
  float v = abs(vMeta.x);
  float u = vMeta.y;
  float style = vMeta.z;
  vec4 c;
  if (style < 0.5) {
    float core = exp(-v * v * 16.0);
    c = layer(mix(vColor.rgb, vec3(1.0), core), smoothstep(1.0, 0.55, v), vAdd);
  } else if (style < 1.5) {
    vec3 body = mix(vColor.rgb, vec3(0.85, 1.0, 0.6), smoothstep(0.3, 0.05, abs(vMeta.x + 0.3)) * 0.7);
    c = layer(mix(body, INK, smoothstep(0.62, 0.78, v)), smoothstep(1.0, 0.9, v), vAdd);
  } else if (style < 2.5) {
    float a = pow(max(0.0, 1.0 - v), 1.6) * u;
    c = layer(mix(vColor.rgb, vec3(1.0), u * (1.0 - v) * 0.7), a, vAdd);
  } else if (style < 3.5) {
    c = layer(vColor.rgb, smoothstep(1.0, 0.7, v), vAdd);
  } else {
    c = layer(vColor.rgb, (1.0 - v) * (1.0 - v), vAdd);
  }
  c *= vColor.a;
  if (c.a + c.r + c.g + c.b < 0.004) discard;
  gl_FragColor = c;
}
`;

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Camera-facing strips (lightning, vines, swipes) in one draw. Rebuilt every frame:
 * call `point` for each vertex of a strip, then `flush` to commit it.
 */
export class Ribbons {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly buffer: InterleavedBuffer;
  private readonly indices: BufferAttribute;
  private readonly strip = new Float32Array(MAX_POINTS * 8);
  private points = 0;
  private vertices = 0;
  private indexCount = 0;
  private readonly capacity: number;
  /** Scratch polyline and fork origins for `bolt`. */
  private readonly path = new Float32Array(MAX_POINTS * 3);
  private readonly forks = new Float32Array(3 * 3);

  constructor(uniforms: FxUniforms, capacity: number) {
    this.capacity = capacity;
    this.buffer = new InterleavedBuffer(new Float32Array(capacity * STRIDE), STRIDE);
    this.buffer.setUsage(DynamicDrawUsage);
    const view = (size: number, offset: number) =>
      new InterleavedBufferAttribute(this.buffer, size, offset);
    this.geometry.setAttribute("position", view(3, 0));
    this.geometry.setAttribute("prev", view(3, 3));
    this.geometry.setAttribute("next", view(3, 6));
    this.geometry.setAttribute("color", view(4, 9));
    this.geometry.setAttribute("meta", view(4, 13));
    this.geometry.setAttribute("add", view(1, 17));
    this.indices = new BufferAttribute(new Uint16Array(capacity * 3), 1);
    this.indices.setUsage(DynamicDrawUsage);
    this.geometry.setIndex(this.indices);
    // Strip winding flips with the direction of travel, so neither face may be culled.
    this.material = fxMaterial({
      uniforms: { ...uniforms },
      vertexShader,
      fragmentShader,
      side: DoubleSide,
      forceSinglePass: true,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  begin(): void {
    this.vertices = 0;
    this.indexCount = 0;
    this.points = 0;
  }

  point(x: number, y: number, z: number, width: number, color: Rgb, alpha: number): void {
    if (this.points >= MAX_POINTS) return;
    const s = this.strip;
    const o = this.points++ * 8;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = z;
    s[o + 3] = width;
    s[o + 4] = color[0];
    s[o + 5] = color[1];
    s[o + 6] = color[2];
    s[o + 7] = alpha;
  }

  flush(style: number, add: number): void {
    const n = this.points;
    this.points = 0;
    if (n < 2 || this.vertices + n * 2 > this.capacity) return;
    const s = this.strip;
    const data = this.buffer.array as Float32Array;
    const index = this.indices.array as Uint16Array;
    const base = this.vertices;
    for (let i = 0; i < n; i++) {
      const p = i * 8;
      const prev = Math.max(0, i - 1) * 8;
      const next = Math.min(n - 1, i + 1) * 8;
      for (let side = -1; side <= 1; side += 2) {
        const o = this.vertices++ * STRIDE;
        data[o] = s[p]!;
        data[o + 1] = s[p + 1]!;
        data[o + 2] = s[p + 2]!;
        data[o + 3] = s[prev]!;
        data[o + 4] = s[prev + 1]!;
        data[o + 5] = s[prev + 2]!;
        data[o + 6] = s[next]!;
        data[o + 7] = s[next + 1]!;
        data[o + 8] = s[next + 2]!;
        data[o + 9] = s[p + 4]!;
        data[o + 10] = s[p + 5]!;
        data[o + 11] = s[p + 6]!;
        data[o + 12] = s[p + 7]!;
        data[o + 13] = side;
        data[o + 14] = s[p + 3]!;
        data[o + 15] = i / (n - 1);
        data[o + 16] = style;
        data[o + 17] = add;
      }
      if (i > 0) {
        const a = base + (i - 1) * 2;
        const k = this.indexCount;
        index[k] = a;
        index[k + 1] = a + 1;
        index[k + 2] = a + 2;
        index[k + 3] = a + 1;
        index[k + 4] = a + 3;
        index[k + 5] = a + 2;
        this.indexCount += 6;
      }
    }
  }

  /**
   * Jagged lightning from a to b: soft halo, ink edge, hot core. The same `seed` gives the same zig-zag, so
   * callers decide how often it re-rolls.
   */
  bolt(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    seed: number,
    width: number,
    color: Rgb,
    alpha: number,
    forks = 0,
  ): void {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz) || 1;
    const n = Math.min(MAX_POINTS / 2, Math.max(3, Math.round(length / 0.55))) + 1;
    // Two axes across the bolt: horizontal, then the one perpendicular to both.
    let px = -dz;
    let pz = dx;
    let pl = Math.hypot(px, pz);
    if (pl < 1e-4) {
      px = 1;
      pz = 0;
      pl = 1;
    }
    px /= pl;
    pz /= pl;
    const qx = (dy * pz) / length;
    const qy = (dz * px - dx * pz) / length;
    const qz = (-dy * px) / length;
    const amplitude = Math.min(1.4, length * 0.11);
    const path = this.path;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const envelope = Math.sin(Math.PI * t) * amplitude;
      const u = (hash(seed, i) - 0.5) * 2 * envelope;
      const v = (hash(seed + 7.3, i) - 0.5) * 2 * envelope;
      path[i * 3] = ax + dx * t + px * u + qx * v;
      path[i * 3 + 1] = ay + dy * t + qy * v;
      path[i * 3 + 2] = az + dz * t + pz * u + qz * v;
    }
    this.polyline(n, width * 3.4, color, alpha * 0.35, Ribbon.glow, 1);
    this.polyline(n, width * 1.6, ink, alpha * 0.75, Ribbon.solid, 0);
    this.polyline(n, width, color, alpha, Ribbon.bolt, 1);
    // Read every fork origin before recursing: each fork reuses the scratch path.
    const origins = this.forks;
    const count = Math.min(forks, origins.length / 3);
    for (let f = 0; f < count; f++) {
      const k = (1 + Math.floor(hash(seed, 50 + f) * (n - 2))) * 3;
      origins[f * 3] = path[k]!;
      origins[f * 3 + 1] = path[k + 1]!;
      origins[f * 3 + 2] = path[k + 2]!;
    }
    for (let f = 0; f < count; f++) {
      const sx = origins[f * 3]!;
      const sy = origins[f * 3 + 1]!;
      const sz = origins[f * 3 + 2]!;
      const reach = 0.3 + hash(seed, 60 + f) * 0.3;
      const swing = (hash(seed, 70 + f) - 0.5) * length * 0.7;
      // Forks swing out sideways (horizontal axis) from the remaining path.
      const ex = sx + (bx - sx) * reach + px * swing;
      const ey = sy + (by - sy) * reach;
      const ez = sz + (bz - sz) * reach + pz * swing;
      this.bolt(sx, sy, sz, ex, ey, ez, seed + 13.7 * (f + 1), width * 0.6, color, alpha * 0.85);
    }
  }

  private polyline(
    n: number,
    width: number,
    color: Rgb,
    alpha: number,
    style: number,
    add: number,
  ): void {
    const path = this.path;
    for (let i = 0; i < n; i++) {
      const taper = i === 0 || i === n - 1 ? 0.45 : 1;
      this.point(path[i * 3]!, path[i * 3 + 1]!, path[i * 3 + 2]!, width * taper, color, alpha);
    }
    this.flush(style, add);
  }

  end(): void {
    uploadRange(this.buffer, this.vertices * STRIDE);
    uploadRange(this.indices, this.indexCount);
    this.geometry.setDrawRange(0, this.indexCount);
    this.mesh.visible = this.indexCount > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
