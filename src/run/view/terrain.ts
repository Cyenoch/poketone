import type { RunAssets } from "./assets";
import { slabGlsl } from "./architecture";
import {
  ClampToEdgeWrapping,
  type BufferGeometry,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  RedFormat,
  RGFormat,
  Vector4,
  type Material,
  type Texture,
} from "three";
import { TERRAIN_HALF, type Terrain } from "../sim/terrain";
import { shadeUnderClouds } from "./environment/clouds";
import { groundGlsl, sandGlsl, type GroundUniforms } from "./environment/ground";
import { LAVA_BANK, LAVA_FRAGMENT, LAVA_GLSL } from "./environment/lava";
import { terrainGeometry } from "./environment/terrainGeometry";
import { NOISE_GLSL } from "./environment/noise";
import { SEA_FRAGMENT, SEA_LIGHT, SEA_OUTGOING, seaGlsl } from "./environment/sea";
import { WIND_GLSL, type WindUniforms } from "./environment/wind";
import { inject, patchShader } from "./patchShader";
import { glslVec, type StageTheme } from "./stageThemes";
import { createGridWalls } from "./walls";

/**
 * One heightmap, three consumers: terrain geometry (CPU), terrain shading (lip outline, cliff faces,
 * contact shadow) and anything that must hug the ground (skill decals, telegraphs) via `conformToTerrain`.
 */
export interface TerrainUniforms {
  uTerrainHeight: { value: Texture };
  /** (origin, samples per unit, 1 / samples, terrace step) */
  uTerrainRect: { value: Vector4 };
  /** Top of the highest liquid plane (its drawn surface), or far below the map without one. */
  uLiquidTop: { value: number };
}

/** Liquid planes draw this far above their level. */
const LIQUID_LIFT = 0.025;

export const TERRAIN_GLSL = /* glsl */ `
#ifndef TERRAIN_GLSL
#define TERRAIN_GLSL
uniform sampler2D uTerrainHeight;
uniform vec4 uTerrainRect;
vec2 terrainUv(vec2 xz) {
  return ((xz - uTerrainRect.x) * uTerrainRect.y + 0.5) * uTerrainRect.z;
}
float terrainHeight(vec2 xz) {
  return texture2D(uTerrainHeight, terrainUv(xz)).r;
}
#endif
`;

export function createTerrainUniforms(terrain: Terrain): TerrainUniforms {
  const data = new Uint16Array(terrain.heights.length);
  for (let i = 0; i < data.length; i++) data[i] = DataUtils.toHalfFloat(terrain.heights[i]!);
  // Half floats are filterable in WebGL 2 core; 32-bit floats would need an extension.
  const texture = new DataTexture(data, terrain.samples, terrain.samples, RedFormat, HalfFloatType);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return {
    uTerrainHeight: { value: texture },
    uTerrainRect: {
      value: new Vector4(terrain.origin, terrain.resolution, 1 / terrain.samples, terrain.step),
    },
    uLiquidTop: {
      value: Math.max(
        -1e4,
        ...(terrain.surface?.liquids ?? []).map((liquid) => liquid.level + LIQUID_LIFT),
      ),
    },
  };
}

/** Lifts every vertex onto the terrain after the model/instance transform. Geometry must be subdivided. */
export function conformToTerrain(material: Material, uniforms: TerrainUniforms, lift = 0.06): void {
  const key = `conform:${lift}`;
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = inject(`${TERRAIN_GLSL}\n${shader.vertexShader}`, key, {
      "#include <project_vertex>": /* glsl */ `
      vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 conformed = modelMatrix * mvPosition;
      conformed.y += terrainHeight(conformed.xz) + ${lift.toFixed(3)};
      mvPosition = viewMatrix * conformed;
      gl_Position = projectionMatrix * mvPosition;
      `,
    });
  });
}

const BAYER = "float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.)";

export const SURFACE_GLSL = /* glsl */ `
uniform sampler2D uSurfaceDepth;
vec2 surfaceDepth(vec2 p) {
  return texture2D(uSurfaceDepth, terrainUv(p)).rg;
}
`;

