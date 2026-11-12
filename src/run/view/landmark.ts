// The same summon/fight/exit contract, with stage-owned set pieces and sparse vertical light.
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Object3D,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
} from "three";
import type { World } from "../sim/state/world";
import { landmarkOf } from "../sim/currentZone";
import type { InstanceSource } from "./assets";
import { lambertCopy } from "./materials";
import { inject, patchShader } from "./patchShader";
import type { StageTheme } from "./stageThemes";
import type { WindUniforms } from "./environment/wind";
const EXIT = new Color("#dddcca");
export interface LandmarkView {
  root: Group;
  update(world: World, elapsed: number): void;
  dispose(): void;
}
export function createLandmark(
  world: World,
  source: InstanceSource,
  look: StageTheme["landmark"],
  wind: WindUniforms,
): LandmarkView {
  const pad = landmarkOf(world),
    root = new Group();
  root.position.set(pad.x, pad.height, pad.z);
  const summon = new Color(look.glow);
  const glow = (opacity: number) =>
    new MeshBasicMaterial({
      color: summon,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  const ringGeometry = new RingGeometry(pad.radius - 0.055, pad.radius, 96).rotateX(-Math.PI / 2);
  const ringMaterial = glow(0.35);
  patchShader(ringMaterial, "landmark-runes", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "landmark-runes", {
      "#include <common>": "#include <common>\nvarying vec2 vRune;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvRune=position.xz;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "landmark-runes", {
      "#include <common>": "#include <common>\nvarying vec2 vRune;",
      "#include <color_fragment>":
        "#include <color_fragment>\nfloat rune=fract(atan(vRune.y,vRune.x)*5.729578);\ndiffuseColor.a*=smoothstep(0.08,0.18,rune)*(1.0-smoothstep(0.7,0.85,rune));",
    });
  });
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.04;
  ring.renderOrder = 0.6;
  const columnGeometry = new CylinderGeometry(0.32, 0.55, 14, 20, 1, true).translate(0, 7, 0),
    columnMaterial = glow(0.08);
  patchShader(columnMaterial, "landmark-column", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "landmark-column", {
      "#include <common>": "#include <common>\nvarying float vColumnY;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvColumnY=position.y;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "landmark-column", {
      "#include <common>": "#include <common>\nvarying float vColumnY;",
      "#include <color_fragment>":
        "#include <color_fragment>\ndiffuseColor.a*=smoothstep(0.0,0.8,vColumnY)*(1.0-smoothstep(4.0,14.0,vColumnY));",
    });
  });
  const column = new Mesh(columnGeometry, columnMaterial);
  if (look.columnOffset) column.position.set(...look.columnOffset);
  column.renderOrder = 0.6;
  const bodyMaterial = lambertCopy(source.material);
  look.patchMaterial?.(bodyMaterial, wind);
  bodyMaterial.flatShading = true;
  const body = new Mesh(source.geometry, bodyMaterial);
  body.castShadow = body.receiveShadow = true;
  // A small solid lantern core on the plinth, never a filled ground disc.
  const coreGeometry = new SphereGeometry(0.12, 8, 6),
    coreMaterial = glow(0.5),
    core = new InstancedMesh(coreGeometry, coreMaterial, look.cores.length);
  const light = new Object3D();
  for (const [i, position] of look.cores.entries()) {
    light.position.set(...position);
    light.scale.set(0.5, 1.6, 0.5);
    light.updateMatrix();
    core.setMatrixAt(i, light.matrix);
  }
  root.add(body, ring, column, core);
  ring.visible = look.runes !== false;
  return {
    root,
    update(current, elapsed) {
      const cleared = current.zone.phase !== "active",
        fighting = !cleared && current.bossId !== null,
        color = cleared ? EXIT : summon,
        pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4);
      for (const material of [ringMaterial, columnMaterial, coreMaterial])
        material.color.copy(color);
      ringMaterial.opacity = fighting ? 0.09 : 0.22 + 0.1 * pulse;
      column.visible = !fighting;
      columnMaterial.opacity = 0.055 + 0.025 * pulse;
      coreMaterial.opacity = fighting ? 0.08 : 0.45 + 0.2 * pulse;
      if (look.emissiveBody) {
        bodyMaterial.emissive.copy(color);
        bodyMaterial.emissiveIntensity = fighting ? 0.025 : 0.28 + 0.08 * pulse;
      }
    },
    dispose() {
      core.dispose();
      for (const geometry of [ringGeometry, columnGeometry, coreGeometry]) geometry.dispose();
      for (const material of [ringMaterial, columnMaterial, coreMaterial, bodyMaterial])
        material.dispose();
    },
  };
}
