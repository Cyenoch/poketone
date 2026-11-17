import {
  BackSide,
  BufferAttribute,
  MeshBasicMaterial,
  NotEqualStencilFunc,
  type BufferGeometry,
} from "three";
import { inject, patchShader } from "./patchShader";

/**
 * The local player's outline, the only outlined model in the world: an inverted hull (a second draw
 * of the same geometry, back faces only, each vertex pushed out along its smoothed normal by a fixed
 * share of the viewport height), so the line keeps its on-screen width at any distance or zoom and
 * needs no full-screen pass. The push is added after three's own skinning.
 */

/** The local player's ink: the same warm yellow as their x-ray silhouette and solo foot ring. */
export const SELF_INK = "#ffd45b";

/** Line width as a share of the viewport height (1280×720: about 2.4 px). */
const WIDTH = 0.0034;

/**
 * Adds `outlineNormal`: the mean normal of every vertex at the same position. Low-poly models split
 * vertices along hard edges, and pushing those apart along their own normals would tear the hull.
 * Shared by every user of `geometry`; added once.
 */
export function addOutlineNormals(geometry: BufferGeometry): void {
  if (geometry.getAttribute("outlineNormal")) return;
  const position = geometry.getAttribute("position");
  let normal = geometry.getAttribute("normal");
  if (!position) throw new Error(`描边需要顶点位置（${geometry.name || geometry.uuid}）。`);
  if (!normal) {
    const copy = geometry.clone();
    copy.computeVertexNormals();
    normal = copy.getAttribute("normal");
    copy.dispose();
  }
  const sums = new Map<string, [number, number, number]>();
  const keys: string[] = [];
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`;
    keys.push(key);
    const sum = sums.get(key) ?? [0, 0, 0];
    sum[0] += normal.getX(i);
    sum[1] += normal.getY(i);
    sum[2] += normal.getZ(i);
    sums.set(key, sum);
  }
  const smooth = new Float32Array(position.count * 3);
  keys.forEach((key, i) => {
    const [x, y, z] = sums.get(key)!;
    const length = Math.hypot(x, y, z) || 1;
    smooth[i * 3] = x / length;
    smooth[i * 3 + 1] = y / length;
    smooth[i * 3 + 2] = z / length;
  });
  geometry.setAttribute("outlineNormal", new BufferAttribute(smooth, 3));
}

const OUTLINE_VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec3 outlineDir = outlineNormal;
  #ifdef USE_SKINNING
    mat4 outlineSkin = skinWeight.x * boneMatX + skinWeight.y * boneMatY
      + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;
    outlineDir = ( bindMatrixInverse * outlineSkin * bindMatrix * vec4( outlineDir, 0.0 ) ).xyz;
  #endif
  vec4 outlineTip = vec4( transformed + outlineDir * 0.01, 1.0 );
  outlineTip = projectionMatrix * ( modelViewMatrix * outlineTip );
  // Screen direction of the normal, in pixel-proportional units (x scaled by the aspect).
  float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
  vec2 screen = ( outlineTip.xy / outlineTip.w - gl_Position.xy / gl_Position.w ) * vec2( aspect, 1.0 );
  float screenLength = length( screen );
  if ( screenLength > 1e-7 )
    gl_Position.xy += screen / screenLength / vec2( aspect, 1.0 ) * 2.0 * uOutlineWidth * gl_Position.w;
}`;

/**
 * Flat-ink hull material. Fog applies, the grade does not (`toneMapped: false`), so the ink stays
 * the exact token colour. It sorts with the transparent pass after every effect: effects write no
 * depth, so the line still reads where the body is buried under a blast. It never draws over the
 * body's own visible pixels (marked in the stencil by playerRig.ts), so an arm in front of the chest
 * draws no line across it: a silhouette only.
 */
export function selfOutlineMaterial(): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color: SELF_INK,
    side: BackSide,
    toneMapped: false,
    transparent: true,
    stencilWrite: true,
    stencilRef: 1,
    stencilFunc: NotEqualStencilFunc,
  });
  const key = "self-outline";
  patchShader(material, key, (shader) => {
    shader.uniforms.uOutlineWidth = { value: WIDTH };
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>":
        "#include <common>\nattribute vec3 outlineNormal;\nuniform float uOutlineWidth;",
      "#include <project_vertex>": OUTLINE_VERTEX,
    });
  });
  return material;
}