/**
 * Screen-door fade driven by a per-instance `aFade` attribute (1 = solid). Stays in the opaque pass:
 * no sorting, depth intact, shadows unchanged — the usual top-down occluder treatment.
 */
export function ditherFade(material: Material): void {
  const key = "dither-fade";
  patchShader(material, key, (shader) => {
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": "#include <common>\nattribute float aFade;\nvarying float vFade;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvFade = aFade;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\nvarying float vFade;\nconst float bayer4[16] = ${BAYER};`,
      "void main() {": /* glsl */ `void main() {
        if (vFade < 0.999) {
          ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
          if ((bayer4[cell.x + cell.y * 4] + 0.5) / 16.0 > vFade) discard;
        }`,
    });
  });
}

export interface TerrainMesh {
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  surfaceTexture: Texture;
  dispose(): void;
}

/** Lambert with the sea's sun glint (`seaGloss`), and direct specular added to the outgoing light. */
const GLOSSY_LIGHT: Record<string, string> = {
  "#include <lights_lambert_pars_fragment>": SEA_LIGHT,
  "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;":
    "vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.directSpecular + reflectedLight.indirectDiffuse + totalEmissiveRadiance;",
};

/** Quilez-style anti-tiling: two copies of a tile at offsets picked by a slow noise, cross-faded. */
const UNTILED_GLSL = /* glsl */ `
vec3 sampleUntiled(sampler2D map, vec2 uv, vec2 dx, vec2 dy) {
  float k = envNoise(uv * 0.37) * 7.0;
  float i = floor(k);
  float f = fract(k);
  vec3 a = textureGrad(map, uv + sin(vec2(3.0, 7.0) * i), dx, dy).rgb;
  vec3 b = textureGrad(map, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy).rgb;
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * dot(a - b, vec3(1.0))));
}
`;

