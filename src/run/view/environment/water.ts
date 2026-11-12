import {
  CircleGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  ShaderChunk,
  Vector4,
} from "three";
import { waterDepthAt, type Water as WaterMap } from "../../sim/mapgen/index";
import { inject, patchShader } from "../patchShader";
import { shadeUnderClouds } from "./clouds";
import { SHORE_GLSL, type GroundUniforms } from "./ground";
import { WIND_GLSL, type WindUniforms } from "./wind";
import { glslVec, type StageTheme, type WaterLook } from "../stageThemes";

/** Waders that draw rings, nearest the camera first; the rest of a crowd in a pond stays quiet. */
const MAX_WADERS = 12;
/**
 * The surface is drawn this far above the water plane, so a terrain triangle that pokes a few
 * centimetres above the plane just inside the outline (the mesh is linear between height samples)
 * never cuts a facet into the waterline.
 */
const SURFACE_LIFT = 0.04;

/**
 * Toon puddle water in one transparent draw (an instanced disc per puddle, cut to the shoreline in
 * the fragment shader). Everything is read from the ground's baked distance to each puddle's designed
 * outline (`shoreDistance`, the same outline the sim carves and soaks enemies in): a clear film at the
 * edge that shows the mud bank beneath, crisp shallow / mid / deep bands, thin foam along some
 * stretches of shore only, drifting caustic veins, sun glints that clouds and shadows dim, a faint sky fresnel and rings around anything wading through.
 * No normal-map lighting: the surface is flat-shaded, like the rest of the diorama. Drawn before the
 * ground decals so telegraphs stay readable on top of it.
 */
const waterGlsl = (look: WaterLook) => /* glsl */ `
${WIND_GLSL}
${SHORE_GLSL}
uniform vec4 uWaders[${MAX_WADERS}];
uniform int uWaderCount;
varying vec3 vWaterWorld;
varying float vWaterRim;
float waterSparkle;
float waterFilm;
float waterGlow;
const vec3 WATER_EDGE = ${glslVec(look.edge)};
const vec3 WATER_SHALLOW = ${glslVec(look.shallow)};
const vec3 WATER_MID = ${glslVec(look.mid)};
const vec3 WATER_DEEP = ${glslVec(look.deep)};
const vec3 WATER_VEIN = ${glslVec(look.vein)};
const vec3 WATER_FOAM = ${glslVec(look.foam)};
const vec3 WATER_SKY = ${glslVec(look.sky)};
/** Step that stays about a pixel soft at any distance, so toon edges neither shimmer nor blur. */
float waterStep(float edge, float x) {
  float w = max(fwidth(x), 1e-4);
  return smoothstep(edge - w, edge + w, x);
}
`;

const WATER_FRAGMENT = /* glsl */ `
vec3 waterNormal = vec3(0.0, 1.0, 0.0);
{
  vec2 p = vWaterWorld.xz;
  // Metres in from the shoreline (the outline is where the carve's bowl crosses the water plane).
  float inward = -groundShore(p);
  // Taken before the discard: at the waterline the neighbouring pixels are the discarded ones.
  float pixel = max(fwidth(inward), 1e-5);
  if (inward <= 0.0) discard;
  // Two soft noise layers drifting apart downwind.
  float t = uWindTime;
  vec2 q = p - uWindScroll * 0.3;
  float n1 = envNoise(q * 0.9 + vec2(t * 0.11, -t * 0.07));
  float n2 = envNoise(q * 1.3 + vec2(-t * 0.08, t * 0.12) + 4.7);
  // Bands with wavering edges, following the bowl: a clear shallow shelf, a teal middle, a dark
  // centre that only the wider ponds reach.
  float banded = inward + (n1 - 0.5) * 0.25;
  float mid = waterStep(0.32, banded);
  float deep = waterStep(0.85, banded);
  vec3 color = mix(mix(WATER_SHALLOW, WATER_MID, mid), WATER_DEEP, deep);
  // The edge is a clear film over the mud: opacity climbs from almost nothing at the waterline, over a
  // width that wanders along the shore (a wide clear shelf in places, open water close in elsewhere).
  float film = smoothstep(0.0, mix(0.06, 0.34, envNoise(p * 0.9 + 7.7)), inward);
  color = mix(WATER_EDGE, color, film);
  float alpha = mix(mix(mix(0.06, 0.5, film), 0.78, mid), 0.9, deep);
  // Caustic veins: where the two layers cross the same value, a thin wobbling network.
  float vein = 1.0 - waterStep(0.035, abs(n1 - n2));
  color = mix(color, WATER_VEIN, vein * mix(0.22, 0.1, deep) * mid);
  // Rings spreading from waders, and a foam collar where they stand.
  vec2 grad = vec2(0.0);
  float collar = 0.0;
  for (int i = 0; i < ${MAX_WADERS}; i++) {
    if (i >= uWaderCount) break;
    vec4 wader = uWaders[i];
    vec2 away = p - wader.xy;
    float r = length(away);
    if (r > 1.4) continue;
    float fall = (1.0 - r / 1.4) * (1.0 - r / 1.4);
    grad += away / max(r, 1e-3) * cos(r * 20.0 - t * 9.0 + wader.w) * fall * wader.z * 0.35;
    float ring = smoothstep(0.2, 0.26, r) * (1.0 - smoothstep(0.28, 0.36, r));
    collar = max(collar, wader.z * ring * (0.35 + 0.4 * envNoise(away * 9.0 + t * 2.0)));
  }
  waterNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
  // Foam: a thin line just off the waterline (a few centimetres, never under a pixel), only along
  // some stretches of shore and broken into dashes there; the stretches drift slowly.
  float stretch = smoothstep(0.6, 0.74, envNoise(p * 0.55 + vec2(t * 0.03, -t * 0.02) + 11.3));
  float dashes = smoothstep(0.38, 0.52, envNoise(p * 5.0 + t * 0.2));
  float halfWidth = max(0.025, pixel * 0.9);
  float shore = (1.0 - smoothstep(halfWidth * 0.5, halfWidth, abs(inward - 0.05))) * stretch * dashes;
  // A puddle whose outline reaches its disc edge (it should sit well inside) fades out there.
  float rim = 1.0 - smoothstep(0.88, 1.0, vWaterRim);
  float foam = max(shore, collar);
  diffuseColor.rgb = mix(color, WATER_FOAM, foam);
  diffuseColor.a = max(alpha, foam * 0.75) * rim;
  // Sun glints: small crisp flecks on the open water; lighting multiplies them by sun, shadow and cloud.
  float fleck = envNoise(q * 6.0 + vec2(t * 0.9, t * 0.5) + 9.2);
  waterSparkle = waterStep(0.93, fleck) * waterStep(0.55, n1) * mid * (1.0 - foam) * rim * 0.5;
  // Shallows glow faintly teal, so a pond stays a lit pool even under cloud or in shade.
  waterGlow = (1.0 - mid) * film * (1.0 - foam) * rim;
  waterFilm = film;
}
`;

