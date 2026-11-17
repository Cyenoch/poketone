// The exit a fallen guardian opens where it fell (currentZone.ts `clearZone`): a bright ring at the
// exit's reach and a tall light column readable from anywhere on the map, so a guardian kited far from
// its altar still leaves an obvious way on.
import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from "three";
import { EXIT_RADIUS } from "../sim/content/params/campaign";
import type { World } from "../sim/state/world";
import { inject, patchShader } from "./patchShader";

const COLOR = "#bff4ff";
const COLUMN_HEIGHT = 40;

export interface ExitPortalView {
  root: Group;
  update(world: World, elapsed: number): void;
  dispose(): void;
}

export function createExitPortal(ground: (x: number, z: number) => number): ExitPortalView {
  const root = new Group();
  root.visible = false;
  const glow = (opacity: number) =>
    new MeshBasicMaterial({
      color: COLOR,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  const ringGeometry = new RingGeometry(EXIT_RADIUS - 0.18, EXIT_RADIUS, 96).rotateX(-Math.PI / 2),
    innerGeometry = new RingGeometry(0, EXIT_RADIUS - 0.18, 64).rotateX(-Math.PI / 2),
    ringMaterial = glow(0.7),
    innerMaterial = glow(0.12);
  const ring = new Mesh(ringGeometry, ringMaterial),
    inner = new Mesh(innerGeometry, innerMaterial);
  ring.position.y = inner.position.y = 0.05;
  ring.renderOrder = inner.renderOrder = 0.6;
  // Outer haze and a bright core, both fading out toward the top.
  const fade = (material: MeshBasicMaterial, key: string) =>
    patchShader(material, key, (shader) => {
      shader.vertexShader = inject(shader.vertexShader, key, {
        "#include <common>": "#include <common>\nvarying float vExitY;",
        "#include <begin_vertex>": "#include <begin_vertex>\nvExitY=position.y;",
      });
      shader.fragmentShader = inject(shader.fragmentShader, key, {
        "#include <common>": `#include <common>\nvarying float vExitY;`,
        "#include <color_fragment>": `#include <color_fragment>\ndiffuseColor.a*=smoothstep(0.0,0.6,vExitY)*(1.0-smoothstep(${(COLUMN_HEIGHT * 0.3).toFixed(1)},${COLUMN_HEIGHT.toFixed(1)},vExitY));`,
      });
    });
  const hazeGeometry = new CylinderGeometry(
      EXIT_RADIUS * 0.75,
      EXIT_RADIUS,
      COLUMN_HEIGHT,
      24,
      1,
      true,
    ).translate(0, COLUMN_HEIGHT / 2, 0),
    coreGeometry = new CylinderGeometry(0.35, 0.5, COLUMN_HEIGHT, 16, 1, true).translate(
      0,
      COLUMN_HEIGHT / 2,
      0,
    ),
    hazeMaterial = glow(0.14),
    coreMaterial = glow(0.55);
  fade(hazeMaterial, "exit-haze");
  fade(coreMaterial, "exit-core");
  const haze = new Mesh(hazeGeometry, hazeMaterial),
    core = new Mesh(coreGeometry, coreMaterial);
  haze.renderOrder = core.renderOrder = 0.6;
  root.add(inner, ring, haze, core);
  return {
    root,
    update(world, elapsed) {
      const exit = world.zone.phase === "cleared" ? world.zone.exit : null;
      root.visible = exit !== null;
      if (!exit) return;
      root.position.set(exit.x, ground(exit.x, exit.z), exit.z);
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3);
      ringMaterial.opacity = 0.55 + 0.3 * pulse;
      innerMaterial.opacity = 0.08 + 0.08 * pulse;
      hazeMaterial.opacity = 0.1 + 0.06 * pulse;
      ring.scale.setScalar(1 + 0.04 * pulse);
    },
    dispose() {
      for (const geometry of [ringGeometry, innerGeometry, hazeGeometry, coreGeometry])
        geometry.dispose();
      for (const material of [ringMaterial, innerMaterial, hazeMaterial, coreMaterial])
        material.dispose();
    },
  };
}
