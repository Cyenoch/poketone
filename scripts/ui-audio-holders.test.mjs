import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// A sound nobody holds is silent (src/audio/engine.ts: `acquire`), so every sound the game plays
// must be in a holder's list: UI_SOUNDS (held for the page) anywhere, RUN_SOUNDS (held from the
// first lobby, for the run) only in the run. Read statically from the call sites: a sound added
// to a screen without a holder fails here, never ships silent. (engine.ts can't load under node.)
const src = fileURLToPath(new URL("../src/", import.meta.url));
const engine = readFileSync(join(src, "audio/engine.ts"), "utf8");
const SFX = [
  ...engine
    .slice(engine.indexOf("SFX_NAMES = ["), engine.indexOf("] as const;"))
    .matchAll(/"([a-z-]+)"/g),
].map(([, name]) => name);
const UI = SFX.filter((name) => name.startsWith("ui-"));
const RUN = SFX.filter((name) => !name.startsWith("ui-"));

/** Files that play sounds, with every `sfx(` call's first argument. */
function calls() {
  const found = [];
  for (const entry of readdirSync(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const path = join(entry.parentPath, entry.name);
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/\.sfx\(\s*([^,)]+)/g)) {
      const line = text.slice(0, match.index).split("\n").length;
      found.push({ file: relative(src, path), line, argument: match[1].trim(), text });
    }
  }
  return found;
}

test("every sfx call plays a held sound: screens UI sounds, the run run or UI sounds", () => {
  const unheld = [];
  for (const { file, line, argument, text } of calls()) {
    if (file === "audio/engine.ts") continue; // the engine's own fallback replay
    const inRun = file === "run/createRun.ts";
    const allowed = new Set(inRun ? [...UI, ...RUN] : UI);
    const literal = /^"([a-z-]+)"$/.exec(argument);
    let names;
    if (literal) names = [literal[1]];
    else if (inRun)
      // A name built in the run (by element, tell severity, crit, outcome): every sound-name
      // literal the run's source holds is a candidate, so each must be held too.
      names = [...text.matchAll(/"([a-z]+(?:-[a-z]+)*)"/g)]
        .map(([, name]) => name)
        .filter((name) => SFX.includes(name));
    else names = [`<computed: ${argument}>`];
    for (const name of names) if (!allowed.has(name)) unheld.push(`src/${file}:${line} ${name}`);
  }
  assert.deepEqual(
    unheld,
    [],
    "add the sound to a holder (UI_SOUNDS / RUN_SOUNDS) or play another",
  );
});

test("a sound's cooldown fallback is held wherever the sound is", () => {
  for (const [, name, fallback] of engine.matchAll(
    /"?([a-z-]+)"?: \{[^}]*fallback: "([a-z-]+)"/g,
  )) {
    const holder = name.startsWith("ui-") ? UI : RUN;
    assert.ok(
      holder.includes(fallback) || UI.includes(fallback),
      `${name} falls back to ${fallback}`,
    );
  }
});
