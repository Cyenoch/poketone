import {
  AddEquation,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  type BufferAttribute,
  type InterleavedBuffer,
  type ShaderMaterialParameters,
} from "three";

/** Display-space (sRGB) colour, written straight to the canvas by the effect shaders. */
export type Rgb = readonly [number, number, number];

export function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Uploads only the first `count` elements of a dynamic buffer. Skips empty frames: a zero-length
 * range would make WebGL 2 copy the whole buffer.
 */
export function uploadRange(buffer: BufferAttribute | InterleavedBuffer, count: number): void {
  if (count === 0) return;
  buffer.clearUpdateRanges();
  buffer.addUpdateRange(0, count);
  buffer.needsUpdate = true;
}

/** Time shared by every effect material (one object, many references). */
export interface FxUniforms {
  uTime: { value: number };
}

/**
 * Premultiplied output: `add = 0` blends like normal alpha, `add = 1` is purely additive, anything
 * between mixes both — so hot cores and inked smoke share one draw call.
 */
export function fxMaterial(params: ShaderMaterialParameters): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    ...params,
  });
}

export const FX_GLSL = /* glsl */ `
uniform float uTime;
const vec3 INK = vec3(0.078, 0.184, 0.314);
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm2(vec2 p) {
  return noise2(p) * 0.55 + noise2(p * 2.03 + 7.1) * 0.3 + noise2(p * 4.01 + 3.7) * 0.15;
}
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
/** Premultiplied layer: colour, coverage and how additive it is. */
vec4 layer(vec3 c, float a, float add) {
  return vec4(c * a, a * (1.0 - add));
}
/** Paints \`top\` over \`base\` (both premultiplied). */
vec4 over(vec4 top, vec4 base) {
  return top + base * (1.0 - top.a);
}
`;
