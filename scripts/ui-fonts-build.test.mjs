import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// The font build's publish guarantees (scripts/fonts/publish.py), run through its pinned toolchain.
const core = fileURLToPath(new URL("../public/fonts/gpu/core/", import.meta.url));
const scripts = fileURLToPath(new URL("fonts/", import.meta.url));
const UV = ["run", "-q", "--with", "fonttools==4.68.0", "--with", "brotli==1.2.1"];
const python = (code, args = []) =>
  spawnSync("uv", [...UV, "--with", "pillow==13.0.0", "python", "-c", code, ...args], {
    cwd: scripts,
    encoding: "utf8",
  });

const snapshot = (folder) =>
  Object.fromEntries(
    readdirSync(folder)
      .sort()
      .map((name) => [name, readFileSync(join(folder, name)).toString("base64")]),
  );
const temporary = (prefix) => mkdtempSync(join(tmpdir(), `poketone-fonts-${prefix}-`));

test("a failing build leaves the published set byte-for-byte untouched", () => {
  const out = join(temporary("test"), "core");
  cpSync(core, out, { recursive: true });
  const before = snapshot(out);
  // Pages forced too small to hold any chunk: the first weight fails after a real msdf run.
  const run = python(
    `import importlib.util, sys
spec = importlib.util.spec_from_file_location("build_core", "build-core.py")
build = importlib.util.module_from_spec(spec); spec.loader.exec_module(build)
build.PAGE_MAX_HEIGHT = 128
sys.argv = ["build-core.py", "--out", sys.argv[1]]
build.main()`,
    [out],
  );
  assert.notEqual(run.status, 0, "the forced build must fail");
  assert.match(run.stderr + run.stdout, /do not fit/);
  assert.deepEqual(snapshot(out), before);
});

/** Publishes a one-font set tagged `tag` into `out`, pausing `pause` s just before its manifest
 *  swap (its files installed, the old manifest still current): the window another build used to
 *  interleave into. Prints "installed" when the pause starts. */
const PUBLISH = `import json, sys, time
from pathlib import Path
import atlas, publish
out, tag, pause = Path(sys.argv[1]), sys.argv[2], float(sys.argv[3])
staging = Path(sys.argv[4])
file, digest = atlas.page_file("ui-500-0", tag.encode() * 64, staging)
data = json.dumps({"pages": [file], "tag": tag}).encode()
info = f"ui-500.{atlas.sha256(data)[:16]}.json"; (staging / info).write_bytes(data)
install = publish._install
def paused(source, target):
    if target.name == "manifest.json" and pause:
        print("installed", flush=True); time.sleep(pause)
    install(source, target)
publish._install = paused
publish.publish(staging, {"ui-500": {"json": info, "sha256": atlas.sha256(data)}}, out)`;

const publishSync = (out, tag) => {
  const run = python(PUBLISH, [out, tag, "0", temporary("staging")]);
  assert.equal(run.status, 0, run.stderr);
};

/** Every file the current manifest names exists: what a client reading it will fetch. */
function assertComplete(out) {
  const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const info = JSON.parse(readFileSync(join(out, manifest["ui-500"].json), "utf8"));
  for (const file of [manifest["ui-500"].json, ...info.pages])
    assert.ok(existsSync(join(out, file)), `${file} named by the manifest is missing`);
  return info.tag;
}

test("publishing keeps the files of the last three publishes and prunes older ones", () => {
  const out = join(temporary("test"), "core");
  for (const tag of ["a", "b", "c", "d"]) publishSync(out, tag);
  assert.equal(assertComplete(out), "d");
  const pages = readdirSync(out).filter((name) => name.endsWith(".webp"));
  // A client still holding the b or c manifest can fetch its files; a's are gone.
  assert.equal(pages.length, 3);
  const releases = JSON.parse(readFileSync(join(out, "releases.json"), "utf8"));
  assert.equal(releases.length, 3);
  for (const release of releases)
    for (const file of release) assert.ok(existsSync(join(out, file)), file);
});

// A build that starts while another is between installing its files and swapping its manifest
// waits for it (lock beside the set), so the other's files are never pruned from under it and the
// final manifest always names files that exist.
test("a publish that starts mid-publication waits instead of interleaving", async () => {
  const out = join(temporary("test"), "core");
  publishSync(out, "a");
  const run = (tag, pause, onInstalled) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "uv",
        [
          ...UV,
          "--with",
          "pillow==13.0.0",
          "python",
          "-c",
          PUBLISH,
          out,
          tag,
          pause,
          temporary("staging"),
        ],
        { cwd: scripts, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stdout.on("data", (chunk) => String(chunk).includes("installed") && onInstalled?.());
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(stderr))));
    });
  // c starts while b is paused between its installed files and its manifest swap.
  const both = await new Promise((started) => {
    const first = run("b", "1.5", () => started(Promise.all([first, run("c", "0")])));
  });
  await both;
  assert.equal(assertComplete(out), "c");
  assert.deepEqual(
    readdirSync(out).filter((name) => name.endsWith(".tmp")),
    [],
    "no temporary left behind",
  );
});
