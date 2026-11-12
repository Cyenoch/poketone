import type { Terrain } from "../terrain";
import type { PathSearch } from "./astar";
import type { Blocker } from "./blockers";
import type { FlowSearch } from "./flow";
import { createNavGrid, type NavGrid } from "./grid";
import { createLayer, sameProfile, type MobilityProfile, type NavLayer } from "./profiles";
import { mobilityClasses } from "../content/mobility";

/** Navigation state for one world. Pure data plus typed arrays; every peer builds the same one from the seed. */
export interface Nav {
  grid: NavGrid;
  /** Creation order is the scheduling order, so it must not depend on anything but call order. */
  layers: NavLayer[];
  blockers: Blocker[];
  nextBlockerId: number;
  /** Advanced once per flow refresh; lets fields tell whether anyone still reads them. */
  clock: number;
  /** Layer whose flow field the refresh scheduler serves first. */
  cursor: number;
  /** Target cells of the current refresh, reused across ticks. */
  targets: number[];
  /** Flow-field search queue, allocated by the first refresh. */
  flow: FlowSearch | null;
  /** A* buffers, allocated by the first path query. */
  search: PathSearch | null;
}

export function createNav(terrain: Terrain): Nav {
  const nav: Nav = {
    grid: createNavGrid(terrain),
    layers: [],
    blockers: [],
    nextBlockerId: 1,
    clock: 0,
    cursor: 0,
    targets: [],
    flow: null,
    search: null,
  };
  // Built up front so read-only callers (groundBlockedMask from the view) never change layer order.
  layerFor(nav, mobilityClasses.ground);
  return nav;
}

/** The layer for a walker profile, built on first use and shared by every equal profile. */
export function layerFor(nav: Nav, profile: MobilityProfile): NavLayer {
  if (profile.flying) throw new Error("飞行单位不使用导航层。");
  let layer = nav.layers.find((candidate) => sameProfile(candidate.profile, profile));
  if (!layer) {
    layer = createLayer(nav.grid, profile);
    nav.layers.push(layer);
  }
  return layer;
}
