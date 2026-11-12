import type { Steps } from "../../../prepare/steps";
import {
  DoubleSide,
  Float32BufferAttribute,
  Frustum,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type InstancedBufferGeometry,
  type PerspectiveCamera,
} from "three";
import { TERRAIN_HALF, type Terrain } from "../../sim/terrain";
import { inject, patchShader } from "../patchShader";
import { TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { chunkInstances, type ChunkedInstances } from "./chunkedInstances";
import { shadeUnderClouds } from "./clouds";
import { flowerGeometry, flowerVertex, placeFlowers } from "./flowers";
import { grassGeometry, grassVertex, placeGrass } from "./grass";
import { groundGlsl, type GroundLayers, type GroundUniforms } from "./ground";
import { NOISE_GLSL } from "./noise";
import { placeReeds, reedGeometry, reedVertex } from "./reeds";
import type { GeneratedMap } from "../../sim/mapgen/index";
import { WIND_GLSL, type WindUniforms } from "./wind";
import type { StageTheme } from "../stageThemes";

/**
 * Plants shrink away between these camera distances, just past the edge of the view: the far screen
 * corners on flat ground sit 31–36 m from the camera (42° fov, 4:3 to 19.5:9), so nothing visibly
 * shrinks; lower ground in a hollow only shows a little more.
 */
const FADE_NEAR = 38;
const FADE_FAR = 44;
/** Tallest plant (a reed stand) plus its wind lean, for chunk bounds. */
const PLANT_TOP = 1.1;

/**
 * Vertex-side helpers for everything rooted in the ground. Each layer's body reads `aRoot`
 * (x, y, z, layer parameter), declares `vec3 transformed` in world space and sets `vFoliageColor`.
 */
const foliageGlsl = (theme: StageTheme) => /* glsl */ `
${TERRAIN_GLSL}
${NOISE_GLSL}
${groundGlsl(theme.ground)}
${WIND_GLSL}
attribute vec4 aRoot;
uniform vec3 uFoliagePusher;
varying vec3 vFoliageColor;
vec3 groundNormal(vec2 xz, float y) {
  const float e = 0.35;
  return normalize(vec3(y - terrainHeight(xz + vec2(e, 0.0)), e, y - terrainHeight(xz + vec2(0.0, e))));
}
/** 1 near the camera, 0 by the fade distance, so plants shrink out instead of popping. */
float foliageFade(vec3 root) {
  return 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, distance(cameraPosition, root));
}
/** Wind lean plus a slight bend away from the player's feet (a nudge, not a parting). */
vec2 foliageLean(vec3 root, float phase, float rate) {
  vec2 away = root.xz - uFoliagePusher.xz;
  float d = length(away);
  float press = (1.0 - smoothstep(0.1, 0.45, d)) * (1.0 - smoothstep(0.6, 1.2, abs(uFoliagePusher.y - root.y)));
  return windLean(root.xz, phase, rate) + away / max(d, 1e-3) * press * 0.4;
}
/** Bends a rest offset (rooted at 0, y up) by \`lean\` per unit height at bend weight t, keeping its length. */
vec3 bendBy(vec3 offset, vec2 lean, float t) {
  vec2 bend = lean * t;
  offset.xz += bend * offset.y;
  offset.y /= sqrt(1.0 + dot(bend, bend));
  return offset;
}
`;

interface FoliageUniforms {
  terrain: TerrainUniforms;
  ground: GroundUniforms;
  wind: WindUniforms;
  pusher: { value: Vector3 };
}

/** A layer's own vertex code: global declarations, and the body that replaces `begin_vertex`. */
interface FoliageVertex {
  attributes: string;
  body: string;
}

/** Lambert-lit with the ground's own normal on both faces, so a plant's root matches the soil under it. */
function foliageMaterial(
  key: string,
  uniforms: FoliageUniforms,
  vertex: FoliageVertex,
  theme: StageTheme,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ side: DoubleSide });
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, uniforms.terrain, uniforms.ground, uniforms.wind, {
      uFoliagePusher: uniforms.pusher,
    });
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": `#include <common>\n${foliageGlsl(theme)}\n${vertex.attributes}`,
      "#include <beginnormal_vertex>": "vec3 objectNormal = groundNormal(aRoot.xz, aRoot.y);",
      "#include <begin_vertex>": vertex.body,
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": "#include <common>\nvarying vec3 vFoliageColor;",
      "#include <color_fragment>": "#include <color_fragment>\ndiffuseColor.rgb *= vFoliageColor;",
      "#include <normal_fragment_begin>":
        "#include <normal_fragment_begin>\nnormal = normalize(vNormal);",
    });
  });
  shadeUnderClouds(material, uniforms.wind);
  return material;
}

