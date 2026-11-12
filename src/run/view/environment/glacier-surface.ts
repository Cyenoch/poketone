import { Vector4, type Material } from "three";
import type { Terrain } from "../../sim/terrain";
import { iceShorePhase } from "../../sim/surface";
import { FX_GLSL } from "../vfx/gl";
import { ICE_GLSL, ICE_COLOR, ICE_DEEP } from "./ice-surface";
import { inject, patchShader } from "../patchShader";

/** Snow relief and ice fractures share the terrain draw, lighting, shadows and texture ownership. */
export function glacierSurface(material: Material, terrain: Terrain): void {
  const patches = terrain.surface?.patches.filter((p) => p.kind === "ice-slick") ?? [];
  const key = `glacier-sastrugi:ice-${patches.length}`;
  patchShader(material, key, (shader) => {
    if (patches.length)
      shader.uniforms.uIcePatches = {
        value: patches.map((p) => new Vector4(p.x, p.z, p.radius, iceShorePhase(p))),
      };

    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>
${patches.length ? `${FX_GLSL}\n${ICE_GLSL}\nuniform vec4 uIcePatches[${patches.length}];` : ""}
float glacierRidge(vec2 p) {
  vec2 q = vec2(dot(p, vec2(0.91, 0.42)), dot(p, vec2(-0.42, 0.91)));
  float bend = sin(q.y * 0.43) * 0.8 + sin(q.y * 0.87 + q.x * 0.23) * 0.3;
  float wave = sin(q.x * 5.1 + bend * 2.4 + sin(q.x * 1.3 + q.y * 0.3) * 1.1);
  return pow(wave * 0.5 + 0.5, 4.0) * (0.55 + 0.45 * sin(q.y * 0.6 + q.x * 0.27));
}
float glacierCrack(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  float first = 8.0, second = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(float(x), float(y));
    vec2 id = cell + o;
    vec2 seed = fract(sin(vec2(dot(id, vec2(127.1,311.7)), dot(id, vec2(269.5,183.3)))) * 43758.5453);
    vec2 delta = o + 0.18 + seed * 0.64 - f;
    float d = dot(delta, delta);
    if (d < first) { second = first; first = d; } else second = min(second, d);
  }
  float edge = second - first;
  return 1.0 - smoothstep(0.012, 0.012 + max(fwidth(edge), 0.006), edge);
}`,
      "vec3 albedo = groundAlbedo(layers, grass, meadow, meadowMean);": `
  float iceWeight = layerWeight(layers.r, meadow, meadowMean);
  float ridge = glacierRidge(p);
  float ridgeFade = 1.0 - smoothstep(0.08, 0.45, length(fwidth(p)));
  vec3 snow = settle(mix(grassMean, grass, 0.18), GRASS_SETTLE);
  snow *= 1.0 + (ridge - 0.28) * 0.14 * ridgeFade;
  vec3 ice = settle(mix(meadowMean, meadow, 0.3), MEADOW_SETTLE);
  if (iceWeight > 0.02) {
    float crack = glacierCrack(p * 0.72);
    ice = mix(ice, vec3(0.68, 0.79, 0.87), crack * 0.085 * smoothstep(0.38, 0.65, envNoise(p * 1.7)));
  }
  vec3 albedo = mix(snow, ice, iceWeight);
  ${
    patches.length
      ? `for (int i = 0; i < ${patches.length}; i++) {
    vec4 lake = uIcePatches[i];
    vec2 q = (p - lake.xy) / lake.z;
    if (dot(q,q) < 1.44) {
      float edge = length(q) / iceExtent(vec2(-q.x,q.y), lake.w);
      float bank = smoothstep(0.82, 0.99, edge)
        * (1.0 - smoothstep(1.02, 1.18, edge + (envNoise(p * 2.1) - 0.5) * 0.12));
      float drift = smoothstep(0.2, 0.8, envNoise(p * 0.65 + vec2(8.0,11.0))
        + q.x * 0.15 + q.y * 0.1);
      albedo = mix(albedo, snow, bank * drift * 0.85);
      vec4 frozen = iceSurface(vec2(-q.x,q.y), float(i), lake.w, 1.0,
        vec3(${ICE_COLOR.join(",")}), vec3(${ICE_DEEP.join(",")}));
      albedo = mix(albedo, pow(frozen.rgb, vec3(2.2)), frozen.a);
    }
  }`
      : ""
  }`,

      "// Surface-gradient normal mapping: remove the component pointing out of the geometric plane.": `
  // The broad ridge relief is restricted to snow; the smooth ice keeps its packed normal map.
  float snowWeight = (1.0 - smoothstep(0.25, 0.72, materialPatch)) * (1.0 - smoothstep(0.12, 0.55, layers.g));
  float relief = glacierRidge(p.xz);
  vec2 snowSlope = vec2(glacierRidge(p.xz + vec2(0.035, 0.0)) - relief,
    glacierRidge(p.xz + vec2(0.0, 0.035)) - relief) / 0.035;
  perturb += vec3(-snowSlope.x, 0.0, -snowSlope.y) * 0.016 * snowWeight
    * (1.0 - smoothstep(0.08, 0.45, length(fwidth(p.xz))));
  // Surface-gradient normal mapping: remove the component pointing out of the geometric plane.`,
    });
  });
}
