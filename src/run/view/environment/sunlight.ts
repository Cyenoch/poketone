import {
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
} from "three";
import type { Obstacle } from "../../sim/state/entities";
import { heightAt, type Terrain } from "../../sim/terrain";
import { glslVec, type StageTheme } from "../stageThemes";
import { fxMaterial } from "../vfx/gl";
import { latticeHash } from "./noise";
import { WIND_GLSL, type WindUniforms } from "./wind";

/** Sparse, world-rooted shafts. The sun sets their tilt; the camera only turns their thin cross-section. */
export function createSunlight(
  terrain: Terrain,
  obstacles: readonly Obstacle[],
  theme: StageTheme,
  wind: WindUniforms,
) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  const roots: number[] = [];
  if (theme.sunlight.shafts > 0) {
    const trees = obstacles.filter((o) => o.kind === "tree" || o.kind === "pine");
    for (const [i, tree] of trees.entries()) {
      if (latticeHash(731, i, 1) > 0.28) continue;
      const x = tree.x - 1.4,
        z = tree.z - 0.6;
      roots.push(x, heightAt(terrain, x, z) + 0.08, z, 0.7 + latticeHash(731, i, 2) * 1.1);
    }
    if (!trees.length)
      for (let x = -36; x <= 36; x += 24)
        for (let z = -36; z <= 36; z += 24) roots.push(x, heightAt(terrain, x, z) + 0.08, z, 1.1);
  }
  geometry.setAttribute("aLight", new InstancedBufferAttribute(new Float32Array(roots), 4));
  // Explicit normal avoids three treating this shader-only plane as flat-shaded geometry.
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute(plane.getAttribute("normal").array, 3),
  );
  geometry.instanceCount = roots.length / 4;
  const material = fxMaterial({
    uniforms: { ...wind },
    vertexShader: /* glsl */ `
      attribute vec4 aLight;
      varying vec2 vLightUv;
      varying float vLightFade;
      void main() {
        vLightUv = uv;
        vec3 sun = normalize(${glslVec(theme.light.sunOffset)});
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        right.y = 0.0; right = normalize(right);
        vec3 p = aLight.xyz + sun * uv.y * 11.0 + right * position.x * aLight.w * (1.0 + uv.y * 1.3);
        vLightFade = 1.0 - smoothstep(26.0, 44.0, distance(cameraPosition, aLight.xyz));
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${WIND_GLSL}
      varying vec2 vLightUv;
      varying float vLightFade;
      void main() {
        float side = pow(max(0.0, 1.0 - abs(vLightUv.x * 2.0 - 1.0)), 2.0);
        float ends = smoothstep(0.0, 0.12, vLightUv.y) * (1.0-smoothstep(0.35, 1.0, vLightUv.y));
        float breath = 0.88 + 0.12 * sin(uWindTime * 0.4 + vLightUv.y * 2.0);
        float a = side * ends * breath * vLightFade * ${theme.sunlight.shafts.toFixed(4)};
        gl_FragColor = vec4(${glslVec(theme.sunlight.color)} * a, a);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "sunlight-shafts";
  mesh.frustumCulled = false;
  mesh.visible = roots.length > 0;
  mesh.renderOrder = 0.75;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
