import type { StationKind } from "../../state/entities";

/** 站点实体碰撞半径（u）；同时用于导航阻挡和交互距离计算。 */
export const STATION_RADIUS: Record<StationKind, number> = { hypno: 0.6, bill: 1.3 };

/** 超出站点半径 + 玩家半径后仍能交互的距离（u）；可玩性检查和交互共用。 */
export const STATION_REACH = 0.5;
