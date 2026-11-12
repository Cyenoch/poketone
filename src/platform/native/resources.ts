import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { relative, isAbsolute } from "node:path";
import sharp from "sharp";
import { DataTexture, type Texture } from "three";
import type { Resources } from "../resources";

/** Files below the shipped public directory; query strings only version the asset cache. */
export function nativeResources(root: URL): Resources {
  const rootPath = fileURLToPath(root);
  return {
    async read(value, options) {
      options?.signal?.throwIfAborted();
      const url = value instanceof URL ? new URL(value) : new URL(value.replace(/^\//, ""), root);
      url.search = "";
      url.hash = "";
      const path = fileURLToPath(url);
      const inside = relative(rootPath, path);
      if (inside === ".." || inside.startsWith("../") || isAbsolute(inside)) {
        throw new Error(`Asset outside the public directory: ${value}`);
      }
      const bytes = await readFile(path, { signal: options?.signal });
      return new Response(bytes);
    },
    async decodeImage(blob, flipY) {
      const bytes = Buffer.from(await blob.arrayBuffer());
      let decoder = sharp(bytes).ensureAlpha();
      if (flipY) decoder = decoder.flip();
      const {
        data,
        info: { width, height },
      } = await decoder.raw().toBuffer({ resolveWithObject: true });
      // Typed arrays are reclaimed with their owner; no bitmap handle to close.
      return { source: { data, width, height }, width, height, release() {} };
    },
    createTexture() {
      const texture: Texture = new DataTexture();
      texture.source.data = null;
      return texture;
    },
  };
}
