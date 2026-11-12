import type { MeshLambertMaterial } from "three";
import { inject, patchShader } from "../patchShader";

/** Weathered sandstone with a carved sun on the lintel; existing cores own the summon glow. */
export function dressDesertTotem(material: MeshLambertMaterial): void {
  patchShader(material, "desert-sun-totem", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "desert-sun-totem", {
      "#include <common>": "#include <common>\nvarying vec3 vTotem;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvTotem = position;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "desert-sun-totem", {
      "#include <common>": "#include <common>\nvarying vec3 vTotem;",
      "#include <color_fragment>": /* glsl */ `#include <color_fragment>
        float strata = sin(vTotem.y * 24.0 + sin(vTotem.x * 2.8) * 0.4);
        diffuseColor.rgb *= mix(vec3(0.73, 0.67, 0.62), vec3(0.93, 0.87, 0.77), smoothstep(-0.3, 0.3, strata));
        vec2 sun = (vTotem.xz - vec2(0.0, -0.4)) / 0.34;
        float r = length(sun);
        float aa = max(fwidth(r), 0.02);
        float rim = 1.0 - smoothstep(0.09, 0.09 + aa, abs(r - 0.72));
        float rays = smoothstep(0.55, 0.8, cos(atan(sun.y, sun.x) * 12.0));
        rays *= smoothstep(0.84, 0.89, r) * (1.0 - smoothstep(1.16, 1.21, r));
        float carving = max(rim, rays) * smoothstep(1.65, 1.8, vTotem.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.13, 0.055), carving * 0.85);`,
    });
  });
}
