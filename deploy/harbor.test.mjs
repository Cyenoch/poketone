import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "../src/network/protocol.ts";
import test from "node:test";
import { startHarbor } from "../services/harbor/server.ts";

await test("shutdown closes room and idle sockets with Going Away and releases the listener", async () => {
  const server = startHarbor({ port: 0, hostname: "127.0.0.1" });
  const sockets = [0, 1].map(() => new WebSocket(`ws://127.0.0.1:${server.port}/multiplayer`));
  try {
    await Promise.all(sockets.map((socket) => new Promise((resolve) => (socket.onopen = resolve))));
    const room = new Promise((resolve) => (sockets[0].onmessage = resolve));
    sockets[0].send(
      JSON.stringify({
        t: "enter",
        version: PROTOCOL_VERSION,
        build: "test",
        code: "",
        player: { starter: "charmander" },
      }),
    );
    assert.equal(JSON.parse((await room).data).t, "room");
    const closed = sockets.map((socket) => new Promise((resolve) => (socket.onclose = resolve)));
    await server.shutdown();
    assert.deepEqual(
      (await Promise.all(closed)).map((event) => event.code),
      [1001, 1001],
    );
    await assert.rejects(fetch(`${server.url}health`));
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.stop(true);
  }
});
