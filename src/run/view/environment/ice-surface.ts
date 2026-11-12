import { ICE_SHORE } from "../../sim/content/params/environment";
import { rgb } from "../vfx/gl";

export const ICE_COLOR = rgb("#9bcbd9");
export const ICE_DEEP = rgb("#386d87");

/** Shared ice appearance: straight-alpha sRGB, used by lit terrain and temporary ground trails. */
export const ICE_GLSL = /* glsl */ `
float iceExtent(vec2 q, float phase) {
  float angle = atan(q.y, -q.x + 0.0000001);
  return ${ICE_SHORE.base}
    + ${ICE_SHORE.bay} * sin(angle * 3.0 + phase)
    + ${ICE_SHORE.inlet} * cos(angle * 5.0 - phase)
    + ${ICE_SHORE.skew} * sin(angle * 2.0 + phase * 0.7);
}
vec4 iceSurface(vec2 q, float seed, float phase, float irregular, vec3 baseColor, vec3 deepColor) {
  float r = length(q) / mix(1.0, iceExtent(q, phase), irregular);
  if (r >= 1.0) return vec4(0.0);
  vec2 offset = vec2(seed * 3.7, seed * 5.1);
  vec2 p = q * 2.7 + offset;
  vec2 cell = floor(p), f = fract(p), nearest = vec2(0.0);
  float first = 8.0, second = 8.0, facet = 0.0;
  // Offset cells make an interconnected fracture network, without a radial impact point.
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y)), id = cell + o;
    vec2 jitter = vec2(hash12(id), hash12(id + 19.4));
    vec2 delta = o + 0.15 + jitter * 0.7 - f;
    float d = dot(delta, delta);
    if (d < first) {
      second = first;
      first = d;
      nearest = delta;
      facet = hash12(id + 8.3);
    } else second = min(second, d);
  }
  float edge = second - first;
  float aa = max(fwidth(edge), 0.003);
  float fractures = smoothstep(0.32, 0.7, noise2(p * 0.62 + 11.7));
  float seam = (1.0 - smoothstep(0.008, 0.008 + aa, edge)) * fractures;
  float submerged = 1.0 - smoothstep(0.01, 0.09, edge);
  float cloud = fbm2(q * 3.1 + offset);
  float depth = smoothstep(0.25, 0.8, cloud + (1.0 - r) * 0.22);
  vec3 color = mix(baseColor, deepColor, depth * 0.65);
  color += (facet - 0.5) * 0.035 + dot(nearest, vec2(-0.012, 0.02));
  color = mix(color, deepColor, submerged * fractures * 0.18);
  color = mix(color, vec3(0.82, 0.95, 0.98), seam * 0.35);
  // Broad broken reflections sit above the darker ice, rather than an animated glowing ring.
  float reflection = q.x * 0.55 + q.y * 0.84 + (cloud - 0.5) * 0.16;
  float gloss = (1.0 - smoothstep(0.06, 0.22, abs(reflection + 0.22)))
    + (1.0 - smoothstep(0.01, 0.06, abs(reflection - 0.25))) * 0.55;
  color = mix(color, vec3(0.9, 0.97, 1.0), gloss * (0.1 + facet * 0.06));
  float trappedFrost = smoothstep(0.47, 0.7, fbm2(q * vec2(7.0, 3.0) + offset + 9.3));
  color = mix(color, vec3(0.79, 0.89, 0.94), trappedFrost * 0.35);
  float frostNoise = fbm2(q * 15.0 + offset);
  float shore = smoothstep(0.78, 0.98, r + (frostNoise - 0.5) * 0.25);
  float frost = shore * (0.7 + frostNoise * 0.3);
  color = mix(color, vec3(0.89, 0.94, 0.97), frost);
  float inside = 1.0 - smoothstep(0.91 + frostNoise * 0.07, 1.0, r);
  return vec4(color, inside * (0.91 - shore * 0.65));
}
`;
