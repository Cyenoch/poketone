import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from "three";
import { fetchAsset } from "./fetch";
import { resources, type DecodedImage } from "../platform/resources";
import { allOf, Shared, type Handle, type Lane, type NetworkProgress } from "./handle";
import { createPreparation, type GpuContext, type Need } from "./preparation";

/**
 * The image store (readiness design §5.3): one Source per canonical URL, with the sampler, colour
 * and mip policy of its class. A consumer never owns the pixels: it asks for a view, a Texture of
 * its own that shares the Source (so the GPU copy is shared and uploaded once per context
 * generation) and that it disposes on unmount without releasing anything shared. The store's base
 * view keeps the Source's GPU texture alive while anyone holds the Source. Fetch and decode are C2
 * shared operations; the upload is a preparation need. MSDF font pages are `fonts.ts`'s own class.
 */

/** Sampler, colour and mip policy, fixed per class: every view of a Source samples alike, so all
 *  of them share one GPU texture (three keys it by Source and sampler). */
export const IMAGE_CLASSES = {
  /** Illustrations, portraits, cards, icons: drawn at any scale. */
  art: { wrap: ClampToEdgeWrapping, mipmaps: true },
  /** Tiled fills (the transition pattern). */
  pattern: { wrap: RepeatWrapping, mipmaps: true },
} as const;
export type ImageClass = keyof typeof IMAGE_CLASSES;

/** What the store needs from the application renderer (`AppRenderer`). */
export interface ImageGpu extends GpuContext {
  upload(texture: Texture): void;
  resident(resident: { release(): void; restore?(): void }): () => void;
}

/** Fetching and decoding one image (upright, straight alpha); `release` before it settles abandons it. */
export type ImageDecoder = (
  url: string,
  lane: Lane,
  progress: (network: NetworkProgress) => void,
) => { readonly result: Promise<DecodedImage>; setLane(lane: Lane): void; release(): void };

export interface ImageEntry {
  readonly key: string;
  readonly url: string;
  readonly kind: ImageClass;
  /** The store's own view: initialized once per generation, disposed only with the Source. */
  readonly base: Texture;
  readonly source: Texture["source"];
  state: "fetching" | "decoded" | "failed";
  uploadedIn: number | null;
}

export interface ImageHandle extends Handle<ImageEntry> {
  /** A Texture of the caller's own over the shared Source; call after `result` settles. Disposing
   *  it releases nothing shared. */
  view(): Texture;
}

export interface ImageStore {
  /** Holds `url`'s Source (fetched and decoded) while the handle lives. */
  acquire(url: string, kind: ImageClass, lane?: Lane): ImageHandle;
  /** A preparation need: the Source decoded, then its base view uploaded in the current generation. */
  need(url: string, kind?: ImageClass): Need<ImageEntry>;
  /** Several images as one handle (a surface's set). */
  acquireAll(urls: readonly string[], kind: ImageClass, lane?: Lane): Handle<void>;
  /**
   * An application-lifetime image as a Texture right away (the caller builds its material now):
   * the view binds once the Source is decoded, and `onLoad` then asks for a redraw. The Source is
   * held for the page's lifetime (shared art: portraits, crests, backdrops); dispose the view.
   */
  texture(url: string, kind: ImageClass, onLoad: () => void): Texture;
  /** Settles once every Source asked for so far is decoded and uploaded in the current context
   *  generation: the surface hold for images (rejects with the first failed image). */
  uploaded(): Promise<void>;
  /** Whether `uploaded()` would wait for nothing now. */
  allUploaded(): boolean;
  readonly entries: ReadonlyMap<string, ImageEntry>;
}

/** The default decoder: shared fetch, off-thread decode to an upright bitmap. */
export const decodeImage: ImageDecoder = (url, lane, progress) => {
  const download = fetchAsset(url, { lane });
  const unwatch = download.watch(() => {
    if (download.network) progress(download.network);
  });
  const result = download.result.then((blob) =>
    // Upright in memory, so the texture does not flip it again (design [A21]); straight alpha and
    // the browser's colour handling, as an <img> upload had.
    resources()
      .decodeImage(blob, true)
      .catch((cause: unknown) => {
        throw new Error(`图片无法解码：${url}`, { cause });
      }),
  );
  // Settled either way, the download is let go; the cleanup's own promise never rejects.
  const done = () => {
    unwatch();
    download.release();
  };
  result.then(done, done);
  return { result, setLane: (next) => download.setLane(next), release: () => download.release() };
};

