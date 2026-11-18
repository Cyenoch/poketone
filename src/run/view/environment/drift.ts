import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry } from "three";
import type { DriftLook } from "../themes/types";
import { glslVec } from "../stageThemes";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { fxMaterial } from "../vfx/gl";
import { latticeHash } from "./noise";
import { WIND_GLSL, type WindUniforms } from "./wind";

/** Side of the camera-centred box the particles wrap in: covers the view at every zoom, no more. */
const SPAN = 52;

const SHAPE = { streak: 0, mote: 1, flake: 2, leaf: 3, sheet: 4 } as const;

/**
 * Wind-carried ambience (sand streaks, spindrift, ash, leaves, motes, ground dust sheets) in one
 * instanced draw per look. Particles wrap around the camera, travel with the shared wind scroll and
 * fade out around the screen centre, so the fight itself stays clear. View-only: nothing reads back.
 */
export function createDrift(
  look: DriftLook,
  wind: WindUniforms,
  terrain: TerrainUniforms,
  density: number,
  salt: number,
) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  for (const [name, attribute] of Object.entries(plane.attributes))
    geometry.setAttribute(name, attribute);
  const count = Math.max(1, Math.round(look.count * density));
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = latticeHash(7927 + salt * 131, i, 29);
  geometry.setAttribute("aDrift", new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const shape = SHAPE[look.shape];
  const material = fxMaterial({
    uniforms: { ...wind, ...terrain },
    vertexShader: /* glsl */ `
      ${TERRAIN_GLSL}
      ${WIND_GLSL}
      attribute vec4 aDrift;
      varying vec2 vDriftUv;
      varying float vDriftFade;
      varying float vDriftSeed;
      void main() {
        vDriftUv = uv;
        vDriftSeed = aDrift.w;
        // Calm air still has a direction: streaks and sheets need an axis even when the wind drops.
        vec2 windAxis = dot(uWindDir, uWindDir) > 1e-4 ? normalize(uWindDir) : vec2(0.0, 1.0);
        float cycle = fract(aDrift.w * 7.13 + uWindTime * ${(1 / look.life).toFixed(4)});
        vec2 travel = uWindScroll * ${look.speed.toFixed(3)} + windAxis * cycle * ${look.carry.toFixed(3)};
        // The box centres where the view axis meets the ground, not under the (tilted, offset) camera.
        vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec2 focus = cameraPosition.xz + forward.xz * (cameraPosition.y / max(-forward.y, 0.2));
        vec2 xz = focus + mod(aDrift.xy * ${SPAN.toFixed(1)} + travel - focus, ${SPAN.toFixed(1)}) - ${(SPAN / 2).toFixed(1)};
        float lift = mix(${look.height[0].toFixed(3)}, ${look.height[1].toFixed(3)}, aDrift.z) + cycle * ${look.rise.toFixed(3)};
        vec3 p = vec3(xz.x, terrainHeight(xz) + lift, xz.y);
        float wobble = aDrift.w * 40.0 + uWindTime * ${look.flutter.toFixed(3)};
        vec2 across = vec2(-windAxis.y, windAxis.x);
        p.xz += across * sin(wobble) * 0.25 * ${look.flutter > 0 ? "1.0" : "0.0"};
        p.y += cos(wobble * 0.7) * 0.12 * ${look.flutter > 0 ? "1.0" : "0.0"};
        vec4 centre = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vec2 screen = centre.xy / centre.w;
        vDriftFade = smoothstep(${look.clear.toFixed(3)}, ${(look.clear + 0.45).toFixed(3)}, length(screen * vec2(1.0, 0.8)));
        vDriftFade *= sin(cycle * 3.141593) * (1.0 - smoothstep(${(SPAN * 0.36).toFixed(1)}, ${(SPAN * 0.5).toFixed(1)}, distance(p.xz, focus)));
        vDriftFade *= 0.6 + 0.4 * uWindStrength + 0.4 * uWindGust;
        float size = mix(0.6, 1.0, aDrift.z);
        vec2 corner = position.xy * vec2(${look.size[1].toFixed(3)}, ${look.size[0].toFixed(3)}) * size;
        vec3 along = vec3(windAxis.x, 0.0, windAxis.y);
        #if ${shape} == 4
          // Ground sheet: a flat ribbon lying on the terrain, stretched downwind.
          p += along * corner.x + vec3(across.x, 0.0, across.y) * corner.y;
          p.y = terrainHeight(p.xz) + lift;
        #elif ${shape} == 0
          // Streak: stretched downwind, widened toward the camera.
          vec3 toEye = normalize(cameraPosition - p);
          vec3 side = normalize(cross(along, toEye));
          p += along * corner.x + side * corner.y;
        #else
          float spin = ${shape === SHAPE.leaf ? "uWindTime * (1.5 + aDrift.y * 2.0) + aDrift.x * 6.2832" : "0.0"};
          vec2 turned = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * corner;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          p += right * turned.x + up * turned.y;
        #endif
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${WIND_GLSL}
      varying vec2 vDriftUv;
      varying float vDriftFade;
      varying float vDriftSeed;
      void main() {
        vec2 q = vDriftUv * 2.0 - 1.0;
        float alpha;
        #if ${shape} == 4
          float streaks = envNoise(vec2(vDriftUv.x * 2.0 + vDriftSeed * 9.0, vDriftUv.y * 9.0));
          alpha = (1.0 - smoothstep(0.3, 1.0, abs(q.y))) * (1.0 - smoothstep(0.4, 1.0, abs(q.x)));
          alpha *= smoothstep(0.35, 0.8, streaks);
        #elif ${shape} == 0
          alpha = (1.0 - smoothstep(0.0, 1.0, abs(q.y))) * (1.0 - smoothstep(0.2, 1.0, abs(q.x)));
        #elif ${shape} == 3
          alpha = 1.0 - smoothstep(0.75, 1.0, length(q * vec2(1.0, 1.8)));
        #else
          alpha = 1.0 - smoothstep(0.1, 1.0, length(q));
        #endif
        vec3 color = ${glslVec(look.color)} * mix(0.8, 1.15, fract(vDriftSeed * 17.3));
        #if ${shape} == 2
          // Flakes catch the light now and then.
          color *= 1.0 + 1.4 * step(0.93, fract(vDriftSeed * 31.0 + uWindTime * 0.7));
        #endif
        alpha *= vDriftFade * ${look.alpha.toFixed(3)};
        gl_FragColor = vec4(color * alpha, alpha);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = `drift-${look.shape}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.65;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
