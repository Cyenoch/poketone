// Terrain-aware navigation for the pure simulation: slope-limited movement, shared flow fields for
// swarms, point-to-point A*, and runtime blockers. See docs/NAVIGATION.md.
export { groundBlockedMask, type MobilityProfile, type TerrainMask } from "./profiles";
export { createNav, type Nav } from "./nav";
export { navContinuation, restoreNav, type NavContinuation } from "./continuation";
export { cellAt, cellCenterX, cellCenterZ, routeBlocked, steepnessAt } from "./grid";
export { bodyFits, routeReach } from "./reach";
export { addCellBlocker, addCircleBlocker, removeBlocker } from "./blockers";
export {
  canReach,
  flowDirection,
  refreshFlowFields,
  requestFlowField,
  type Direction,
  type FlowTarget,
} from "./flow";
export { hasWalkableLine } from "./line";
export { findPath } from "./astar";
export { moveWithSlope, type Body } from "./movement";
