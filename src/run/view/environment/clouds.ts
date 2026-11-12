import type { Material } from "three";
import { inject, patchShader } from "../patchShader";
import { WIND_GLSL, type WindUniforms } from "./wind";

const CLOUD_GLSL = /* glsl */ `
${WIND_GLSL}
uniform vec4 uCloudLook;
/** Sunlight left under the drifting cloud field at a world point: 1 clear, 1 - depth under a core. */
float cloudLight(vec3 world) {
  // Exactly the grass swell's integrated travel, including turns and gust acceleration.
  vec2 q = (world.xz - uWindScroll) * uCloudLook.x;
  float cover = envNoise(q) * 0.65 + envNoise(q * 2.7 + 13.1) * 0.35;
  return 1.0 - uCloudLook.y * smoothstep(uCloudLook.z, uCloudLook.w, cover);
}
`;

/**
 * Shadows only, with no cloud geometry or extra draw. Two noise samples per vertex, independent of
 * cloud count; the existing terrain, foliage and prop patches share the same world-space field.
 */
export function shadeUnderClouds(material: Material, wind: WindUniforms): void {
  const key = "cloud-shadows";
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": `#include <common>\n${CLOUD_GLSL}\nvarying float vCloudLight;`,
      // World position recovered from view space: works whichever earlier patch built mvPosition.
      "#include <fog_vertex>": `#include <fog_vertex>\nvCloudLight = cloudLight((mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix));`,
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": "#include <common>\nvarying float vCloudLight;",
      "#include <lights_fragment_end>": /* glsl */ `#include <lights_fragment_end>
      reflectedLight.directDiffuse *= vCloudLight;
      reflectedLight.directSpecular *= vCloudLight;`,
    });
  });
}
