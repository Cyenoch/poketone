import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from "three";
import { inject, patchShader } from "../patchShader";
import type { Terrain } from "../../sim/terrain";
import { latticeHash, valueNoise } from "./noise";

/** CPU-baked periodic cells: edge distance, plate tone, broad paint variation, cell phase. */
export function bakeLavaCrust() {
  const size = 256,
    cells = 8,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = (x / size) * cells,
        py = (y / size) * cells;
      let first = 100,
        second = 100,
        tone = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const cx = Math.floor(px) + i,
            cy = Math.floor(py) + j;
          const wx = (cx + cells) % cells,
            wy = (cy + cells) % cells;
          const dx = cx + 0.18 + latticeHash(723, wx, wy) * 0.64 - px;
          const dy = cy + 0.18 + latticeHash(941, wx, wy) * 0.64 - py;
          const d = Math.hypot(dx, dy);
          if (d < first) {
            second = first;
            first = d;
            tone = latticeHash(817, wx, wy);
          } else second = Math.min(second, d);
        }
      const k = (y * size + x) * 4;
      pixels[k] = Math.min(255, (second - first) * 420);
      pixels[k + 1] = tone * 255;
      // Periodic broad brush modulation, baked once instead of fragment-noise octaves.
      pixels[k + 2] =
        (0.5 +
          0.22 * Math.sin((px * Math.PI) / 2 + Math.sin((py * Math.PI) / 2)) +
          0.18 * Math.cos((py * Math.PI) / 2 - (px * Math.PI) / 4)) *
        255;
      pixels[k + 3] = (0.5 + 0.5 * Math.sin(tone * 29)) * 255;
    }
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Signed shore distance and a smoothed bank-tangent flow; the sim depth still owns the boundary. */
export function bakeLavaFlow(terrain: Terrain) {
  const grid = terrain.surface!.lava,
    n = grid.samples,
    values = grid.values;
  const distance = new Float32Array(n * n).fill(1000);
  const gx = new Float32Array(n * n),
    gz = new Float32Array(n * n);
  const step = 1 / grid.resolution;
  for (let z = 1; z < n - 1; z++)
    for (let x = 1; x < n - 1; x++) {
      const k = z * n + x,
        wet = values[k]! > 0;
      for (const o of [-1, 1, -n, n])
        if (values[k + o]! > 0 !== wet)
          distance[k] = Math.min(
            distance[k]!,
            (Math.abs(values[k]!) / (Math.abs(values[k]!) + Math.abs(values[k + o]!))) * step,
          );
      gx[k] = (values[k + 1]! - values[k - 1]!) / (2 * step);
      gz[k] = (values[k + n]! - values[k - n]!) / (2 * step);
    }
  // Eight-neighbour distance transform: no runtime nearest-bank searches.
  for (const direction of [1, -1]) {
    for (let zz = 1; zz < n - 1; zz++)
      for (let xx = 1; xx < n - 1; xx++) {
        const x = direction > 0 ? xx : n - 1 - xx,
          z = direction > 0 ? zz : n - 1 - zz;
        const k = z * n + x;
        distance[k] = Math.min(
          distance[k]!,
          distance[k - direction]! + step,
          distance[k - direction * n]! + step,
          distance[k - direction * n - 1]! + step * Math.SQRT2,
          distance[k - direction * n + 1]! + step * Math.SQRT2,
        );
      }
  }
  const pixels = new Uint8Array(n * n * 4);
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      let xx = 0,
        xz = 0,
        zz = 0;
      for (let j = -4; j <= 4; j++)
        for (let i = -4; i <= 4; i++) {
          const k = Math.max(0, Math.min(n - 1, z + j)) * n + Math.max(0, Math.min(n - 1, x + i));
          xx += gx[k]! * gx[k]!;
          xz += gx[k]! * gz[k]!;
          zz += gz[k]! * gz[k]!;
        }
      const angle = Math.atan2(2 * xz, xx - zz) * 0.5;
      let tx = -Math.sin(angle),
        tz = Math.cos(angle);
      if (tz < 0) {
        tx = -tx;
        tz = -tz;
      }
      // Authored channels run north/south. Cap gradients must not curl the current back on itself.
      tx = Math.max(-0.32, Math.min(0.32, tx));
      tz = Math.sqrt(1 - tx * tx);
      const k = z * n + x,
        d = distance[k]! * (values[k]! > 0 ? 1 : -1);
      pixels[k * 4] = (tx * 0.5 + 0.5) * 255;
      pixels[k * 4 + 1] = (tz * 0.5 + 0.5) * 255;
      pixels[k * 4 + 2] = Math.max(0, Math.min(255, (d / 8 + 0.5) * 255));
      pixels[k * 4 + 3] = valueNoise(921, x * 0.13, z * 0.13) * 255;
    }
  const texture = new DataTexture(pixels, n, n, RGBAFormat, UnsignedByteType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export const LAVA_GLSL = /* glsl */ `
uniform sampler2D uLavaCrust;
uniform sampler2D uLavaFlow;
float lavaShore(vec2 p, float depth) {
  return -(texture2D(uLavaFlow, terrainUv(p)).b - 0.5) * 8.0;
}
`;

/**
 * Ground beside a pool: a ragged band of cooled grey crust right at the edge, charred rock behind it,
 * and a warm emissive spill that fades with distance.
 */
export const LAVA_BANK = /* glsl */ `
  float lava = surfaceDepth(p).g;
  float lavaDistance = lavaShore(p, lava);
  if (lava <= 0.0 && lavaDistance < 3.0) {
    float roughEdge = texture2D(uLavaCrust, p * 0.16).b;
    float rag = envNoise(p * 1.9) * 0.6 + envNoise(p * 4.3) * 0.4;
    float charred = 1.0 - smoothstep(0.04, 0.3 + roughEdge * 0.45, lavaDistance);
    float cooled = (1.0 - smoothstep(0.02, 0.12 + rag * 0.3, lavaDistance)) * smoothstep(0.25, 0.5, rag + roughEdge * 0.3);
    float warmth = (1.0 - smoothstep(0.08, 1.15 + roughEdge * 0.6, lavaDistance))
      * (0.4 + 0.6 * roughEdge);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.016, 0.019), charred * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.085, 0.08), cooled * 0.8);
    totalEmissiveRadiance += vec3(0.17, 0.043, 0.002) * warmth * warmth * (1.0 - cooled * 0.6);
  }
`;

/**
 * The molten surface: dark crust plates drifting on a current, glowing only through their cracks and
 * a few open channels. The current is the bank-tangent flow bent by a slow noise field (eddies, not
 * rails), and a ragged band of dead crust along the shore breaks the pool's outline.
 */
export const LAVA_FRAGMENT = /* glsl */ `
{
  vec2 p = vSurfaceWorld;
  if (surfaceDepth(p).g <= 0.0) discard;
  vec4 flow = texture2D(uLavaFlow, terrainUv(p));
  float shore = max(0.0, (flow.b - 0.5) * 8.0);
  float t = uWindTime;
  vec2 swirl = vec2(envNoise(p * 0.11 + 3.7), envNoise(p * 0.11 - 5.1)) - 0.5;
  vec2 direction = normalize(normalize(flow.rg * 2.0 - 1.0) + swirl * 2.2);
  // Two overlapping advection phases avoid an endless stretch at bends.
  float phase = fract(t * 0.05), other = fract(t * 0.05 + 0.5);
  float blend = abs(phase * 2.0 - 1.0);
  vec2 uv = p / 11.0;
  vec4 a = texture2D(uLavaCrust, uv - direction * phase * 0.3);
  vec4 b = texture2D(uLavaCrust, uv - direction * other * 0.3 + 0.5);
  float edge = mix(a.r, b.r, blend);
  float tone = mix(a.g, b.g, blend);
  float paint = mix(a.b, b.b, blend);
  float fine = mix(texture2D(uLavaCrust, uv * 3.1 - direction * phase * 0.9 + 0.31).r,
    texture2D(uLavaCrust, uv * 3.1 - direction * other * 0.9 + 0.81).r, blend);
  float hot = smoothstep(0.5, 2.2, shore);
  float width = mix(0.05, 0.13, hot) * (0.6 + 0.8 * paint);
  float crack = 1.0 - smoothstep(width * 0.4, width, edge);
  float hair = (1.0 - smoothstep(0.015, 0.05, fine)) * hot * 0.55;
  float channel = smoothstep(0.7, 0.86, envNoise(p * 0.33 - direction * t * 0.05)) * hot;
  channel *= smoothstep(0.3, 0.6, envNoise(p * 1.4 - direction * t * 0.12));
  float molten = max(max(crack, hair), channel * 0.9);
  vec3 crust = mix(vec3(0.014, 0.011, 0.014), vec3(0.055, 0.036, 0.036), tone) * (0.75 + 0.5 * paint);
  crust += vec3(0.1, 0.018, 0.0) * (1.0 - smoothstep(width, width * 3.5, edge)) * (0.35 + 0.65 * hot);
  float pulse = 0.85 + 0.15 * sin(t * 0.9 + paint * 7.0);
  vec3 melt = mix(vec3(0.5, 0.05, 0.004), vec3(1.0, 0.42, 0.04), smoothstep(0.55, 1.0, molten) * pulse);
  vec3 color = mix(crust, melt, molten);
  float rag = envNoise(p * 1.3) * 0.6 + envNoise(p * 3.7) * 0.4;
  float rim = 1.0 - smoothstep(0.08, 0.3 + rag * 0.8, shore);
  color = mix(color, vec3(0.026, 0.019, 0.021) + vec3(0.12, 0.02, 0.0) * crack * 0.35, rim);
  // Infrequent swelling blisters in the open channels; phase and size are cell-seeded.
  vec2 cell = floor(p / 2.7), local = fract(p / 2.7) - 0.5;
  float seed = envHash(cell), age = fract(t * 0.16 + seed * 13.0);
  float bubble = (1.0 - smoothstep(0.018, 0.045, abs(length(local) - age * 0.095)))
    * smoothstep(0.55, 0.7, age) * (1.0 - smoothstep(0.78, 0.88, age)) * step(0.82, seed) * channel;
  color = mix(color, vec3(1.0, 0.66, 0.07), bubble * 0.65);
  diffuseColor.rgb = vec3(0.0);
  totalEmissiveRadiance = color;
}
`;

/** Run-owned textures; bind before shader compile, dispose with the terrain. */
export function createLavaLook(terrain: Terrain) {
  const crust = bakeLavaCrust(),
    flow = bakeLavaFlow(terrain);
  return {
    bind(material: import("three").Material) {
      Object.assign(material, { lavaCrust: crust, lavaFlow: flow });
      const previous = material.onBeforeCompile.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        previous(shader, renderer);
        shader.uniforms.uLavaCrust = { value: crust };
        shader.uniforms.uLavaFlow = { value: flow };
      };
    },
    bindCreature(material: import("three").MeshLambertMaterial, strength: number) {
      lavaUnderglow(material, flow, terrain, strength);
    },
    dispose() {
      crust.dispose();
      flow.dispose();
    },
  };
}