const TERRAIN_FRAGMENT = /* glsl */ `
{
  vec2 p = vTerrainWorld.xz;
  float stepH = uTerrainRect.w;
  float h = terrainHeight(p);
  const float e = 0.22;
  vec2 grad = vec2(
    terrainHeight(p + vec2(e, 0.0)) - terrainHeight(p - vec2(e, 0.0)),
    terrainHeight(p + vec2(0.0, e)) - terrainHeight(p - vec2(0.0, e))
  ) / (2.0 * e);
  float slope = length(grad);
  const float r = 0.7;
  float n0 = terrainHeight(p + vec2(r, 0.0));
  float n1 = terrainHeight(p - vec2(r, 0.0));
  float n2 = terrainHeight(p + vec2(0.0, r));
  float n3 = terrainHeight(p - vec2(0.0, r));
  float drop = h - min(min(n0, n1), min(n2, n3));
  float rise = max(max(n0, n1), max(n2, n3)) - h;
  vec4 structure = textureLod(uGroundStructure, terrainUv(p), 0.0);

  // Walkable ground: anti-tiled grass with meadow patches. Derivatives are taken up front so the
  // branches below can skip their fetches where a layer is absent.
  vec4 layers = groundLayers(p);
  layers.r = max(layers.r, structure.a * MATERIAL_PATCH);
  float earth = layers.g;
  // The mask is per half-metre cell; near its edge, a small 5-tap average rounds the cell staircase
  // into a curve while straight edges keep their 0.5 crossing (the rule boundary) in place.
  if (earth > 0.01 && earth < 0.99) {
    const float o = 0.2;
    earth = (earth * 2.0 + groundLayers(p + vec2(o, 0.0)).g + groundLayers(p - vec2(o, 0.0)).g
      + groundLayers(p + vec2(0.0, o)).g + groundLayers(p - vec2(0.0, o)).g) / 6.0;
  }
  vec3 dwx = dFdx(vTerrainWorld);
  vec3 dwy = dFdy(vTerrainWorld);
#ifdef SEA_SHORE
  // Metres from the sea's waterline (positive inland). The sea bed is sand, never an earth bank: the
  // water over it already says how deep it is.
  float seaDepth = surfaceDepth(p).r;
  float seaS = seaShore(p, seaDepth);
  float seaPx = max(fwidth(seaS), 1e-3);
  if (seaDepth > 0.0) earth = 0.0;
#else
  float seaS = 1e3;
#endif
#ifdef GROUND_SAND
  vec3 grassMean = vec3(0.0);
  vec3 grass = grassMean;
  vec3 albedo = sandAlbedo(p, dwx.xz, dwy.xz, 1.0 - smoothstep(0.3, 4.5, seaS));
#else
  // Extra detail contrast around the tile's mean: dark tufts and lit speckles, same average colour.
  vec3 grassMean = meanColor(uGrassMap);
  vec3 grass = max(mix(grassMean, sampleUntiled(uGrassMap, p / GRASS_TILE, dwx.xz / GRASS_TILE, dwy.xz / GRASS_TILE), DETAIL_CONTRAST), 0.0);
  vec3 meadowMean = meanColor(uMeadowMap);
  vec4 materialDetail = textureGrad(uMeadowDetail, p / MEADOW_TILE, dwx.xz / MEADOW_TILE, dwy.xz / MEADOW_TILE);
  layers.r = clamp(layers.r + (materialDetail.b - 0.5) * 0.18 * MATERIAL_PATCH, 0.0, 1.0);
  vec3 meadow = layers.r > 0.02
    ? sampleUntiled(uMeadowMap, p / MEADOW_TILE, dwx.xz / MEADOW_TILE, dwy.xz / MEADOW_TILE)
    : meadowMean;
  vec3 albedo = groundAlbedo(layers, grass, meadow, meadowMean);
  // Dark speckles of low weeds across the turf (the earth banks below paint over them).
  albedo *= mix(vec3(1.0), GROUND_SPECKLE, smoothstep(0.7, 0.76, envNoise(p * SPECKLE_FREQUENCY)) * SPECKLE_STRENGTH);
#endif
  // Turf lip: a narrow sunlit rim where walkable ground breaks over an earth bank below it.
  float rim = smoothstep(0.02, 0.15, earth) * (1.0 - smoothstep(0.2, 0.45, earth));
  albedo *= 1.0 + GROUND_LIP * max(rim, structure.g * 0.6) * smoothstep(0.1, 0.4, (drop - rise) / stepH);

  // Pond banks: the turf darkens and cools toward the water, then gives way to a strip of dark wet
  // soil whose width wanders along the shore (in places the turf meets the water directly). Under the
  // water the soil fades into a dark bed. Not the earth-bank colour: that one means "can't walk here".
  float shore = groundShore(p);
  if (shore < MUD_BANK + 1.2) {
    albedo *= groundDamp(shore);
    float width = MUD_BANK * smoothstep(0.4, 0.85, envNoise(p * 0.7 + 3.1));
    // The edge follows the turf's own detail (tufts reach onto the soil), like the earth banks.
    float onMud = 1.0 - smoothstep(-0.08, 0.08, shore - width + (groundLuma(grass) - groundLuma(grassMean)) * 0.8);
    vec3 dirt = textureGrad(uDirtMap, p / DIRT_TILE, dwx.xz / DIRT_TILE, dwy.xz / DIRT_TILE).rgb;
    vec3 mud = WET_SOIL * (0.75 + 0.5 * groundLuma(dirt) / max(groundLuma(meanColor(uDirtMap)), 1e-3));
    float pebble = smoothstep(0.9, 0.93, envNoise(p * 8.0 + 1.7)) * smoothstep(0.03, 0.1, shore);
    mud = mix(mud, PEBBLE, pebble);
    vec3 bed = mix(mud, POND_BED, smoothstep(0.0, 0.45, -shore));
    albedo = mix(albedo, bed, max(onMud, step(shore, 0.0)));
  }
#ifdef SEA_SHORE
  // The beach the sea laps: washes run up in irregular stretches, the sand they reach turns dark and
  // glossy, foam rides each wash's edge, and the stain dries before the next. Under the sea the bed
  // darkens with depth and catches caustics.
  if (seaS < 2.8) {
    Surf w = seaSurf(p, seaS);
    float wet = max(w.wet, 1.0 - smoothstep(-0.05, 0.3, seaS));
#ifdef GROUND_SAND
    vec3 soaked = albedo * (SAND_WET / SAND_DAMP);
#else
    vec3 soaked = albedo * 0.55;
#endif
    albedo = mix(albedo, soaked, wet * 0.9);
    float film = smoothstep(-seaPx, seaPx, w.edge) * smoothstep(-0.6, 0.0, seaS);
    albedo = mix(albedo, albedo * 0.55 + SEA_SHALLOW * 0.3, film * (0.4 + 0.3 * smoothstep(0.0, 1.0, w.edge)));
    float foam = surfFoam(p, w, seaPx) * smoothstep(-0.3, 0.0, seaS);
    albedo = mix(albedo, SEA_FOAM, foam);
    seaGloss = (wet * 0.4 + film * 0.6) * (1.0 - foam) * smoothstep(-0.4, 0.0, seaS);
  }
  if (seaDepth > 0.0) {
    float t = uWindTime;
    vec2 cq = p * 1.25;
    float c1 = envNoise(cq + vec2(t * 0.33, t * 0.12));
    float c2 = envNoise(cq * 1.4 + vec2(-t * 0.21, t * 0.29) + 5.7);
    float caustic = 1.0 - smoothstep(0.0, 0.06, abs(c1 - c2));
    float reach = smoothstep(0.02, 0.18, seaDepth) * (1.0 - smoothstep(0.45, 1.4, seaDepth));
    albedo = albedo * mix(vec3(1.0), vec3(0.7, 0.86, 0.9), smoothstep(0.0, 1.5, seaDepth)) + SEA_CAUSTIC * caustic * reach * 0.1;
  }
#endif

  // Earth exactly where ground walkers cannot go (the nav mask): packed soil on the gentler banks,
  // side-on strata on sheer ones, darker toward the foot of each terrace.
  if (earth > 0.01) {
    vec3 wn = normalize(vec3(-grad.x, 1.0, -grad.y));
    vec3 w = pow(abs(wn), vec3(4.0));
    w /= w.x + w.y + w.z;
    vec3 strataX = textureGrad(uCliffMap, vTerrainWorld.zy / CLIFF_TILE, dwx.zy / CLIFF_TILE, dwy.zy / CLIFF_TILE).rgb;
    vec3 strataZ = textureGrad(uCliffMap, vTerrainWorld.xy / CLIFF_TILE, dwx.xy / CLIFF_TILE, dwy.xy / CLIFF_TILE).rgb;
    vec3 strataY = textureGrad(uCliffMap, p / CLIFF_TILE, dwx.xz / CLIFF_TILE, dwy.xz / CLIFF_TILE).rgb;
    vec3 strata = settle(strataX * w.x + strataY * w.y + strataZ * w.z, CLIFF_SETTLE);
    float seam = sin((vTerrainWorld.y + envNoise(p * 0.35) * 0.12) / BANK_STRATA.x * 6.2832);
    strata *= 1.0 + smoothstep(-0.25, 0.25, seam) * BANK_STRATA.y;
    vec3 soil = settle(textureGrad(uDirtMap, p / DIRT_TILE, dwx.xz / DIRT_TILE, dwy.xz / DIRT_TILE).rgb, DIRT_SETTLE);
    // One continuous face: repeating height-band resets made deep crevasses read as stacked boxes.
    vec3 bank = mix(soil, strata, smoothstep(BANK_SLOPE.x, BANK_SLOPE.y, slope));
    bank *= mix(BANK_SHADE.x, BANK_SHADE.y, smoothstep(-0.6, 0.8, (drop-rise)/stepH));
    // Noise breaks the mask's half-metre cell staircase into an organic edge; it never moves the edge
    // by more than a fraction of a cell.
    albedo = mix(albedo, bank, smoothstep(0.35, 0.65, earth + (envNoise(p * 2.7) - 0.5) * 0.25));
  }
  albedo *= mix(vec3(1.0), groundOcclusion(0.35), structure.b);
  diffuseColor.rgb *= albedo * vGroundMacro;
  // Occlusion: hollows, the foot of every bank and the base of every prop sit in their own shade.
  diffuseColor.rgb *= groundOcclusion(layers.a);

  // Silhouette ink: only on edges whose slope falls away from the viewer (the plateau hides
  // what lies behind it). Slopes rising toward the camera show their face and get no line.
  // Weight grows with how squarely the slope faces away and how tall the drop is.
  vec2 downhill = slope > 1e-3 ? -grad / slope : vec2(0.0);
  vec2 viewDir = normalize(p - cameraPosition.xz);
  float away = smoothstep(0.05, 0.6, dot(downhill, viewDir));
  float tall = smoothstep(0.25, 1.0, drop / stepH);
  float weight = away * smoothstep(0.25, 0.9, slope) * mix(0.35, 1.0, tall) * smoothstep(-0.2, 0.0, h);
  float contour = h / stepH;
  float inkDist = abs(fract(contour) - 0.9) / max(fwidth(contour), 1e-4);
  float width = mix(0.7, 2.2, weight);
  float ink = (1.0 - smoothstep(width * 0.5, width, inkDist)) * weight;
#ifdef SEA_SHORE
  ink *= 1.0 - smoothstep(-0.05, 0.05, seaDepth);
#endif
  diffuseColor.rgb = mix(diffuseColor.rgb, GROUND_INK, ink * 0.92);
#ifdef LAVA_SURFACE
${LAVA_BANK}
#endif
}
`;

