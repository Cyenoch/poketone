import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build the platform's real file sheets; the library is shipped beside native assets. */
export async function buildNativePlatform(outputDir) {
  if (process.platform !== "darwin")
    throw new Error("Native desktop packaging currently targets macOS.");
  await mkdir(outputDir, { recursive: true });
  const library = join(outputDir, "libpoketone-platform.dylib");
  const source = fileURLToPath(
    new URL("../src/platform/native/platform-dialogs.m", import.meta.url),
  );
  const child = Bun.spawn(
    [
      "xcrun",
      "clang",
      "-dynamiclib",
      "-fobjc-arc",
      "-fblocks",
      "-O2",
      "-mmacosx-version-min=13.0",
      "-framework",
      "AppKit",
      "-framework",
      "UniformTypeIdentifiers",
      source,
      "-o",
      library,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await child.exited) !== 0) throw new Error("Native file dialog library build failed.");
  return library;
}
