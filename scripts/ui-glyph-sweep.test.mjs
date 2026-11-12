import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { codexSections } from "../src/run/codex.ts";
import { actionTerms, labTerms, statTerms } from "../src/run/glossary.ts";
import { archetypeNames } from "../src/run/labels.ts";
import { conditionTags } from "../src/run/sim/content/effects.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { items } from "../src/run/sim/content/items.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { statuses } from "../src/run/sim/content/statuses.ts";
import { describeRoll, rarityNames, statValue } from "../src/run/sim/upgrades.ts";
import { statDefs, statGroups } from "../src/ui/gpu/run-overlays-stats.ts";

const fonts = new URL("../public/fonts/gpu/core/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", fonts), "utf8"));

/**
 * Text the game builds at run time from its content (a source scan sees only the literals): every
 * 图鉴 page, every item, move, status and enemy name and description, each upgrade card's roll lines
 * at every rarity, the stats panel's labels and conditions, the glossary tips.
 */
function generatedText() {
  const parts = [JSON.stringify(codexSections())];
  for (const table of [items, moves, statuses, enemies]) parts.push(JSON.stringify(table));
  parts.push(JSON.stringify([statTerms, actionTerms, labTerms, archetypeNames, conditionTags]));
  parts.push(JSON.stringify([statDefs, statGroups, rarityNames]));
  const powers = [1, 1.3, 1.6, 2];
  for (const move of Object.values(moves))
    for (const stat of move.stats ?? [])
      for (const power of powers) parts.push(describeRoll(stat, statValue(stat, power)));
  return parts.join("");
}

// Game text draws from the core set (its own pages, app-resident), never from base pages loaded on
// demand: every character of generated UI text is in each core UI font. A miss would draw a box.
test("every character of generated UI text is in each core UI font", () => {
  const text = new Set(generatedText());
  for (const name of ["ui-500", "ui-700", "ui-800"]) {
    const atlas = JSON.parse(readFileSync(new URL(manifest[name].json, fonts), "utf8"));
    const glyphs = new Set(atlas.glyphs.map(([code]) => String.fromCodePoint(code)));
    const missing = [...text].filter((char) => char.trim() && !glyphs.has(char));
    assert.deepEqual(
      missing,
      [],
      `${name}: rerun bun run fonts:core (or the source font lacks these)`,
    );
  }
});

// The first screen (the lobby) waits only for chrome page 0 of each weight it draws with. Chrome is
// the text the shell and window sources display (src/ui/**, src/*; string, template and JSX text,
// never comments) plus the game data the lobby shows: all of it on page 0, never on a content page.
test("chrome page 0 holds every character the lobby can show", async () => {
  const { firstScreenText } = await import("./fonts/first-screen-text.mjs");
  const { chromeAndContent } = await import("./fonts/source-text.mjs");
  // What src/ui/** and src/* display (never their comments) plus the data the lobby shows.
  const lobby = new Set(chromeAndContent().chrome + firstScreenText());
  for (const name of ["ui-500", "ui-700", "ui-800"]) {
    const atlas = JSON.parse(readFileSync(new URL(manifest[name].json, fonts), "utf8"));
    const pageOf = new Map(atlas.glyphs.map(([code, page]) => [String.fromCodePoint(code), page]));
    const unavailable = new Set(manifest[name].unavailable);
    // Whitespace other than the space lays out as the space (U+0020 is in ASCII, on page 0).
    const off = [...lobby].filter(
      (char) => char.trim() && !unavailable.has(char) && pageOf.get(char) !== 0,
    );
    assert.deepEqual(
      off,
      [],
      `${name}: lobby characters off chrome page 0; rerun bun run fonts:core`,
    );
  }
});