interface WaderUniforms {
  uWaders: { value: Vector4[] };
  uWaderCount: { value: number };
}

function waterMaterial(
  ground: GroundUniforms,
  wind: WindUniforms,
  waders: WaderUniforms,
  theme: StageTheme,
): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ transparent: true, depthWrite: false });
  const key = `water-${theme.id}`;
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, wind, waders, {
      uGroundShore: ground.uGroundShore,
      uGroundShoreRect: ground.uGroundShoreRect,
    });
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": "#include <common>\nvarying vec3 vWaterWorld;\nvarying float vWaterRim;",
      "#include <project_vertex>": /* glsl */ `#include <project_vertex>
      vWaterWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      vWaterRim = length(position.xz);`,
    });
    const sparkleLambert = inject(ShaderChunk.lights_lambert_pars_fragment, key, {
      "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );":
        "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n\treflectedLight.directSpecular += directLight.color * waterSparkle;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\n${waterGlsl(theme.water)}`,
      "#include <lights_lambert_pars_fragment>": sparkleLambert,
      "#include <color_fragment>": `#include <color_fragment>\n${WATER_FRAGMENT}`,
      "#include <normal_fragment_begin>":
        "#include <normal_fragment_begin>\nnormal = normalize(mat3(viewMatrix) * waterNormal);",
      "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;":
        "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.directSpecular + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
      "#include <opaque_fragment>": /* glsl */ `
      outgoingLight += vec3(0.015, 0.05, 0.045) * waterGlow;
      outgoingLight = mix(outgoingLight, WATER_SKY, pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0) * 0.6 * waterFilm);
      #include <opaque_fragment>`,
    });
  });
  shadeUnderClouds(material, wind);
  return material;
}

export interface Water {
  mesh: InstancedMesh;
  /** Queue a unit standing at a world point; `stir` 0..1 (0.2 standing, 1 running). Ignored when dry. */
  wade(x: number, z: number, stir: number): void;
  /** Uploads this frame's waders, nearest to `focusX/Z` first, and clears the queue. */
  update(focusX: number, focusZ: number): void;
  dispose(): void;
}

export function createWater(
  water: WaterMap,
  wind: WindUniforms,
  ground: GroundUniforms,
  theme: StageTheme,
): Water {
  const { puddles } = water;
  const waders: WaderUniforms = {
    uWaders: { value: Array.from({ length: MAX_WADERS }, () => new Vector4()) },
    uWaderCount: { value: 0 },
  };
  // Each disc covers its puddle's whole carve (`radius`); the shader cuts it to the shoreline.
  const geometry = new CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  const material = waterMaterial(ground, wind, waders, theme);
  const mesh = new InstancedMesh(geometry, material, puddles.length);
  mesh.receiveShadow = true;
  // Transparent objects sort by render order first: water before decals, telegraphs and blob shadows.
  mesh.renderOrder = -1;
  const place = new Object3D();
  puddles.forEach((puddle, index) => {
    place.position.set(puddle.x, puddle.surface + SURFACE_LIFT, puddle.z);
    place.scale.setScalar(puddle.radius);
    place.updateMatrix();
    mesh.setMatrixAt(index, place.matrix);
  });
  mesh.computeBoundingSphere();

  // Pooled so a crowd wading through a pond allocates nothing per frame.
  const pool: { x: number; z: number; stir: number; distance: number }[] = [];
  let queued = 0;
  return {
    mesh,
    wade(x, z, stir) {
      if (waterDepthAt(water, x, z) <= 0) return;
      const wader = (pool[queued] ??= { x: 0, z: 0, stir: 0, distance: 0 });
      wader.x = x;
      wader.z = z;
      wader.stir = stir;
      queued++;
    },
    update(focusX, focusZ) {
      // Sort the pool in place; slots not queued this frame sink to the end.
      pool.forEach((wader, index) => {
        wader.distance = index < queued ? Math.hypot(wader.x - focusX, wader.z - focusZ) : Infinity;
      });
      pool.sort((a, b) => a.distance - b.distance || 0);
      const count = Math.min(MAX_WADERS, queued);
      waders.uWaderCount.value = count;
      waders.uWaders.value.forEach((slot, index) => {
        const wader = index < count ? pool[index] : undefined;
        // A fixed phase per slot keeps neighbouring rings from pulsing in lockstep.
        if (wader) slot.set(wader.x, wader.z, wader.stir, index * 2.39);
      });
      queued = 0;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
