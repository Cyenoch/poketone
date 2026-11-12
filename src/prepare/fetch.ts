import { laneRank, Shared, type Handle, type Lane } from "./handle";
import { resources } from "../platform/resources";
import { assetUrl } from "./asset-url";

/**
 * The network layer (readiness design §2, §8): one in-flight request per URL, run at the highest lane among its
 * waiters. Background and idle requests share {@link BACKGROUND_SLOTS}; critical and interactive start at once; `keep`
 * starts nothing. A request already in flight finishes at whatever lane it was admitted under. A finished response
 * stays shared while any handle holds it; a failed or abandoned URL leaves the table and is fetched afresh.
 */

export const BACKGROUND_SLOTS = 2;

interface Entry {
  readonly url: string;
  readonly shared: Shared<Blob>;
  readonly controller: AbortController;
}

const entries = new Map<string, Entry>();
const queued: Entry[] = [];
let backgroundBusy = 0;

/** `size` is the manifest's byte count for this URL, the only source of `bytesTotal`. */
export function fetchAsset(url: string, options: { lane: Lane; size?: number }): Handle<Blob> {
  const entry = entries.get(url) ?? enqueue(url, options.size ?? null);
  const handle = entry.shared.acquire(options.lane);
  pump();
  return handle;
}

function enqueue(url: string, bytesTotal: number | null): Entry {
  const entry: Entry = {
    url,
    controller: new AbortController(),
    shared: new Shared<Blob>(url, { lane: pump, empty: () => abandon(entry) }, { bytesTotal }),
  };
  entries.set(url, entry);
  queued.push(entry);
  return entry;
}

function abandon(entry: Entry): void {
  forget(entry);
  if (entry.shared.state !== "pending") return;
  const index = queued.indexOf(entry);
  if (index >= 0) queued.splice(index, 1);
  entry.controller.abort();
}

function pump(): void {
  const order = queued.toSorted((a, b) => rank(b) - rank(a));
  for (const entry of order) {
    const lane = entry.shared.lane;
    if (lane === null || lane === "keep") continue;
    const capped = laneRank(lane) <= laneRank("background");
    if (capped && backgroundBusy >= BACKGROUND_SLOTS) continue;
    queued.splice(queued.indexOf(entry), 1);
    if (capped) backgroundBusy++;
    void download(entry).finally(() => {
      if (capped) backgroundBusy--;
      pump();
    });
  }
}

const rank = (entry: Entry) => (entry.shared.lane === null ? -1 : laneRank(entry.shared.lane));

async function download(entry: Entry): Promise<void> {
  const { url, shared, controller } = entry;
  try {
    const response = await resources().read(assetUrl(url), { signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`fetch ${url}: HTTP ${response.status}`);
    }
    const type = response.headers.get("content-type") ?? "";
    const bytesTotal = shared.network?.bytesTotal ?? null;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytes += value.byteLength;
        shared.progress({ bytes, bytesTotal, done: false });
      }
    }
    shared.progress({ bytes, bytesTotal, done: true });
    shared.resolve(new Blob(chunks, { type }));
  } catch (cause) {
    forget(entry);
    shared.reject(cause);
  }
}

function forget(entry: Entry): void {
  if (entries.get(entry.url) === entry) entries.delete(entry.url);
}
