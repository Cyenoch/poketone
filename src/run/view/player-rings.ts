import {
  AdditiveBlending,
  BackSide,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
} from "three";
import { playerColors } from "../../ui/player-colors";
import { COOP } from "../sim/content/params/coop";
import type { World } from "../sim/state/world";
import { heightAt, type Terrain } from "../sim/terrain";

const INK = "#0d233f",
  BEACON_HEIGHT = 7,
  GEM_HEIGHT = 3.4;

/** Lays a flat ring on the terrain; `scale` is the mesh's own XZ scale, so sampling follows it. */
function drape(
  terrain: Terrain,
  mesh: Mesh<RingGeometry>,
  x: number,
  z: number,
  lift: number,
  scale = 1,
): void {
  const position = mesh.geometry.attributes.position!;
  for (let i = 0; i < position.count; i++)
    position.setY(
      i,
      heightAt(terrain, x + position.getX(i) * scale, z + position.getZ(i) * scale) + lift,
    );
  position.needsUpdate = true;
  mesh.geometry.computeBoundingSphere();
}

/** Drawn over everything: a fallen teammate must stay findable behind trees, enemies and effects. */
function overlay(color: string, opacity = 1, additive = false): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    ...(additive ? { blending: AdditiveBlending } : {}),
  });
  return material;
}

/**
 * Slot rings follow the scene's interpolated feet, with dark rims on every map palette. A downed
 * player's body is hidden, so their seat is marked by a rescue-reach ring, a light column and a
 * floating gem in the seat colour; all of it is read-only presentation of `alive`.
 */
export function playerRings(world: World) {
  const root = new Group();
  const rings = world.players.map((_, slot) => {
    const group = new Group();
    const layers = [
      new Mesh(
        new RingGeometry(0.66, 0.87, 48).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ color: INK, depthWrite: false, toneMapped: false }),
      ),
      new Mesh(
        new RingGeometry(0.7, 0.83, 48).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ color: playerColors[slot]!, depthWrite: false, toneMapped: false }),
      ),
    ];
    group.add(...layers);
    root.add(group);

    const beacon = new Group();
    const reach = new Mesh(
      new RingGeometry(COOP.rescueReach - 0.12, COOP.rescueReach, 64).rotateX(-Math.PI / 2),
      overlay(playerColors[slot]!, 0.9),
    );
    const ripple = new Mesh(
      new RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      overlay(playerColors[slot]!, 1),
    );
    const column = new Mesh(
      new CylinderGeometry(0.22, 0.5, BEACON_HEIGHT, 16, 1, true),
      overlay(playerColors[slot]!, 0.35, true),
    );
    const gem = new Mesh(
      new OctahedronGeometry(0.5).scale(0.8, 1.25, 0.8),
      overlay(playerColors[slot]!),
    );
    const gemRim = new Mesh(new OctahedronGeometry(0.64).scale(0.8, 1.25, 0.8), overlay(INK));
    gemRim.material.side = BackSide;
    for (const mesh of [reach, ripple, column, gemRim, gem]) mesh.renderOrder = 900;
    gem.renderOrder = 901;
    beacon.add(reach, ripple, column, gemRim, gem);
    beacon.visible = false;
    root.add(beacon);
    return { group, layers, beacon, reach, ripple, column, gem, gemRim };
  });
  root.visible = world.players.length > 1;
  let clock = 0;
  return {
    root,
    update(alpha: number, dt: number) {
      clock += dt;
      const { terrain } = world.map;
      rings.forEach(({ group, layers, beacon, reach, ripple, column, gem, gemRim }, slot) => {
        const player = world.players[slot]!;
        group.visible = !player.departed;
        const x = player.px + (player.x - player.px) * alpha,
          z = player.pz + (player.z - player.pz) * alpha;
        group.position.set(x, 0, z);
        layers.forEach((mesh, layer) => {
          const position = mesh.geometry.attributes.position!;
          for (let i = 0; i < position.count; i++)
            position.setY(
              i,
              heightAt(terrain, x + position.getX(i), z + position.getZ(i)) + 0.04 + layer * 0.01,
            );
          position.needsUpdate = true;
          mesh.geometry.computeBoundingSphere();
        });

        const down = !player.alive && !player.departed;
        beacon.visible = down;
        if (!down) return;
        const ground = heightAt(terrain, x, z);
        beacon.position.set(x, 0, z);
        drape(terrain, reach, x, z, 0.06);
        // A ripple leaves the body every 0.9 s: where help has to stand, and that it is urgent.
        const wave = (clock / 0.9) % 1;
        const spread = 0.6 + wave * (COOP.rescueReach - 0.6);
        ripple.scale.set(spread, 1, spread);
        drape(terrain, ripple, x, z, 0.07, spread);
        ripple.material.opacity = 1 - wave;
        reach.material.opacity = 0.55 + 0.35 * Math.sin(clock * 6);
        column.position.y = ground + BEACON_HEIGHT / 2;
        column.material.opacity = 0.28 + 0.12 * Math.sin(clock * 6);
        const bob = Math.sin(clock * 3) * 0.25;
        gem.position.set(0, ground + GEM_HEIGHT + bob, 0);
        gem.rotation.y = clock * 2.2;
        gemRim.position.copy(gem.position);
        gemRim.rotation.y = gem.rotation.y;
      });
    },
    dispose() {
      for (const { layers, reach, ripple, column, gem, gemRim } of rings) {
        for (const mesh of [...layers, reach, ripple, column, gem, gemRim]) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }
    },
  };
}
