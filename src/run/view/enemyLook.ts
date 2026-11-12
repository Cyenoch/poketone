import { GreaterDepth, MeshLambertMaterial } from "three";
import { enemies, type EnemyId } from "../sim/content/enemies";
import { inject, patchShader } from "./patchShader";

/** Material changes stay on the run's copy; species sharing a GLB keep their own identity. */
export function enemyLook(material: MeshLambertMaterial, id: EnemyId): void {
  const def = enemies[id];
  const ghost = def.types.includes("ghost");
  const flame = id === "magmar" || id === "flareon";
  const eyes = id === "golbat" || id === "gengar";
  if (!ghost && !flame && !eyes && id !== "grimer" && id !== "muk") return;
  patchShader(material, `enemy-look-${id}`, (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, `enemy-look-${id}`, {
      "#include <emissivemap_fragment>": `#include <emissivemap_fragment>
        ${
          flame
            ? `
          float warm = smoothstep(0.12, 0.4, diffuseColor.r - diffuseColor.b);
          float mane = smoothstep(0.3, 0.6, min(diffuseColor.r, diffuseColor.g));
          totalEmissiveRadiance += diffuseColor.rgb * ${id === "flareon" ? "mane * 0.5" : "warm * 0.45"};`
            : ""
        }
        ${
          eyes
            ? `
          float eye = smoothstep(0.18, 0.4, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));
          totalEmissiveRadiance += vec3(0.8,0.18,0.12) * eye * 0.65;`
            : ""
        }`,
      "#include <opaque_fragment>": `
        float enemyRim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.5);
        ${ghost ? "outgoingLight += vec3(0.34,0.25,0.48) * (0.18 + enemyRim * 0.6);" : ""}
        ${id === "grimer" || id === "muk" ? "outgoingLight += vec3(0.24,0.18,0.3) * enemyRim * 0.45;" : ""}
        #include <opaque_fragment>`,
    });
  });
  // Ordered transparency keeps the ghost body substantial, including over pale floor tiles.
  if (ghost && (def.model || id === "gengar")) {
    material.transparent = true;
    material.opacity = 0.82;
    material.depthWrite = false;
  }
}

/** Only depth-hidden fragments survive: a quiet silhouette through tower stone. */
export function towerEnemySilhouette(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({
    color: "#c4aee9",
    transparent: true,
    opacity: 0.65,
    depthFunc: GreaterDepth,
    depthWrite: false,
    fog: false,
  });
  patchShader(material, "tower-enemy-silhouette", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "tower-enemy-silhouette", {
      "#include <opaque_fragment>": `
        float rim = 1.0 - saturate(dot(normal, normalize(vViewPosition)));
        diffuseColor.a *= smoothstep(0.2,0.75,rim);
        outgoingLight = vec3(0.56,0.38,0.78);
        #include <opaque_fragment>`,
    });
  });
  return material;
}
