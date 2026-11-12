// Real two-context Harbor journey through the shared GPU app session; no private navigation calls.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { startHarbor } from "../../services/harbor/server.ts";
import { cleanup, launchChrome, onCleanup, snapshot, startDev } from "./lib/env.mjs";
import { openConfig, waitLobby, press } from "./lib/page.mjs";

const root = resolve(import.meta.dir, "../..");
const output = "/tmp/poketone-reconnect-ui";
const work = join(output, `source-${process.pid}`);
mkdirSync(output, { recursive: true });
const config = { width: 1280, height: 800, dpr: 1, uiScale: 1, touch: false };
const lobby = "window.__poketoneUi.lobby.stage";
const room = "window.__poketoneUi.screens.at(-1)?.stage";
const overlays = "window.__poketoneUi.run?.overlays.stage";
const world = "window.__poketoneWorld";
try {
  const harbor = startHarbor({ port: 0, hostname: "127.0.0.1" });
  onCleanup(() => harbor.stop(true));
  snapshot(root, work);
  onCleanup(() => rmSync(work, { recursive: true, force: true }));
  const url = await startDev(work, `ws://127.0.0.1:${harbor.port}/multiplayer`);
  const { browser, version } = await launchChrome();
  const owner = await openConfig(browser, url, config);
  const guest = await openConfig(browser, url, config);
  const clients = [owner, guest];
  for (const client of clients) {
    onCleanup(() => client.context.close());
    client.page.on("pageerror", (error) => console.error(error));
    await waitLobby(client.page);
    await client.page.evaluate(() => {
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket {
        constructor(...args) {
          super(...args);
          window.__qaSocket = this;
        }
      };
    });
  }
  console.info("Two lobbies ready");
  await press(owner.page, config, lobby, "联机");
  await press(owner.page, config, room, "创建房间");
  await owner.page.waitForFunction(`(() => {
    let code = null;
    window.__poketoneUi.screens.at(-1).stage.root.traverse(o => {
      const value = o.properties?.peek?.().text;
      if (typeof value === 'string' && /^\\d{6}$/.test(value)) code = value.slice(-6);
    });
    return code;
  })()`);
  const code = await owner.page.evaluate(`(() => {
    let code = '';
    window.__poketoneUi.screens.at(-1).stage.root.traverse(o => {
      const value = o.properties?.peek?.().text;
      if (typeof value === 'string' && /^\\d{6}$/.test(value)) code = value.slice(-6);
    });
    return code;
  })()`);
  await owner.page.screenshot({ path: join(output, "owner-room.png") });
  await press(guest.page, config, lobby, "联机");
  await press(guest.page, config, room, "加入房间");
  for (const digit of code) await guest.page.keyboard.press(digit);
  await press(guest.page, config, room, "加入");
  console.info("Guest join submitted");
  await owner.page.waitForFunction(
    `window.__poketoneUi.screens.at(-1).state?.room?.players.length === 2 && window.__poketoneUi.screens.at(-1).state.mode !== 'connecting'`,
  );
  console.info("Both transports ready");
  await press(owner.page, config, room, "出发");
  console.info("Room joined and departure requested");
  for (const client of clients)
    try {
      await client.page.waitForFunction(
        `${world}?.players.length === 2 && ${world}?.tick > 30`,
        null,
        { timeout: 90000 },
      );
    } catch (error) {
      console.error(
        await client.page.evaluate(
          `({ world: ${world} && { tick: ${world}.tick, players: ${world}.players.length }, body: document.body.innerText, ui: window.__poketoneUi.run?.overlays.state })`,
        ),
        client.logs,
      );
      await client.page.screenshot({ path: join(output, "failed.png") });
      throw error;
    }
  const sample = (page) =>
    page.evaluate(
      `({ tick: ${world}.tick, positions: ${world}.players.map(p => ({x:p.x,y:p.y})) })`,
    );
  const before = await sample(owner.page);
  await guest.page.keyboard.down("d");
  await guest.page.waitForTimeout(400);
  await guest.page.keyboard.up("d");
  await owner.page.waitForTimeout(200);
  const moved = await sample(owner.page);
  assert(moved.positions[1].x > before.positions[1].x + 0.2, "guest input must move guest on host");
  assert.equal(moved.positions[0].x, before.positions[0].x, "guest input must not move host");
  await guest.page.keyboard.press("p");
  await guest.page.waitForTimeout(400);
  const paused = await sample(owner.page);
  await owner.page.waitForTimeout(350);
  assert.equal((await sample(owner.page)).tick, paused.tick, "guest pause must stop both peers");
  await guest.page.keyboard.press("Escape");
  await owner.page.waitForFunction(`${world}.tick > ${paused.tick}`);
  await owner.page.screenshot({ path: join(output, "owner-run.png") });
  await guest.page.screenshot({ path: join(output, "guest-run.png") });
  await guest.page.evaluate(() => window.__qaSocket.close());
  await owner.page.waitForFunction(
    `window.__poketoneUi.run?.overlays.state?.kind === 'reconnecting'`,
  );
  await owner.page.screenshot({ path: join(output, "owner-reconnecting.png") });
  const reconnectTick = (await sample(owner.page)).tick;
  await guest.page.waitForFunction(
    `window.__poketoneUi.run?.overlays.state?.kind !== 'reconnecting' && ${world}.tick > ${reconnectTick}`,
    null,
    { timeout: 90000 },
  );
  await guest.page.reload();
  await waitLobby(guest.page);
  await press(guest.page, config, lobby, "联机");
  await press(guest.page, config, room, `重返 ${code}`);
  await guest.page.waitForFunction(
    `${world}?.tick > ${reconnectTick} && window.__poketoneUi.run?.overlays.state === null`,
    null,
    { timeout: 90000 },
  );
  await guest.page.screenshot({ path: join(output, "guest-rejoined.png") });
  await owner.page.keyboard.press("p");
  await press(owner.page, config, overlays, "放弃冒险");
  await press(owner.page, config, overlays, "返回大厅");
  await waitLobby(owner.page);
  await guest.page.waitForFunction(`(() => {
    let found = false;
    window.__poketoneUi.run?.overlays.stage.root.traverse(o => {
      if (o.properties?.peek?.().text === '再来一局' && o.isVisible?.value) found = true;
    });
    return found;
  })()`);
  await guest.page.screenshot({ path: join(output, "guest-result.png") });
  const logs = clients.map((client) => client.logs);
  assert.equal(
    logs.flat().filter((entry) => entry.type === "pageerror").length,
    0,
    "no page crashes",
  );
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify({ version, before, moved, paused, logs }, null, 2),
  );
  console.info(`Multiplayer app smoke passed: ${output}`);
} finally {
  await cleanup();
}
