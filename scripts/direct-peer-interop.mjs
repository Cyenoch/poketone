// Uses the same PLAYWRIGHT_CORE / CHROME_PATH environment as the existing browser QA.
import assert from "node:assert/strict";
import { launchChrome, cleanup } from "./qa/lib/env.mjs";
import {
  nativeDirectPeer,
  nativeIceServers,
  cleanupNativeDirectPeers,
} from "../src/platform/native/direct-peer.ts";

const build = await Bun.build({
  entrypoints: [new URL("../src/platform/web/direct-peer.ts", import.meta.url).pathname],
  target: "browser",
  format: "esm",
});
if (!build.success) throw new AggregateError(build.logs, "Browser peer build failed");
const webModule = await build.outputs[0].text();
const messages = [
  "P",
  "Q",
  "0" + "漢".repeat(12000),
  "1" + "語".repeat(12000),
  ...Array.from({ length: 600 }, (_, i) => `${i}:` + "x".repeat(12000)),
];
const results = [];
const guard = setTimeout(() => {
  console.error("Direct peer interop timed out.");
  process.exit(2);
}, 45000);
const { browser } = await launchChrome();

try {
  assert.equal(typeof globalThis.RTCPeerConnection, "undefined");
  assert.deepEqual(
    nativeIceServers([
      { urls: "stun:stun.example:3478" },
      {
        urls: ["turn:relay.example:3478?transport=tcp", "turns:[::1]:5349?transport=tcp"],
        username: "expiry:user@realm",
        credential: ["p", ":", "a", "/", "s", "+", "?", "%", "#", "雪"].join(""),
      },
    ]),
    [
      "stun:stun.example:3478",
      "turn:expiry%3Auser%40realm:p%3Aa%2Fs%2B%3F%25%23%E9%9B%AA@relay.example:3478?transport=tcp",
      "turns:expiry%3Auser%40realm:p%3Aa%2Fs%2B%3F%25%23%E9%9B%AA@[::1]:5349?transport=tcp",
    ],
  );
  for (const invalid of [
    { credential: {} },
    { username: {} },
    { credentialType: "oauth" },
    { credential: undefined },
  ])
    assert.throws(() =>
      nativeIceServers([
        { urls: "turn:relay.example", username: "u", credential: "p", ...invalid },
      ]),
    );

  for (const initiator of [true, false, true, false]) {
    const page = await browser.newPage();
    let peer;
    const ready = Promise.withResolvers();
    let received = 0;
    let nativeEvents = 0;
    let peakBuffered = 0;
    const done = Promise.withResolvers();
    const disconnected = Promise.withResolvers();
    let outbound = Promise.resolve();
    // Deliberately deliver the first real ICE candidate before its remote description.
    const candidateFirst = (deliver) => {
      let description;
      let sawCandidate = false;
      return (signal) => {
        if (signal.description && !sawCandidate) description = signal;
        else {
          const sent = deliver(signal);
          if (signal.candidate) {
            sawCandidate = true;
            if (description) {
              const pending = description;
              description = undefined;
              return Promise.resolve(sent).then(() => deliver(pending));
            }
          }
          return sent;
        }
      };
    };
    const toNative = candidateFirst(async (signal) => {
      await ready.promise;
      await peer.accept(signal);
    });
    const toWeb = candidateFirst((signal) => {
      outbound = outbound.then(() => page.evaluate((s) => globalThis.testPeer.accept(s), signal));
      void outbound.catch(done.reject);
      return outbound;
    });
    await page.exposeFunction("nativeSignal", (signal) => toNative(signal));
    await page.evaluate(
      async ({ source, initiator }) => {
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        const { webDirectPeer } = await import(url);
        URL.revokeObjectURL(url);
        globalThis.webDirectPeer = webDirectPeer;
        globalThis.received = [];
        globalThis.errors = [];
        globalThis.webEvents = 0;
        globalThis.webDisconnected = Promise.withResolvers();
        globalThis.testPeer = webDirectPeer(
          { initiator: !initiator, iceServers: [] },
          {
            signal: (signal) => {
              globalThis.webEvents++;
              void globalThis
                .nativeSignal(signal)
                .catch((error) => globalThis.errors.push(String(error)));
            },
            opened: () => globalThis.webEvents++,
            message: (text) => {
              globalThis.webEvents++;
              globalThis.received.push(text);
              globalThis.testPeer.send(text);
            },
            disconnected: () => {
              globalThis.webEvents++;
              globalThis.webDisconnected.resolve();
            },
            error: (error) => globalThis.errors.push(String(error)),
          },
        );
      },
      { source: webModule, initiator },
    );
    peer = nativeDirectPeer(
      { initiator, iceServers: [] },
      {
        signal: (signal) => {
          nativeEvents++;
          void Promise.resolve(toWeb(signal)).catch(done.reject);
        },
        opened: () => {
          nativeEvents++;
          try {
            assert(peer.open);
            for (const message of messages) {
              peer.send(message);
              peakBuffered = Math.max(peakBuffered, peer.bufferedAmount);
            }
          } catch (error) {
            done.reject(error);
          }
        },
        message: (text) => {
          nativeEvents++;
          try {
            assert.equal(text, messages[received++]);
            if (received === messages.length) done.resolve();
          } catch (error) {
            done.reject(error);
          }
        },
        disconnected: () => {
          nativeEvents++;
          disconnected.resolve();
        },
        error: done.reject,
      },
    );
    ready.resolve();
    try {
      await done.promise;
      await outbound;
      const web = await page.evaluate(() => ({
        received: globalThis.received,
        errors: globalThis.errors,
        open: globalThis.testPeer.open,
      }));
      assert.deepEqual(web.received, messages);
      assert.deepEqual(web.errors, []);
      assert(web.open);
      if (initiator) {
        await page.evaluate(() => globalThis.testPeer.close());
        await disconnected.promise;
      } else {
        peer.close();
        await page.evaluate(() => globalThis.webDisconnected.promise);
      }
      peer.close();
      peer.close();
      const eventsAtClose = await page.evaluate(() => {
        globalThis.testPeer.close();
        globalThis.testPeer.close();
        return globalThis.webEvents;
      });
      assert.equal(peer.open, false);
      assert.equal(peer.bufferedAmount, 0);
      assert.throws(() => peer.send("after close"), /not open/);
      const nativeAtClose = nativeEvents;
      await peer.accept({ candidate: { candidate: "" } });
      await page.evaluate(() => globalThis.testPeer.accept({ candidate: { candidate: "" } }));
      assert.equal(await page.evaluate(() => globalThis.webEvents), eventsAtClose);
      assert.equal(nativeEvents, nativeAtClose);
      const interruptedEvents = [];
      const record = () => interruptedEvents.push("late callback");
      const interrupted = nativeDirectPeer(
        { initiator: true, iceServers: [] },
        { signal: record, opened: record, message: record, disconnected: record, error: record },
      );
      interrupted.close();
      await interrupted.accept({ candidate: { candidate: "" } });
      assert.deepEqual(interruptedEvents, []);
      await page.evaluate(async () => {
        const events = [];
        const record = () => events.push("late callback");
        const interrupted = globalThis.webDirectPeer(
          { initiator: true, iceServers: [] },
          { signal: record, opened: record, message: record, disconnected: record, error: record },
        );
        interrupted.close();
        await interrupted.accept({ candidate: { candidate: "" } });
        if (events.length) throw new Error("Web peer called back after immediate close.");
      });
      results.push({
        offerer: initiator ? "native" : "web",
        messagesEachDirection: received,
        peakBuffered,
      });
    } finally {
      peer.close();
      await page.close();
    }
  }
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  await cleanup();
  cleanupNativeDirectPeers();
  clearTimeout(guard);
}
