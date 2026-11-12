import { Text, type FontFamilies, type FontInfoSource } from "@pmndrs/uikit";
import { loadCachedFont } from "@pmndrs/uikit/dist/text/cache.js";
import type { Font } from "@pmndrs/uikit/dist/text/font.js";
import { LinearFilter, Texture, type Object3D } from "three";
import { fetchAsset } from "../../prepare/fetch";
import { Shared, type Handle, type Lane, type NetworkProgress } from "../../prepare/handle";
import { createPreparation, type GpuContext, type Need } from "../../prepare/preparation";
import { sha256 } from "./sha256";
import { resources, type DecodedImage } from "../../platform/resources";

type FontInfo = Exclude<FontInfoSource, string | (() => unknown)>;
/**
 * Names each character this font lacks, once, with its code point and the font. The glyph itself
 * is still uikit's solid box (MISSING_GLYPH): a diagnostic, never a reason to stop the UI.
 */
export function logMissingGlyphs(
  font: Pick<Font, "getGlyphInfo">,
  name: string,
  log: (message: string) => void,
): void {
  const lookup = font.getGlyphInfo.bind(font);
  const reported = new Set<string>();
  font.getGlyphInfo = (char) => {
    const glyph = lookup(char);
    // uikit's MISSING_GLYPH is the only glyph without a code point (id -1).
    if (glyph.id === -1 && !reported.has(char)) {
      reported.add(char);
      const code = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      // Only characters the atlases have: this text is source text too (the coverage scan).
      log(`UI 字体缺字「${char}」U+${code}（${name}）`);
    }
    return glyph;
  };
}

/**
 * Paged font sets (docs/fonts-paging-design.md): `fonts/gpu/core/` (committed game text) and
 * `fonts/gpu/base/<key>/` (generated name charset; the core manifest pins the key). Each font's
 * metrics json names its pages; every file is verified against the SHA-256 that names it (the
 * manifest holds each json's, the json its pages'). The paged loader is wired once uikit draws
 * multi-page fonts; these functions are its contract and are tested in node.
 */
export interface PagedEntry {
  json: string;
  sha256: string;
  weight: number;
  glyphs: number;
  pages: number;
}
/** [code point, page, x, y, width, height, xoffset, yoffset, xadvance], in the 48px atlas units. */
export type GlyphRow = [number, number, number, number, number, number, number, number, number];
export interface PagedFont {
  name: string;
  weight: number;
  size: number;
  distanceRange: number;
  lineHeight: number;
  base: number;
  pages: string[];
  pageSha256: string[];
  pageSizes: [number, number][];
  glyphs: GlyphRow[];
}

/** Hex SHA-256 of fetched bytes (Web Crypto: browsers and node). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  // `crypto.subtle` exists only in secure contexts; the game is also served over plain HTTP.
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    : sha256(new Uint8Array(bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const mismatch = (detail: string, file: string) =>
  new Error(`UI 字体图集与清单不一致（${detail}）：${file}`);

/** A json from another build, or one whose glyphs point outside its pages, is refused. */
export function checkPagedFont(
  name: string,
  entry: PagedEntry,
  font: PagedFont,
  jsonSha256: string,
): void {
  if (jsonSha256 !== entry.sha256)
    throw mismatch(
      `${name}：清单 ${entry.sha256.slice(0, 16)}，文件 ${jsonSha256.slice(0, 16)}`,
      entry.json,
    );
  const pageCount = font.pages.length;
  const outside = font.glyphs.find(([, page]) => page < 0 || page >= pageCount);
  if (
    font.glyphs.length !== entry.glyphs ||
    pageCount !== entry.pages ||
    font.pageSizes.length !== pageCount ||
    font.pageSha256.length !== pageCount ||
    outside
  )
    throw mismatch(
      `${name}：清单 ${entry.glyphs} 字 / ${entry.pages} 页，图集 ${font.glyphs.length} 字 / ${pageCount} 页` +
        (outside ? `，U+${outside[0].toString(16).toUpperCase()} 在第 ${outside[1]} 页` : ""),
      entry.json,
    );
}