const terrainNormalGlsl = (look: StageTheme["ground"]) => /* glsl */ `
{
  vec3 p = vTerrainWorld;
  vec3 dx = dFdx(p), dy = dFdy(p);
  vec3 wn = normalize(normal * mat3(viewMatrix));
  vec4 layers = groundLayers(p.xz);
  float materialPatch = max(layers.r, textureLod(uGroundStructure, terrainUv(p.xz), 0.0).a * MATERIAL_PATCH);
  vec2 detail = (textureGrad(uGrassDetail, p.xz / GRASS_TILE, dx.xz / GRASS_TILE, dy.xz / GRASS_TILE).rg * 2.0 - 1.0) * ${look.grass.normal.toFixed(3)};
  if (materialPatch > 0.02) detail = mix(detail, (textureGrad(uMeadowDetail, p.xz / MEADOW_TILE, dx.xz / MEADOW_TILE, dy.xz / MEADOW_TILE).rg * 2.0 - 1.0) * ${look.meadow.normal.toFixed(3)}, smoothstep(0.4,0.6,materialPatch));
  vec3 perturb = vec3(detail.x,0.0,detail.y);
  if (layers.g > 0.01) {
    vec3 weights = pow(abs(wn),vec3(4.0)); weights /= weights.x + weights.y + weights.z;
    vec2 nx = textureGrad(uCliffDetail,p.zy/CLIFF_TILE,dx.zy/CLIFF_TILE,dy.zy/CLIFF_TILE).rg*2.0-1.0;
    vec2 ny = textureGrad(uCliffDetail,p.xz/CLIFF_TILE,dx.xz/CLIFF_TILE,dy.xz/CLIFF_TILE).rg*2.0-1.0;
    vec2 nz = textureGrad(uCliffDetail,p.xy/CLIFF_TILE,dx.xy/CLIFF_TILE,dy.xy/CLIFF_TILE).rg*2.0-1.0;
    vec3 rock = vec3(0.0,nx.y,nx.x)*weights.x + vec3(ny.x,0.0,ny.y)*weights.y + vec3(nz.x,nz.y,0.0)*weights.z;
    vec2 soil = textureGrad(uDirtDetail,p.xz/DIRT_TILE,dx.xz/DIRT_TILE,dy.xz/DIRT_TILE).rg*2.0-1.0;
    vec3 bank = mix(rock * ${look.cliff.normal.toFixed(3)},vec3(soil.x,0.0,soil.y) * ${look.dirt.normal.toFixed(3)},smoothstep(0.65,0.95,abs(wn.y)));
    perturb = mix(perturb,bank,smoothstep(0.2,0.7,layers.g));
  }
  // Surface-gradient normal mapping: remove the component pointing out of the geometric plane.
  normal = normalize(mat3(viewMatrix) * (wn + perturb - wn * dot(perturb,wn)));
}
`;

