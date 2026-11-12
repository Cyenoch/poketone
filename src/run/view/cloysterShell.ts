import type { Material } from "three";
import { ZONE_GUARDIAN } from "../sim/content/params/late-zones";
import { inject, patchShader } from "./patchShader";

const CLOSE = 0.16;
const OPEN = 0.28;

/** The shield's expiry survives interrupted actions; opening never precedes lost damage reduction. */
export function cloysterClosure(time: number, shieldEnd: number | undefined): number {
  if (shieldEnd === undefined) return 0;
  const progress =
    time < shieldEnd
      ? (time - (shieldEnd - ZONE_GUARDIAN.shieldTime)) / CLOSE
      : 1 - (time - shieldEnd) / OPEN;
  const p = Math.max(0, Math.min(1, progress));
  return p * p * (3 - 2 * p);
}

/** Procedural shell bracing on the welded static GLB, not articulated shell valves. */
export function foldCloysterShell(material: Material): void {
  patchShader(material, "cloyster-shell", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "cloyster-shell", {
      "#include <common>": /* glsl */ `#include <common>
        attribute float aShellClose;
        float shellWeight() {
          return smoothstep(0.23, 0.33, length(vec2(position.x, (position.y - 0.46) * 0.95)));
        }
        mat2 shellTurn() {
          // Preserve the face and centre horn's shape; fold the outer walls around the rear seam.
          float side = smoothstep(0.04, 0.16, abs(position.x));
          float angle = -sign(position.x) * side * shellWeight() * aShellClose * 0.36;
          float c = cos(angle), s = sin(angle);
          return mat2(c, -s, s, c);
        }`,
      "#include <beginnormal_vertex>": /* glsl */ `#include <beginnormal_vertex>
        objectNormal.xz = shellTurn() * objectNormal.xz;`,
      "#include <begin_vertex>": /* glsl */ `#include <begin_vertex>
        transformed.xz = shellTurn() * (position.xz - vec2(0.0, -0.25)) + vec2(0.0, -0.25);
        transformed.z -= (1.0 - shellWeight()) * aShellClose * 0.08;`,
    });
  });
}
