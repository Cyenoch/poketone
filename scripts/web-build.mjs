import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createStylexBunPlugin } from "@stylexjs/unplugin/bun";
import { gameBuild } from "./game-build.ts";

/** Public directories whose files the game fetches by plain path (src/prepare/asset-url.ts). */
const HASHED_DIRS = ["models", "art", "audio", "textures"];

/**
 * Plain asset path → its content-hashed copy (`/audio/sfx/hit.flac` → `/audio/sfx/hit.<hash>.flac`).
 * A release build ships both; the game requests only the hashed one, so changed content always
 * gets a new URL and no browser or CDN cache can serve a stale file under the code's name.
 */
export function assetUrls(root) {
  const urls = {};
  for (const dir of HASHED_DIRS) {
    const base = resolve(root, "public", dir);
    if (!existsSync(base)) continue;
    for (const file of readdirSync(base, { recursive: true, encoding: "utf8" })) {
      const path = resolve(base, file);
      if (!statSync(path).isFile() || file.endsWith(".provenance.json")) continue;
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
      const plain = `/${dir}/${file.replaceAll(sep, "/")}`;
      const dot = plain.lastIndexOf(".");
      urls[plain] = `${plain.slice(0, dot)}.${hash}${plain.slice(dot)}`;
    }
  }
  return urls;
}

/** Web and native use the same simulation fingerprint; release assets use content-hashed URLs. */
export async function bundleWeb(root, development) {
  // Dev serves public/ by name with no-store; only a release build has hashed copies.
  return bundle(root, development, development ? {} : assetUrls(root));
}

async function bundle(root, development, urls) {
  const temp = await mkdtemp(resolve(tmpdir(), "poketone-stylex-"));
  const cssOutput = resolve(temp, "stylex.css");
  let result;
  let css;
  try {
    result = await Bun.build({
      plugins: [
        createStylexBunPlugin({
          dev: development,
          runtimeInjection: false,
          useCSSLayers: true,
          bunDevCssOutput: cssOutput,
        }),
      ],
      entrypoints: [resolve(root, "src/main.tsx")],
      target: "browser",
      splitting: true,
      minify: !development,
      sourcemap: development ? "inline" : "none",
      naming: {
        entry: "assets/[name]-[hash].[ext]",
        chunk: "assets/[name]-[hash].[ext]",
        asset: "assets/[name]-[hash].[ext]",
      },
      define: {
        "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production"),
        "import.meta.env.DEV": String(development),
        "import.meta.env.BASE_URL": JSON.stringify("/"),
        __ASSET_URLS__: JSON.stringify(urls),
        __GAME_BUILD__: JSON.stringify(gameBuild(pathToFileURL(`${root}/`))),
      },
    });
    css = await Bun.file(cssOutput).text();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  const files = new Map(
    result.outputs.map((output) => [`/${output.path.replace(/^\.\//, "")}`, output]),
  );
  const cssPath = `/assets/stylex-${createHash("sha256").update(css).digest("hex").slice(0, 16)}.css`;
  files.set(cssPath, new Blob([css], { type: "text/css" }));
  const entry = result.outputs.find((output) => output.kind === "entry-point");
  if (!entry) throw new Error("Web build did not emit an entry point");
  const html = new HTMLRewriter()
    .on('script[src="/src/main.tsx"]', {
      element(element) {
        element.setAttribute("src", `/${entry.path.replace(/^\.\//, "")}`);
      },
    })
    .on("head", {
      element(element) {
        for (const path of [...files.keys()].filter((path) => path.endsWith(".css")))
          element.append(`<link rel="stylesheet" href="${path}">`, { html: true });
      },
    })
    .on("body", {
      element(element) {
        if (development)
          element.append('<script type="module" src="/__dev/client.js"></script>', { html: true });
      },
    })
    .transform(new Response(Bun.file(resolve(root, "index.html"))));
  files.set("/index.html", new Blob([await html.text()], { type: "text/html;charset=utf-8" }));
  return files;
}

export async function buildWeb(root, outdir) {
  const snapshot = await mkdtemp(resolve(tmpdir(), "poketone-public-"));
  const publicDir = resolve(snapshot, "public");
  try {
    // Dereference links so later exports cannot change the bytes behind this private snapshot.
    await cp(resolve(root, "public"), publicDir, { recursive: true, dereference: true });
    const urls = assetUrls(snapshot);
    const files = await bundle(root, false, urls);
    await rm(outdir, { recursive: true, force: true });
    await mkdir(outdir, { recursive: true });
    await cp(publicDir, outdir, { recursive: true });
    for (const [plain, hashed] of Object.entries(urls))
      await cp(resolve(publicDir, `.${plain}`), resolve(outdir, `.${hashed}`));
    for (const [path, file] of files) await Bun.write(resolve(outdir, `.${path}`), file);
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
  console.log(`Web build: ${outdir}`);
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  await buildWeb(root, resolve(root, "dist"));
}
