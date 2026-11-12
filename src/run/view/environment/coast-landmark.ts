import type { MeshLambertMaterial } from "three";
import { inject, patchShader } from "../patchShader";

/** Salt-worn ivory masonry and an ochre navigation band on the existing low-poly ruin. */
export function dressCoastLighthouse(material: MeshLambertMaterial): void {
  patchShader(material, "coast-lighthouse-masonry", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "coast-lighthouse-masonry", {
      "#include <common>": "#include <common>\nvarying vec3 vLighthouse;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvLighthouse = position;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "coast-lighthouse-masonry", {
      "#include <common>": "#include <common>\nvarying vec3 vLighthouse;",
      "#include <color_fragment>": /* glsl */ `#include <color_fragment>
        float tower = smoothstep(0.38, 0.55, vLighthouse.y);
        float band = smoothstep(1.08, 1.12, vLighthouse.y) * (1.0-smoothstep(1.45, 1.49, vLighthouse.y));
        float stone = mix(0.88, 1.0, fract(vLighthouse.y * 5.0 + floor(vLighthouse.x * 6.0) * 0.23));
        vec3 plaster = mix(vec3(0.63,0.58,0.46), vec3(0.3,0.23,0.13), band) * stone;
        diffuseColor.rgb = mix(diffuseColor.rgb, plaster, tower * 0.85);`,
    });
  });
}
