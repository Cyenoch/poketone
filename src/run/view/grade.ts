import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  ShaderChunk,
  ShaderMaterial,
  SrcColorFactor,
  ZeroFactor,
  type Material,
  type Object3D,
} from "three";
import { inject, patchShader } from "./patchShader";

/**
 * The run's colour grade. The world draws into its own target (`rendering/world-pass.ts`), where
 * three applies no tone mapping and leaves output linear, so every built-in world material carries
 * the grade and the sRGB encoding itself, at the points three's tone-mapping and colour-space
 * chunks sit: lighting → grade → encode → fog → premultiply, as on the canvas before. The target
 * thus holds display colour. Effect shaders write display colour straight out and skip both, so
 * attacks and telegraphs keep their full colour on the calmer ground.
 */
const GRADE_GLSL = /* glsl */ `
vec3 poketoneGrade( vec3 color ) {
  color *= 1.25;
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Foliage greens (green clearly leading red and blue) lose a little saturation, just enough to take
  // the lime edge off; calm comes from the warm/cool split and value structure, not from less chroma.
  float green = smoothstep( 0.05, 0.45, ( color.g - max( color.r, color.b ) ) / max( color.g, 1e-4 ) );
  color = mix( vec3( luma ), color, 1.0 - 0.25 * green );
  // Split tone: blue-green shade, gold sunlit ground.
  color *= mix( vec3( 0.8, 0.97, 1.1 ), vec3( 1.07, 1.02, 0.9 ), smoothstep( 0.03, 0.3, luma ) );
  // S-curve in a display-like space (sqrt ~ gamma 2): richer darks, a soft shoulder on highlights.
  vec3 p = sqrt( clamp( color, 0.0, 1.0 ) );
  p = mix( p, p * p * ( 3.0 - 2.0 * p ), 0.5 );
  return p * p;
}
`;

/** Fog mixes in display space after the encode; three hands ordinary targets a linear fog colour. */
const FOG_FRAGMENT = inject(ShaderChunk.fog_fragment, "world-fog", {
  "fogColor, fogFactor": "sRGBTransferOETF( vec4( fogColor, 1.0 ) ).rgb, fogFactor",
});

const patched = new WeakSet<Material>();

function patchOutput(material: Material, grade: boolean): void {
  patched.add(material);
  // `toneMapped: false` skipped the grade on the canvas too; it still encoded.
  const graded = grade && material.toneMapped;
  patchShader(material, `world-output-${graded ? "graded" : "plain"}`, (shader) => {
    let source = shader.fragmentShader;
    if (!source.includes("#include <colorspace_fragment>")) return;
    source = source.replace(
      "#include <colorspace_fragment>",
      "gl_FragColor = sRGBTransferOETF( gl_FragColor );",
    );
    source = source.replace("#include <fog_fragment>", () => FOG_FRAGMENT);
    if (graded && source.includes("#include <tonemapping_fragment>")) {
      source = inject(source, "world-grade", {
        "#include <tonemapping_fragment>": "gl_FragColor.rgb = poketoneGrade( gl_FragColor.rgb );",
        "void main() {": `${GRADE_GLSL}\nvoid main() {`,
      });
    }
    shader.fragmentShader = source;
  });
  material.needsUpdate = true;
}

/**
 * Gives every material under `root` the world output, once: the run's grade (unless
 * `grade: false`, encode only) and the sRGB encode. Called before each world render and compile,
 * so materials made at any time (pools, pre-mounted forms, effects) are covered before their first
 * program is built. A material keeps the output it first got.
 */
export function applyWorldOutput(root: Object3D, { grade = true }: { grade?: boolean } = {}): void {
  root.traverse((object) => {
    const material = (object as { material?: Material | Material[] }).material;
    if (!material) return;
    for (const each of Array.isArray(material) ? material : [material])
      if (!patched.has(each)) patchOutput(each, grade);
  });
}

/**
 * Edge falloff in the diorama style: one fullscreen triangle multiplying the frame by a dark teal
 * toward the corners. Drawn after the opaque scene, water and blob shadows but before effects
 * (renderOrder 1+) and health bars, so telegraphs at the screen edge keep their full strength.
 * The middle of each edge, where enemies walk in, darkens far less than the corners.
 */
const VIGNETTE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float edge = smoothstep( 0.7, 1.42, length( q ) );
  gl_FragColor = vec4( mix( vec3( 1.0 ), vec3( 0.2, 0.27, 0.3 ), edge * 0.75 ), 1.0 );
}
`;

export interface Grade {
  /** Add to the scene; it draws itself over the whole view regardless of the camera. */
  vignette: Mesh;
  dispose(): void;
}

export function createGrade(): Grade {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: VIGNETTE_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
  });
  const vignette = new Mesh(geometry, material);
  vignette.frustumCulled = false;
  // Transparent draws sort by render order: after water (-1) and blob shadows (0), before effects (1+).
  vignette.renderOrder = 0.5;
  return {
    vignette,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