/** A page must be the bytes its json names, decoded to the size its glyph boxes were packed for. */
export function checkPage(
  name: string,
  font: PagedFont,
  page: number,
  sha256: string,
  width: number,
  height: number,
): void {
  const [expectedWidth, expectedHeight] = font.pageSizes[page]!;
  if (sha256 !== font.pageSha256[page])
    throw mismatch(`${name} 第 ${page} 页内容与图集记录不符`, font.pages[page]!);
  if (width !== expectedWidth || height !== expectedHeight)
    throw mismatch(
      `${name} 第 ${page} 页 ${width}×${height}，图集 ${expectedWidth}×${expectedHeight}`,
      font.pages[page]!,
    );
}

export interface MergedFont {
  /** Core pages first, then base pages; a glyph's page indexes this list. */
  pages: { file: string; set: "core" | "base"; size: [number, number] }[];
  glyphs: Map<number, GlyphRow>;
  corePages: number;
}

/**
 * One glyph table per weight. Core wins: a character the game itself writes (ASCII, digits, menu
 * text, the damage-number words) always draws from a core page, never from a base page that also
 * has it; base glyphs are only the name charset's remainder, their page indices moved past core's.
 */
export function mergeFonts(core: PagedFont, base: PagedFont): MergedFont {
  if (core.size !== base.size || core.lineHeight !== base.lineHeight || core.base !== base.base)
    throw new Error(`UI 字体基础字集与游戏字集的度量不一致：${core.name}`);
  const corePages = core.pages.length;
  const pages = [
    ...core.pages.map((file, i) => ({ file, set: "core" as const, size: core.pageSizes[i]! })),
    ...base.pages.map((file, i) => ({ file, set: "base" as const, size: base.pageSizes[i]! })),
  ];
  const glyphs = new Map<number, GlyphRow>();
  for (const row of core.glyphs) glyphs.set(row[0], row);
  for (const row of base.glyphs)
    if (!glyphs.has(row[0]))
      glyphs.set(row[0], [row[0], row[1] + corePages, ...row.slice(2)] as GlyphRow);
  for (const [code] of core.glyphs)
    if (glyphs.get(code)![1] >= corePages)
      throw new Error(
        `UI 字体图集与清单不一致：U+${code.toString(16).toUpperCase()} 不在游戏字集页`,
      );
  return { pages, glyphs, corePages };
}

/**
 * The characters of `text` no font set draws, in order of first appearance. Input or import
 * boundaries reject text that has any (naming them as U+XXXX: the UI cannot draw them) and keep
 * the original string; nothing is stripped, transliterated or drawn as a box.
 */
export function unsupportedIn(text: string, drawable: ReadonlySet<number>): string[] {
  const missing = new Set<string>();
  for (const char of text)
    // uikit draws a line break with the space glyph; every other character needs its own.
    if (char !== "\n" && !drawable.has(char.codePointAt(0)!)) missing.add(char);
  return [...missing];
}

// ── Revision gate ────────────────────────────────────────────────────────────────────────────────

/** Pages acquired for one revision: `result` settles once every page is decoded and uploaded in the
 *  current context generation (rejects on a failed page); `release` drops the hold. */
export interface PageAcquisition {
  readonly result: Promise<void>;
  release(): void;
}

export interface PageSource {
  /** Every page decoded and uploaded in the current generation, with the context available. */
  resident(keys: readonly string[]): boolean;
  acquire(keys: readonly string[]): PageAcquisition;
}

/**
 * Commits a value (a surface's reveal, a label's text) only once every page it draws from is
 * resident, and only the latest one (readiness design §6a): an older revision's pages arriving can
 * never commit it, so a label changing A → A+B never shows A's part while B is still on its way.
 * Until then the previous commit stays. A committed value keeps its pages held until the next
 * commit or `dispose`.
 */
export class RevisionGate<T> {
  readonly #source: PageSource;
  readonly #commit: (value: T) => void;
  readonly #failed: (value: T, error: Error) => void;
  #latest = 0;
  #pending: PageAcquisition | null = null;
  #held: PageAcquisition | null = null;
  #disposed = false;

