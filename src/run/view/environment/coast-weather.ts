import {
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector3,
  type Material,
} from "three";
import { fxMaterial } from "../vfx/gl";
import { inject, patchShader } from "../patchShader";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { latticeHash } from "./noise";
import type { WindUniforms } from "./wind";
import type { World } from "../../sim/state/world";
import { zoneDef } from "../../sim/currentZone";

/** Rain stays outside the combat centre; lightning lights distant haze, never the scene lights. */
export function createCoastWeather(
  world: Readonly<World>,
  wind: WindUniforms,
  terrain: TerrainUniforms,
) {
  if (zoneDef(world).atmosphere === "tropic") return null;
  const root = new Group();
  root.name = "coast-weather";
  const centre = { value: new Vector3() };
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  for (const [name, attribute] of Object.entries(plane.attributes))
    geometry.setAttribute(name, attribute);
  const seeds = new Float32Array(320 * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = latticeHash(7319, i, 3);
  geometry.setAttribute("aRain", new InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 320;
  const material = fxMaterial({
    uniforms: { ...wind, ...terrain, uCoastCentre: centre },
    vertexShader: /* glsl */ `
      ${TERRAIN_GLSL}
      attribute vec4 aRain;
      uniform vec3 uCoastCentre;
      uniform vec2 uWindDir;
      uniform float uWindTime;
      uniform float uWindStrength;
      uniform float uLiquidTop;
      varying vec2 vRainUv;
      varying float vRainFade;
      void main() {
        vRainUv = uv;
        float cycle = fract(aRain.z + uWindTime * (0.8 + aRain.w * 0.35));
        float angle = aRain.x * 6.283185;
        float radius = mix(10.0, 29.0, aRain.y);
        vec2 xz = uCoastCentre.xz + vec2(cos(angle), sin(angle)) * radius;
        xz += uWindDir * (cycle - 0.5) * (2.0 + uWindStrength * 3.0);
        float floorY = max(terrainHeight(xz), uLiquidTop);
        vec3 p = vec3(xz.x, floorY + (1.0 - cycle) * 7.0 + 0.1, xz.y);
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 tail = vec3(-uWindDir.x * 0.32, 0.8, -uWindDir.y * 0.32);
        p += right * position.x * 0.025 + tail * position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vec2 screen = gl_Position.xy / gl_Position.w;
        float edge = smoothstep(0.28, 0.82, length(screen * vec2(1.0, 0.8)));
        vRainFade = edge * smoothstep(0.0, 0.1, cycle) * (1.0 - smoothstep(0.85, 1.0, cycle));
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vRainUv;
      varying float vRainFade;
      void main() {
        float a = pow(1.0 - abs(vRainUv.x * 2.0 - 1.0), 2.0);
        a *= sin(vRainUv.y * 3.141593) * vRainFade * 0.22;
        gl_FragColor = vec4(vec3(0.69, 0.8, 0.83) * a, a);
      }`,
  });
  const rain = new Mesh(geometry, material);
  rain.frustumCulled = false;
  rain.renderOrder = 0.65;
  root.add(rain);

  return {
    root,
    update(target: Readonly<Vector3>) {
      centre.value.copy(target);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function coastThunderTerrain(material: Material): void {
  patchShader(material, "coast-distant-lightning", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "coast-distant-lightning", {
      "#include <common>": "#include <common>\nvarying vec4 vCoastClip;",
      "#include <fog_vertex>": "#include <fog_vertex>\nvCoastClip = gl_Position;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "coast-distant-lightning", {
      "#include <common>": "#include <common>\nvarying vec4 vCoastClip;",
      "#include <fog_fragment>": /* glsl */ `#include <fog_fragment>
          float stormPhase = mod(uWindTime + 2.0, 11.7);
          float flash = exp(-pow((stormPhase - 1.0) / 0.085, 2.0))
            + 0.55 * exp(-pow((stormPhase - 1.24) / 0.13, 2.0));
          float distant = smoothstep(28.0, 48.0, length(vViewPosition));
          float upper = smoothstep(0.35, 0.85, vCoastClip.y / vCoastClip.w);
          float gap = smoothstep(0.55, 0.9, vCloudLight);
          gl_FragColor.rgb += vec3(0.2, 0.25, 0.28) * flash * distant * upper * gap;`,
    });
  });
}
