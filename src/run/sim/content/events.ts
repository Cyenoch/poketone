import type { FieldEventId } from "../state/field";
import type { StageId, StageZone } from "./stages/index";
import { FIELD_EVENTS } from "./params/field-events";

export const fieldEventDefs: Record<FieldEventId, { name: string; stages: readonly StageId[] }> = {
  horde: { name: "群体遭遇", stages: ["forest", "desert", "coast", "glacier", "volcano", "tower"] },
  outbreak: {
    name: "大量出现",
    stages: ["forest", "desert", "coast", "glacier", "volcano", "tower"],
  },
  "site-awaken": {
    name: "交互点觉醒",
    stages: ["forest", "desert", "coast", "glacier", "volcano", "tower"],
  },
  sun: { name: "大晴天", stages: ["volcano"] },
  rain: { name: "下雨", stages: ["coast"] },
  sandstorm: { name: "沙暴", stages: ["desert"] },
  hail: { name: "冰雹", stages: ["glacier"] },
};

export function fieldEvents(stage: StageId): StageZone["events"] {
  return {
    windows: [FIELD_EVENTS.window],
    pool: (Object.keys(fieldEventDefs) as FieldEventId[]).filter((id) =>
      fieldEventDefs[id].stages.includes(stage),
    ),
  };
}
