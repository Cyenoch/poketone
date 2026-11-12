import assert from "node:assert/strict";
import test from "node:test";
import { codexEntry, codexSections } from "../src/run/codex.ts";
import { abilities } from "../src/run/sim/content/abilities.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { fusionRecipes } from "../src/run/sim/content/fusions.ts";
import { itemIds } from "../src/run/sim/content/items.ts";
import { formDefs, starters } from "../src/run/sim/content/lines/index.ts";
import { moves } from "../src/run/sim/content/moves.ts";
import { reactionIds } from "../src/run/sim/content/reactions.ts";
import { stationNames } from "../src/run/sim/content/stations.ts";
import { statusIds } from "../src/run/sim/content/statuses.ts";
import { ultimates } from "../src/run/sim/content/ultimates.ts";
import { labItems } from "../src/run/lab.ts";

const entries = codexSections().flatMap((section) =>
  section.groups.flatMap((group) => group.entries),
);
const text = (entry) => JSON.stringify([entry.name, entry.tags, entry.summary, entry.blocks]);

test("every content id has its 图鉴 entry, and every link opens one", () => {
  const keys = entries.map((entry) => entry.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate 图鉴 keys");
  const expected = [
    ...Object.keys(formDefs).map((id) => `form:${id}`),
    ...Object.keys(moves).map((id) => `move:${id}`),
    ...[...itemIds, "tm-case"].map((id) => `item:${id}`),
    ...labItems.map((item) => `lab:${item.id}`),
    ...Object.keys(stationNames).map((id) => `station:${id}`),
    ...Object.keys(enemies).map((id) => `enemy:${id}`),
    ...statusIds.map((id) => `status:${id}`),
    ...reactionIds.map((id) => `reaction:${id}`),
  ];
  assert.deepEqual(
    expected.filter((key) => !keys.includes(key)),
    [],
  );
  const broken = entries.flatMap((entry) =>
    entry.blocks.flatMap((block) =>
      block.kind === "refs"
        ? block.refs.filter((ref) => ref.key && !codexEntry(ref.key)).map((ref) => ref.key)
        : [],
    ),
  );
  assert.deepEqual(broken, []);
});

test("each line's ability, ultimate tiers and fusion recipe are on its forms' pages", () => {
  for (const line of Object.values(starters)) {
    const page = text(codexEntry(`form:${line.stages[0].form.id}`).entry);
    assert.ok(page.includes(abilities[line.ability].name), `${line.id}: ability`);
    for (const name of ultimates[line.ultimate].names)
      assert.ok(page.includes(name), `${line.id}: ultimate ${name}`);
  }
  for (const recipe of fusionRecipes) {
    const page = codexEntry(`move:${recipe.result}`).entry;
    const refs = page.blocks.flatMap((block) => (block.kind === "refs" ? block.refs : []));
    for (const move of recipe.match.pair)
      assert.ok(
        refs.some((ref) => ref.key === `move:${move}`),
        `${recipe.result}: ${move}`,
      );
  }
});

test("every enemy skill has words on its page", () => {
  for (const [id, enemy] of Object.entries(enemies)) {
    const page = codexEntry(`enemy:${id}`).entry;
    if (enemy.skill)
      assert.ok(
        page.blocks.some((block) => block.title === "行动"),
        id,
      );
    if (enemy.contact)
      assert.ok(text(page).includes(`status:${enemy.contact.status}`), `${id}: contact status`);
  }
});

test("every entry's picture tells it apart from its neighbours", () => {
  for (const section of codexSections()) {
    const marks = new Map();
    for (const entry of section.groups.flatMap((group) => group.entries)) {
      if (entry.art.kind === "model") assert.ok(entry.model, `${entry.key}: picture needs a model`);
      if (entry.art.kind !== "mark") continue;
      const initial = entry.name.slice(0, 1);
      assert.ok(
        !marks.has(initial),
        `${entry.key} and ${marks.get(initial)} both show 「${initial}」`,
      );
      marks.set(initial, entry.key);
    }
  }
});
