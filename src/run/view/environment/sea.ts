import { ShaderChunk } from "three";
import { inject } from "../patchShader";
import { WADE_DEPTH } from "../../sim/content/params/environment";
import { glslVec, type WaterLook } from "../stageThemes";

/**
 * The sea (a static water plane, `terrain.surface.liquids`) and the beach it laps: everything is read
 * from the sim's water depth grid (`surfaceDepth(p).r`, metres, negative above the waterline), so the
 * colour follows the real depth and the shoreline is exactly where the rules put it. Stateless: every
 * wash, wet stain and foam line is a function of time and position, so nothing is stored or rendered
 * ahead. Shared by the terrain (wet sand, washes on the beach, caustics on the bed) and the sea plane
 * (depth colour, transparency, waves, glints, breakers). Requires SURFACE_GLSL and WIND_GLSL earlier.
 */
export const SURF_GLSL = /* glsl */ `
#ifndef ENV_SURF
#define ENV_SURF
const float SURF_PERIOD = 6.5;  // seconds per wash at one spot
const float SURF_BOTTOM = -1.6; // each wash starts this far out (metres, negative = seaward)
const float SURF_RISE = 0.3;    // share of a cycle spent running up the beach
const float SURF_DRY = 3.0;     // seconds for a stain to dry to 1/e
const float SURF_EASE = 1.6;    // the draw-back starts slow and speeds up
/**
 * Metres from the sea's waterline, positive inland: depth over its horizontal gradient. Exact at the
 * waterline, a smooth estimate a few metres away, which is all the beach effects reach.
 */
float seaShore(vec2 p, float depth) {
  const float e = 0.5;
  vec2 g = vec2(
    surfaceDepth(p + vec2(e, 0.0)).r - surfaceDepth(p - vec2(e, 0.0)).r,
    surfaceDepth(p + vec2(0.0, e)).r - surfaceDepth(p - vec2(0.0, e)).r
  ) / (2.0 * e);
  return -depth / max(length(g), 0.04);
}
/** How far one wash runs up past the waterline: varies along the shore and from wash to wash. */
float surfRunup(vec2 p, float cycle) {
  return mix(0.3, 1.7, envNoise(p * 0.12 + vec2(cycle * 3.7, cycle * 1.9)));
}
/** The wash front (metres from the waterline) at cycle time v: a quick run up, a slower draw back. */
float surfFront(float v, float runup) {
  if (v < SURF_RISE) {
    float up = 1.0 - v / SURF_RISE;
    return mix(SURF_BOTTOM, runup, 1.0 - up * up);
  }
  return mix(runup, SURF_BOTTOM, pow((v - SURF_RISE) / (1.0 - SURF_RISE), SURF_EASE));
}
/** Wetness one wash left at s by cycle time v (> 1 for the previous wash): 1 while covered, then drying. */
float surfStain(float s, float v, float runup) {
  if (s > runup) return 0.0;
  float k = (s - SURF_BOTTOM) / (runup - SURF_BOTTOM);
  float reached = SURF_RISE * (1.0 - sqrt(max(1.0 - k, 0.0)));
  float left = SURF_RISE + (1.0 - SURF_RISE) * pow(max(1.0 - k, 0.0), 1.0 / SURF_EASE);
  if (v < reached) return 0.0;
  // Gone by the time the wash after next arrives, so neighbouring stretches in other cycles agree.
  return exp(-max(v - left, 0.0) * SURF_PERIOD / SURF_DRY)
    * (1.0 - smoothstep(1.5, 2.0, v)) * smoothstep(0.0, 0.18, runup - s);
}
struct Surf {
  float edge;   // metres behind the wash front (> 0 under the wash)
  float wet;    // 0..1, this wash and the drying stain of the last
  float rising; // 1 while the wash runs up, 0 as it draws back
  float mark;   // the thin line of foam a wash leaves at its highest reach, fading
  float foamLife; // foam dissolves offshore before the cycle starts again
};
/**
 * The wash at a point s metres from the waterline. Each stretch of shore runs on its own clock (a slow
 * noise), so washes arrive along the beach at different times and reach different heights.
 */
Surf seaSurf(vec2 p, float s) {
  float clock = uWindTime / SURF_PERIOD + envNoise(p * 0.055) * 0.75 + envNoise(p * 0.15 + 3.3) * 0.18;
  float cycle = floor(clock);
  float v = clock - cycle;
  float runup = surfRunup(p, cycle);
  float last = surfRunup(p, cycle - 1.0);
  Surf o;
  o.edge = surfFront(v, runup) - s;
  o.wet = max(surfStain(s, v, runup), surfStain(s, v + 1.0, last));
  o.rising = 1.0 - smoothstep(SURF_RISE * 0.7, SURF_RISE * 1.1, v);
  float markNow = (1.0 - smoothstep(0.0, 0.07, abs(s - runup + 0.04))) * smoothstep(SURF_RISE, SURF_RISE + 0.08, v) * (1.0 - v);
  float markLast = (1.0 - smoothstep(0.0, 0.07, abs(s - last + 0.04))) * max(0.0, 0.6 - v);
  o.mark = max(markNow, markLast);
  o.foamLife = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.85, 1.0, v));
  return o;
}
/** Foam riding a wash's leading edge, broken into clumps; \`px\` is the pixel size in metres. */
float surfFoam(vec2 p, Surf w, float px) {
  float width = mix(0.16, 0.42, w.rising);
  float band = smoothstep(-px, px, w.edge) * (1.0 - smoothstep(width * 0.35, width, w.edge));
  float clumps = smoothstep(0.3, 0.62, envNoise(p * 3.1 + uWindTime * vec2(0.3, -0.2)) * 0.7 + envNoise(p * 9.0) * 0.3 + w.rising * 0.15);
  float mark = w.mark * smoothstep(0.45, 0.6, envNoise(p * 7.0 + 1.3));
  return max(band * clumps * w.foamLife, mark * 0.8);
}
#endif
`;

