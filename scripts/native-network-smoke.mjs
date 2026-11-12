import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startHarbor } from "../services/harbor/server.ts";
import { MultiplayerSession } from "../src/network/session.ts";
import { MultiplayerRun } from "../src/network/run.ts";
import { createWorld, stepWorld } from "../src/run/sim/world.ts";
import { mapDigest } from "../src/run/sim/snapshot.ts";
import { nativeDirectPeer, cleanupNativeDirectPeers } from "../src/platform/native/direct-peer.ts";
import { gameBuild } from "./game-build.ts";
import { launchChrome, cleanup } from "./qa/lib/env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fingerprint = gameBuild(new URL("../", import.meta.url));
globalThis.__GAME_BUILD__ = fingerprint;
const outdir = await mkdtemp(join(tmpdir(), "poketone-native-network-"));
const build = await Bun.build({
  root: join(root, "src"),
  entrypoints: [
    "network/session.ts",
    "network/run.ts",
    "platform/web/direct-peer.ts",
    "run/sim/world.ts",
    "run/sim/snapshot.ts",
  ].map((path) => join(root, "src", path)),
  target: "browser",
  format: "esm",
  splitting: true,
  outdir,
  naming: { entry: "[dir]/[name].js", chunk: "chunks/[name]-[hash].js" },
  define: { __GAME_BUILD__: JSON.stringify(fingerprint) },
});
if (!build.success) throw new AggregateError(build.logs, "Network browser fixture build failed.");
const outputs = new Map(build.outputs.map((file) => [`/${relative(outdir, file.path)}`, file]));
const assets = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/") return new Response("<!doctype html><title>Native network smoke</title>");
    const file = outputs.get(path);
    return new Response(file ?? "missing", { status: file ? 200 : 404 });
  },
});
const { browser, version } = await launchChrome();
const results = [];
const guard = setTimeout(() => {
  console.error("Native network smoke did not finish or left native network resources running.");
  process.exit(2);
}, 45000);
guard.unref();
async function until(condition, description) {
  const limit = Date.now() + 10000;
  while (!(await condition())) {
    if (Date.now() > limit) throw new Error(description);
    await delay(10);
  }
}

