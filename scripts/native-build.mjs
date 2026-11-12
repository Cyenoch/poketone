import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "acorn";
import { gameBuild } from "./game-build.ts";
import { buildNativePlatform } from "./native-platform-build.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const harbor = "wss://poketone.bingzi.dev/multiplayer";
const packageName = (specifier) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

async function packageDirectory(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpath(candidate);
    if (dirname(dir) === dir) return undefined;
  }
}

/** Keep each installed version and its dependency edges; never flatten conflicting versions. */
export async function copyDependencies(names, from, destination) {
  const packages = new Map();
  async function visit(name, importer, optional = false) {
    const source = await packageDirectory(name, importer);
    if (!source) {
      if (optional) return undefined;
      throw new Error(`Missing native production dependency ${name} imported from ${importer}`);
    }
    if (packages.has(source)) return packages.get(source).directory;
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    for (const [field, host] of [
      ["os", process.platform],
      ["cpu", process.arch],
    ]) {
      const allowed = manifest[field];
      if (
        allowed &&
        (allowed.includes(`!${host}`) ||
          (allowed.some((v) => !v.startsWith("!")) && !allowed.includes(host)))
      ) {
        if (optional) return undefined;
        throw new Error(`${name} does not support ${field}=${host}`);
      }
    }
    const directory = join(destination, ".packages", String(packages.size), "node_modules", name);
    const record = {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
      directory,
    };
    packages.set(source, record);
    await cp(source, directory, {
      recursive: true,
      dereference: true,
      filter: (path) =>
        path === source || !relative(source, path).split(sep).includes("node_modules"),
    });
    const dependencies = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const dependency of Object.keys(dependencies)) {
      const optionalDependency =
        dependency in (manifest.optionalDependencies ?? {}) ||
        manifest.peerDependenciesMeta?.[dependency]?.optional === true;
      const target = await visit(dependency, source, optionalDependency);
      if (target) await link(target, join(directory, "node_modules", dependency));
    }
    return directory;
  }
  async function link(target, path) {
    await mkdir(dirname(path), { recursive: true });
    await symlink(relative(dirname(path), target), path);
  }
  for (const name of names) await link(await visit(name, from), join(destination, name));
  return [...packages.values()].map(({ directory, ...record }) => ({
    ...record,
    directory: relative(destination, directory),
  }));
}

/** Bind only external imports to the shipped tree; the application itself stays inside Bun. */
export function relocateImports(source) {
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const names = new Set();
  const replacements = [];
  function visit(node) {
    if (node.type === "ImportDeclaration" || node.type === "ImportExpression") {
      const specifier = node.source.value;
      if (typeof specifier !== "string")
        throw new Error("Native application imports must use literal module specifiers");
      if (isBuiltin(specifier)) return;
      names.add(packageName(specifier));
      const expression = `import(Bun.resolveSync(${JSON.stringify(specifier)}, __nativeModules))`;
      const bindings =
        node.type === "ImportDeclaration"
          ? node.specifiers.map((binding) => {
              if (binding.type === "ImportNamespaceSpecifier")
                return `const ${binding.local.name} = await ${expression};`;
              const key =
                binding.type === "ImportDefaultSpecifier"
                  ? "default"
                  : (binding.imported.name ?? binding.imported.value);
              return `const { ${JSON.stringify(key)}: ${binding.local.name} } = await ${expression};`;
            })
          : undefined;
      replacements.push({
        start: node.start,
        end: node.end,
        text: bindings ? bindings.join("\n") || `await ${expression};` : expression,
      });
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child);
      } else if (value?.type) visit(value);
    }
  }
  visit(ast);
  for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start))
    source = source.slice(0, start) + text + source.slice(end);
  return {
    names: [...names].sort((a, b) => a.localeCompare(b)),
    source: `import { dirname as __nativeDirname, join as __nativeJoin } from "node:path";
const __nativeModules = __nativeJoin(__nativeDirname(process.execPath), "../Resources/runtime/");
${source}`,
  };
}

export async function validateFonts(publicPath) {
  const core = join(publicPath, "fonts/gpu/core");
  const manifest = JSON.parse(await readFile(join(core, "manifest.json"), "utf8"));
  const base = join(publicPath, "fonts/gpu/base", manifest.base);
  const baseManifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
  if (baseManifest.key !== manifest.base) throw new Error("Native base font manifest key mismatch");
  async function check(path, hash) {
    if (
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex") !== hash
    )
      throw new Error(`Native font digest mismatch: ${path}`);
  }
  for (const [directory, set] of [
    [core, manifest],
    [base, baseManifest],
  ]) {
    for (const font of Object.values(set).filter((value) => value?.json)) {
      await check(join(directory, font.json), font.sha256);
      const data = JSON.parse(await readFile(join(directory, font.json), "utf8"));
      for (const [index, page] of data.pages.entries())
        await check(join(directory, page), data.pageSha256[index]);
    }
  }
  return manifest.base;
}

