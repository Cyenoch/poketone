// Exercises the deployed entry point, including nginx's WebSocket upgrade and relay.
import assert from "node:assert/strict";
import { PROTOCOL_VERSION } from "../src/network/protocol.ts";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:8080");
const guestBase = new URL(process.argv[3] ?? base);
for (const origin of new Set([base.href, guestBase.href])) {
  const page = await fetch(origin, { signal: AbortSignal.timeout(10_000) });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/);
  const health = await fetch(new URL("/healthz", origin), { signal: AbortSignal.timeout(10_000) });
  assert.equal(health.status, 200);
}
const sockets = [];
let relayReject;
const deadline = setTimeout(() => {
  console.error("Compose smoke timed out");
  process.exit(1);
}, 15_000);
function next(socket, type) {
  return new Promise((resolve, reject) => {
    socket.onerror = reject;
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.t === "error") reject(new Error(message.message));
      else if (message.t === type) resolve(message);
    };
  });
}
async function connect(base, code) {
  const url = new URL("/multiplayer", base);
  url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(url);
  sockets.push(socket);
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.t === "error") {
      const error = new Error(`${base.origin}: ${message.message}`);
      console.error(error.message);
      relayReject?.(error);
    }
  });
  const room = next(socket, "room");
  socket.onopen = () =>
    socket.send(
      JSON.stringify({
        t: "enter",
        version: PROTOCOL_VERSION,
        build: "deploy-smoke",
        code,
        player: { starter: "charmander" },
      }),
    );
  return { socket, message: await room };
}
try {
  const owner = await connect(base, "");
  console.log(`${base.origin}: room created`);
  const guest = await connect(guestBase, owner.message.room.code);
  assert.equal(guest.message.room.code, owner.message.room.code);
  assert.equal(guest.message.room.players.length, 2);
  console.log(`${guestBase.origin}: joined the same room (2 players)`);
  const relayed = next(guest.socket, "relay");
  const relayFailed = new Promise((_, reject) => {
    relayReject = reject;
  });
  owner.socket.send(JSON.stringify({ t: "relay", to: 1, data: "nginx-to-harbor", epoch: 0 }));
  assert.equal((await Promise.race([relayed, relayFailed])).data, "nginx-to-harbor");
  console.log(`Game HTTP 200; ${base.origin} + ${guestBase.origin} joined one room; relay passed`);
} finally {
  sockets.forEach((socket) => socket.close());
  clearTimeout(deadline);
}
