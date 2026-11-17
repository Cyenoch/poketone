import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Drawing substitutes stay in a separate process, never replacing modules in other UI tests.
for (const scenario of [
  "codex-replaced-run",
  "codex-resumed-run",
  "settings-save-input",
  "lobby-retry",
  "backdrop-url",
  "launch-waits-lobby",
  "launch-progress-cancelled",
  "dispose-during-boot",
])
  test(`real GPU host/lobby lifecycle: ${scenario}`, () => {
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("ui-host.fixture.mjs", import.meta.url)), scenario],
      { encoding: "utf8", timeout: 15000 },
    );
    assert.equal(run.status, 0, run.error?.message ?? `${run.stdout}\n${run.stderr}`);
  });
