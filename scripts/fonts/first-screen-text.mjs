// Text the first screen (the lobby, docs/fonts-paging-design.md) draws from game data rather than
// from literals in src/ui: chrome page 0 must hold all of it, so opening the game never waits for
// a content page. build-core.py adds it to chrome; scripts/ui-glyph-sweep.test.mjs checks page 0.
// The tables are the ones the lobby reads (src/ui/gpu/lobby.ts); its own literals are in src/ui.
//   bun scripts/fonts/first-screen-text.mjs   # prints it
import { LEGAL_NOTICE } from "../../src/legalNotice.ts";
import { difficultyLock, starterLock } from "../../src/run/locks.ts";
import { emptyProgress } from "../../src/run/progress.ts";
import { abilities } from "../../src/run/sim/content/abilities.ts";
import { bondMilestones } from "../../src/run/sim/content/bonds.ts";
import { difficulties } from "../../src/run/sim/content/difficulties.ts";
import { items } from "../../src/run/sim/content/items.ts";
import { starters } from "../../src/run/sim/content/lines/index.ts";
import { kitTip, trainerOrder, trainers } from "../../src/trainers.ts";

/**
 * Partner names and roles, every ability's name and description (the name-plate tip), difficulty
 * names, the legal notice, the partner and difficulty lock lines, every item name (backpack tips),
 * the bond titles and rewards (the bond's tip), each trainer's name and kit with its tip.
 */
export function firstScreenText() {
  const parts = [LEGAL_NOTICE];
  const progress = emptyProgress();
  for (const [id, line] of Object.entries(starters))
    parts.push(line.stages[0].form.name, line.role, starterLock(progress, id) ?? "");
  for (const ability of Object.values(abilities)) parts.push(ability.name, ability.desc);
  difficulties.forEach((difficulty, index) =>
    parts.push(difficulty.name, difficultyLock(progress, index) ?? ""),
  );
  for (const item of Object.values(items)) parts.push(item.name);
  for (const { title, reward } of bondMilestones) parts.push(title, reward ?? "");
  for (const id of trainerOrder) parts.push(trainers[id].name, kitTip(id));
  return parts.join("");
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(firstScreenText());