try {
  for (const nativeHost of [true, false]) {
    const harbor = startHarbor({ port: 0, hostname: "127.0.0.1" });
    const url = `ws://127.0.0.1:${harbor.port}/multiplayer`;
    const page = await browser.newPage();
    const lifetime = new AbortController();
    const failures = [];
    let nativeSession, nativeRun, nativeWorld, shutdown;
    /** @type {Promise<void> | undefined} */
    let ready;
    const connectNative = (code) => {
      nativeSession = new MultiplayerSession(
        url,
        code,
        { starter: nativeHost ? "charmander" : "squirtle" },
        { directPeer: nativeDirectPeer, signal: lifetime.signal },
      );
      nativeSession.onFailure = (error) => failures.push(error.message);
      nativeSession.onStart = (config) => {
        nativeRun = new MultiplayerRun(nativeSession, config);
        ready = (async () => {
          nativeWorld = nativeHost
            ? createWorld({ ...config, seed: 7 })
            : await nativeRun.initial();
          if (nativeHost) nativeRun.publishMap(nativeWorld);
          nativeRun.loading(nativeWorld);
          await nativeRun.ready();
        })();
        void ready.catch((error) => failures.push(error.message));
      };
    };
    const connectWeb = (code) =>
      page.evaluate(
        async ({ url, code, host }) => {
          const [{ MultiplayerSession }, { MultiplayerRun }, { webDirectPeer }, sim, snapshots] =
            await Promise.all([
              import("/network/session.js"),
              import("/network/run.js"),
              import("/platform/web/direct-peer.js"),
              import("/run/sim/world.js"),
              import("/run/sim/snapshot.js"),
            ]);
          const lifetime = new AbortController();
          const session = new MultiplayerSession(
            url,
            code,
            { starter: host ? "charmander" : "squirtle" },
            { directPeer: webDirectPeer, signal: lifetime.signal },
          );
          const test = (globalThis.networkTest = {
            session,
            lifetime,
            sim,
            snapshots,
            failures: [],
          });
          session.onFailure = (error) => test.failures.push(error.message);
          session.onStart = (config) => {
            test.run = new MultiplayerRun(session, config);
            void (async () => {
              test.world = host
                ? sim.createWorld({ ...config, seed: 7 })
                : await test.run.initial();
              if (host) test.run.publishMap(test.world);
              test.run.loading(test.world);
              await test.run.ready();
              test.ready = true;
            })().catch((error) => test.failures.push(error.message));
          };
        },
        { url, code, host: !nativeHost },
      );
    try {
      await page.goto(String(assets.url));
      if (nativeHost) {
        connectNative("");
        await until(() => nativeSession.state.room, "Native room creation failed.");
        await connectWeb(nativeSession.state.room.code);
      } else {
        await connectWeb("");
        await page.waitForFunction(() => !!globalThis.networkTest.session.state.room);
        connectNative(await page.evaluate(() => globalThis.networkTest.session.state.room.code));
      }
      await until(
        () => nativeSession.state.mode === "direct",
        "Native peer did not select direct.",
      );
      await page.waitForFunction(() => globalThis.networkTest.session.state.mode === "direct");
      if (nativeHost) nativeSession.start("forest", 0);
      else await page.evaluate(() => globalThis.networkTest.session.start("forest", 0));
      await until(() => !!ready, "Native run did not start.");
      await ready;
      await page.waitForFunction(() => globalThis.networkTest.ready);
      const digest = mapDigest(nativeWorld.map);
      assert.equal(
        await page.evaluate(() =>
          globalThis.networkTest.snapshots.mapDigest(globalThis.networkTest.world.map),
        ),
        digest,
        "native and browser must install exactly the same transferred map",
      );

      let commands;
      const move = { t: "move", player: 0, x: 1, z: 0 };
      if (nativeHost) {
        await page.evaluate((command) => globalThis.networkTest.run.submit([command]), move);
        await until(
          () => (commands = nativeRun.submit([])).length,
          "Browser commands did not reach native.",
        );
        assert.equal(commands[0].player, 1);
        for (let i = 0; i < 12; i++) stepWorld(nativeWorld, i === 0 ? commands : []);
        nativeRun.publish(nativeWorld, nativeWorld.events.splice(0), 0.1, true);
        await page.waitForFunction(() => {
          const t = globalThis.networkTest;
          return t.run.apply(t.world, 0.1);
        });
      } else {
        nativeRun.submit([move]);
        await page.waitForFunction(() => {
          const t = globalThis.networkTest;
          const commands = t.run.submit([]);
          if (!commands.length) return false;
          t.commands = commands;
          return true;
        });
        commands = await page.evaluate(() => {
          const t = globalThis.networkTest;
          for (let i = 0; i < 12; i++) t.sim.stepWorld(t.world, i === 0 ? t.commands : []);
          t.run.publish(t.world, t.world.events.splice(0), 0.1, true);
          return t.commands;
        });
        assert.equal(commands[0].player, 1);
        await until(
          () => nativeRun.apply(nativeWorld, 0.1),
          "Browser world frame did not reach native.",
        );
      }
      assert.deepEqual(failures, []);
      assert.deepEqual(await page.evaluate(() => globalThis.networkTest.failures), []);
      results.push({
        nativeHost,
        mode: nativeSession.state.mode,
        mapDigest: digest,
        commands,
        players: nativeWorld.players.length,
      });

      // Intentional leave while Harbor is unavailable must not keep a closed app reconnecting.
      shutdown = harbor.shutdown();
      await shutdown;
      await delay(80);
      nativeSession.close();
      lifetime.abort();
      await page.evaluate(() => {
        globalThis.networkTest.session.close();
        globalThis.networkTest.lifetime.abort();
      });
    } finally {
      lifetime.abort();
      nativeRun?.dispose(false);
      nativeSession?.close(false);
      await page.close();
      await (shutdown ?? harbor.shutdown());
    }
  }
  await writeFile(
    "/tmp/poketone-native-network.json",
    JSON.stringify({ fingerprint, browser: version, results }, null, 2),
  );
  console.info(JSON.stringify({ fingerprint, browser: version, results }, null, 2));
} finally {
  cleanupNativeDirectPeers();
  await cleanup();
  await assets.stop(true);
  await rm(outdir, { recursive: true, force: true });
}
