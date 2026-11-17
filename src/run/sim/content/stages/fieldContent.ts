import { fieldEvents } from "../events";
import { SITE_POOLS } from "../sites";
import type { StageId, StageZone } from "./index";

export function fieldContent(stage: StageId): Pick<StageZone, "events" | "sites"> {
  return { events: fieldEvents(stage), sites: SITE_POOLS[stage] };
}
