import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  ShaderChunk,
  ShaderMaterial,
  SrcColorFactor,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
  type Camera,
  type Material,
  type Object3D,
} from "three";
import { inject, patchShader } from "./patchShader";
import type { World } from "../sim/state/world";
import type { GradeLook } from "./themes/types";
import { caveLights } from "./routeLook";

/**
 * The run's colour grade. The world draws into its own target (`rendering/world-pass.ts`), where
 * three applies no tone mapping and leaves output linear, so every built-in world material carries
 * the grade and the sRGB encoding itself, at the points three's tone-mapping and colour-space
 * chunks sit: lighting → grade → encode → fog → premultiply, as on the canvas before. The target
 * thus holds display colour. Effect shaders write display colour straight out and skip both, so
 * attacks and telegraphs keep their full colour on the calmer ground.
 */
const GRADE_GLSL = /* glsl */ `
uniform float uGradeExposure;
uniform float uGradeGreen;
uniform vec3 uGradeShade;
uniform vec3 uGradeLight;
uniform float uGradeCurve;
vec3 poketoneGrade( vec3 color ) {
  color *= uGradeExposure;
  float luma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Foliage greens (green clearly leading red and blue) lose a little saturation, just enough to take
  // the lime edge off; calm comes from the warm/cool split and value structure, not from less chroma.
  float green = smoothstep( 0.05, 0.45, ( color.g - max( color.r, color.b ) ) / max( color.g, 1e-4 ) );
  color = mix( vec3( luma ), color, 1.0 - uGradeGreen * green );
  // Split tone: the stage's shade and sunlit tints (forest: blue-green shade, gold ground).
  color *= mix( uGradeShade, uGradeLight, smoothstep( 0.03, 0.3, luma ) );
  // S-curve in a display-like space (sqrt ~ gamma 2): richer darks, a soft shoulder on highlights.
  vec3 p = sqrt( clamp( color, 0.0, 1.0 ) );
  p = mix( p, p * p * ( 3.0 - 2.0 * p ), uGradeCurve );
  return p * p;
}
`;

/** Fog mixes in display space after the encode; three hands ordinary targets a linear fog colour. */
const FOG_FRAGMENT = inject(ShaderChunk.fog_fragment, "world-fog", {
  "fogColor, fogFactor": "sRGBTransferOETF( vec4( fogColor, 1.0 ) ).rgb, fogFactor",
});

/** The forest's grade; the lobby and every stage without its own look use it. */
export const defaultGrade: GradeLook = {
  exposure: 1.25,
  green: 0.25,
  shade: [0.8, 0.97, 1.1],
  light: [1.07, 1.02, 0.9],
  curve: 0.5,
};

/** One set shared by every graded program, so a stage's look is a uniform change, not a recompile. */
const gradeUniforms = {
  uGradeExposure: { value: 0 },
  uGradeGreen: { value: 0 },
  uGradeShade: { value: new Vector3() },
  uGradeLight: { value: new Vector3() },
  uGradeCurve: { value: 0 },
};

/** The current stage's grade (`defaultGrade` outside a run). */
export function setWorldGrade(look: GradeLook): void {
  gradeUniforms.uGradeExposure.value = look.exposure;
  gradeUniforms.uGradeGreen.value = look.green;
  gradeUniforms.uGradeShade.value.set(...look.shade);
  gradeUniforms.uGradeLight.value.set(...look.light);
  gradeUniforms.uGradeCurve.value = look.curve;
}
setWorldGrade(defaultGrade);

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
      Object.assign(shader.uniforms, gradeUniforms);
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

/** Up to four players carry a light. */
const LIGHTS = 4;

/**
 * The dark cave (map modifier): the vignette's own multiply, darkened toward a navy moonlight
 * except inside each player's light. A light is the sim's ground circle around a player, projected
 * to the screen as an ellipse (its centre and two conjugate radii in NDC). Drawn just after the
 * vignette and before exits (0.6) and effects (1+), so the way on, telegraphs and health bars keep
 * their full strength.
 */
const DARK_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform float darkness;
uniform int lightCount;
uniform vec2 lightCentre[${LIGHTS}];
uniform vec4 lightAxes[${LIGHTS}];
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float lit = 0.0;
  for ( int i = 0; i < ${LIGHTS}; i++ ) {
    if ( i >= lightCount ) break;
    vec2 a = lightAxes[i].xy, b = lightAxes[i].zw, d = q - lightCentre[i];
    float det = a.x * b.y - a.y * b.x;
    if ( abs( det ) < 1e-6 ) continue;
    vec2 t = vec2( b.y * d.x - b.x * d.y, a.x * d.y - a.y * d.x ) / det;
    lit = max( lit, 1.0 - smoothstep( 0.62, 1.0, length( t ) ) );
  }
  gl_FragColor = vec4( mix( vec3( 1.0 ), vec3( 0.18, 0.21, 0.32 ), darkness * ( 1.0 - lit ) ), 1.0 );
}
`;

export interface Darkness {
  mesh: Mesh;
  /** Eases toward dark while `world.modifier` is the dark cave; `lights` are world circles. */
  update(
    world: World,
    alpha: number,
    ground: (x: number, z: number) => number,
    camera: Camera,
    dt: number,
  ): void;
  dispose(): void;
}

export function createDarkness(): Darkness {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const uniforms = {
    darkness: { value: 0 },
    lightCount: { value: 0 },
    lightCentre: { value: Array.from({ length: LIGHTS }, () => new Vector2()) },
    lightAxes: { value: Array.from({ length: LIGHTS }, () => new Vector4()) },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: DARK_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: ZeroFactor,
    blendDst: SrcColorFactor,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.55;
  mesh.visible = false;
  const p = new Vector3(),
    e = new Vector3();
  const at = (x: number, y: number, z: number, camera: Camera, out: Vector3) =>
    out.set(x, y, z).project(camera);
  return {
    mesh,
    update(world, alpha, ground, camera, dt) {
      // In over 0.6s once the map shows, out over 1.2s when Flash lights it; the radius never eases.
      const level = uniforms.darkness.value;
      uniforms.darkness.value =
        world.modifier === "dark-cave"
          ? Math.min(1, level + dt / 0.6)
          : Math.max(0, level - dt / 1.2);
      mesh.visible = uniforms.darkness.value > 0;
      if (!mesh.visible) return;
      const litGround = caveLights(world, alpha);
      const count = Math.min(LIGHTS, litGround.length);
      uniforms.lightCount.value = count;
      for (let i = 0; i < count; i++) {
        const { x, z, r } = litGround[i]!;
        const y = ground(x, z) + 0.6;
        at(x, y, z, camera, p);
        uniforms.lightCentre.value[i]!.set(p.x, p.y);
        const axes = uniforms.lightAxes.value[i]!;
        at(x + r, y, z, camera, e);
        const ax = e.x,
          ay = e.y;
        at(x - r, y, z, camera, e);
        axes.x = (ax - e.x) / 2;
        axes.y = (ay - e.y) / 2;
        at(x, y, z + r, camera, e);
        const bx = e.x,
          by = e.y;
        at(x, y, z - r, camera, e);
        axes.z = (bx - e.x) / 2;
        axes.w = (by - e.y) / 2;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

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
