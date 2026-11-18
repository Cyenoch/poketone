import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
  Vector4,
} from "three";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { fxMaterial } from "../vfx/gl";
import { latticeHash } from "./noise";
import { WIND_GLSL, type WindUniforms } from "./wind";

const SLOTS = 2;
const GRAINS = 110;
/** Seconds a devil lives, and the quiet gap before its slot spins up again. */
const LIFE = 6;
const GAP = [4, 11] as const;
/** Distance from the camera target where a devil may form, to its left or right: off the fight, on screen. */
const RING = [8, 12] as const;

/**
 * Up to two short-lived dust devils spinning up on a ring off the fight centre and drifting downwind.
 * Each is a funnel of grains in one instanced draw; slots are placed on the CPU so a devil stays put
 * in the world while the camera moves. View-only.
 */
export function createDustDevils(wind: WindUniforms, terrain: TerrainUniforms) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  for (const [name, attribute] of Object.entries(plane.attributes))
    geometry.setAttribute(name, attribute);
  const seeds = new Float32Array(SLOTS * GRAINS * 4);
  for (let i = 0; i < SLOTS * GRAINS; i++) {
    seeds[i * 4] = Math.floor(i / GRAINS);
    for (let k = 1; k < 4; k++) seeds[i * 4 + k] = latticeHash(8111, i, k);
  }
  geometry.setAttribute("aGrain", new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = SLOTS * GRAINS;
  // (x, z, age 0..1, unused); age outside (0, 1) hides the slot.
  const devils = Array.from({ length: SLOTS }, () => new Vector4(0, 0, -1, 0));
  const material = fxMaterial({
    uniforms: { ...wind, ...terrain, uDevils: { value: devils } },
    vertexShader: /* glsl */ `
      ${TERRAIN_GLSL}
      ${WIND_GLSL}
      uniform vec4 uDevils[${SLOTS}];
      attribute vec4 aGrain;
      varying vec2 vGrainUv;
      varying float vGrainFade;
      void main() {
        vGrainUv = uv;
        vec4 devil = uDevils[int(aGrain.x)];
        float age = devil.z;
        float life = smoothstep(0.0, 0.2, age) * (1.0 - smoothstep(0.65, 1.0, age)) * step(0.0, age) * step(age, 1.0);
        // Grains climb the funnel and widen as they rise; the top spins slower than the base.
        float h = fract(aGrain.y + uWindTime * (0.3 + 0.15 * aGrain.w));
        float radius = 0.25 + h * h * 1.7 + 0.12 * sin(uWindTime * 3.0 + aGrain.z * 20.0);
        float angle = aGrain.z * 6.2832 + uWindTime * (6.5 - 3.5 * h);
        vec2 windAxis = dot(uWindDir, uWindDir) > 1e-4 ? normalize(uWindDir) : vec2(0.0, 1.0);
        vec2 xz = devil.xy + vec2(cos(angle), sin(angle)) * radius * (0.4 + 0.6 * life) + windAxis * h * h * 1.1;
        vec3 p = vec3(xz.x, terrainHeight(devil.xy) + 0.1 + h * 3.6 * (0.5 + 0.5 * life), xz.y);
        vec4 centre = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vec2 screen = centre.xy / centre.w;
        vGrainFade = life * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.55, 1.0, h))
          * smoothstep(0.3, 0.6, length(screen * vec2(1.0, 0.8)));
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        float size = 0.22 + 0.4 * h + 0.15 * aGrain.w;
        p += (right * position.x + up * position.y) * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vGrainUv;
      varying float vGrainFade;
      void main() {
        float alpha = (1.0 - smoothstep(0.05, 0.5, length(vGrainUv - 0.5))) * vGrainFade * 0.6;
        gl_FragColor = vec4(vec3(1.0, 0.84, 0.6) * alpha, alpha);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "dust-devils";
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.66;
  // The camera's horizontal right: devils form beside the fight on screen whatever the camera yaw.
  const right = new Vector3(1, 0, 0);
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0);
    if (right.lengthSq() > 1e-6) right.normalize();
  };

  // Each slot spins up at `born` (wind time) and is placed then, around wherever the camera is.
  const born = Array.from({ length: SLOTS }, (_, i) => GAP[0] * (i + 0.5));
  const placed = Array.from({ length: SLOTS }, () => false);
  let spawned = 0;
  let last = wind.uWindTime.value;
  return {
    mesh,
    update(target: Readonly<Vector3>) {
      const now = wind.uWindTime.value;
      const dt = now - last;
      last = now;
      const dir = wind.uWindDir.value;
      for (const [i, devil] of devils.entries()) {
        const age = (now - born[i]!) / LIFE;
        if (age > 1) {
          spawned++;
          born[i] = now + GAP[0] + latticeHash(8113, spawned, 3) * (GAP[1] - GAP[0]);
          placed[i] = false;
          devil.z = -1;
        } else if (age >= 0) {
          if (!placed[i]) {
            spawned++;
            // Left or right of the screen, where the wide sides have room; fixed in the world after.
            const side = latticeHash(8113, spawned, 4) < 0.5 ? 1 : -1;
            const spread = (latticeHash(8113, spawned, 1) - 0.5) * 1.1;
            const r = RING[0] + latticeHash(8113, spawned, 2) * (RING[1] - RING[0]);
            const c = Math.cos(spread) * r * side,
              s = Math.sin(spread) * r * side;
            devil.set(
              target.x + right.x * c - right.z * s,
              target.z + right.x * s + right.z * c,
              age,
              0,
            );
            placed[i] = true;
          }
          devil.z = age;
          devil.x += dir.x * dt * 1.4;
          devil.y += dir.y * dt * 1.4;
        }
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
