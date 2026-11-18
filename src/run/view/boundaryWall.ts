import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { heightAt, type Terrain } from "../sim/terrain";
import { ARENA_HALF } from "../sim/state/world";
import { NOISE_GLSL } from "./environment/noise";
import { rgb } from "./vfx/gl";

/** Distance from the edge at which the warning starts to appear. */
const REVEAL = 9;
const HEIGHT = 5;
const INSET = 0.5;

const vertexShader = /* glsl */ `
attribute float aAlong;
varying vec3 vWorld;
varying float vAlong;
varying float vUp;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vAlong = aAlong;
  vUp = uv.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${NOISE_GLSL}
uniform vec2 uPlayer;
uniform float uTime;
uniform vec3 uTint;
varying vec3 vWorld;
varying float vAlong;
varying float vUp;
void main() {
  // Only the stretch of wall near the player shows; its ends fade out with distance.
  float reach = distance(vWorld.xz, uPlayer);
  float near = 1.0 - smoothstep(1.5, ${REVEAL.toFixed(1)}, reach);
  // A curtain of light rising from the ground: dense at the foot, thinning upward, with soft veils
  // drifting up through it, so the edge reads as a barrier without hazard markings.
  float body = pow(1.0 - vUp, 1.5);
  float rise = vWorld.y - uTime * 0.7;
  float veil = envNoise(vec2(vAlong * 0.32, rise * 0.45)) * envNoise(vec2(vAlong * 0.85 + 5.3, rise * 0.9 + 2.1));
  // Slow flickering columns of light give the curtain an energy grain along its length.
  float column = smoothstep(0.55, 1.0, envNoise(vec2(vAlong * 1.4, uTime * 0.4)));
  float rim = 1.0 - smoothstep(0.0, 0.07, vUp);
  // Where the player presses closest the curtain brightens, so it answers the push.
  float contact = 1.0 - smoothstep(0.0, 3.5, reach);
  // Seen edge-on (standing at the wall it runs away from) the band would collapse into a bright line.
  vec3 facing = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  float broadside = smoothstep(0.1, 0.35, abs(dot(facing, normalize(cameraPosition - vWorld))));
  float alpha = near * broadside
    * (body * (0.26 + 0.45 * veil + 0.25 * column + 0.2 * contact) + rim * 0.85);
  if (alpha < 0.01) discard;
  vec3 color = mix(uTint, vec3(1.0), rim * 0.7 + column * 0.3 + veil * 0.2);
  gl_FragColor = vec4(color, alpha);
}
`;

export interface BoundaryWall {
  mesh: Mesh;
  update(playerX: number, playerZ: number, dt: number): void;
  dispose(): void;
}

/**
 * Soft light curtain, in the stage's `edge` tint, on the invisible arena edge. Hidden until the player is within REVEAL of an
 * edge; then only the nearby stretch fades in. The base follows the terrain (baked once; the map is static).
 */
export function createBoundaryWall(terrain: Terrain, tint: string): BoundaryWall {
  const edge = ARENA_HALF + INSET;
  const segments = Math.ceil(edge * 2);
  const positions: number[] = [];
  const uvs: number[] = [];
  const along: number[] = [];
  const indices: number[] = [];
  const sides: [number, number, number, number][] = [
    [-edge, -edge, edge, -edge],
    [edge, -edge, edge, edge],
    [edge, edge, -edge, edge],
    [-edge, edge, -edge, -edge],
  ];
  sides.forEach(([x0, z0, x1, z1], side) => {
    const start = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      const ground = heightAt(terrain, x, z) - 0.15;
      const distance = side * edge * 2 + t * edge * 2;
      positions.push(x, ground, z, x, ground + HEIGHT, z);
      uvs.push(t, 0, t, 1);
      along.push(distance, distance);
      if (i < segments) {
        const a = start + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setAttribute("aAlong", new BufferAttribute(new Float32Array(along), 1));
  geometry.setIndex(indices);
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uPlayer: { value: new Vector2() },
      uTime: { value: 0 },
      uTint: { value: new Vector3(...rgb(tint)) },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    update(playerX, playerZ, dt) {
      const fromEdge = edge - Math.max(Math.abs(playerX), Math.abs(playerZ));
      mesh.visible = fromEdge < REVEAL;
      if (!mesh.visible) return;
      (material.uniforms.uPlayer!.value as Vector2).set(playerX, playerZ);
      material.uniforms.uTime!.value += dt;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