/**
 * Stylised terraces from the heightmap and the baked ground layers: grass and meadow wherever ground
 * walkers can go, earth banks exactly where they cannot, occlusion in hollows and at bank feet, and an
 * ink line where an edge falls away from the camera. Height reads through light, shadow, line and
 * occlusion — never by bleaching the grass.
 */
export function createTerrainMesh(
  terrain: Terrain,
  uniforms: TerrainUniforms,
  ground: GroundUniforms,
  wind: WindUniforms,
  theme: StageTheme,
  scenery: RunAssets["scenery"],
): TerrainMesh {
  const size = TERRAIN_HALF * 2;
  const geometry = terrainGeometry(terrain);
  const depths = new Uint16Array(terrain.heights.length * 2);
  for (let i = 0; i < terrain.heights.length; i++) {
    depths[i * 2] = DataUtils.toHalfFloat(terrain.surface?.water.values[i] ?? -1);
    depths[i * 2 + 1] = DataUtils.toHalfFloat(terrain.surface?.lava.values[i] ?? -1);
  }
  const surfaceTexture = new DataTexture(
    depths,
    terrain.samples,
    terrain.samples,
    RGFormat,
    HalfFloatType,
  );
  surfaceTexture.magFilter = surfaceTexture.minFilter = LinearFilter;
  surfaceTexture.wrapS = surfaceTexture.wrapT = ClampToEdgeWrapping;
  surfaceTexture.needsUpdate = true;
  const surfaceUniform = { uSurfaceDepth: { value: surfaceTexture } };
  // The existing resource walker sees public texture fields, including on context loss.
  const material = Object.assign(new MeshLambertMaterial(), { surfaceDepth: surfaceTexture });
  // A sea (a static water plane) brings the shore effects; sand replaces the grass layers.
  const sea = (terrain.surface?.liquids ?? []).some((liquid) => liquid.kind === "water");
  const sand = theme.ground.sand;
  const lava = terrain.surface?.liquids.some((liquid) => liquid.kind === "lava");
  const key = `terrain-shading-${theme.id}:${JSON.stringify([theme.ground, theme.sunlight, theme.light.sunOffset, theme.architecture])}`;
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, uniforms, ground, surfaceUniform, wind);
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": `#include <common>
varying vec3 vTerrainWorld;
varying vec3 vGroundMacro;
${TERRAIN_GLSL}
${WIND_GLSL}
${groundGlsl(theme.ground)}`,
      "#include <begin_vertex>": `#include <begin_vertex>
        vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGroundMacro = ${sand ? "vec3(1.0)" : "groundMacro(vTerrainWorld.xz, vTerrainWorld.y / uTerrainRect.w)"};
        float canopy = textureLod(uGroundStructure, terrainUv(vTerrainWorld.xz), 0.0).r;
        float pool = smoothstep(0.42, 0.7, envNoise(vTerrainWorld.xz * 0.8 - uWindScroll * 0.015));
        vGroundMacro *= mix(vec3(1.0), vec3(0.78, 0.87, 0.94), canopy * ${theme.sunlight.canopy.toFixed(3)} * 3.0);
        vGroundMacro += ${glslVec(theme.sunlight.color)} * pool * canopy * ${theme.sunlight.canopy.toFixed(3)};
        `,
    });
    const shore = sea ? `#define SEA_SHORE\n${WIND_GLSL}\n${seaGlsl(theme.water)}` : "";
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\nvarying vec3 vTerrainWorld;\nvarying vec3 vGroundMacro;\nconst float MATERIAL_PATCH = ${theme.ground.patch.toFixed(3)};\n${TERRAIN_GLSL}\n${SURFACE_GLSL}\n${NOISE_GLSL}\n${groundGlsl(theme.ground)}\n${UNTILED_GLSL}\nuniform sampler2D uGrassDetail;\nuniform sampler2D uMeadowDetail;\nuniform sampler2D uDirtDetail;\nuniform sampler2D uCliffDetail;\n${lava ? `#define LAVA_SURFACE\n${LAVA_GLSL}` : ""}\n${sand ? sandGlsl(sand) : ""}\n${shore}`,
      "#include <map_fragment>": `#include <map_fragment>\n${sea ? "seaGloss = 0.0;" : ""}\n${TERRAIN_FRAGMENT}
