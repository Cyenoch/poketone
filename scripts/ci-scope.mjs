import { appendFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const base = event.pull_request?.base.sha ?? event.before;
const head = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
// A force-push's `before` may no longer exist, so it has no usable baseline.
const full =
  process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ||
  event.forced ||
  !base ||
  /^0+$/.test(base);
const files = full
  ? []
  : execFileSync("git", ["diff", "--name-only", "-z", base, head], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const simTests = pkg.scripts["test:sim"].match(/scripts\/[^\s]+\.mjs/g);
const viewTests = ["scripts/view.test.mjs", "scripts/ultimate-fire-vfx.test.mjs"];
const deterministic = (file) =>
  /^(src\/run\/(sim\/|balance\/|lab\.ts$|createRun\.ts$)|scripts\/golden\.|package\.json$|bun\.lock$|tsconfig|patches\/)/.test(
    file,
  );
const golden = full || files.some(deterministic);
const sim = golden || files.some((file) => simTests.includes(file) && !viewTests.includes(file));
// The full sim command already includes these view tests; do not run them twice.
const view =
  !sim &&
  files.some(
    (file) =>
      /^(assets\/|public\/(art|models|textures)\/|src\/(run\/view\/|rendering\/|game\/models\/))/.test(
        file,
      ) || /^scripts\/(view.*|ultimate-fire-vfx)\.test\.mjs$/.test(file),
  );
appendFileSync(process.env.GITHUB_OUTPUT, `sim=${sim}\ngolden=${golden}\nview=${view}\n`);
console.log(`Simulation tests: ${sim}; deterministic replays: ${golden}; view tests: ${view}`);
