import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry } from "three";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { fxMaterial } from "../vfx/gl";
import { latticeHash } from "./noise";
import type { WindUniforms } from "./wind";

/** Wind carries sparse grains over the dunes; screen-edge fade keeps the fight clear. */
export function createDesertDust(storm: boolean, wind: WindUniforms, terrain: TerrainUniforms) {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  for (const [name, attribute] of Object.entries(plane.attributes))
    geometry.setAttribute(name, attribute);
  const count = storm ? 2304 : 576;
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = latticeHash(7919, i, 17);
  geometry.setAttribute("aDust", new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const material = fxMaterial({
    uniforms: { ...wind, ...terrain },
    vertexShader: /* glsl */ `
      ${TERRAIN_GLSL}
      attribute vec4 aDust;
      uniform vec2 uWindScroll;
      uniform float uWindTime;
      varying vec2 vDustUv;
      varying float vDustFade;
      void main() {
        vDustUv = uv;
        vec2 xz = mod(aDust.xy * 112.0 + uWindScroll * ${storm ? "0.9" : "0.3"}, 112.0) - 56.0;
        float cycle = fract(aDust.w + uWindTime * 0.13);
        vec3 p = vec3(xz.x, terrainHeight(xz) + 0.25 + aDust.z * 2.5, xz.y);
        vec4 centre = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vec2 screen = centre.xy / centre.w;
        vDustFade = smoothstep(0.24, 0.85, length(screen * vec2(1.0, 0.8)));
        vDustFade *= sin(cycle * 3.141593) * (1.0 - smoothstep(34.0, 54.0, distance(p, cameraPosition)));
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        p += (right * position.x * 1.6 + up * position.y) * (0.035 + aDust.z * 0.045);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vDustUv;
      varying float vDustFade;
      void main() {
        float alpha = (1.0 - smoothstep(0.1, 0.5, length(vDustUv - 0.5))) * vDustFade * 0.24;
        gl_FragColor = vec4(vec3(0.71, 0.61, 0.45) * alpha, alpha);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "desert-dust";
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
