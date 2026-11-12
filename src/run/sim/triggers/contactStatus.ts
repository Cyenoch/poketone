// Static's contact: the thorns hit (`afterTouch`) lands as the trigger's type and status.

import type { TriggerRule } from "./index";

export const contactStatus: TriggerRule<"contactStatus"> = { hook: "thorns" };
