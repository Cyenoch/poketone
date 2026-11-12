import type { Texture } from "three";

/** Decoded CPU storage. Its lifetime is separate from the texture's GPU upload. */
export interface DecodedImage {
  readonly source: ImageBitmap | { data: Uint8Array; width: number; height: number };
  readonly width: number;
  readonly height: number;
  release(): void;
}

/** Installed by the entry point, before any asset is requested. */
export interface Resources {
  read(
    url: string | URL,
    options?: { signal?: AbortSignal; cache?: RequestCache },
  ): Promise<Response>;
  decodeImage(blob: Blob, flipY: boolean): Promise<DecodedImage>;
  createTexture(): Texture;
}

let installed: Resources;

export function installResources(resources: Resources): void {
  installed = resources;
}

export function resources(): Resources {
  if (!installed) throw new Error("Asset resources have not been installed by the host.");
  return installed;
}
