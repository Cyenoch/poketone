import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
import { enemies as enemyDefs } from "../sim/content/enemies";
import { FLYER_HOVER } from "../sim/content/params/combat";
import { standingHeight } from "../sim/sight";
import { targetable } from "../sim/status";
import type { World } from "../sim/state/world";

/**
 * Subtle enemy HP bars with a "delayed chip": the lost segment flashes white→yellow, swells past the
 * bar edges, holds, then drains into the remaining HP. Bars appear only once damaged, fade after a
 * quiet spell, and pop on death. One instanced draw; view-only state keyed by enemy id.
 */
export interface HealthBars {
  mesh: InstancedMesh;
  update(world: World, alpha: number, dt: number): void;
  dispose(): void;
}

const CAPACITY = 360;
const VISIBLE_FOR = 2.2;
const CHIP_HOLD = 0.35;
const CHIP_DRAIN = 3.2;
const DEATH_TIME = 0.32;
/** Quad height in bar heights: room for the chip to swell to CHIP_SWELL. */
const QUAD_SPAN = 2.6;
/** The lost segment jumps to this many bar heights, holds, then eases back while it drains. */
const CHIP_SWELL = 2.3;

interface Bar {
  ratio: number;
  chip: number;
  hold: number;
  flash: number;
  shown: number;
  death: number;
  x: number;
  y: number;
  z: number;
  width: number;
  thick: number;
  alive: boolean;
}

const vertexShader = /* glsl */ `
attribute vec4 aBar;    // ratio, chip, flash, alpha
attribute vec4 aShape;  // width, height, chip swell (1 = bar height), death 0…1
varying vec2 vUv;
varying vec4 vBar;
varying vec4 vShape;
void main() {
  vUv = uv;
  vBar = aBar;
  vShape = aShape;
  vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  // Quad is QUAD_SPAN bar heights tall so the chip can swell well past the bar edges.
  float scale = 1.0 + aShape.w * 0.35;
  vec3 world = center + right * position.x * aShape.x * scale + up * position.y * aShape.y * ${QUAD_SPAN.toFixed(1)} * scale;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec4 vBar;
varying vec4 vShape;
void main() {
  float ratio = vBar.x;
  float chip = vBar.y;
  float flash = vBar.z;
  float alpha = vBar.w;
  float v = abs(vUv.y - 0.5) * 2.0 * ${QUAD_SPAN.toFixed(1)};  // 0 centre … 1 bar edge … QUAD_SPAN quad edge
  float u = vUv.x;
  bool inChip = u > ratio && u < chip;
  float swell = vShape.z;
  if (v > (inChip ? swell : 1.0)) discard;
  vec3 back = vec3(0.05, 0.11, 0.2);
  vec3 fill = mix(vec3(1.0, 0.42, 0.36), vec3(1.0, 0.85, 0.5), step(0.5, vShape.w));
  vec3 chipColor = mix(vec3(1.0, 0.82, 0.3), vec3(1.0), flash);
  vec3 color = u <= ratio ? fill : inChip ? chipColor : back;
  float edge = v > 0.72 && !inChip ? 0.65 : 1.0;   // thin dark rim reads on bright grass
  float a = (u <= ratio ? 0.92 : inChip ? 0.95 : 0.55) * alpha;
  gl_FragColor = vec4(color * edge + vec3(vShape.w * 0.6), a * (1.0 - vShape.w * 0.4));
}
`;