/** Sea surface colour constants for one stage. */
export const seaGlsl = (look: WaterLook) => /* glsl */ `
${SURF_GLSL}
const vec3 SEA_SHALLOW = ${glslVec(look.shallow)};
const vec3 SEA_MID = ${glslVec(look.mid)};
const vec3 SEA_DEEP = ${glslVec(look.deep)};
const vec3 SEA_CAUSTIC = ${glslVec(look.vein)};
const vec3 SEA_FOAM = ${glslVec(look.foam)};
const vec3 SEA_SKY = ${glslVec(look.sky)};
const float SEA_WADE = ${WADE_DEPTH.toFixed(3)};
float seaGloss;
float seaGlow;
float seaFresnel;
`;

/**
 * The sea plane: a smooth turquoise → teal → deep blue ramp on the true depth, clear enough in the
 * shallows to show the sand and its caustics, a soft shelf where wading ends (still readable: ground
 * walkers stop there), washes breaking toward the beach, and a gently moving faceted surface whose
 * normals catch the sun.
 */
export const SEA_FRAGMENT = /* glsl */ `
vec3 seaNormal = vec3(0.0, 1.0, 0.0);
{
  vec2 p = vSurfaceWorld;
  float depth = surfaceDepth(p).r;
  if (depth <= 0.0) discard;
  float t = uWindTime;
  float s = seaShore(p, depth);
  float px = max(fwidth(s), 1e-3);
  // Swell: two noise layers drifting across each other; the shallows lie flatter.
  float calm = smoothstep(0.05, 0.8, depth);
  float lift = 0.35 + 0.65 * smoothstep(0.0, 1.0, uWindStrength + uWindGust);
  vec2 q = p - uWindScroll * 0.15;
  const float e = 0.1;
  vec2 a = q * 0.55 + vec2(t * 0.09, t * 0.035);
  vec2 b = q * 1.7 + vec2(-t * 0.05, t * 0.16) + 7.1;
  vec2 c = q * 5.5 + vec2(t * 0.4, -t * 0.25) + 3.3;
  float h0 = envNoise(a) + envNoise(b) * 0.45;
  float hx = envNoise(a + vec2(e * 0.55, 0.0)) + envNoise(b + vec2(e * 1.7, 0.0)) * 0.45;
  float hz = envNoise(a + vec2(0.0, e * 0.55)) + envNoise(b + vec2(0.0, e * 1.7)) * 0.45;
  // Fine ripples only tilt the glints: small, scattered flecks rather than one smeared sun.
  float r0 = envNoise(c);
  vec2 ripple = vec2(envNoise(c + vec2(e * 5.5, 0.0)) - r0, envNoise(c + vec2(0.0, e * 5.5)) - r0) / e * 0.05;
  vec2 slope = (vec2(hx - h0, hz - h0) / e * 0.12 + ripple) * calm * lift;
  seaNormal = normalize(vec3(-slope.x, 1.0, -slope.y));

  // Depth ramp with a wandering edge; a soft darker shelf where the water gets too deep to wade.
  float d = depth + (envNoise(p * 0.21 + 2.0) - 0.5) * 0.12;
  vec3 color = mix(SEA_SHALLOW, SEA_MID, smoothstep(0.08, 0.95, d));
  color = mix(color, SEA_DEEP, smoothstep(0.8, 2.6, d));
  float shelf = smoothstep(SEA_WADE - 0.06, SEA_WADE + 0.1, depth);
  color *= mix(1.06, 0.9, shelf);
  // Large soft patches (wind on the water), brighter swell crests.
  color *= 0.94 + 0.12 * envNoise(q * 0.09 + t * 0.01);
  color = mix(color, SEA_SHALLOW * 1.1, smoothstep(0.85, 1.25, h0) * 0.25 * calm);
  // Clear at the waterline, opaque in the deep: the sand and its caustics show through the shallows.
  float alpha = mix(0.0, 0.62, smoothstep(0.0, 0.32, depth));
  alpha = mix(alpha, 0.8, smoothstep(0.32, SEA_WADE + 0.1, depth));
  alpha = mix(alpha, 0.95, smoothstep(SEA_WADE + 0.1, 1.8, depth));

  // A faint lighter seam on the shelf edge, breaking and drifting: the wading limit without a stroke.
  float seam = 1.0 - smoothstep(0.0, 0.05, abs(depth - SEA_WADE - 0.02));
  seam *= smoothstep(0.35, 0.65, envNoise(p * 1.4 + vec2(t * 0.15, -t * 0.1)));
  color = mix(color, SEA_FOAM, seam * 0.22);

  // Washes: a breaking crest rolls in from out on the shelf, foam rides it onto the beach.
  Surf w = seaSurf(p, s);
  float foam = surfFoam(p, w, px);
  float crest = smoothstep(-0.6, 0.0, w.edge) * (1.0 - smoothstep(0.0, 0.5, w.edge)) * w.rising * (1.0 - shelf);
  color = mix(color, SEA_SHALLOW * 1.25, crest * 0.35);
  // Lace: the foam a wash leaves spreading on the water behind it as it draws back.
  float lace = smoothstep(0.5, 0.56, abs(envNoise(p * 4.2 + t * 0.12) - envNoise(p * 2.7 - t * 0.09 + 5.0)) + 0.45)
    * (1.0 - smoothstep(-0.2, 1.4, -s)) * (1.0 - w.rising) * 0.14;
  foam = max(foam, lace);
  color = mix(color, SEA_FOAM, foam);
  alpha = max(alpha, foam * 0.9);

  // Out in the deep, whitecaps on the swell when the wind is up.
  float caps = smoothstep(1.2, 1.3, h0 + envNoise(q * 3.0 - t * 0.3) * 0.3) * smoothstep(1.2, 2.5, depth) * smoothstep(0.35, 0.9, uWindStrength + uWindGust * 0.5);
  color = mix(color, SEA_FOAM, caps * 0.6);

  diffuseColor.rgb = color;
  diffuseColor.a = alpha;
  seaGloss = (1.0 - foam) * smoothstep(0.02, 0.3, depth);
  seaGlow = (1.0 - smoothstep(0.1, 0.9, depth)) * (1.0 - foam);
  seaFresnel = smoothstep(0.0, 0.5, depth) * (1.0 - foam);
}
`;

/** Lambert plus a stylised sun glint on the waves (multiplied by sun, shadow and cloud like any light). */
export const SEA_LIGHT = inject(ShaderChunk.lights_lambert_pars_fragment, "sea-glint", {
  "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );": /* glsl */ `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  {
    vec3 halfway = normalize(directLight.direction + geometryViewDir);
    float facing = saturate(dot(geometryNormal, halfway));
    float glint = smoothstep(0.55, 0.8, pow(facing, 600.0)) * 0.7 + pow(facing, 160.0) * 0.08;
    reflectedLight.directSpecular += directLight.color * seaGloss * glint;
  }`,
});

/** After lighting: a faint glow in the shallows (a lit pool even in shade) and the sky in the fresnel. */
export const SEA_OUTGOING = /* glsl */ `
outgoingLight += SEA_SHALLOW * 0.07 * seaGlow;
outgoingLight = mix(outgoingLight, SEA_SKY, pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 5.0) * 0.5 * seaFresnel);
`;
