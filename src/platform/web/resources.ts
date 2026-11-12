import { Texture } from "three";
import type { Resources } from "../resources";

export const webResources: Resources = {
  read: (url, options) => fetch(url, options),
  async decodeImage(blob, flipY) {
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: flipY ? "flipY" : "none",
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  },
  createTexture: () => new Texture(),
};
