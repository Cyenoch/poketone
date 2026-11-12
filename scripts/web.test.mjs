import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { serveWeb } from "./web.mjs";
import { assetUrls, buildWeb } from "./web-build.mjs";
import { startHarbor } from "../services/harbor/server.ts";
import { PROTOCOL_VERSION } from "../src/network/protocol.ts";

test("Bun serves compiled StyleX and static assets, proxies Harbor, and closes its listener", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "poketone-web-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["src/run/sim", "public/models"])
    await mkdir(resolve(root, dir), { recursive: true });
  await symlink(resolve(import.meta.dir, "../node_modules"), resolve(root, "node_modules"), "dir");
  await Bun.write(
    resolve(root, "index.html"),
    '<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  await Bun.write(resolve(root, "public/asset.txt"), "public asset");
  await Bun.write(resolve(root, "public/audio/bank.json"), '{"sfx":{}}');
  await Bun.write(
    resolve(root, "src/main.tsx"),
    `import * as stylex from '@stylexjs/stylex';
const styles = stylex.create({ text: { color: '#123456' } });
document.body.className = stylex.props(styles.text).className;
document.body.textContent = String(import.meta.env.DEV);`,
  );
  const harbor = startHarbor({ port: 0, hostname: "127.0.0.1" });
  t.after(() => harbor.stop(true));
  const server = await serveWeb({
    root,
    port: 0,
    hostname: "127.0.0.1",
    development: true,
    harbor: `ws://127.0.0.1:${harbor.port}/multiplayer`,
  });
  t.after(() => server.stop());
  const html = await (await fetch(server.url)).text();
  assert(html.includes("/__dev/client.js?revision="));
  const cssPath = html.match(/href="(\/assets\/stylex-[^"]+)"/)[1];
  assert((await (await fetch(new URL(cssPath, server.url))).text()).includes("#123456"));
  assert.equal(await (await fetch(new URL("asset.txt", server.url))).text(), "public asset");
  assert.equal((await fetch(new URL("/src/main.tsx", server.url))).status, 404);
  await assert.rejects(
    () =>
      serveWeb({
        root,
        port: Number(server.url.port),
        hostname: "127.0.0.1",
        development: true,
        harbor: "ws://127.0.0.1:1/multiplayer",
      }),
    { code: "EADDRINUSE" },
  );

  const socket = new WebSocket(new URL("/multiplayer", String(server.url).replace("http:", "ws:")));
  t.after(() => socket.close());
  const room = await new Promise((accept, reject) => {
    socket.onerror = reject;
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          t: "enter",
          version: PROTOCOL_VERSION,
          build: "test",
          code: "",
          player: { starter: "charmander" },
        }),
      );
    socket.onmessage = ({ data }) => accept(JSON.parse(data));
  });
  assert.equal(room.t, "room");
  assert.equal(room.room.players.length, 1);
  socket.close();

  const dist = resolve(root, "dist");
  await buildWeb(root, dist);
  const production = await Bun.file(resolve(dist, "index.html")).text();
  assert(!production.includes("/__dev/"), "production must not connect to a development server");
  assert.equal(await Bun.file(resolve(dist, "asset.txt")).text(), "public asset");
  for (const [, path] of production.matchAll(/(?:src|href)="(\/[^"]+)"/g))
    assert(await Bun.file(resolve(dist, `.${path}`)).exists(), path);
  // Fetched assets ship a content-hashed copy; new content is a new URL no cache can hold.
  const hashed = assetUrls(root)["/audio/bank.json"];
  assert.match(hashed, /^\/audio\/bank\.[0-9a-f]{16}\.json$/);
  assert.equal(await Bun.file(resolve(dist, `.${hashed}`)).text(), '{"sfx":{}}');
  await Bun.write(resolve(root, "public/audio/bank.json"), '{"sfx":{"hit":{}}}');
  assert.notEqual(assetUrls(root)["/audio/bank.json"], hashed);
  await server.stop();
  const replacement = Bun.serve({
    port: Number(server.url.port),
    hostname: "127.0.0.1",
    fetch: () => new Response("replacement"),
  });
  await replacement.stop(true);
});
