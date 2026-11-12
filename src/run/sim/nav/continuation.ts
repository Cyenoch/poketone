import type { Terrain } from "../terrain";
import { addCellBlocker, addCircleBlocker, type Blocker } from "./blockers";
import { restoreFields, type FieldFacts, type RunningSearch } from "./flow";
import { createNav, layerFor, type Nav } from "./nav";
import { mobilityClasses } from "../content/mobility";
import { sameProfile } from "./profiles";

const mobilityIds = Object.keys(mobilityClasses) as (keyof typeof mobilityClasses)[];

/**
 * What a world's nav carries across ticks, as plain data: the blockers in install order, the
 * layers in creation order (it is the scheduling order) with their fields' facts, the refresh
 * clock and cursor, and the running search. Grid, layer masks, field buffers, the search queue and
 * A* buffers are rebuilt from these and the terrain (docs/state-machines/simulation.md).
 */
export interface NavContinuation {
  blockers: Blocker[];
  nextBlockerId: number;
  clock: number;
  cursor: number;
  layers: { mobility: keyof typeof mobilityClasses; field: FieldFacts | null }[];
  search: RunningSearch | null;
}

export function navContinuation(nav: Nav): NavContinuation {
  const running = nav.flow?.layer;
  return {
    blockers: nav.blockers.map((blocker) =>
      blocker.kind === "circle" ? { ...blocker } : { ...blocker, cells: [...blocker.cells] },
    ),
    nextBlockerId: nav.nextBlockerId,
    clock: nav.clock,
    cursor: nav.cursor,
    layers: nav.layers.map(({ profile, field }, i) => {
      const mobility = mobilityIds.find((id) => sameProfile(profile, mobilityClasses[id]));
      if (!mobility) throw new Error(`导航层 ${i} 的机动属性不属于已知类别。`);
      return {
        mobility,
        field: field && {
          dirty: field.dirty,
          seeds: [...field.seeds],
          published: field.published && [...field.published],
          demand: field.demand,
        },
      };
    }),
    search: running ? { layer: nav.layers.indexOf(running), settled: nav.flow!.settled } : null,
  };
}

/** A fresh nav on `terrain` in the state `continuation` describes. */
export function restoreNav(terrain: Terrain, continuation: NavContinuation): Nav {
  const nav = createNav(terrain);
  for (const blocker of continuation.blockers) {
    nav.nextBlockerId = blocker.id;
    if (blocker.kind === "circle") addCircleBlocker(nav, blocker.x, blocker.z, blocker.radius);
    else addCellBlocker(nav, blocker.cells);
  }
  nav.nextBlockerId = continuation.nextBlockerId;
  continuation.layers.forEach(({ mobility }, i) => {
    if (typeof mobility !== "string" || !Object.hasOwn(mobilityClasses, mobility))
      throw new Error(`导航层 ${i} 的机动类别无效：${mobility}。`);
    if (layerFor(nav, mobilityClasses[mobility]) !== nav.layers[i])
      throw new Error(`导航层 ${i} 的顺序与快照不符。`);
  });
  if (nav.layers.length !== continuation.layers.length)
    throw new Error(
      `快照有 ${continuation.layers.length} 个导航层，导航有 ${nav.layers.length} 个。`,
    );
  restoreFields(
    nav,
    continuation.layers.map((layer) => layer.field),
    continuation.search,
  );
  nav.clock = continuation.clock;
  nav.cursor = continuation.cursor;
  return nav;
}
