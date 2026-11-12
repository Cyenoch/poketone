import { fileURLToPath } from "node:url";
import { gameBuild } from "./game-build.ts";
import { buildNativePlatform } from "./native-platform-build.mjs";
const root = new URL("../", import.meta.url);
const outdir = fileURLToPath(new URL("node_modules/.cache/poketone/", root));
const platformLibrary = await buildNativePlatform(outdir);
const built = await Bun.build({
  entrypoints: [fileURLToPath(new URL("scripts/native-smoke.ts", root))],
  target: "bun",
  packages: "external",
  outdir,
  naming: "smoke.mjs",
  sourcemap: "linked",
  define: {
    "import.meta.env.DEV": "false",
    __GAME_BUILD__: JSON.stringify(gameBuild(root)),
    NATIVE_ASSETS: JSON.stringify(new URL("public/", root).href),
    NATIVE_PLATFORM_LIBRARY: JSON.stringify(platformLibrary),
  },
});
if (!built.success) throw new AggregateError(built.logs, "Native smoke build failed");
process.exitCode = await Bun.spawn([process.execPath, `${outdir}/smoke.mjs`], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
}).exited;