${theme.architecture ? slabGlsl(theme.architecture) : ""}`,
      "#include <normal_fragment_maps>": `#include <normal_fragment_maps>
${terrainNormalGlsl(theme.ground)}`,
      "#include <fog_fragment>": `#include <fog_fragment>
        #ifdef USE_FOG
        vec3 sunDirection = normalize(${glslVec(theme.light.sunOffset)});
        vec3 rayDirection = normalize(vTerrainWorld - cameraPosition);
        float sunHaze = pow(max(0.0, dot(normalize(rayDirection.xz), normalize(sunDirection.xz))), 3.0);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, ${glslVec(theme.sunlight.color)}, sunHaze * smoothstep(12.0, 55.0, length(vViewPosition)) * ${theme.sunlight.glow.toFixed(4)});
        #endif`,
      ...(sea ? GLOSSY_LIGHT : {}),
    });
  });
  theme.patchTerrain?.(material, terrain);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const walls =
    terrain.walls && theme.architecture
      ? createGridWalls(terrain, theme.architecture, scenery)
      : undefined;
  if (walls) mesh.add(walls.group);
  const planes = (terrain.surface?.liquids ?? []).map((liquid) => {
    const planeGeometry = new PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    const lava = liquid.kind === "lava";
    // Water is see-through in the shallows: drawn after the opaque scene without writing depth, and
    // before the decals and telegraphs (render order), which stay on top of it.
    const planeMaterial = lava
      ? new MeshLambertMaterial()
      : new MeshLambertMaterial({ transparent: true, depthWrite: false });
    const planeKey = `surface-${liquid.kind}-${theme.id}`;
    patchShader(planeMaterial, planeKey, (shader) => {
      Object.assign(shader.uniforms, uniforms, surfaceUniform, wind);
      shader.vertexShader = inject(shader.vertexShader, planeKey, {
        "#include <common>": "#include <common>\nvarying vec2 vSurfaceWorld;",
        "#include <begin_vertex>":
          "#include <begin_vertex>\nvSurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xz;",
      });
      shader.fragmentShader = inject(
        shader.fragmentShader,
        planeKey,
        lava
          ? {
              "#include <common>": `#include <common>\nvarying vec2 vSurfaceWorld;\n${TERRAIN_GLSL}\n${SURFACE_GLSL}\n${WIND_GLSL}\n${LAVA_GLSL}`,
              "#include <color_fragment>": `#include <color_fragment>\n${LAVA_FRAGMENT}`,
            }
          : {
              "#include <common>": `#include <common>\nvarying vec2 vSurfaceWorld;\n${TERRAIN_GLSL}\n${SURFACE_GLSL}\n${WIND_GLSL}\n${seaGlsl(theme.water)}`,
              "#include <color_fragment>": `#include <color_fragment>\n${SEA_FRAGMENT}`,
              "#include <normal_fragment_begin>":
                "#include <normal_fragment_begin>\nnormal = normalize(mat3(viewMatrix) * seaNormal);",
              ...GLOSSY_LIGHT,
              "#include <opaque_fragment>": `${SEA_OUTGOING}\n#include <opaque_fragment>`,
            },
      );
    });
    if (!lava) shadeUnderClouds(planeMaterial, wind);
    const plane = new Mesh(planeGeometry, planeMaterial);
    plane.position.y = liquid.level + LIQUID_LIFT;
    plane.receiveShadow = !lava;
    if (!lava) plane.renderOrder = -1;
    mesh.add(plane);
    return plane;
  });
  return {
    mesh,
    surfaceTexture,
    dispose() {
      geometry.dispose();
      material.dispose();
      surfaceTexture.dispose();
      walls?.dispose();
      for (const plane of planes) {
        plane.geometry.dispose();
        plane.material.dispose();
      }
    },
  };
}