export function createHealthBars(): HealthBars {
  const geometry = new PlaneGeometry(1, 1);
  const barAttr = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(
    DynamicDrawUsage,
  );
  const shapeAttr = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(
    DynamicDrawUsage,
  );
  geometry.setAttribute("aBar", barAttr);
  geometry.setAttribute("aShape", shapeAttr);
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.count = 0;
  const bars = new Map<number, Bar>();
  const matrix = new Matrix4();
  const seen = new Set<number>();

  function track(world: World, alpha: number, dt: number): void {
    seen.clear();
    for (const enemy of world.enemies) {
      if (enemy.boss) continue;
      seen.add(enemy.id);
      const ratio = Math.max(0, enemy.hp / enemy.maxHp);
      let bar = bars.get(enemy.id);
      if (!bar) {
        if (ratio >= 1) continue;
        bar = {
          ratio: 1,
          chip: 1,
          hold: 0,
          flash: 0,
          shown: 0,
          death: 0,
          x: 0,
          y: 0,
          z: 0,
          width: 0,
          thick: 0,
          alive: true,
        };
        bars.set(enemy.id, bar);
      }
      if (ratio < bar.ratio - 1e-4) {
        // New damage on a settled bar: the previous value becomes the chip, which flashes and holds
        // before draining. A hit while the chip still holds or drains joins that cycle (DESIGN.md
        // 连续命中): restarting the hold per hit would pin the chip at the pre-fight HP under steady fire.
        if (bar.chip <= bar.ratio + 1e-4) {
          bar.chip = bar.ratio;
          bar.hold = CHIP_HOLD;
        }
        bar.flash = 1;
        bar.shown = VISIBLE_FOR;
      }
      bar.ratio = ratio;
      const def = enemyDefs[enemy.species];
      const x = enemy.px + (enemy.x - enemy.px) * alpha;
      const z = enemy.pz + (enemy.z - enemy.pz) * alpha;
      bar.x = x;
      bar.z = z;
      bar.y =
        standingHeight(world.map.terrain, enemy.species, x, z) +
        def.height * enemy.scale +
        (def.mobility.flying ? FLYER_HOVER * enemy.scale + 0.2 : 0.35);
      bar.width = Math.max(0.7, enemy.radius * 2.1);
      bar.thick = enemy.elite ? 0.085 : 0.065;
      // Underground, the bar would float over an empty spot.
      if (!targetable(enemy)) bar.shown = 0;
    }
    for (const [id, bar] of bars) {
      if (!seen.has(id) && bar.alive) {
        bar.alive = false;
        bar.ratio = 0;
        bar.death = DEATH_TIME;
        bar.flash = 1;
        bar.shown = DEATH_TIME;
      }
      bar.hold -= dt;
      if (bar.hold <= 0)
        bar.chip = Math.max(bar.ratio, bar.chip - (bar.chip - bar.ratio + 0.04) * CHIP_DRAIN * dt);
      bar.flash = Math.max(0, bar.flash - dt * 5);
      bar.shown -= dt;
      if (!bar.alive) bar.death -= dt;
      // A quiet bar stays tracked (just hidden) so its next hit chips from the real HP, not from full.
      if (!bar.alive && bar.death <= 0) bars.delete(id);
    }
  }

  return {
    mesh,
    update(world, alpha, dt) {
      track(world, alpha, dt);
      let count = 0;
      const bar4 = barAttr.array as Float32Array;
      const shape4 = shapeAttr.array as Float32Array;
      for (const bar of bars.values()) {
        if (count >= CAPACITY) break;
        if (bar.shown <= 0) continue;
        matrix.makeTranslation(bar.x, bar.y, bar.z);
        mesh.setMatrixAt(count, matrix);
        const fade = Math.min(1, bar.shown / 0.4);
        const dying = bar.alive ? 0 : 1 - bar.death / DEATH_TIME;
        // Full swell through the hold, then ease-out back to the bar height as the chip drains.
        const settle = bar.hold > 0 ? 1 : Math.max(0, 1 + bar.hold / 0.18) ** 2;
        const swell = 1 + (CHIP_SWELL - 1) * settle;
        const o = count * 4;
        bar4[o] = bar.ratio;
        bar4[o + 1] = bar.chip;
        bar4[o + 2] = bar.flash;
        bar4[o + 3] = fade * (bar.alive ? 1 : 1 - dying);
        shape4[o] = bar.width;
        shape4[o + 1] = bar.thick;
        shape4[o + 2] = swell;
        shape4[o + 3] = bar.alive ? 0 : dying;
        count++;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      barAttr.needsUpdate = true;
      shapeAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
