// How the route reads in the run view and HUD (openspec add-route-branches): each target map's
// accent, the marker art, and what maps and the compass may show under a map modifier.
import { stageDefs, type StageId } from "../sim/content/stages/index";
import { routeMarkers } from "../sim/content/route";
import { caveLightRadius } from "../sim/route-rewards";
import type { MarkerId, ZoneExit } from "../sim/state/route";
import type { World } from "../sim/state/world";

export interface RouteAccent {
  light: string;
  deep: string;
}

/** Target-map accents: a tier's two maps sit far apart in hue; none is the player's warm yellow. */
export const routeAccent: Record<StageId, RouteAccent> = {
  forest: { light: "#5fcf5a", deep: "#1f5e22" },
  desert: { light: "#e9b04e", deep: "#8a5a12" },
  coast: { light: "#36c6c9", deep: "#0f5f66" },
  glacier: { light: "#8fc4ff", deep: "#2a5d9c" },
  volcano: { light: "#ff6f3c", deep: "#8f2a10" },
  tower: { light: "#b08cff", deep: "#46307e" },
};

/** The expedition's end: the plain exit ice, not a victory gold. */
const FINAL: RouteAccent = { light: "#bff4ff", deep: "#2a5d7c" };

export function exitAccent(exit: ZoneExit): RouteAccent {
  return exit.to ? routeAccent[exit.to] : FINAL;
}

/** The target's name, or 离开 for the final exit. */
export function exitName(exit: Pick<ZoneExit, "to">): string {
  return exit.to ? stageDefs[exit.to].name : "离开";
}

/** Marker art from existing item and lab icons; chests draw the item ball (null). */
export const markerIcons: Record<MarkerId, string | null> = {
  chests: null,
  "elite-nest": "/art/icons/items/razor-fang.webp",
  pokecenter: "/art/icons/items/potion.webp",
  research: "/art/icons/lab/research.webp",
  "gengar-deal": "/art/icons/items/reaper-cloth.webp",
};

export function markerName(marker: MarkerId): string {
  return routeMarkers[marker].name;
}

export interface RouteLight {
  x: number;
  z: number;
  r: number;
}

/** The light each standing player carries in a dark cave (sim radius), at its drawn position. */
export function routeLights(world: World, alpha = 1): RouteLight[] {
  return world.modifier === "dark-cave" ? caveLights(world, alpha) : [];
}

export function caveLights(world: World, alpha: number): RouteLight[] {
  const lights: RouteLight[] = [];
  for (const player of world.players) {
    if (!player.alive || player.departed) continue;
    lights.push({
      x: player.px + (player.x - player.px) * alpha,
      z: player.pz + (player.z - player.pz) * alpha,
      r: caveLightRadius(player),
    });
  }
  return lights;
}

/**
 * Whether maps and the compass may show an ordinary mark (enemies, chests, berries, stations,
 * sites) at (x, z): nothing in fog, only lit ground in a dark cave. Players, teammates (and their
 * rescue rings), the guardian and the exits are always shown by their callers.
 */
export function routeSight(world: World, alpha = 1): (x: number, z: number) => boolean {
  if (world.modifier === "fog") return () => false;
  if (world.modifier !== "dark-cave") return () => true;
  const lights = routeLights(world, alpha);
  return (x, z) => lights.some((light) => Math.hypot(light.x - x, light.z - z) <= light.r);
}
