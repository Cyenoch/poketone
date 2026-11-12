/**
 * Value noise for the view: a CPU version for baking ground layers and a GLSL version for shaders.
 * The two need not match; each side only needs smooth, seed-stable variation.
 */

export { latticeHash, smoothstep, valueNoise } from "../../sim/noise";

/** Include-guarded so several chunks can depend on it inside one shader. */
export const NOISE_GLSL = /* glsl */ `
#ifndef ENV_NOISE
#define ENV_NOISE
float envHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = envHash(i);
  float b = envHash(i + vec2(1.0, 0.0));
  float c = envHash(i + vec2(0.0, 1.0));
  float d = envHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
#endif
`;
