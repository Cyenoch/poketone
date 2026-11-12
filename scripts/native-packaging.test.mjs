import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyDependencies, relocateImports, validateFonts } from "./native-build.mjs";

test("relocated production dependencies preserve conflicting versions and native neighbors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketone-package-test-"));
  try {
    const source = join(directory, "source");
    const output = join(directory, "moved", "node_modules");
    async function pkg(path, manifest, files = {}) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "package.json"), JSON.stringify(manifest));
      for (const [name, content] of Object.entries(files))
        await writeFile(join(path, name), content);
    }
    await pkg(
      join(source, "node_modules/parent"),
      {
        name: "parent",
        version: "1",
        dependencies: { child: "1" },
        optionalDependencies: { absent: "1" },
      },
      { "addon.node": "binary", "neighbor.dylib": "library", LICENSE: "license" },
    );
    await pkg(join(source, "node_modules/parent/node_modules/child"), {
      name: "child",
      version: "1",
    });
    await pkg(join(source, "node_modules/child"), { name: "child", version: "2" });
    const packages = await copyDependencies(["parent", "child"], source, output);
    await rm(source, { recursive: true });
    assert.equal(packages.length, 3);
    assert.equal(
      JSON.parse(await readFile(join(output, "parent/node_modules/child/package.json"))).version,
      "1",
    );
    assert.equal(JSON.parse(await readFile(join(output, "child/package.json"))).version, "2");
    for (const [name, text] of [
      ["addon.node", "binary"],
      ["neighbor.dylib", "library"],
      ["LICENSE", "license"],
    ])
      assert.equal(await readFile(join(output, "parent", name), "utf8"), text);
    await assert.rejects(
      copyDependencies(["missing"], directory, join(directory, "bad")),
      /Missing native production dependency/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("compiled entry survives relocation, preserves ESM exports and reads nested dependencies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketone-compile-test-"));
  try {
    const app = join(directory, "Original.app");
    const modules = join(app, "Contents/Resources/runtime/node_modules");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await mkdir(join(modules, "fixture/node_modules/nested"), { recursive: true });
    await writeFile(
      join(modules, "fixture/package.json"),
      JSON.stringify({ type: "module", exports: { import: "./esm.js", require: "./wrong.cjs" } }),
    );
    await writeFile(
      join(modules, "fixture/esm.js"),
      'import nested from "nested"; export default nested + 1;',
    );
    await writeFile(
      join(modules, "fixture/wrong.cjs"),
      "throw new Error('CJS condition selected');",
    );
    await writeFile(
      join(modules, "fixture/node_modules/nested/package.json"),
      '{"main":"index.js"}',
    );
    await writeFile(join(modules, "fixture/node_modules/nested/index.js"), "module.exports = 41;");
    const { source } = relocateImports(
      'import value from "fixture"; const later = await import("fixture"); console.log(value + later.default);',
    );
    const entry = join(directory, "entry.mjs");
    await writeFile(entry, source);
    const compiled = Bun.spawn(
      [
        process.execPath,
        "build",
        "--compile",
        "--compile-autoload-package-json",
        "--no-compile-autoload-dotenv",
        "--no-compile-autoload-bunfig",
        entry,
        "--outfile",
        join(app, "Contents/MacOS/probe"),
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    assert.equal(await compiled.exited, 0, await new Response(compiled.stderr).text());
    await rm(entry);
    const moved = join(directory, "Moved with spaces.app");
    await rename(app, moved);
    const child = Bun.spawn([join(moved, "Contents/MacOS/probe")], {
      cwd: "/",
      env: { PATH: "/usr/bin:/bin", HOME: directory },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.equal(await child.exited, 0, await new Response(child.stderr).text());
    assert.equal((await new Response(child.stdout).text()).trim(), "84");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing or corrupt manifest-pinned fonts stop packaging", async () => {
  const directory = await mkdtemp(join(tmpdir(), "poketone-font-package-test-"));
  try {
    const core = join(directory, "fonts/gpu/core");
    const base = join(directory, "fonts/gpu/base/pinned");
    await mkdir(core, { recursive: true });
    await writeFile(join(core, "manifest.json"), '{"base":"pinned"}');
    await assert.rejects(validateFonts(directory), /ENOENT/);
    await mkdir(base, { recursive: true });
    await writeFile(
      join(base, "manifest.json"),
      '{"key":"pinned","ui-500":{"json":"font.json","sha256":"bad"}}',
    );
    await writeFile(join(base, "font.json"), "{}");
    await assert.rejects(validateFonts(directory), /digest mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
