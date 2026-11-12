import {
  Frustum,
  InstancedBufferGeometry,
  Matrix4,
  Vector3,
  Mesh,
  type MeshLambertMaterial,
  Vector4,
  type PerspectiveCamera,
} from "three";
import type { Steps } from "../../../prepare/steps";
import type { World } from "../../sim/state/world";
import { heightAt, TERRAIN_HALF } from "../../sim/terrain";
import { onPassage } from "../../sim/mapgen/layout";
import { sampleDepth } from "../../sim/surface";
import type { RunAssets } from "../assets";
import { lambertCopy } from "../materials";
import { inject, patchShader } from "../patchShader";
import type { StageTheme } from "../stageThemes";
import { chunkInstances, type ChunkedInstances } from "./chunkedInstances";
import { shadeUnderClouds } from "./clouds";
import { GroundChannel, type GroundLayers } from "./ground";
import { latticeHash, valueNoise } from "./noise";
import { aboveWater, onPad, scatter } from "./scatter";
import type { WindUniforms } from "./wind";

/** Decorations never enter the simulation; respect its existing dry, open walking spaces. */
export function dressingSite(
  world: World,
  layers: GroundLayers,
  x: number,
  z: number,
  reach: number,
): boolean {
  const { map } = world;
  return (
    Math.hypot(x, z) > 5 &&
    !onPad(map, x, z) &&
    !onPassage(map.passages, x, z, reach) &&
    aboveWater(map, x, z, reach) &&
    layers.sample(GroundChannel.earth, x, z) < 0.2 &&
    map.obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.radius + reach)
  );
}

