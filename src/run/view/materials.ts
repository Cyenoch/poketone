import {
  MeshDepthMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  ShaderChunk,
  type Material,
  type Mesh,
} from "three";
import { inject, patchShader } from "./patchShader";

/**
 * Lambert copy of a Tripo glTF material. Those are metalness 0 / roughness 0.9, so the PBR specular
 * they pay for is invisible; Lambert gives the same diffuse look for far less work per pixel.
 */
export function lambertCopy(source: Material): MeshLambertMaterial {
  if (!(source instanceof MeshStandardMaterial)) {
    throw new Error(`模型材质应为 MeshStandardMaterial，实际是 ${source.type}（${source.name}）。`);
  }
  return new MeshLambertMaterial({
    name: source.name,
    map: source.map,
    color: source.color,
    vertexColors: source.vertexColors,
    side: source.side,
    transparent: source.transparent,
    opacity: source.opacity,
    alphaTest: source.alphaTest,
  });
}

/** Cool sky light catching the upper silhouette of every creature, so they read against the grass. */
const RIM_COLOR = "vec3(0.34, 0.4, 0.46)";

/**
 * Creature look on a Lambert material: a soft cel terminator (most of the light change happens in a
 * narrow band) and a rim light on upward-facing silhouette edges. Instance colours (hit flash, status
 * tints) still multiply the albedo underneath.
 */
export function creatureLook(material: MeshLambertMaterial): MeshLambertMaterial {
  const key = "creature-look";
  patchShader(material, key, (shader) => {
    const toonLambert = inject(ShaderChunk.lights_lambert_pars_fragment, key, {
      "float dotNL = saturate( dot( geometryNormal, directLight.direction ) );": /* glsl */ `
      float rawNL = dot( geometryNormal, directLight.direction );
      float dotNL = smoothstep( -0.05, 0.3, rawNL ) * 0.7 + saturate( rawNL ) * 0.3;`,
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <lights_lambert_pars_fragment>": toonLambert,
      "#include <opaque_fragment>": /* glsl */ `
      {
        vec3 worldNormal = normal * mat3(viewMatrix);
        float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
        outgoingLight += ${RIM_COLOR} * rim * smoothstep(-0.1, 0.6, worldNormal.y);
      }
      #include <opaque_fragment>`,
    });
  });
  return material;
}

/**
 * Gives a shadow caster its own depth material and returns it (the caller disposes it). Three's
 * shared depth material rewrites `side` per caster without picking a new program, so a double-sided
 * caster drawn after a single-sided one casts with the wrong side and compiles its own variant
 * only at first use, never in the run warm.
 */
export function ownShadowDepth(mesh: Mesh): Material {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  mesh.customDepthMaterial = depth;
  return depth;
}
