import type { MeshLambertMaterial } from "three";
import { WIND_GLSL, type WindUniforms } from "./environment/wind";
import { inject, patchShader } from "./patchShader";

/**
 * The spring prop paints its pool as one flat mint disc. Give the water depth (darker toward the
 * middle), slow concentric ripples from the source and a bright lip at the stones, so it reads as
 * clear water rather than a coloured plate. Only the pool's own colour is touched; stones stay as modelled.
 * `radius`: the prop's half-width in model units.
 */
export function springWater(
  material: MeshLambertMaterial,
  wind: WindUniforms,
  radius: number,
): void {
  patchShader(material, "spring-water", (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = inject(shader.vertexShader, "spring-water", {
      "#include <common>": "#include <common>\nvarying vec3 vSpring;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvSpring=position;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "spring-water", {
      "#include <common>": `#include <common>\nvarying vec3 vSpring;\n${WIND_GLSL}`,
      "#include <color_fragment>": `#include <color_fragment>
        {
          vec3 c=diffuseColor.rgb;
          float pool=smoothstep(0.04,0.12,c.b-c.r)*smoothstep(0.02,0.08,c.g-c.r);
          if(pool>0.0){
            float r=length(vSpring.xz)/${radius.toFixed(4)};
            float ripple=0.5+0.5*sin(r*22.0-uWindTime*2.2+envNoise(vSpring.xz/${radius.toFixed(4)}*5.0)*2.0);
            vec3 deep=vec3(0.03,0.16,0.2), shallow=vec3(0.16,0.42,0.42);
            float depth=1.0-smoothstep(0.1,0.75,r);
            vec3 water=mix(shallow,deep,depth*0.7)+vec3(0.18,0.26,0.24)*pow(ripple,6.0)*0.4;
            diffuseColor.rgb=mix(c,water,pool);
          }
        }`,
    });
  });
}
