// The cure for a map modifier (Flash in a dark cave, Defog in fog) under a short light column: found
// by exploring, as maps show no mark for it, yet it reads through the shade and the fog it lifts.
import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
} from "three";
import type { World } from "../sim/state/world";
import { inject, patchShader } from "./patchShader";

const HEIGHT = 6;
const POOL = 2;
const COLORS = { flash: "#fff2a8", defog: "#c9f2ff" } as const;

export interface RouteBeacons {
  root: Group;
  update(world: World, elapsed: number): void;
  dispose(): void;
}

export function createRouteBeacons(ground: (x: number, z: number) => number): RouteBeacons {
  const root = new Group();
  const column = new CylinderGeometry(0.3, 0.55, HEIGHT, 16, 1, true).translate(0, HEIGHT / 2, 0);
  const ring = new RingGeometry(0.75, 0.95, 48).rotateX(-Math.PI / 2);
  const beacons = Array.from({ length: POOL }, () => {
    const material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    patchShader(material, "route-beacon", (shader) => {
      shader.vertexShader = inject(shader.vertexShader, "route-beacon", {
        "#include <common>": "#include <common>\nvarying float vBeaconY;",
        "#include <begin_vertex>": "#include <begin_vertex>\nvBeaconY=position.y;",
      });
      shader.fragmentShader = inject(shader.fragmentShader, "route-beacon", {
        "#include <common>": "#include <common>\nvarying float vBeaconY;",
        "#include <color_fragment>": `#include <color_fragment>\ndiffuseColor.a*=1.0-smoothstep(${(HEIGHT * 0.25).toFixed(2)},${HEIGHT.toFixed(1)},vBeaconY);`,
      });
    });
    const foot = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    const group = new Group();
    const body = new Mesh(column, material),
      base = new Mesh(ring, foot);
    base.position.y = 0.05;
    body.renderOrder = base.renderOrder = 0.6;
    group.add(body, base);
    group.visible = false;
    root.add(group);
    return { group, material, foot, base };
  });
  return {
    root,
    update(world, elapsed) {
      let used = 0;
      for (const pickup of world.pickups) {
        if (pickup.kind !== "flash" && pickup.kind !== "defog") continue;
        const beacon = beacons[used++];
        if (!beacon) break;
        beacon.group.visible = true;
        beacon.group.position.set(pickup.x, ground(pickup.x, pickup.z), pickup.z);
        beacon.material.color.set(COLORS[pickup.kind]);
        beacon.foot.color.set(COLORS[pickup.kind]);
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.4 + pickup.id);
        beacon.material.opacity = 0.35 + 0.2 * pulse;
        beacon.base.scale.setScalar(1 + 0.25 * pulse);
      }
      for (let i = used; i < POOL; i++) beacons[i]!.group.visible = false;
    },
    dispose() {
      column.dispose();
      ring.dispose();
      for (const beacon of beacons) {
        beacon.material.dispose();
        beacon.foot.dispose();
      }
    },
  };
}