/** Reuses the terrain flow bake; warm underside fill, never another light or render pass. */
export function lavaUnderglow(
  material: import("three").MeshLambertMaterial,
  flow: DataTexture,
  terrain: Terrain,
  strength: number,
) {
  Object.assign(material, { lavaFlow: flow });
  patchShader(material, `lava-underglow-${strength}`, (shader) => {
    shader.uniforms.uLavaFlow = { value: flow };
    shader.vertexShader = inject(shader.vertexShader, "lava-underglow", {
      "#include <common>": "#include <common>\nvarying vec3 vLavaBodyWorld;",
      "#include <fog_vertex>": `#include <fog_vertex>
        vLavaBodyWorld = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);`,
    });
    shader.fragmentShader = inject(shader.fragmentShader, "lava-underglow", {
      "#include <common>":
        "#include <common>\nuniform sampler2D uLavaFlow;\nvarying vec3 vLavaBodyWorld;",
      "#include <opaque_fragment>": `
        vec2 heatUv = ((vLavaBodyWorld.xz - ${terrain.origin.toFixed(3)}) * ${terrain.resolution.toFixed(3)} + 0.5) / ${terrain.samples.toFixed(1)};
        float bankDistance = (texture2D(uLavaFlow, heatUv).b - 0.5) * 8.0;
        float nearHeat = smoothstep(-2.6, 0.2, bankDistance);
        vec3 heatNormal = normal * mat3(viewMatrix);
        float underside = 0.25 + 0.75 * (1.0 - smoothstep(-0.65, 0.6, heatNormal.y));
        float lift = 1.0 - smoothstep(0.3, 3.0, vLavaBodyWorld.y);
        outgoingLight += vec3(0.42, 0.12, 0.012) * nearHeat * underside * lift * ${strength.toFixed(3)};
        #include <opaque_fragment>`,
    });
  });
}
