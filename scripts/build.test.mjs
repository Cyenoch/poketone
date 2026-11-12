import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { lowerPowers } from "./determinism/pow-probe.mjs";
import { assetUrls, buildWeb, bundleWeb } from "./web-build.mjs";

test("determinism probe lowers nested powers without changing strings or evaluation order", () => {
  const code = 'const label = "a ** b"; export const value = (2 + 1) ** (2 ** 2);';
  const result = lowerPowers(code);
  assert(result.includes('"a ** b"'));
  assert(result.includes("Math.pow"));
  const value = runInNewContext(result.replace("export ", "") + "\nvalue;");
  assert.equal(value, 81);
});

test("public assets are fetched only through the hashed-URL path, never read raw by name", () => {
  // A raw read of /models|/art|/audio|/textures bypasses assetUrl (src/prepare/asset-url.ts) and
  // gets a cached copy that can be older than the code (docs/LESSONS.md, stale bank.json).
  const src = resolve(import.meta.dir, "../src");
  const raw = /(?:\bfetch|resources\(\)\.read)\(\s*["'`]\/(?:models|art|audio|textures)\//;
  const offenders = readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => raw.test(readFileSync(resolve(src, file), "utf8")));
  assert.deepEqual(offenders, []);
});

test("release output and injected URLs use one public byte snapshot despite changes during bundling", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "poketone-build-snapshot-"));
  const originalBuild = Bun.build;
  try {
    for (const dir of ["src/run/sim", "public/audio"])
      await mkdir(resolve(root, dir), { recursive: true });
    await symlink(
      resolve(import.meta.dir, "../node_modules"),
      resolve(root, "node_modules"),
      "dir",
    );
    await Bun.write(
      resolve(root, "index.html"),
      '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>',
    );
    await Bun.write(
      resolve(root, "src/main.tsx"),
      `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ text: { color: '#123456' } });
globalThis.release = { urls: __ASSET_URLS__, dev: import.meta.env.DEV, style: stylex.props(styles.text) };`,
    );
    const bank = '{"sfx":{}}';
    await Bun.write(resolve(root, "bank-source.json"), bank);
    await symlink(resolve(root, "bank-source.json"), resolve(root, "public/audio/bank.json"));
    await Bun.write(resolve(root, "public/models/triangle.glb"), "original model");
    await Bun.write(resolve(root, "public/fonts/manifest.json"), "original font manifest");
    const urls = assetUrls(root);
    const evaluate = async (files) => {
      const entry = [...files].find(([path]) => path.endsWith(".js"))[1];
      return runInNewContext(`${await entry.text()}; release;`);
    };
    // Both standalone bundle modes retain their contract for existing callers.
    for (const development of [true, false]) {
      const files = await bundleWeb(root, development);
      const result = await evaluate(files);
      assert.equal(result.dev, development);
      assert.equal(JSON.stringify(result.urls), JSON.stringify(development ? {} : urls));
      assert.equal((await files.get("/index.html").text()).includes("/__dev/"), development);
    }
    Bun.build = async (options) => {
      const result = await originalBuild(options);
      await Bun.write(resolve(root, "bank-source.json"), '{"sfx":{"hit":{}}}');
      await rm(resolve(root, "public/models/triangle.glb"));
      await Bun.write(resolve(root, "public/fonts/manifest.json"), "new font manifest");
      return result;
    };
    const dist = resolve(root, "dist");
    await buildWeb(root, dist);
    const html = await Bun.file(resolve(dist, "index.html")).text();
    const script = html.match(/src="([^"]+\.js)"/)[1];
    const result = await evaluate(new Map([[script, Bun.file(resolve(dist, `.${script}`))]]));
    assert.equal(JSON.stringify(result.urls), JSON.stringify(urls));
    for (const [plain, bytes] of [
      ["/audio/bank.json", bank],
      ["/models/triangle.glb", "original model"],
    ]) {
      assert.equal(await Bun.file(resolve(dist, `.${plain}`)).text(), bytes);
      assert.equal(await Bun.file(resolve(dist, `.${result.urls[plain]}`)).text(), bytes);
    }
    assert.equal(
      await Bun.file(resolve(dist, "fonts/manifest.json")).text(),
      "original font manifest",
    );
  } finally {
    Bun.build = originalBuild;
    await rm(root, { recursive: true, force: true });
  }
});