  /** `failed` hears the latest revision whose pages could not load (the source reports the
   *  error too); the previous commit stays. */
  constructor(
    source: PageSource,
    commit: (value: T) => void,
    failed: (value: T, error: Error) => void = () => {},
  ) {
    this.#source = source;
    this.#commit = commit;
    this.#failed = failed;
  }

  set(value: T, keys: readonly string[]): void {
    if (this.#disposed) return;
    const revision = ++this.#latest;
    // Acquire before releasing the superseded hold, so pages both revisions draw stay loading.
    const acquisition = this.#source.acquire(keys);
    this.#pending?.release();
    this.#pending = acquisition;
    const commit = () => {
      if (this.#disposed || revision !== this.#latest || this.#pending !== acquisition) return;
      this.#pending = null;
      this.#held?.release();
      this.#held = acquisition;
      this.#commit(value);
    };
    if (this.#source.resident(keys)) commit();
    else
      acquisition.result.then(commit, (cause: unknown) => {
        if (this.#disposed || revision !== this.#latest || this.#pending !== acquisition) return;
        this.#pending = null;
        acquisition.release();
        this.#failed(value, cause instanceof Error ? cause : new Error(String(cause)));
      });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pending?.release();
    this.#held?.release();
    this.#pending = this.#held = null;
  }
}

// ── Page registry ────────────────────────────────────────────────────────────────────────────────

/** What the registry needs from the application renderer (`AppRenderer`). */
export interface FontGpu extends GpuContext {
  /** Uploads a texture now (three's `initTexture`). */
  upload(texture: Texture): void;
  /** Registers release-on-loss / restore hooks; returns the unregister. */
  resident(resident: { release(): void; restore?(): void }): () => void;
}

/** One page of one font: a stable texture whose image comes and goes with residency. */
export interface PageRecord {
  readonly key: string;
  readonly font: string;
  readonly index: number;
  readonly url: string;
  readonly sha256: string;
  readonly size: readonly [number, number];
  readonly bytes: number;
  readonly set: "core" | "base";
  readonly texture: Texture;
  state: "absent" | "fetching" | "decoded" | "failed";
  /** The context generation its upload belongs to. */
  uploadedIn: number | null;
  lastUsed: number;
}

/** Fetching and decoding one page (bytes checked against the json's digest, size against its
 *  box); `progress` reports network bytes. `release` before it settles abandons it. */
export type PageDecoder = (
  page: PageRecord,
  lane: Lane,
  progress: (network: NetworkProgress) => void,
) => { readonly result: Promise<DecodedImage>; setLane(lane: Lane): void; release(): void };

/** Base pages kept decoded with no holder (≈ 1 MB of VRAM each, 512²) before the oldest goes. */
export const BASE_PAGES_KEPT = 64;

/**
 * Every page of every font (readiness design §6a): one entry per page, one owner of its upload.
 * Chrome and content pages are app-resident; base pages are on demand and the least recently used
 * of those nobody holds go past {@link BASE_PAGES_KEPT}. On context loss every upload is released
 * (images kept); on restore every decoded page is uploaded again.
 */
export class PageRegistry implements PageSource {
  readonly pages = new Map<string, PageRecord>();
  readonly #gpu: FontGpu;
  readonly #decode: PageDecoder;
  readonly #setImage: (page: PageRecord, image: DecodedImage["source"] | null) => void;
  readonly #report: (error: Error) => void;
  readonly #decodes = new Map<string, Shared<PageRecord>>();
  readonly #decoding = new Map<string, ReturnType<PageDecoder>>();
  readonly #images = new Map<string, DecodedImage>();
  /** `hold`'s own handles (app-resident pages), released only by `dispose`. */
  readonly #held: Handle<PageRecord>[] = [];
  readonly #unregister: () => void;
  #clock = 0;

  constructor(options: {
    gpu: FontGpu;
    decode: PageDecoder;
    setImage: (page: PageRecord, image: DecodedImage["source"] | null) => void;
    report: (error: Error) => void;
  }) {
    this.#gpu = options.gpu;
    this.#decode = options.decode;
    this.#setImage = options.setImage;
    this.#report = options.report;
    this.#unregister = options.gpu.resident({
      release: () => this.#releaseUploads(),
      restore: () => this.#reupload(),
    });
  }

  /** A set that failed or went: no more restores, and its app-resident pages are let go. */
  dispose(): void {
    this.#unregister();
    for (const handle of this.#held.splice(0)) handle.release();
  }

  add(page: PageRecord): void {
    this.pages.set(page.key, page);
  }

  resident(keys: readonly string[]): boolean {
    const { available, generation } = this.#gpu;
    return (
      available &&
      keys.every((key) => {
        const page = this.pages.get(key);
        return page?.state === "decoded" && page.uploadedIn === generation;
      })
    );
  }

  /** Holds `keys` decoded (CPU only): app-resident pages are fetched ahead of any surface. */
  hold(keys: readonly string[], lane: Lane): void {
    for (const key of keys) this.#held.push(this.#decoded(key, lane));
  }

  acquire(keys: readonly string[], lane: Lane = "critical"): PageAcquisition {
    const needs: Need<PageRecord>[] = keys.map((key) => ({
      key,
      acquire: (needLane) => this.#decoded(key, needLane),
      gpu: (page) => this.#upload(page),
    }));
    const preparation = createPreparation({ revision: 0, lane, needs, context: this.#gpu });
    const result = preparation.settled.then((outcome) => {
      if (outcome === "ready") return;
      const error = preparation.error;
      const failure =
        error?.cause instanceof Error ? error.cause : new Error(`UI 字体页载入失败：${error?.key}`);
      if (outcome === "failed") this.#report(failure);
      throw failure;
    });
    result.catch(() => {});
    return { result, release: () => preparation.cancel() };
  }

  #decoded(key: string, lane: Lane): Handle<PageRecord> {
    const page = this.pages.get(key);
    if (!page) throw new Error(`UI 字体没有这一页：${key}`);
    page.lastUsed = ++this.#clock;
    let shared = this.#decodes.get(key);
    if (!shared || shared.state === "failed") {
      const created = new Shared<PageRecord>(
        key,
        {
          empty: () => this.#idle(page, created),
          // The waiters' highest lane reaches the download (a `keep` hold raised later starts it).
          lane: (next) => this.#decoding.get(key)?.setLane(next),
        },
        { bytesTotal: page.bytes },
      );
      shared = created;
      this.#decodes.set(key, created);
      page.state = "fetching";
      const decode = this.#decode(page, lane, (network) => created.progress(network));
      this.#decoding.set(key, decode);
      decode.result.then(
        (image) => {
          if (this.#decodes.get(key) !== created) {
            // Its last holder left before it finished: nobody will use or close it.
            image.release();
            return;
          }
          this.#decoding.delete(key);
          this.#images.set(key, image);
          this.#setImage(page, image.source);
          page.state = "decoded";
          created.resolve(page);
        },
        (cause: unknown) => {
          if (this.#decodes.get(key) !== created) return;
          this.#decoding.delete(key);
          page.state = "failed";
          created.reject(cause);
        },
      );
    }
    return shared.acquire(lane);
  }

  #upload(page: PageRecord): void {
    const generation = this.#gpu.generation;
    if (page.uploadedIn === generation || page.state !== "decoded") return;
    this.#gpu.upload(page.texture);
    page.uploadedIn = generation;
  }

  /** Nobody holds `page`: an unfinished decode stops; a base page may go when too many are kept. */
  #idle(page: PageRecord, shared: Shared<PageRecord>): void {
    if (shared.state === "pending") {
      this.#decoding.get(page.key)?.release();
      this.#decoding.delete(page.key);
      this.#decodes.delete(page.key);
      page.state = "absent";
      return;
    }
    if (page.set !== "base") return;
    const idle = [...this.pages.values()].filter(
      (other) =>
        other.set === "base" &&
        other.state === "decoded" &&
        (this.#decodes.get(other.key)?.holders ?? 0) === 0,
    );
    idle.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const evicted of idle.slice(0, Math.max(0, idle.length - BASE_PAGES_KEPT))) {
      this.#setImage(evicted, null);
      const image = this.#images.get(evicted.key);
      image?.release();
      this.#images.delete(evicted.key);
      this.#decodes.delete(evicted.key);
      evicted.state = "absent";
      evicted.uploadedIn = null;
    }
  }

  #releaseUploads(): void {
    for (const page of this.pages.values()) {
      if (page.uploadedIn === null) continue;
      // The GPU copy only: the image stays, so the restore uploads it again.
      page.texture.dispose();
      page.uploadedIn = null;
    }
  }

  #reupload(): void {
    for (const page of this.pages.values())
      if (page.state === "decoded")
        this.#gpu.enqueue(async () => {
          if (this.#gpu.available) this.#upload(page);
        });
  }
}

