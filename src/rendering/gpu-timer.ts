/**
 * GPU time of whole frames through `EXT_disjoint_timer_query_webgl2`, read back asynchronously a few
 * frames later (never `finish` or a pixel read). One query per measured frame, never nested.
 * Results from a disjoint period or a lost context are discarded.
 */
interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Results older than this many frames are given up (a driver that never answers). */
const MAX_PENDING = 8;

export class GpuTimer {
  #gl: Omit<WebGL2RenderingContext, "canvas">;
  #ext: TimerExtension | null;
  #pending: { query: WebGLQuery; at: number }[] = [];
  #open: WebGLQuery | null = null;

  constructor(gl: Omit<WebGL2RenderingContext, "canvas">) {
    this.#gl = gl;
    this.#ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
  }

  get supported(): boolean {
    return this.#ext !== null;
  }

  begin(): void {
    const ext = this.#ext;
    if (!ext || this.#open) return;
    const query = this.#gl.createQuery();
    if (!query) return;
    this.#gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.#open = query;
  }

  end(at: number): void {
    const ext = this.#ext;
    if (!ext || !this.#open) return;
    this.#gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.#pending.push({ query: this.#open, at });
    this.#open = null;
    while (this.#pending.length > MAX_PENDING) this.#gl.deleteQuery(this.#pending.shift()!.query);
  }

  /** Hands every finished result, oldest first, to `sink` (milliseconds, the frame's time). */
  poll(sink: (ms: number, at: number) => void): void {
    const gl = this.#gl,
      ext = this.#ext;
    if (!ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.#pending.length > 0) {
      const { query, at } = this.#pending[0]!;
      if (!disjoint && !(gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) as boolean)) break;
      this.#pending.shift();
      if (!disjoint) sink((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6, at);
      gl.deleteQuery(query);
    }
  }

  /** Context lost: the queries died with it. After the restore the extension is fetched again. */
  lost(): void {
    this.#pending = [];
    this.#open = null;
  }

  restored(): void {
    this.#ext = this.#gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension | null;
  }
}
