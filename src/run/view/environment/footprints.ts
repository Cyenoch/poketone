import {
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  PlaneGeometry,
  type Texture,
} from "three";
import { formOf } from "../../sim/evolution";
import { sampleDepth } from "../../sim/surface";
import type { World } from "../../sim/state/world";
import { glslVec, type FootprintLook } from "../stageThemes";
import { SURFACE_GLSL, TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { fxMaterial } from "../vfx/gl";
import { GroundChannel, type GroundLayers } from "./ground";
import { SURF_GLSL } from "./sea";
import { WIND_GLSL, type WindUniforms } from "./wind";

const CAPACITY = 192;
const STRIDE = 6;

/** Fixed ring of small ground stamps: no stamp objects, no per-frame compaction or allocations. */
export function createFootprints(
  world: World,
  terrain: TerrainUniforms,
  layers: GroundLayers,
  surfaceTexture: Texture,
  wind: WindUniforms,
  look: FootprintLook,
) {
  const surface = world.map.terrain.surface!;
  const sea = surface.liquids.some((liquid) => liquid.kind === "water");
  const data = new Float32Array(CAPACITY * STRIDE);
  const buffer = new InstancedInterleavedBuffer(data, STRIDE).setUsage(DynamicDrawUsage);
  const plane = new PlaneGeometry(1, 1, 2, 2);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.setAttribute("iPrint", new InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute("iSize", new InterleavedBufferAttribute(buffer, 2, 4));
  geometry.instanceCount = 0;
  const material = fxMaterial({
    uniforms: { ...terrain, ...wind, uSurfaceDepth: { value: surfaceTexture } },
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      ${TERRAIN_GLSL}
      attribute vec4 iPrint; // x, z, yaw, birth
      attribute vec2 iSize;
      varying vec2 vPrintUv;
      varying vec2 vPrintWorld;
      varying float vBirth;
      void main() {
        vec2 q = (uv - 0.5) * iSize;
        vec2 f = vec2(sin(iPrint.z), cos(iPrint.z));
        vec2 p = iPrint.xy + vec2(-f.y, f.x) * q.x + f * q.y;
        vPrintUv = uv * 2.0 - 1.0;
        vPrintWorld = p;
        vBirth = iPrint.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, terrainHeight(p) + 0.018, p.y, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${TERRAIN_GLSL}
      ${SURFACE_GLSL}
      ${WIND_GLSL}
      ${sea ? SURF_GLSL : ""}
      varying vec2 vPrintUv;
      varying vec2 vPrintWorld;
      varying float vBirth;
      void main() {
        float age = uWindTime - vBirth;
        float fade = 1.0 - smoothstep(${(look.lifetime * 0.35).toFixed(3)}, ${look.lifetime.toFixed(3)}, age);
        if (fade <= 0.0) discard;
        float wet = 0.0;
        ${
          sea
            ? /* glsl */ `
        float depth = surfaceDepth(vPrintWorld).r;
        if (depth > 0.0) discard;
        float shore = seaShore(vPrintWorld, depth);
        if (shore < 2.0) {
          float phase = envNoise(vPrintWorld * 0.055) * 0.75 + envNoise(vPrintWorld * 0.15 + 3.3) * 0.18;
          float now = uWindTime / SURF_PERIOD + phase;
          float born = vBirth / SURF_PERIOD + phase;
          float cycle = floor(now);
          float front = surfFront(fract(now), surfRunup(vPrintWorld, cycle));
          front = max(front, surfFront(fract(born), surfRunup(vPrintWorld, floor(born))));
          // Include every intervening crest: a washed print never reappears on the draw-back.
          for (int i = 0; i < 3; i++) {
            float c = cycle - float(i);
            if (c + SURF_RISE >= born && c + SURF_RISE <= now)
              front = max(front, surfRunup(vPrintWorld, c));
          }
          fade *= smoothstep(front, front + 0.12, shore);
          wet = seaSurf(vPrintWorld, shore).wet;
        }`
            : ""
        }
        vec2 q = vPrintUv;
        // A heel pad and three toes: readable as a small paw, oriented once when it lands.
        float pad = length((q - vec2(0.0, -0.2)) / vec2(0.58, 0.65)) - 1.0;
        float toes = min(length((q - vec2(-0.42, 0.48)) / vec2(0.24, 0.3)),
          min(length((q - vec2(0.0, 0.65)) / vec2(0.24, 0.3)),
              length((q - vec2(0.42, 0.48)) / vec2(0.24, 0.3)))) - 1.0;
        float d = min(pad, toes);
        float edge = max(fwidth(d), mix(${look.softness.toFixed(3)}, 0.025, wet));
        float inside = 1.0 - smoothstep(-edge, edge, d);
        float lip = (1.0 - smoothstep(0.04, 0.22 + edge, d)) * (1.0 - inside);
        float shade = 0.75 + 0.25 * smoothstep(-0.7, 0.6, q.y);
        float alpha = (inside + lip * 0.28) * fade * ${look.strength.toFixed(3)} * mix(1.0, 1.25, wet);
        vec3 color = mix(${glslVec(look.ink)} * shade, ${glslVec(look.rim)}, lip);
        gl_FragColor = vec4(color * alpha, alpha);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "footprints";
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.5;
  mesh.visible = false;
  const walkers = world.players.map((p) => ({ x: p.x, z: p.z, travel: 0, side: 1 }));
  let cursor = 0;
  let latest = -Infinity;
  return {
    mesh,
    update(alpha: number) {
      let dirty = false;
      for (let i = 0; i < world.players.length; i++) {
        const p = world.players[i]!;
        const last = walkers[i]!;
        const x = p.px + (p.x - p.px) * alpha;
        const z = p.pz + (p.z - p.pz) * alpha;
        const dx = x - last.x,
          dz = z - last.z;
        const distance = Math.hypot(dx, dz);
        last.x = x;
        last.z = z;
        const form = formOf(p);
        if (!p.alive || distance > 2 || form.types.includes("flying")) {
          last.travel = 0;
          continue;
        }
        const size = Math.max(0.25, Math.min(0.48, form.radius * 0.8));
        last.travel += distance;
        if (distance < 0.001 || last.travel < size * 1.8) continue;
        last.travel %= size * 1.8;
        const px = x + (dz / distance) * size * 0.5 * last.side;
        const pz = z - (dx / distance) * size * 0.5 * last.side;
        last.side *= -1;
        if (
          sampleDepth(surface.water, px, pz) > 0 ||
          sampleDepth(surface.lava, px, pz) > 0 ||
          layers.sample(GroundChannel.earth, px, pz) > 0.4
        )
          continue;
        const offset = cursor * STRIDE;
        data[offset] = px;
        data[offset + 1] = pz;
        data[offset + 2] = Math.atan2(dx, dz);
        data[offset + 3] = wind.uWindTime.value;
        data[offset + 4] = size;
        data[offset + 5] = size * 1.35;
        latest = wind.uWindTime.value;
        cursor = (cursor + 1) % CAPACITY;
        geometry.instanceCount = Math.min(CAPACITY, geometry.instanceCount + 1);
        dirty = true;
      }
      if (dirty) buffer.needsUpdate = true;
      mesh.visible = wind.uWindTime.value - latest < look.lifetime;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
