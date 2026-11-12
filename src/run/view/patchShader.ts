import type { Material, WebGLProgramParametersWithUniforms } from "three";

/**
 * Chains an onBeforeCompile edit onto a built-in material and keys the program cache by it, so
 * several independent patches (terrain conform, dither fade, wind, clouds…) can stack on one material.
 */
export function patchShader(
  material: Material,
  key: string,
  apply: (shader: WebGLProgramParametersWithUniforms) => void,
): void {
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    apply(shader);
  };
  material.customProgramCacheKey = () => `${previousKey()}|${key}`;
}

/**
 * Replaces each anchor (usually an `#include <chunk>` line) once, failing loudly when three's source,
 * or an earlier patch, no longer contains it — a silent miss would just drop the effect.
 */
export function inject(source: string, key: string, edits: Record<string, string>): string {
  let result = source;
  for (const [anchor, replacement] of Object.entries(edits)) {
    if (!result.includes(anchor)) throw new Error(`着色器补丁 ${key} 找不到锚点 ${anchor}。`);
    result = result.replace(anchor, () => replacement);
  }
  return result;
}
