import assert from "node:assert/strict";
import test from "node:test";
import { codexEntry, codexSections, researchGroups, researchedEntry } from "../src/run/codex.ts";
import { typeNames } from "../src/run/sim/content/elements.ts";
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
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { unlocks } from "../src/run/sim/content/unlocks.ts";
import { SITE } from "../src/run/sim/content/params/sites.ts";

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
    ...researchGroups().flatMap((group) => group.species.map((id) => `enemy:${id}`)),
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
    for (const id of line.stages[0].form.abilities.normal)
      assert.ok(page.includes(abilities[id].name), `${line.id}: ability ${id}`);
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
  for (const id of researchGroups().flatMap((group) => group.species)) {
    const enemy = enemies[id];
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

test("the research shelf files every species a run can meet, once, and nothing retired", () => {
  const filed = researchGroups().flatMap((group) => group.species);
  assert.equal(new Set(filed).size, filed.length, "a species filed twice");
  const spawned = Object.values(stageDefs).flatMap((stage) =>
    stage.zones.flatMap((zone) => [
      ...zone.roster.map(([, id]) => id),
      zone.guardian.species,
      ...zone.beats.flatMap(({ beat }) => ("species" in beat ? [beat.species].flat() : [])),
    ]),
  );
  const researched = Object.values(unlocks).flatMap(({ requires }) =>
    "research" in requires ? [requires.research] : [],
  );
  // Site-only species: the honey tree's, the fished, the ghost's.
  const sites = ["heracross", "pinsir", "munchlax", "magikarp", "gyarados", "marowak"];
  for (const id of [...spawned, ...researched, ...sites])
    assert.ok(filed.includes(id), `${id} is missing from the shelf`);
  // Guardians the current maps replaced can no longer be met, so they cannot count toward 研究.
  for (const id of ["marowak-ghost", "haunter-guardian"])
    assert.ok(!filed.includes(id), `${id} cannot be completed`);
});

test("site species name their maps and the site's own reward", () => {
  const full = { seen: 9999, defeated: 9999, shiny: 1 };
  const done = (id) => researchedEntry({ [id]: full }, codexEntry(`enemy:${id}`).entry, id);
  const block = (entry, title) => entry.blocks.find((b) => b.title === title);
  const magikarp = done("magikarp");
  assert.deepEqual(block(magikarp, "出现地图").lines, [stageDefs.coast.name]);
  const catchDrop = block(magikarp, "掉落").rows.find((row) => row.label === "星星沙子");
  assert.match(catchDrop.value, new RegExp(`^${SITE.rewards.fishStardust} \\+`));
  // A species met both in the wild and at a site shows each source's drop under its name.
  const weedle = done("weedle");
  assert.ok(block(weedle, "掉落 · 野生"), "weedle: wild drop");
  assert.ok(
    block(weedle, "掉落 · 团体战巢穴").rows.some((row) => row.label === "宝箱"),
    "weedle: raid den chest",
  );
  const snorlax = done("snorlax");
  assert.ok(
    block(snorlax, "掉落 · 睡着的卡比兽").rows.some((row) => row.label === "吃剩的东西"),
    "snorlax: the sleeping one's leftovers",
  );
});

test("a species' 图鉴 page shows only what its research has earned", () => {
  const full = { seen: 9999, defeated: 9999, shiny: 99 };
  for (const id of researchGroups().flatMap((group) => group.species)) {
    const enemy = enemies[id];
    const page = codexEntry(`enemy:${id}`).entry;
    const words = (entry) => text(entry);
    const types = (entry) => enemy.types.filter((type) => words(entry).includes(typeNames[type]));

    const unseen = researchedEntry({}, page, id);
    assert.ok(!words(unseen).includes(enemy.name), `${id}: unseen leaks its name`);
    assert.deepEqual(unseen.types, [], `${id}: unseen leaks its types`);
    assert.deepEqual(types(unseen), [], `${id}: unseen names its types`);
    assert.deepEqual(
      unseen.blocks.map((block) => block.kind),
      ["research"],
      `${id}: unseen blocks`,
    );

    const seen = researchedEntry({ [id]: { seen: 1, defeated: 0, shiny: 0 } }, page, id);
    assert.equal(seen.name, enemy.name, `${id}: seen shows its name`);
    assert.ok(!seen.blocks.some((block) => block.title === "数值"), `${id}: seen leaks its stats`);
    assert.ok(
      !seen.blocks.some((block) => block.title.startsWith("掉落")),
      `${id}: seen leaks its drops`,
    );
    assert.ok(
      seen.blocks.some((block) => block.kind === "research"),
      `${id}: seen keeps its tasks`,
    );

    const done = researchedEntry({ [id]: full }, page, id);
    assert.ok(
      done.blocks.some((block) => block.title === "数值"),
      `${id}: done shows its stats`,
    );
    const drops = done.blocks.filter((block) => block.title.startsWith("掉落"));
    assert.ok(
      drops.length && drops.every((block) => block.rows.some((row) => row.label === "星星沙子")),
      `${id}: done shows its 星星沙子 drop`,
    );
    for (const block of page.blocks)
      assert.ok(done.blocks.includes(block), `${id}: done keeps ${block.title}`);
  }
});