// ── Paged loader ─────────────────────────────────────────────────────────────────────────────────

const PAGED_FONTS = ["ui-500", "ui-700", "ui-800", "display"] as const;
type PagedName = (typeof PAGED_FONTS)[number];
const WEIGHTS: Record<string, PagedName> = { "500": "ui-500", "700": "ui-700", "800": "ui-800" };
const NAMED_WEIGHTS: Record<string, number> = {
  thin: 100,
  "extra-light": 200,
  light: 300,
  normal: 400,
  medium: 500,
  "semi-bold": 600,
  bold: 700,
  "extra-bold": 800,
  black: 900,
  "extra-black": 950,
};

/** The font a Text draws with, resolved as uikit resolves it (exact weight, else the nearest in
 *  500 / 700 / 800 order). */
export function fontOf(family: unknown, weight: unknown): PagedName {
  if (family === "Poketone Display") return "display";
  const value =
    typeof weight === "number" ? weight : (NAMED_WEIGHTS[String(weight)] ?? Number(weight));
  let best: PagedName = "ui-500",
    distance = Infinity;
  for (const [key, name] of Object.entries(WEIGHTS)) {
    const d = Math.abs(value - Number(key));
    if (d === 0) return name;
    if (d < distance) [best, distance] = [name, d];
  }
  return best;
}

