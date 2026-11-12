import type { Material } from "three";
import { inject, patchShader } from "../patchShader";

/** Cool exposed stone, darker tidal foot, and sparse salt on upward-facing facets. */
export function shadeCoastReef(material: Material, height: number): void {
  patchShader(material, `coast-reef-${height}`, (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "coast-reef", {
      "#include <common>": "#include <common>\nvarying vec3 vReef;\nvarying float vReefTop;",
      "#include <begin_vertex>":
        "#include <begin_vertex>\nvReef = position;\nvReefTop = max(0.0, normal.y);",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "coast-reef", {
      "#include <common>": "#include <common>\nvarying vec3 vReef;\nvarying float vReefTop;",
      "#include <color_fragment>": /* glsl */ `#include <color_fragment>
        float h = vReef.y / ${height.toFixed(4)};
        float tide = smoothstep(0.12, 0.36, h + sin(vReef.x * 9.0 + vReef.z * 5.0) * 0.035);
        diffuseColor.rgb *= mix(vec3(0.5,0.63,0.67),vec3(0.89,0.99,1.1),tide);
        float salt = smoothstep(0.76,0.98,vReefTop) * smoothstep(0.52,0.85,h) * 0.16;
        diffuseColor.rgb = mix(diffuseColor.rgb,vec3(0.57,0.59,0.56),salt);`,
    });
  });
}
