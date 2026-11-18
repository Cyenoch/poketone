import { megaDefs, stageForm, type FormDef, type MegaId } from "../sim/content/lines/index";
import type { Player } from "../sim/state/entities";

/** View seconds a sim mega may lead its ceremony event before the model follows anyway (a missed event). */
export const MEGA_EVENT_GRACE = 1;

/** The mega a player is drawn as; a guest's state arrives before the event plays on its clock. */
export interface ShownMega {
  mega: MegaId | null;
  lag: number;
}

/** The drawn form: a new sim mega waits for its `mega` event (which sets `shown.mega`); clearing follows at once. */
export function shownForm(shown: ShownMega, player: Player, dt: number): FormDef {
  if (!player.mega || player.mega === shown.mega) {
    shown.mega = player.mega;
    shown.lag = 0;
  } else if ((shown.lag += dt) >= MEGA_EVENT_GRACE) shown.mega = player.mega;
  return shown.mega ? megaDefs[shown.mega].form : stageForm(player.starter, player.stage);
}
