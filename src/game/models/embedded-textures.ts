import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapLinearFilter,
  NearestMipmapNearestFilter,
  RepeatWrapping,
  type Texture,
} from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/addons/loaders/GLTFLoader.js";
import { resources, type DecodedImage } from "../../platform/resources";

const filters = {
  9728: NearestFilter,
  9729: LinearFilter,
  9984: NearestMipmapNearestFilter,
  9985: LinearMipmapNearestFilter,
  9986: NearestMipmapLinearFilter,
  9987: LinearMipmapLinearFilter,
} as const;
const wraps = {
  33071: ClampToEdgeWrapping,
  33648: MirroredRepeatWrapping,
  10497: RepeatWrapping,
} as const;

interface Images {
  images: { bufferView?: number; uri?: string; mimeType?: string; name?: string }[];
  textures: { source: number; sampler?: number; name?: string }[];
  samplers?: {
    magFilter?: 9728 | 9729;
    minFilter?: keyof typeof filters;
    wrapS?: keyof typeof wraps;
    wrapT?: keyof typeof wraps;
  }[];
}

/**
 * GLTFLoader's public texture plugin: embedded bytes use the host decoder, while glTF still owns
 * geometry, rigs, texture transforms and colour spaces. No HTML image, blob URL or global shim.
 */
export class EmbeddedTextures implements GLTFLoaderPlugin {
  readonly name = "PoketoneEmbeddedTextures";
  readonly #parser: GLTFParser;
  readonly #images = new Map<number, Promise<DecodedImage>>();
  readonly #textures = new Set<Texture>();

  constructor(parser: GLTFParser) {
    this.#parser = parser;
  }

  async loadTexture(index: number): Promise<Texture> {
    const json = this.#parser.json as Images;
    const definition = json.textures[index]!;
    const source = json.images[definition.source]!;
    let pending = this.#images.get(definition.source);
    if (!pending) {
      pending = (async () => {
        const blob =
          source.bufferView !== undefined
            ? new Blob([await this.#parser.getDependency("bufferView", source.bufferView)], {
                type: source.mimeType,
              })
            : await (await fetch(source.uri!)).blob();
        return resources().decodeImage(blob, false);
      })();
      this.#images.set(definition.source, pending);
    }
    const image = await pending;
    const texture = resources().createTexture();
    texture.image = image.source;
    texture.flipY = false;
    texture.name = definition.name ?? source.name ?? "";
    const sampler = json.samplers?.[definition.sampler ?? -1];
    texture.magFilter = sampler?.magFilter ? filters[sampler.magFilter] : LinearFilter;
    texture.minFilter = sampler?.minFilter ? filters[sampler.minFilter] : LinearMipmapLinearFilter;
    texture.wrapS = sampler?.wrapS ? wraps[sampler.wrapS] : RepeatWrapping;
    texture.wrapT = sampler?.wrapT ? wraps[sampler.wrapT] : RepeatWrapping;
    texture.generateMipmaps =
      texture.minFilter !== NearestFilter && texture.minFilter !== LinearFilter;
    texture.needsUpdate = true;
    this.#textures.add(texture);
    this.#parser.associations.set(texture, { textures: index });
    return texture;
  }

  /** Also handles parse failure while other images are still decoding. */
  async dispose(): Promise<void> {
    await Promise.allSettled(this.#images.values());
    for (const texture of this.#textures) texture.dispose();
    for (const image of this.#images.values()) {
      void image.then(
        (decoded) => decoded.release(),
        () => {},
      );
    }
    this.#textures.clear();
    this.#images.clear();
  }
}