/** A Text's current string (uikit accepts strings, numbers, arrays and signals). */
function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (typeof value === "object" && "value" in value) return textOf(value.value);
  return String(value as string | number);
}

interface PagedManifestEntry extends PagedEntry {
  jsonBytes: number;
  pageBytes: number[];
}
/** A set's manifest: its fonts, plus `base` (core: the pinned base key) or `key` (base). */
type PagedManifest = Record<string, PagedManifestEntry | undefined> & {
  base?: string;
  key?: string;
};

export interface UiFonts {
  readonly families: FontFamilies;
  /** Settles once metrics for every font are in (pagesFor and pagesOf need them). */
  readonly metrics: Promise<void>;
  pagesFor(text: string, font: PagedName): Set<string>;
  pagesOf(stage: { root: Object3D }): Set<string>;
  /**
   * The surface hold: resolves when every page `stage`'s text draws from is decoded and uploaded
   * in the current context generation (`first`: only those; otherwise every core page too, which
   * any surface after the first screen may draw). Only the stage's latest call commits.
   */
  ready(stage: { root: Object3D }, first?: boolean): Promise<void>;
  /** Whether `ready(stage, first)` would hold nothing now (metrics in, every page resident). */
  readyNow(stage: { root: Object3D }, first?: boolean): boolean;
  /** Drops `stage`'s hold (its pages may then go, if they are base pages); its waiting `ready`
   *  calls reject with an AbortError. */
  release(stage: { root: Object3D }): void;
  /** Fetches and decodes every core page ahead of the surfaces that will draw them. */
  prefetch(): void;
  /** Stops the set (it failed or went): no more restores, its held pages let go. */
  dispose(): void;
  readonly registry: PageRegistry;
}