async function command(args) {
  const child = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
  if ((await child.exited) !== 0) throw new Error(`Native packaging command failed: ${args[0]}`);
}

export async function buildNative(output) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Native packaging is verified only on macOS arm64; build on that host");
  if (Bun.version !== "1.4.4")
    throw new Error("Native package and bundled Bun notices require Bun 1.4.4");
  const app = resolve(output);
  if (!app.endsWith(".app")) throw new Error("Native output must end in .app");
  if (existsSync(app)) throw new Error(`Native output already exists: ${app}`);
  const staging = await mkdtemp(join(tmpdir(), "poketone-native-build-"));
  const contents = join(app, "Contents");
  const resources = join(contents, "Resources");
  try {
    const baseKey = await validateFonts(join(root, "public"));
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await cp(join(root, "public"), join(resources, "public"), {
      recursive: true,
      filter: (path) => {
        const part = relative(join(root, "public/fonts/gpu/base"), path);
        return part.startsWith("..") || part === "" || part.split(sep)[0] === baseKey;
      },
    });
    await validateFonts(join(resources, "public"));
    await buildNativePlatform(join(resources, "native"));
    const fingerprint = gameBuild(pathToFileURL(`${root}/`));
    const result = await Bun.build({
      entrypoints: [join(root, "src/platform/native/entry.ts")],
      target: "bun",
      packages: "external",
      define: {
        "import.meta.env.DEV": "false",
        "process.env.NODE_ENV": JSON.stringify("production"),
        __GAME_BUILD__: JSON.stringify(fingerprint),
        NATIVE_ASSETS: JSON.stringify(""),
        NATIVE_HARBOR: JSON.stringify(harbor),
        NATIVE_PLATFORM_LIBRARY: JSON.stringify("../Resources/native/libpoketone-platform.dylib"),
      },
    });
    if (!result.success) throw new AggregateError(result.logs, "Native application build failed");
    const relocated = relocateImports(await result.outputs[0].text());
    const entry = join(staging, "entry.mjs");
    await writeFile(entry, relocated.source);
    const runtime = join(resources, "runtime");
    const packages = await copyDependencies(relocated.names, root, join(runtime, "node_modules"));
    await writeFile(
      join(runtime, "package.json"),
      JSON.stringify({ private: true, type: "module" }),
    );
    await command([
      process.execPath,
      "build",
      "--compile",
      "--target=bun-darwin-arm64",
      "--no-compile-autoload-dotenv",
      "--no-compile-autoload-bunfig",
      "--no-compile-autoload-tsconfig",
      // External packages need their exports/main fields even in a compiled executable.
      "--compile-autoload-package-json",
      entry,
      "--outfile",
      join(contents, "MacOS/poketone"),
    ]);
    await cp(join(root, "scripts/native/licenses"), join(resources, "licenses"), {
      recursive: true,
    });
    // Retain the compiler input so Bun/JSC can be rebuilt and relinked independently.
    await cp(entry, join(resources, "runtime/application.mjs"));
    await writeFile(
      join(resources, "build.json"),
      JSON.stringify(
        {
          platform: process.platform,
          arch: process.arch,
          bun: Bun.version,
          gameBuild: fingerprint,
          harbor,
          baseFonts: baseKey,
          packages,
        },
        null,
        2,
      ) + "\n",
    );
    const iconset = join(staging, "Poketone.iconset");
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        if (size * scale > 512) continue;
        await command([
          "/usr/bin/sips",
          "-z",
          String(size * scale),
          String(size * scale),
          join(root, "public/icons/icon-512.png"),
          "--out",
          join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        ]);
      }
    }
    await command([
      "/usr/bin/iconutil",
      "-c",
      "icns",
      iconset,
      "-o",
      join(resources, "Poketone.icns"),
    ]);
    await writeFile(
      join(contents, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.bingzi.poketone</string>
<key>CFBundleName</key><string>Poketone</string>
<key>CFBundleExecutable</key><string>poketone</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>Poketone.icns</string>
<key>CFBundleShortVersionString</key><string>${JSON.parse(await readFile(join(root, "package.json"), "utf8")).version}</string>
<key>CFBundleVersion</key><string>1</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>\n`,
    );
    console.log(
      `Native app: ${app}\nGame build: ${fingerprint}\nProduction packages: ${packages.length}`,
    );
    return app;
  } catch (error) {
    await rm(app, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { output: { type: "string", default: "dist/native/Poketone.app" } },
  });
  await buildNative(values.output);
}
