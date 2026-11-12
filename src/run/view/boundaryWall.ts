import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector2,
} from "three";
import { heightAt, type Terrain } from "../sim/terrain";
import { ARENA_HALF } from "../sim/state/world";

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
uniform vec2 uPlayer;
uniform float uTime;
uniform vec3 uStripe;
uniform vec3 uBase;
varying vec3 vWorld;
varying float vAlong;
varying float vUp;
void main() {
  // Only the stretch of wall near the player shows; its ends fade out with distance.
  float near = 1.0 - smoothstep(1.5, ${REVEAL.toFixed(1)}, distance(vWorld.xz, uPlayer));
  float rise = pow(1.0 - vUp, 1.2);
  float stripe = step(0.5, fract((vAlong + vWorld.y) * 0.55 - uTime * 0.35));
  float glow = smoothstep(0.35, 0.0, vUp);
  vec3 color = mix(uBase, uStripe, stripe);
  float alpha = near * (rise * mix(0.32, 0.78, stripe) + glow * 0.5);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(color + glow * 0.25, alpha);
}
`;

export interface BoundaryWall {
  mesh: Mesh;
  update(playerX: number, playerZ: number, dt: number): void;
  dispose(): void;
}

/**
 * Vertical warning band on the invisible arena edge. Hidden until the player is within REVEAL of an
 * edge; then only the nearby stretch fades in. The base follows the terrain (baked once; the map is static).
 */
export function createBoundaryWall(terrain: Terrain): BoundaryWall {
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
      uStripe: { value: new Color("#ffd45b") },
      uBase: { value: new Color("#173f70") },
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
