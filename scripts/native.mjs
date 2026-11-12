import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gameBuild } from "./game-build.ts";
import { buildNativePlatform } from "./native-platform-build.mjs";

const root = new URL("../", import.meta.url);
const outdir = fileURLToPath(new URL("node_modules/.cache/poketone/", root));
await mkdir(outdir, { recursive: true });
const platformLibrary = await buildNativePlatform(outdir);
const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/platform/native/entry.ts", root))],
  target: "bun",
  packages: "external",
  outdir,
  naming: "native.mjs",
  define: {
    "import.meta.env.DEV": "false",
    __GAME_BUILD__: JSON.stringify(gameBuild(root)),
    NATIVE_ASSETS: JSON.stringify(new URL("public/", root).href),
    NATIVE_HARBOR: JSON.stringify("ws://127.0.0.1:8787/multiplayer"),
    NATIVE_PLATFORM_LIBRARY: JSON.stringify(platformLibrary),
  },
  sourcemap: "linked",
});
if (!result.success) throw new AggregateError(result.logs, "Native build failed");
const child = Bun.spawn([process.execPath, `${outdir}/native.mjs`, ...process.argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const stop = () => child.kill("SIGTERM");
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.exitCode = await child.exited;
