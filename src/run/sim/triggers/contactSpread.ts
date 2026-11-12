// Sticky Barb: the thorns hit (`afterTouch`) lands on every enemy around the player, with its status.

import type { TriggerRule } from "./index";

export const contactSpread: TriggerRule<"contactSpread"> = { hook: "thorns" };