interface FoliageLayer {
  mesh: Mesh<InstancedBufferGeometry, MeshLambertMaterial>;
  instances: ChunkedInstances;
}

export interface Foliage {
  meshes: Mesh[];
  /** Culls to the camera and bends plants away from `pusher` (the player's feet). */
  update(camera: PerspectiveCamera, pusher: Vector3): void;
  dispose(): void;
}

export interface FoliageSetup {
  terrain: Terrain;
  layers: GroundLayers;
  map: GeneratedMap;
  seed: number;
  /** 1 on desktop; lower on phones. Scales every layer's instance count. */
  density: number;
  terrainUniforms: TerrainUniforms;
  groundUniforms: GroundUniforms;
  wind: WindUniforms;
  theme: StageTheme;
}

/** Grass blades (lawn and tall tufts), a flower kit (four flowers and clover) and pond reeds: three instanced draws. */
/** Steps (`prepare/steps.ts`): each layer's placement is a step. */
export function* createFoliage(setup: FoliageSetup): Steps<Foliage> {
  const uniforms: FoliageUniforms = {
    terrain: setup.terrainUniforms,
    ground: setup.groundUniforms,
    wind: setup.wind,
    pusher: { value: new Vector3(0, -100, 0) },
  };
  const layer = (
    key: string,
    geometry: InstancedBufferGeometry,
    vertex: FoliageVertex,
    values: Float32Array,
  ): FoliageLayer => {
    const instances = chunkInstances(values, TERRAIN_HALF, PLANT_TOP, 4);
    geometry.setAttribute("aRoot", instances.attribute);
    // three shades normal-less geometry flat; the real normal comes from the ground in the shader.
    geometry.setAttribute(
      "normal",
      new Float32BufferAttribute(geometry.getAttribute("position").count * 3, 3),
    );
    geometry.instanceCount = 0;
    const mesh = new Mesh(
      geometry,
      foliageMaterial(
        `${key}-${setup.theme.id}-${JSON.stringify(setup.theme.vegetation)}`,
        uniforms,
        vertex,
        setup.theme,
      ),
    );
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return { mesh, instances };
  };
  const placement = {
    terrain: setup.terrain,
    layers: setup.layers,
    map: setup.map,
    seed: setup.seed,
    density: setup.density,
  };
  const layers: FoliageLayer[] = [];
  const { grass, flowers, reeds } = setup.theme.vegetation;
  if (grass && grass.density > 0)
    layers.push(
      layer(
        "foliage-grass",
        grassGeometry(),
        grassVertex(grass),
        yield* placeGrass(placement, grass),
      ),
    );
  yield;
  if (flowers && flowers.density > 0)
    layers.push(
      layer(
        "foliage-flowers",
        flowerGeometry(),
        flowerVertex(flowers),
        yield* placeFlowers(placement, flowers),
      ),
    );
  yield;
  if (reeds && reeds.density > 0)
    layers.push(
      layer(
        "foliage-reeds",
        reedGeometry(),
        reedVertex(reeds),
        yield* placeReeds({ ...placement, density: placement.density * reeds.density }),
      ),
    );
  const frustum = new Frustum();
  const viewProjection = new Matrix4();
  return {
    meshes: layers.map((entry) => entry.mesh),
    update(camera, pusher) {
      viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection);
      uniforms.pusher.value.copy(pusher);
      for (const { mesh, instances } of layers) {
        mesh.geometry.instanceCount = instances.update(frustum, camera.position, FADE_FAR);
        mesh.visible = mesh.geometry.instanceCount > 0;
      }
    },
    dispose() {
      for (const { mesh } of layers) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