/** The terrain consumes these local light pools; no point lights, target or fullscreen pass. */
export interface GroundPools {
  uSceneryPools: { value: Vector4[] };
  uSceneryPoolCount: { value: number };
}
export const MAX_GROUND_POOLS = 12;
export function* createDressing(
  world: World,
  assets: RunAssets,
  theme: StageTheme,
  layers: GroundLayers,
  wind: WindUniforms,
  density: number,
): Steps<{
  meshes: Mesh[];
  pools: GroundPools;
  update(camera: PerspectiveCamera): void;
  dispose(): void;
}> {
  const pools: GroundPools = {
    uSceneryPools: { value: Array.from({ length: MAX_GROUND_POOLS }, () => new Vector4()) },
    uSceneryPoolCount: { value: 0 },
  };
  const candleFraction = theme.architecture?.candles[world.zone.index] ?? 1;
  const localPools: Vector4[] = [];
  const entries: {
    mesh: Mesh<InstancedBufferGeometry, MeshLambertMaterial>;
    instances: ChunkedInstances;
  }[] = [];
  for (const [index, look] of theme.dressing.entries()) {
    const groundGlow = look.groundGlow?.(world) ?? 0;
    const source = assets.scenery[look.model]!;
    const values: number[] = [];
    const put = (x: number, z: number, scale: number) => {
      const light =
        look.light *
        (latticeHash(world.seed, Math.round(x * 20), Math.round(z * 20)) < candleFraction ? 1 : 0);
      // Sign packs lit/out status without a second geometry or draw call.
      values.push(
        x,
        heightAt(world.map.terrain, x, z),
        z,
        light > 0 || look.light === 0 ? scale : -scale,
      );
      if (groundGlow > 0) localPools.push(new Vector4(x, z, 1.3, groundGlow));
      if (light > 0 && pools.uSceneryPoolCount.value < MAX_GROUND_POOLS)
        pools.uSceneryPools.value[pools.uSceneryPoolCount.value++]!.set(x, z, 1.65, light);
    };
    if (look.placement === "station") {
      for (const station of world.stations) put(station.x, station.z, 1);
    } else if (look.sites) {
      for (const [x, z] of look.sites(world)) {
        if (values.length >= MAX_GROUND_POOLS * 4) break;
        if (dressingSite(world, layers, x, z, 0.4)) put(x, z, 1);
      }
    } else {
      yield* scatter(
        1 / Math.sqrt(look.density * density),
        world.seed ^ (0x34e9 + index * 991),
        (x, z, roll) => {
          if (look.light > 0 && values.length >= MAX_GROUND_POOLS * 4) return;
          if (look.placement === "wall") {
            if (Math.max(Math.abs(x), Math.abs(z)) < 48 || !aboveWater(world.map, x, z, 0.6))
              return;
          } else {
            if (!dressingSite(world, layers, x, z, Math.min(0.45, look.height * 0.8))) return;
            if (look.placement === "shore") {
              const nearPond = world.map.water.puddles.some(
                (p) => Math.hypot(p.x - x, p.z - z) < p.radius + 3,
              );
              const water = world.map.terrain.surface?.water;
              const nearSea =
                water &&
                [
                  [3, 0],
                  [-3, 0],
                  [0, 3],
                  [0, -3],
                ].some(([dx, dz]) => sampleDepth(water, x + dx!, z + dz!) > 0);
              if (!nearPond && !nearSea) return;
            }
            // Low-frequency clusters leave quiet gaps; candles are deliberately rare, not noise thinned.
            if (look.site && !look.site(world, x, z)) return;
            if (!look.light && valueNoise(world.seed ^ index, x / 5, z / 5) < 0.53) return;
          }
          put(x, z, 0.8 + 0.4 * roll(3));
        },
      );
    }
    const instances = chunkInstances(new Float32Array(values), TERRAIN_HALF, look.height * 1.3, 8);
    const geometry = new InstancedBufferGeometry();
    geometry.index = source.geometry.index;
    for (const [name, attribute] of Object.entries(source.geometry.attributes))
      geometry.setAttribute(name, attribute);
    geometry.setAttribute("aRoot", instances.attribute);
    const material = lambertCopy(source.material);
    material.flatShading = true;
    const key = `dressing-${look.model}-${look.light}`;
    patchShader(material, key, (shader) => {
      shader.vertexShader = inject(shader.vertexShader, key, {
        "#include <common>": `#include <common>\nattribute vec4 aRoot;\nvarying float vSceneryLit;\nvarying float vSceneryHeight;`,
        "#include <beginnormal_vertex>": `#include <beginnormal_vertex>
          float normalYaw = fract(sin(dot(aRoot.xz,vec2(12.9898,78.233))) * 43758.5453)*6.28318;
          objectNormal.xz = mat2(cos(normalYaw),-sin(normalYaw),sin(normalYaw),cos(normalYaw))*objectNormal.xz;`,
        "#include <begin_vertex>": `#include <begin_vertex>
          float yaw = fract(sin(dot(aRoot.xz,vec2(12.9898,78.233))) * 43758.5453)*6.28318;
          mat2 turn = mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw));
          transformed.xz = turn * transformed.xz;
          transformed = transformed * abs(aRoot.w) + aRoot.xyz;
          vSceneryLit = step(0.0,aRoot.w);
          vSceneryHeight = position.y / ${source.height.toFixed(4)};`,
      });
      shader.fragmentShader = inject(shader.fragmentShader, key, {
        "#include <common>":
          "#include <common>\nvarying float vSceneryLit;\nvarying float vSceneryHeight;",
        "#include <color_fragment>": `#include <color_fragment>\ndiffuseColor.rgb *= mix(0.55,1.0,vSceneryLit);
          ${look.light > 0 ? "if(vSceneryLit < 0.5 && vSceneryHeight > 0.88) discard;" : ""}`,
      });
    });
    shadeUnderClouds(material, wind);
    look.patchMaterial?.(material, world);
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    geometry.instanceCount = 0;
    entries.push({ mesh, instances });
  }
  const frustum = new Frustum(),
    matrix = new Matrix4();
  // Seed one entry so the terrain installs its existing light-pool patch before the first frame.
  if (localPools.length) {
    pools.uSceneryPools.value[0]!.copy(localPools[0]!);
    pools.uSceneryPoolCount.value = 1;
  }
  const lastPoolEye = new Vector3(Infinity, Infinity, Infinity);
  const poolPoint = new Vector3();
  return {
    meshes: entries.map((e) => e.mesh),
    pools,
    update(camera) {
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      if (localPools.length && lastPoolEye.distanceToSquared(camera.position) > 1) {
        lastPoolEye.copy(camera.position);
        localPools.sort(
          (a, b) =>
            Math.hypot(a.x - camera.position.x, a.y - camera.position.z) -
            Math.hypot(b.x - camera.position.x, b.y - camera.position.z),
        );
        pools.uSceneryPoolCount.value = 0;
        for (const pool of localPools) {
          if (pools.uSceneryPoolCount.value === 4) break;
          poolPoint.set(pool.x, heightAt(world.map.terrain, pool.x, pool.y), pool.y);
          if (!frustum.containsPoint(poolPoint)) continue;
          let crowded = false;
          for (let i = 0; i < pools.uSceneryPoolCount.value; i++) {
            const other = pools.uSceneryPools.value[i]!;
            if (Math.hypot(other.x - pool.x, other.y - pool.y) < 4) crowded = true;
          }
          if (crowded) continue;
          pools.uSceneryPools.value[pools.uSceneryPoolCount.value++]!.copy(pool);
        }
      }
      for (const { mesh, instances } of entries) {
        mesh.geometry.instanceCount = instances.update(frustum, camera.position, 48);
        mesh.visible = mesh.geometry.instanceCount > 0;
      }
    },
    dispose() {
      for (const { mesh } of entries) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
