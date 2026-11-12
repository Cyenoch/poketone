import { resolve } from "node:path";
import { startHarbor } from "../services/harbor/server.ts";
import { serveWeb } from "./web.mjs";

const root = resolve(import.meta.dir, "..");
let harbor;
let web;
async function stop() {
  await web?.stop();
  await harbor?.shutdown();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void stop().then(() => process.exit(0)));

try {
  harbor = startHarbor({
    port: 8787,
    hostname: "0.0.0.0",
    iceServers: JSON.parse(Bun.env.ICE_SERVERS ?? "[]"),
  });
  try {
    web = await serveWeb({
      root,
      port: 5173,
      hostname: "0.0.0.0",
      development: true,
      harbor: "ws://127.0.0.1:8787/multiplayer",
    });
  } catch (error) {
    throw new Error(
      "Web 开发服务启动失败（固定端口 5173）；若端口被占用，已有开发实例或其他服务正在运行。不会自动换端口。",
      { cause: error },
    );
  }
  console.log(
    "Web: http://localhost:5173\nHarbor: ws://localhost:8787/multiplayer\nCtrl+C 关闭两个服务。",
  );
} catch (error) {
  if (!harbor)
    console.error(
      "Harbor 启动失败（固定端口 8787）；请检查是否已有开发实例或 Harbor 服务。不会自动换端口。",
    );
  console.error(error);
  await stop();
  process.exitCode = 1;
}
