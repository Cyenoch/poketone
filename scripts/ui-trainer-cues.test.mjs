import { test } from "node:test";
import assert from "node:assert/strict";
import { TrainerCues } from "../src/run/trainer-cues.ts";
import { parsePick, validPick } from "../src/lobbyPick.ts";
import { emptyProgress, parseProgress, recordRun } from "../src/run/progress.ts";
import { trainerUnlocked } from "../src/trainers.ts";

const cue = (kind, local = true, trainer = "chengxi") => ({
  kind,
  local,
  trainer,
  text: "一起走！",
  type: "water",
  seat: local ? 0 : 1,
});

test("trainer preference survives independent partner picks and rejects unknown identities", () => {
  const parsed = parsePick({
    trainer: "yewei",
    starter: "squirtle",
    difficulty: 0,
    stage: "forest",
  });
  assert.equal(validPick(emptyProgress(), parsed).trainer, "yewei");
  assert.equal(validPick(emptyProgress(), { ...parsed, starter: "charmander" }).trainer, "yewei");
  assert.equal(parsePick({ trainer: "__proto__" }).trainer, undefined);
  assert.equal(validPick(emptyProgress(), parsePick({ trainer: "missing" })).trainer, "chengxi");
});

test("simultaneous remote ultimates cannot replace the local trainer or stack a backlog", () => {
  const cues = new TrainerCues();
  cues.show(cue("dialogue"), 0);
  cues.show(cue("ultimate", false, "shuoye"), 100);
  cues.show(cue("ultimate", true, "yewei"), 110);
  assert.equal(cues.show(cue("ultimate", false), 120), false);
  assert.equal(cues.read(120).trainer, "yewei");
  assert.equal(cues.read(1500), null);
});

test("Xiaqing unlocks on banked lifetime kills and follows imported progress", () => {
  const before = { ...emptyProgress(), kills: 4999, stardust: 200 };
  const pick = { trainer: "xiaqing", starter: "squirtle", difficulty: 0, stage: "forest" };
  assert.equal(trainerUnlocked(before, "xiaqing"), false);
  assert.equal(validPick(before, pick).trainer, "chengxi", "a stored pick cannot bypass the lock");
  for (const outcome of ["victory", "defeat"]) {
    const after = recordRun(before, {
      outcome,
      starter: "squirtle",
      difficulty: 0,
      time: 10,
      kills: 1,
      stardust: 0,
    });
    assert.equal(trainerUnlocked(after, "xiaqing"), true);
    assert.equal(after.stardust, 200, "unlocking spends no currency");
    const reloaded = parseProgress(JSON.parse(JSON.stringify(after)));
    assert.equal(validPick(reloaded, pick).trainer, "xiaqing");
  }
  assert.equal(
    validPick(parseProgress(before), pick).trainer,
    "chengxi",
    "an older imported record relocks the character",
  );
  for (const id of ["chengxi", "shuoye", "yewei"])
    assert.equal(trainerUnlocked(emptyProgress(), id), true);
});

test("old and obscured cues are discarded instead of replaying on return", () => {
  const cues = new TrainerCues();
  assert.equal(cues.show(cue("ultimate"), 5000, 2000), false);
  cues.show(cue("dialogue"), 5000);
  cues.suppress("blocked");
  assert.equal(cues.show(cue("dialogue"), 5100), false);
  cues.suppress("open");
  assert.equal(cues.read(5200), null);
  cues.show(cue("ultimate"), 5300, 600);
  assert.equal(cues.read(6100), null);
});

test("a danger notice keeps the player's own ultimate and drops chatter and teammates", () => {
  const cues = new TrainerCues();
  cues.suppress("danger");
  assert.equal(cues.show(cue("dialogue"), 0), false);
  assert.equal(cues.show(cue("ultimate", false), 0), false);
  assert.equal(cues.show(cue("ultimate"), 0), true);
  cues.suppress("blocked");
  assert.equal(cues.read(10), null);
  assert.equal(cues.show(cue("deploy"), 20), true, "the opening plays under its own cover");
});
