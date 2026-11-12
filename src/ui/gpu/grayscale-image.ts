import { MeshBasicMaterial, type Mesh } from "three";

/**
 * An Image material with CSS `filter: grayscale(n)`: give the Image
 * `panelMaterialClass: GrayscaleImageMaterial` once, then `setGrayscale` per state. One program
 * for every amount, so a state change never compiles.
 */
export class GrayscaleImageMaterial extends MeshBasicMaterial {
  readonly grayscale = { value: 0 };

  constructor() {
    super();
    this.onBeforeCompile = (shader) => {
      shader.uniforms.grayscale = this.grayscale;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float grayscale;\nvoid main() {")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),grayscale);`,
        );
    };
    this.customProgramCacheKey = () => "poketone-grayscale-image";
  }
}

/** `image` is a uikit Image given `panelMaterialClass: GrayscaleImageMaterial`. */
export function setGrayscale(image: Mesh, amount: number): void {
  (image.material as GrayscaleImageMaterial).grayscale.value = amount;
}