async function verifiedJson<T>(url: URL, sha256: string | null): Promise<T> {
  const response = await resources().read(url, sha256 ? {} : { cache: "no-cache" });
  if (!response.ok) throw new Error(`UI 字体载入失败：${url} (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (sha256 && (await sha256Hex(bytes)) !== sha256) throw mismatch("内容与清单记录不符", url.href);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** uikit's font description for one merged table: stable page textures, normalised glyph rows. */
function fontInfo(
  name: string,
  font: PagedFont,
  merged: MergedFont,
  textures: Texture[],
): FontInfo & { pageTextures: Texture[]; pageSizes: [number, number][] } {
  const chars = [...merged.glyphs.values()].map(
    ([id, page, x, y, width, height, xoffset, yoffset, xadvance], index) => ({
      id,
      index,
      char: String.fromCodePoint(id),
      x,
      y,
      width,
      height,
      xoffset,
      yoffset,
      xadvance,
      page,
      chnl: 15,
    }),
  );
  const [scaleW, scaleH] = merged.pages[0]!.size;
  return {
    pages: [],
    pageTextures: textures,
    pageSizes: merged.pages.map((page) => [...page.size] as [number, number]),
    chars,
    info: {
      face: name,
      size: font.size,
      bold: Number(font.weight >= 700),
      italic: 0,
      charset: [],
      unicode: 1,
      stretchH: 100,
      smooth: 1,
      aa: 1,
      padding: [2, 2, 2, 2],
      spacing: [0, 0],
      outline: 0,
    },
    common: {
      lineHeight: font.lineHeight,
      base: font.base,
      scaleW,
      scaleH,
      pages: merged.pages.length,
      packed: 0,
      alphaChnl: 0,
      redChnl: 0,
      greenChnl: 0,
      blueChnl: 0,
    },
    distanceField: { fieldType: "msdf", distanceRange: font.distanceRange },
    kernings: [],
  };
}

/** Fetches a page, checks its bytes and decoded size, and decodes it off the main thread. */
const decodePage: PageDecoder = (page, lane, progress) => {
  const download = fetchAsset(page.url, { lane, size: page.bytes });
  const unwatch = download.watch(() => {
    if (download.network) progress(download.network);
  });
  const result = (async () => {
    const blob = await download.result;
    const sha = await sha256Hex(await blob.arrayBuffer());
    // What arrived (size, digest, type) tells a truncated response from other content or an error page.
    if (sha !== page.sha256)
      throw mismatch(
        `${page.font} 第 ${page.index} 页内容与图集记录不符，收到 ${blob.size}/${page.bytes} 字节，sha256 ${sha.slice(0, 16)}，${blob.type || "-"}`,
        page.url,
      );
    const image = await resources()
      .decodeImage(blob, false)
      .catch((cause: unknown) => {
        throw new Error(`UI 字体图集无法解码：${page.url}`, { cause });
      });
    if (image.width !== page.size[0] || image.height !== page.size[1]) {
      image.release();
      throw mismatch(
        `${page.font} 第 ${page.index} 页 ${image.width}×${image.height}，图集 ${page.size[0]}×${page.size[1]}`,
        page.url,
      );
    }
    return image;
  })();
  // Settled either way, the download is let go; the cleanup's own promise never rejects.
  const done = () => {
    unwatch();
    download.release();
  };
  result.then(done, done);
  return { result, setLane: (next) => download.setLane(next), release: () => download.release() };
};

/**
 * The paged fonts (docs/fonts-paging-design.md): metrics for every font load at once from the
 * committed core set and the base set it pins; pages load through the registry. uikit gets one
 * Font per weight over stable page textures; every failure is reported through `report`.
 */
export function createPagedFonts(
  base: URL,
  gpu: FontGpu,
  report: (error: Error) => void,
  decode: PageDecoder = decodePage,
): UiFonts {
  const reportError = (error: unknown) =>
    report(error instanceof Error ? error : new Error(String(error)));
  const uikitFonts = new Map<string, Font>();
  const registry = new PageRegistry({
    gpu,
    decode,
    report,
    setImage: (page, image) =>
      uikitFonts.get(page.font)!.setPageImage(page.index, image as TexImageSource | null),
  });
  const tables = new Map<string, MergedFont>();
  const coreUrl = new URL("fonts/gpu/core/", base);

  /** One font's metrics: verified core and base jsons, merged, its pages registered. */
  const loadFont = async (
    name: PagedName,
    core: PagedManifest,
    baseManifest: PagedManifest,
    baseUrl: URL,
  ) => {
    const entry = core[name] as PagedManifestEntry;
    const font = await verifiedJson<PagedFont>(new URL(entry.json, coreUrl), entry.sha256);
    checkPagedFont(name, entry, font, entry.sha256);
    const baseEntry = baseManifest[name] as PagedManifestEntry | undefined;
    const baseFont = baseEntry
      ? await verifiedJson<PagedFont>(new URL(baseEntry.json, baseUrl), baseEntry.sha256)
      : { ...font, pages: [], pageSha256: [], pageSizes: [], glyphs: [] };
    if (baseEntry) checkPagedFont(name, baseEntry, baseFont, baseEntry.sha256);
    const merged = mergeFonts(font, baseFont);
    tables.set(name, merged);
    const textures = merged.pages.map((page, index) => {
      const fromBase = page.set === "base";
      const local = fromBase ? index - merged.corePages : index;
      const texture = resources().createTexture();
      texture.magFilter = LinearFilter;
      registry.add({
        key: `${name}/${index}`,
        font: name,
        index,
        url: new URL(page.file, fromBase ? baseUrl : coreUrl).href,
        sha256: (fromBase ? baseFont : font).pageSha256[local]!,
        size: page.size,
        bytes: (fromBase ? baseEntry! : entry).pageBytes[local]!,
        set: page.set,
        texture,
        state: "absent",
        uploadedIn: null,
        lastUsed: 0,
      });
      return texture;
    });
    return fontInfo(name, font, merged, textures);
  };

  const infos = (async () => {
    const core = await verifiedJson<PagedManifest>(new URL("manifest.json", coreUrl), null);
    const key = core.base ?? "";
    const baseUrl = new URL(`fonts/gpu/base/${key}/`, base);
    const baseManifest = await verifiedJson<PagedManifest>(new URL("manifest.json", baseUrl), null);
    if (baseManifest.key !== key)
      throw mismatch(`基础字集 ${baseManifest.key ?? "无"}，清单要求 ${key}`, baseUrl.href);
    const loaded = await Promise.all(
      PAGED_FONTS.map((name) => loadFont(name, core, baseManifest, baseUrl)),
    );
    return new Map(PAGED_FONTS.map((name, i) => [name, loaded[i]!]));
  })();
  infos.catch(reportError);

  // uikit keys its font cache by the source function, and the Font it builds is the one whose
  // pages the registry fills: every font is asked for here, at once, not when first drawn.
  const built = PAGED_FONTS.map((name) => {
    const start = () => infos.then((all) => all.get(name)!);
    const font = new Promise<Font>((resolve) =>
      loadCachedFont(start, (loaded) => {
        uikitFonts.set(name, loaded);
        // `env` is Vite's; plain Node (the font tests) has none.
        if (import.meta.env?.DEV)
          logMissingGlyphs(loaded, name, (message) => console.error(message));
        resolve(loaded);
      }),
    );
    return { start, font };
  });
  // Rejects with the metrics' own failure (the uikit fonts only ever resolve).
  const metrics = Promise.all([infos, ...built.map(({ font }) => font)]).then(() => {});
  metrics.catch(() => {});
  const families: FontFamilies = {
    "Poketone UI": { "500": built[0]!.start, "700": built[1]!.start, "800": built[2]!.start },
    "Poketone Display": { "400": built[3]!.start },
  };

  const pagesFor = (text: string, name: PagedName) => {
    const keys = new Set<string>();
    const table = tables.get(name);
    if (!table) return keys;
    for (const char of text) {
      // A character no table has draws uikit's box: it never holds a surface.
      const row = table.glyphs.get(char.codePointAt(0)!);
      if (row) keys.add(`${name}/${row[1]}`);
    }
    return keys;
  };
  const pagesOf = (stage: { root: Object3D }) => {
    const keys = new Set<string>();
    stage.root.traverse((object) => {
      if (!(object instanceof Text)) return;
      const { fontFamily, fontWeight, text } = object.properties.peek();
      for (const key of pagesFor(textOf(text), fontOf(fontFamily, fontWeight))) keys.add(key);
    });
    return keys;
  };
  const corePages = () =>
    [...registry.pages.values()].filter((page) => page.set === "core").map((page) => page.key);

  /** Per stage: its gate, and the callers waiting for a revision at least as new as theirs. */
  interface Hold {
    readonly gate: RevisionGate<number>;
    waiters: { revision: number; resolve(): void; reject(error: Error): void }[];
  }
  const holds = new WeakMap<object, Hold>();
  let revisions = 0;
  const holdOf = (stage: object) => {
    let hold = holds.get(stage);
    if (!hold) {
      const created: Hold = {
        waiters: [],
        gate: new RevisionGate<number>(
          registry,
          (committed) => {
            const waiting = created.waiters;
            created.waiters = waiting.filter((waiter) => waiter.revision > committed);
            for (const waiter of waiting) if (waiter.revision <= committed) waiter.resolve();
          },
          // The latest revision's pages failed: everyone waiting on this stage hears it.
          (_failed, error) => {
            for (const waiter of created.waiters.splice(0)) waiter.reject(error);
          },
        ),
      };
      holds.set(stage, (hold = created));
    }
    return hold;
  };

  const needed = (stage: { root: Object3D }, first: boolean) => {
    const keys = pagesOf(stage);
    if (!first) for (const key of corePages()) keys.add(key);
    return [...keys];
  };
  let metricsIn = false;
  metrics.then(
    () => (metricsIn = true),
    () => {},
  );

  return {
    families,
    metrics,
    registry,
    pagesFor,
    pagesOf,
    readyNow: (stage, first = false) => metricsIn && registry.resident(needed(stage, first)),
    async ready(stage, first = false) {
      await metrics;
      const keys = needed(stage, first);
      const hold = holdOf(stage);
      const revision = ++revisions;
      const settled = new Promise<void>((resolve, reject) =>
        hold.waiters.push({ revision, resolve, reject }),
      );
      hold.gate.set(revision, keys);
      return settled;
    },
    release(stage) {
      const hold = holds.get(stage);
      if (!hold) return;
      hold.gate.dispose();
      holds.delete(stage);
      for (const waiter of hold.waiters.splice(0))
        waiter.reject(new DOMException("UI 字体：界面已释放", "AbortError"));
    },
    dispose() {
      registry.dispose();
    },
    prefetch() {
      void metrics.then(
        () => registry.hold(corePages(), "background"),
        () => {},
      );
    },
  };
}

/** The application renderer as the fonts see it (`AppRenderer`). */
export interface UiFontApp extends GpuContext {
  readonly renderer: { initTexture(texture: Texture): void };
  resident(resident: { release(): void; restore?(): void }): () => void;
}

/** Fonts are application-lifetime (uikit caches them by source), so every host shares one set; a
 *  set that failed is dropped so the next host (retry) loads afresh. */
const pagedSets = new Map<string, { fonts: UiFonts; report: (error: Error) => void }>();

export function uiFonts(base: URL, app: UiFontApp, onError: (error: Error) => void): UiFonts {
  let entry = pagedSets.get(base.href);
  if (!entry) {
    const gpu: FontGpu = {
      get generation() {
        return app.generation;
      },
      get available() {
        return app.available;
      },
      subscribe: (listener) => app.subscribe(listener),
      enqueue: (task) => app.enqueue(task),
      upload: (texture) => app.renderer.initTexture(texture),
      resident: (resident) => app.resident(resident),
    };
    const created = { report: onError, fonts: undefined as unknown as UiFonts };
    created.fonts = createPagedFonts(base, gpu, (error) => {
      if (pagedSets.get(base.href) === created) {
        pagedSets.delete(base.href);
        // A failed set leaves nothing behind: no restore hook, no held pages.
        created.fonts.dispose();
      }
      created.report(error);
    });
    pagedSets.set(base.href, (entry = created));
  }
  entry.report = onError;
  return entry.fonts;
}
