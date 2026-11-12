import { watch } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { bundleWeb } from "./web-build.mjs";

// Full reload is intentional: GPU, audio and world objects cannot survive partial module swaps.
const reloadClient = `const events = new EventSource('/__dev/events');
const revision = new URL(import.meta.url).searchParams.get('revision');
events.onmessage = ({data}) => {
  const next = JSON.parse(data);
  if (next.error) { console.error('[build]', next.error); return; }
  if (revision !== next.revision) location.reload();
};`;

/** Same-origin WebSocket proxy for development and local production preview. */
function multiplayerProxy(upstream) {
  return {
    async upgrade(request, server) {
      const peer = new WebSocket(upstream);
      peer.binaryType = "arraybuffer";
      const data = { peer, socket: null, pending: [] };
      peer.onmessage = ({ data: message }) => {
        if (data.socket) data.socket.send(message);
        else data.pending.push(message);
      };
      peer.onclose = () => data.socket?.close(1011, "Harbor disconnected");
      try {
        await new Promise((accept, reject) => {
          peer.onopen = accept;
          peer.onerror = () => reject(new Error(`Cannot connect to Harbor at ${upstream}`));
        });
      } catch (error) {
        peer.close();
        console.error(error.message);
        return new Response("Harbor unavailable", { status: 502 });
      }
      if (!server.upgrade(request, { data })) {
        peer.close();
        return new Response("WebSocket upgrade required", { status: 400 });
      }
    },
    websocket: {
      maxPayloadLength: 16 * 1024 * 1024,
      backpressureLimit: 16 * 1024 * 1024,
      closeOnBackpressureLimit: true,
      open(socket) {
        socket.data.socket = socket;
        for (const message of socket.data.pending) socket.send(message);
        socket.data.pending.length = 0;
      },
      message(socket, message) {
        socket.data.peer.send(message);
      },
      close(socket) {
        socket.data.peer.close();
      },
    },
  };
}

export async function serveWeb({ root, port, hostname, development, directory, harbor }) {
  let files;
  let buildError;
  let revision = 0;
  const instance = crypto.randomUUID();
  const version = () => `${instance}:${revision}`;
  const streams = new Set();
  const proxy = multiplayerProxy(harbor);
  const server = Bun.serve({
    reusePort: false,
    port,
    hostname,
    development: false,
    idleTimeout: 0,
    websocket: proxy.websocket,
    async fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === "/multiplayer") return proxy.upgrade(request, server);
      // Explicit diagnostic entrypoints only; never serve arbitrary repository files.
      if (development && /^\/scripts\/[\w-]+\.browser\.mjs$/.test(path)) {
        const entrypoint = resolve(root, `.${path}`);
        if (!(await Bun.file(entrypoint).exists()))
          return new Response("Not found", { status: 404 });
        const result = await Bun.build({
          entrypoints: [entrypoint],
          target: "browser",
          define: {
            "import.meta.env.DEV": "true",
            "import.meta.env.BASE_URL": JSON.stringify("/"),
          },
        });
        return new Response(result.outputs[0], { headers: { "Cache-Control": "no-store" } });
      }
      if (development && path === "/__dev/client.js")
        return new Response(reloadClient, { headers: { "Content-Type": "text/javascript" } });
      if (development && path === "/__dev/events") {
        let controller;
        return new Response(
          new ReadableStream({
            start(stream) {
              controller = stream;
              streams.add(stream);
              stream.enqueue(
                `data: ${JSON.stringify({ revision: version(), error: buildError })}\n\n`,
              );
            },
            cancel() {
              streams.delete(controller);
            },
          }),
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } },
        );
      }
      if (development && !files) return new Response(buildError ?? "Building…", { status: 503 });
      const name = path === "/" ? "/index.html" : path;
      const bundled = files?.get(name);
      if (bundled && name === "/index.html")
        return new HTMLRewriter()
          .on('script[src="/__dev/client.js"]', {
            element(element) {
              element.setAttribute("src", `/__dev/client.js?revision=${version()}`);
            },
          })
          .transform(new Response(bundled, { headers: { "Cache-Control": "no-store" } }));
      if (bundled) return new Response(bundled, { headers: { "Cache-Control": "no-store" } });
      const base = directory ?? resolve(root, "public");
      const filePath = resolve(base, `.${decodeURIComponent(name)}`);
      const rel = relative(base, filePath);
      if (rel.startsWith(`..${sep}`) || rel === "..")
        return new Response("Not found", { status: 404 });
      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Cache-Control": "no-store" } });
    },
  });
  const watchers = [];
  let timer;
  let building = false;
  let dirty = false;
  let stopped = false;
  async function rebuild() {
    if (building) {
      dirty = true;
      return;
    }
    building = true;
    try {
      files = await bundleWeb(root, true);
      buildError = undefined;
      revision++;
      console.log(`Web rebuilt (${revision})`);
    } catch (error) {
      buildError = String(error);
      console.error(error);
    } finally {
      building = false;
    }
    if (stopped) return;
    for (const stream of streams)
      stream.enqueue(`data: ${JSON.stringify({ revision: version(), error: buildError })}\n\n`);
    if (dirty) {
      dirty = false;
      await rebuild();
    }
  }
  function stop() {
    stopped = true;
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    for (const stream of streams) stream.close();
    streams.clear();
    return server.stop(true);
  }
  try {
    if (development) {
      files = await bundleWeb(root, true);
      for (const path of ["src", "public", "index.html"])
        watchers.push(
          watch(resolve(root, path), { recursive: true }, () => {
            clearTimeout(timer);
            timer = setTimeout(() => void rebuild(), 100);
          }),
        );
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return { url: server.url, stop };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const server = await serveWeb({
    root,
    directory: resolve(root, "dist"),
    port: 4173,
    hostname: "0.0.0.0",
    development: false,
    harbor: "ws://127.0.0.1:8787/multiplayer",
  });
  console.log(`Preview: ${server.url}`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void server.stop());
}
