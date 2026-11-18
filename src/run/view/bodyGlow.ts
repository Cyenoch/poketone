import { MeshLambertMaterial, SkinnedMesh, Vector2, Vector3, type Object3D } from "three";
import { inject, patchShader } from "./patchShader";

/**
 * An evolution swaps the model this long after its event, under the full white silhouette; the evolve
 * sound lands its hit here too (createRun.ts), after the 0.3 s freeze.
 */
export const EVOLVE_SWAP_MS = 390;

/**
 * Light laid over a player's own body: an even fill (the evolution's white silhouette), a view rim and
 * a band of the rim's light sweeping up the body (the ultimate's protection). `sweep` is the band's
 * world height (x) and strength (y). One set of uniforms per mounted form, shared by its materials.
 */
export interface BodyGlow {
  readonly fill: Vector3;
  readonly rim: Vector3;
  readonly sweep: Vector2;
}

export function bodyGlow(holder: Object3D): BodyGlow {
  const uniforms = {
    uGlowFill: { value: new Vector3() },
    uGlowRim: { value: new Vector3() },
    uGlowSweep: { value: new Vector2() },
  };
  holder.traverse((node) => {
    if (!(node instanceof SkinnedMesh)) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!(material instanceof MeshLambertMaterial)) continue;
      patchShader(material, "body-glow", (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = inject(shader.fragmentShader, "body-glow", {
          "#include <common>":
            "#include <common>\nuniform vec3 uGlowFill;\nuniform vec3 uGlowRim;\nuniform vec2 uGlowSweep;",
          "#include <opaque_fragment>": `
            float glowRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 1.5);
            // World height of this fragment: the view transform is a rotation plus a translation.
            float glowY = (transpose(mat3(viewMatrix)) * (-vViewPosition - viewMatrix[3].xyz)).y;
            float glowD = (glowY - uGlowSweep.x) / 0.12;
            float glowBand = exp(-glowD * glowD) * uGlowSweep.y;
            outgoingLight += uGlowFill + uGlowRim * (glowRim + glowBand);
            #include <opaque_fragment>`,
        });
      });
    }
  });
  return {
    fill: uniforms.uGlowFill.value,
    rim: uniforms.uGlowRim.value,
    sweep: uniforms.uGlowSweep.value,
  };
}
