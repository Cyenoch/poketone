import type { ItemId } from "../run/sim/content/items";
import type { MoveId } from "../run/sim/content/moves";
import type { StationKind } from "../run/sim/state/entities";

export const moveIcon = (id: MoveId) => `/art/icons/moves/${id}.webp`;
export const itemIcon = (id: ItemId | "oran-berry" | "tm-case") => `/art/icons/items/${id}.webp`;
export const stationIcon = (kind: StationKind) => `/art/icons/stations/${kind}.webp`;
