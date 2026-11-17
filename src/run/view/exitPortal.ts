// The exits a fallen guardian opens (currentZone.ts `clearZone`): per exit, a bright ring at its
// reach over a darker base ring (the hue survives snow and sand), and a tall light column readable
// from anywhere, both in the target map's accent (routeLook.ts). Columns ignore scene fog and draw
// after the dark-cave shade, so the way on shows under every map modifier.
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  RingGeometry,
} from "three";
import { EXIT_RADIUS } from "../sim/content/params/campaign";
import { atExit } from "../sim/currentZone";
import type { PlayerId } from "../sim/state/entities";
import type { World } from "../sim/state/world";
import { inject, patchShader } from "./patchShader";
import { exitAccent } from "./routeLook";

const COLUMN_HEIGHT = 40;
/** Two destinations plus the occasional third. */
const POOL = 3;

export interface ExitPortalView {
  root: Group;
  update(world: World, elapsed: number, local: PlayerId): void;
  dispose(): void;
}

interface Portal {
  root: Group;
  ring: Mesh;
  base: MeshBasicMaterial;
  ringMaterial: MeshBasicMaterial;
  innerMaterial: MeshBasicMaterial;
  hazeMaterial: MeshBasicMaterial;
  coreMaterial: MeshBasicMaterial;
  accent: string;
}

export function createExitPortal(ground: (x: number, z: number) => number): ExitPortalView {
  const root = new Group();
  const glow = (opacity: number) =>
    new MeshBasicMaterial({
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
  const ringGeometry = new RingGeometry(EXIT_RADIUS - 0.18, EXIT_RADIUS, 96).rotateX(-Math.PI / 2),
    baseGeometry = new RingGeometry(EXIT_RADIUS - 0.42, EXIT_RADIUS + 0.06, 96).rotateX(
      -Math.PI / 2,
    ),
    innerGeometry = new RingGeometry(0, EXIT_RADIUS - 0.18, 64).rotateX(-Math.PI / 2);
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
    );
  const portals: Portal[] = [];
  for (let i = 0; i < POOL; i++) {
    const base = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: NormalBlending,
      fog: false,
    });
    const ringMaterial = glow(0.7),
      innerMaterial = glow(0.12),
      hazeMaterial = glow(0.14),
      coreMaterial = glow(0.55);
    // Every instance shares one program per key.
    fade(hazeMaterial, "exit-haze");
    fade(coreMaterial, "exit-core");
    const baseRing = new Mesh(baseGeometry, base),
      ring = new Mesh(ringGeometry, ringMaterial),
      inner = new Mesh(innerGeometry, innerMaterial),
      haze = new Mesh(hazeGeometry, hazeMaterial),
      core = new Mesh(coreGeometry, coreMaterial);
    baseRing.position.y = 0.04;
    ring.position.y = inner.position.y = 0.05;
    for (const mesh of [baseRing, ring, inner, haze, core]) mesh.renderOrder = 0.6;
    const portal = new Group();
    portal.visible = false;
    portal.add(baseRing, inner, ring, haze, core);
    root.add(portal);
    portals.push({
      root: portal,
      ring,
      base,
      ringMaterial,
      innerMaterial,
      hazeMaterial,
      coreMaterial,
      accent: "",
    });
  }
  const white = new Color("#ffffff");
  return {
    root,
    update(world, elapsed, local) {
      const exits = world.zone.phase === "cleared" ? world.zone.exits : [];
      const player = world.players.find((candidate) => candidate.id === local);
      const here = player?.alive ? atExit(world, player) : null;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3);
      for (const [i, portal] of portals.entries()) {
        const exit = exits[i];
        portal.root.visible = exit !== undefined;
        if (!exit) continue;
        const accent = exitAccent(exit);
        if (portal.accent !== accent.light) {
          portal.accent = accent.light;
          const light = new Color(accent.light);
          portal.base.color.set(accent.deep);
          portal.ringMaterial.color.copy(light);
          portal.innerMaterial.color.copy(light);
          portal.hazeMaterial.color.copy(light);
          portal.coreMaterial.color.copy(light).lerp(white, 0.35);
        }
        // The one the local player stands in answers: brighter and a little wider.
        const chosen = here === i;
        portal.root.position.set(exit.x, ground(exit.x, exit.z), exit.z);
        portal.ringMaterial.opacity = 0.55 + 0.3 * pulse + (chosen ? 0.2 : 0);
        portal.innerMaterial.opacity = 0.08 + 0.08 * pulse + (chosen ? 0.08 : 0);
        portal.hazeMaterial.opacity = 0.1 + 0.06 * pulse + (chosen ? 0.06 : 0);
        portal.ring.scale.setScalar((chosen ? 1.06 : 1) + 0.04 * pulse);
      }
    },
    dispose() {
      for (const geometry of [
        ringGeometry,
        baseGeometry,
        innerGeometry,
        hazeGeometry,
        coreGeometry,
      ])
        geometry.dispose();
      for (const portal of portals)
        for (const material of [
          portal.base,
          portal.ringMaterial,
          portal.innerMaterial,
          portal.hazeMaterial,
          portal.coreMaterial,
        ])
          material.dispose();
    },
  };
}
