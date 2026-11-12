import { MeshBasicMaterial, type IUniform, type MeshBasicMaterialParameters } from "three";

/**
 * A hand-written UI shader whose program survives its materials. Three keys a `ShaderMaterial`'s
 * program by shader-cache ids that are released with the last material, so a window rebuilt on
 * every open would compile a fresh program each time (and the UI renderer retains programs). This
 * keys the program by `name` instead, like the other UI surfaces' `onBeforeCompile` materials.
 */
export class UiShaderMaterial<U extends Record<string, IUniform>> extends MeshBasicMaterial {
  readonly uniforms: U;

  constructor(
    name: string,
    shader: { uniforms: U; vertexShader: string; fragmentShader: string },
    parameters: MeshBasicMaterialParameters = {},
  ) {
    super({ transparent: true, depthTest: false, depthWrite: false, ...parameters });
    this.uniforms = shader.uniforms;
    this.customProgramCacheKey = () => `poketone-shader-${name}`;
    this.onBeforeCompile = (compiled) => {
      Object.assign(compiled.uniforms, this.uniforms);
      compiled.vertexShader = shader.vertexShader;
      compiled.fragmentShader = shader.fragmentShader;
    };
  }
}
