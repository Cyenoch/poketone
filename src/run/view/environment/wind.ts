import { Vector2, Vector4, type Material } from "three";
import type { StageTheme } from "../stageThemes";
import type { Wind } from "../../sim/wind";
import { inject, patchShader } from "../patchShader";
import { NOISE_GLSL } from "./noise";

/** Shader view of `windAt`, shared by reference across every material that sways or drifts. */
export interface WindUniforms {
  uCloudLook: { value: Vector4 };
  uWindDir: { value: Vector2 };
  uWindStrength: { value: number };
  uWindGust: { value: number };
  /** Integrated downwind travel: gust swells and cloud shadows drift without jumping when the wind turns. */
  uWindScroll: { value: Vector2 };
  uWindTime: { value: number };
}

export function createWindUniforms(clouds: StageTheme["clouds"]): WindUniforms {
  return {
    uCloudLook: { value: new Vector4(clouds.scale, clouds.depth, ...clouds.coverage) },
    uWindDir: { value: new Vector2(0, 1) },
    uWindStrength: { value: 0 },
    uWindGust: { value: 0 },
    uWindScroll: { value: new Vector2() },
    uWindTime: { value: 0 },
  };
}

export function updateWindUniforms(uniforms: WindUniforms, wind: Wind, dt: number): void {
  uniforms.uWindDir.value.set(wind.dirX, wind.dirZ);
  uniforms.uWindStrength.value = wind.strength;
  uniforms.uWindGust.value = wind.gust;
  // Swells travel faster than the breeze itself, which is what makes a gust read as a gust.
  const travel = (2 + 5 * wind.strength + 4 * wind.gust) * dt;
  uniforms.uWindScroll.value.x += wind.dirX * travel;
  uniforms.uWindScroll.value.y += wind.dirZ * travel;
  uniforms.uWindTime.value += dt;
}

export const WIND_GLSL = /* glsl */ `
${NOISE_GLSL}
#ifndef ENV_WIND
#define ENV_WIND
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindGust;
uniform vec2 uWindScroll;
uniform float uWindTime;
/**
 * Lean (horizontal offset per unit of height) of something rooted at p. Swells of stronger wind roll
 * downwind across the field; on top, each root flutters at its own phase. \`rate\`: blades fast, trees slow.
 */
vec2 windLean(vec2 p, float phase, float rate) {
  float swell = envNoise((p - uWindScroll) * 0.08);
  float push = uWindStrength * (0.4 + 0.6 * swell) + uWindGust * smoothstep(0.35, 0.85, swell);
  float flutter = sin(uWindTime * rate + phase * 6.2832);
  vec2 across = vec2(-uWindDir.y, uWindDir.x);
  return uWindDir * push + (uWindDir * 0.7 + across * 0.5) * flutter * (0.06 + 0.2 * push);
}
#endif
`;

/**
 * Leans instanced props downwind, rooted at their base: `height` is the model's rest height (local units),
 * `flex` the lean in world units at the top for a full-strength push. Applied in world space after the
 * instance transform so the lean never rotates with the prop's own yaw.
 */
export function swayInWind(
  material: Material,
  wind: WindUniforms,
  height: number,
  flex: number,
  rate: number,
): void {
  const key = `wind-sway:${height}:${flex}:${rate}`;
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": `#include <common>\n${WIND_GLSL}`,
      "#include <project_vertex>": /* glsl */ `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        vec2 swayRoot = (modelMatrix * instanceMatrix[3]).xz;
      #else
        vec2 swayRoot = modelMatrix[3].xz;
      #endif
      vec4 swayWorld = modelMatrix * mvPosition;
      float swayT = clamp(transformed.y / ${height.toFixed(3)}, 0.0, 1.0);
      swayWorld.xz += windLean(swayRoot, envHash(swayRoot), ${rate.toFixed(3)}) * ${flex.toFixed(3)} * swayT * swayT;
      mvPosition = viewMatrix * swayWorld;
      gl_Position = projectionMatrix * mvPosition;
      `,
    });
  });
}