/** One Source per canonical URL (path and query: a query names other content) and class. */
const keyOf = (url: string, kind: ImageClass) => {
  const { pathname, search } = new URL(url, "http://local/");
  return `${kind}:${pathname}${search}`;
};

/** Applies `kind`'s sampler, colour and mip policy. */
function configure(texture: Texture, kind: ImageClass): Texture {
  const policy = IMAGE_CLASSES[kind];
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = texture.wrapT = policy.wrap;
  texture.generateMipmaps = policy.mipmaps;
  texture.minFilter = policy.mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

/** A Texture over `entry`'s Source with its class's sampler. No `needsUpdate`: that would bump the
 *  Source's version and upload it again; the view's own version only marks it ready to bind. */
function viewOf(entry: ImageEntry): Texture {
  const texture = configure(resources().createTexture(), entry.kind);
  texture.source = entry.source;
  texture.version = 1;
  return texture;
}

export function createImageStore(gpu: ImageGpu, decode: ImageDecoder = decodeImage): ImageStore {
  const entries = new Map<string, ImageEntry>();
  const shared = new Map<string, Shared<ImageEntry>>();
  const decodings = new Map<string, ReturnType<ImageDecoder>>();
  const images = new Map<string, DecodedImage>();
  /** Views made before their Source decoded, bound (and their owner told) when it is. */
  const waiting = new Map<string, { view: Texture; onLoad: () => void }[]>();
  /** `texture()`'s page-lifetime holds: always on the key's current operation (a retry takes it). */
  const kept = new Map<string, Handle<ImageEntry>>();

  const upload = (entry: ImageEntry) => {
    const generation = gpu.generation;
    if (entry.uploadedIn === generation || entry.state !== "decoded" || !gpu.available) return;
    gpu.upload(entry.base);
    entry.uploadedIn = generation;
  };

  /** The last holder went: an unfinished decode stops; a finished Source is freed (GPU copy and
   *  bitmap). Views a consumer still has must have been disposed with it. */
  const idle = (entry: ImageEntry, operation: Shared<ImageEntry>) => {
    if (shared.get(entry.key) !== operation) return;
    shared.delete(entry.key);
    entries.delete(entry.key);
    decodings.get(entry.key)?.release();
    decodings.delete(entry.key);
    entry.base.dispose();
    const image = images.get(entry.key);
    image?.release();
    images.delete(entry.key);
  };

  gpu.resident({
    release() {
      for (const entry of entries.values()) {
        if (entry.uploadedIn === null) continue;
        // The GPU copy only: the bitmap stays, so the restore uploads it again.
        entry.base.dispose();
        entry.uploadedIn = null;
      }
    },
    restore() {
      for (const entry of entries.values())
        if (entry.state === "decoded") gpu.enqueue(async () => upload(entry));
    },
  });

  const holdOf = (url: string, kind: ImageClass, lane: Lane): Handle<ImageEntry> => {
    const key = keyOf(url, kind);
    let operation = shared.get(key);
    if (!operation || operation.state === "failed") {
      // A retry keeps the failed attempt's entry and Source: views made meanwhile (and waiting
      // to bind) are views of it, so the retry's pixels reach them.
      const retried = operation ? entries.get(key) : undefined;
      const base = retried?.base ?? configure(resources().createTexture(), kind);
      const entry: ImageEntry = retried ?? {
        key,
        url,
        kind,
        base,
        source: base.source,
        state: "fetching",
        uploadedIn: null,
      };
      entry.state = "fetching";
      const created = new Shared<ImageEntry>(
        key,
        {
          empty: () => idle(entry, created),
          // The waiters' highest lane reaches the download (a `keep` hold raised later starts it).
          lane: (next) => decodings.get(key)?.setLane(next),
        },
        { bytesTotal: null },
      );
      operation = created;
      shared.set(key, created);
      entries.set(key, entry);
      const decoding = decode(url, lane, (network) => created.progress(network));
      decodings.set(key, decoding);
      // A page-lifetime hold on the failed attempt moves to this one, whoever started the retry:
      // otherwise the retry's only holder could be a preparation that lets it go when it settles.
      const keptHold = kept.get(key);
      if (keptHold) {
        kept.set(key, created.acquire("interactive"));
        keptHold.release();
      }
      decoding.result.then(
        (image) => {
          if (shared.get(key) !== created) {
            image.release();
            return;
          }
          decodings.delete(key);
          images.set(key, image);
          entry.source.data = image.source;
          // The base view's first version: its upload is the Source's one upload per generation.
          base.needsUpdate = true;
          entry.state = "decoded";
          created.resolve(entry);
          for (const { view, onLoad } of waiting.get(key) ?? []) {
            view.version = 1;
            onLoad();
          }
          waiting.delete(key);
        },
        (cause: unknown) => {
          if (shared.get(key) !== created) return;
          decodings.delete(key);
          entry.state = "failed";
          created.reject(cause);
        },
      );
    }
    return operation.acquire(lane);
  };

  return {
    entries,
    acquire(url, kind, lane = "interactive") {
      const handle = holdOf(url, kind, lane);
      const entry = entries.get(keyOf(url, kind))!;
      return {
        ...handle,
        get network() {
          return handle.network;
        },
        view() {
          if (entry.state !== "decoded") throw new Error(`图片尚未载入：${url}`);
          return viewOf(entry);
        },
      };
    },
    need(url, kind = "art") {
      return {
        key: keyOf(url, kind),
        acquire: (lane) => holdOf(url, kind, lane),
        gpu: (entry) => upload(entry),
      };
    },
    acquireAll(urls, kind, lane = "interactive") {
      return allOf(
        `${kind}:${urls.length} images`,
        urls.map((url) => holdOf(url, kind, lane)),
      );
    },
    texture(url, kind, onLoad) {
      const key = keyOf(url, kind);
      if (!kept.has(key)) kept.set(key, holdOf(url, kind, "interactive"));
      // A failed key retries here; `holdOf` moves the kept hold onto the retry.
      else if (entries.get(key)?.state === "failed") holdOf(url, kind, "interactive").release();
      const entry = entries.get(key)!;
      if (entry.state === "decoded") {
        queueMicrotask(onLoad);
        return viewOf(entry);
      }
      // Not bindable yet (version 0): the decode binds it and tells its owner.
      const view = viewOf(entry);
      view.version = 0;
      waiting.set(key, [...(waiting.get(key) ?? []), { view, onLoad }]);
      return view;
    },
    allUploaded() {
      if (!gpu.available) return false;
      for (const entry of entries.values())
        if (entry.state !== "decoded" || entry.uploadedIn !== gpu.generation) return false;
      return true;
    },
    async uploaded() {
      const pending = [...entries.values()].filter(
        (entry) => entry.state !== "decoded" || entry.uploadedIn !== gpu.generation,
      );
      if (pending.length === 0 && gpu.available) return;
      const preparation = createPreparation({
        revision: 0,
        lane: "critical",
        needs: pending.map((entry) => this.need(entry.url, entry.kind)),
        context: gpu,
      });
      const outcome = await preparation.settled;
      const error = preparation.error;
      preparation.cancel();
      if (outcome !== "ready")
        throw error?.cause instanceof Error
          ? error.cause
          : new Error(`图片载入失败：${error?.key}`);
    },
  };
}

/** The application's one image store, bound to its renderer once (`bindImages`). */
let current: ImageStore | null = null;

export function bindImages(gpu: ImageGpu): ImageStore {
  current ??= createImageStore(gpu);
  return current;
}

export function images(): ImageStore {
  if (!current) throw new Error("图片仓库尚未绑定渲染器（bindImages）");
  return current;
}
