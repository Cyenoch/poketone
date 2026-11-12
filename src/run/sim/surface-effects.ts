import { enemies } from "./content/enemies";
import { PUDDLE_WET } from "./content/params/combat";
import {
  LAVA_DMG,
  EMBERS,
  HURT_TICKS,
  LAVA_BURN,
  QUICKSAND_EASE_DISTANCE,
} from "./content/params/environment";
import { formOf } from "./evolution";
import { damagePlayer } from "./hurt";
import { mobilityClasses } from "./content/mobility";
import { moveWithSlope } from "./nav/index";
import type { Enemy, Player } from "./state/entities";
import type { World } from "./state/world";
import { apply, consume, find, sustain } from "./status";
import { QUICKSAND } from "./content/params/environment";
import { sampleSurface, type SurfacePatch, type SurfaceSample } from "./surface";
import { hypot } from "./math";

/** Called once before enemy DoT/decay, preserving the forest's douse/wet ordering. */
export function settleEnemySurface(enemy: Enemy, surface: SurfaceSample): void {
  if (surface.kind === "water") {
    consume(enemy, "burn");
    sustain(enemy, "wet", PUDDLE_WET, -1);
  } else if (surface.kind === "lava" && !enemies[enemy.species].types.includes("fire")) {
    // The existing burn/DoT/kill path owns damage and attribution; lava never consumes a burn.
    if ((find(enemy, "burn")?.power ?? 0) < LAVA_BURN.power)
      apply(enemy, "burn", LAVA_BURN.time, LAVA_BURN.power, -1);
    else sustain(enemy, "burn", LAVA_BURN.time, -1);
  }
}

/**
 * Each tick for a living player: quicksand drags them toward its centre; lava and burning ground hurt
 * on every `HURT_TICKS`th tick through the shared hit path (armor, shields, dash and i-frames). Burning
 * ground adds no burn status.
 */
export function settlePlayerSurface(world: World, player: Player, dt: number): void {
  const surface = sampleSurface(world.map.terrain.surface, player.x, player.z);
  pullPlayerSurface(world, player, dt);
  if (world.tick % HURT_TICKS !== 0) return;
  if (surface.kind === "lava") damagePlayer(world, player, LAVA_DMG);
  else if (surface.kind === "embers") damagePlayer(world, player, EMBERS.dmg);
}

/** The owner runs terrain displacement alongside its own movement. */
export function pullPlayerSurface(world: World, player: Player, dt: number): void {
  const surface = sampleSurface(world.map.terrain.surface, player.x, player.z);
  if (surface.patch?.kind === "quicksand") {
    const [px, pz] = quicksandPull(surface.patch, player.x, player.z, QUICKSAND.pull);
    // The patch's own speed applies inside the mover: net pull × QUICKSAND.speed.
    moveWithSlope(
      world.nav,
      mobilityClasses.ground,
      player,
      px * dt,
      pz * dt,
      formOf(player).radius,
    );
  }
}

/** Velocity toward the patch centre at `pull` u/s, easing off within QUICKSAND_EASE_DISTANCE. */
export function quicksandPull(
  patch: Pick<SurfacePatch, "x" | "z">,
  x: number,
  z: number,
  pull: number,
): [number, number] {
  const dx = patch.x - x;
  const dz = patch.z - z;
  const distance = hypot(dx, dz);
  if (distance < 1e-6) return [0, 0];
  const speed = pull * Math.min(1, distance / QUICKSAND_EASE_DISTANCE);
  return [(dx / distance) * speed, (dz / distance) * speed];
}
