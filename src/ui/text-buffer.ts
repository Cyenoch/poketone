/** Authoritative text and selection for platform editors and the GPU keyboard. Offsets are UTF-16. */
export class TextBuffer {
  text: string;
  private anchor = 0;
  cursor = 0;
  revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(text: string) {
    this.text = text;
  }
  get start() {
    return Math.min(this.anchor, this.cursor);
  }
  get end() {
    return Math.max(this.anchor, this.cursor);
  }
  get backward() {
    return this.cursor < this.anchor;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(text: string, start: number, end = start, backward = false): void {
    start = Math.max(0, Math.min(start, text.length));
    end = Math.max(start, Math.min(end, text.length));
    const anchor = backward ? end : start,
      cursor = backward ? start : end;
    if (text === this.text && anchor === this.anchor && cursor === this.cursor) return;
    this.text = text;
    this.anchor = anchor;
    this.cursor = cursor;
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  select(start: number, end = start): void {
    this.set(this.text, Math.min(start, end), Math.max(start, end), end < start);
  }

  replace(text: string, start = this.start, end = this.end): void {
    this.set(this.text.slice(0, start) + text + this.text.slice(end), start + text.length);
  }

  private adjacent(at: number, way: -1 | 1): number {
    if (way < 0) {
      const previous = this.text.charCodeAt(at - 1);
      return Math.max(0, at - (previous >= 0xdc00 && previous <= 0xdfff ? 2 : 1));
    }
    return Math.min(this.text.length, at + ((this.text.codePointAt(at) ?? 0) > 0xffff ? 2 : 1));
  }

  move(way: -1 | 1, extend = false): void {
    const at =
      !extend && this.start !== this.end
        ? way < 0
          ? this.start
          : this.end
        : this.adjacent(this.cursor, way);
    this.select(extend ? this.anchor : at, at);
  }

  edge(end: boolean, extend = false): void {
    const at = end ? this.text.length : 0;
    this.select(extend ? this.anchor : at, at);
  }

  delete(backward: boolean): void {
    this.replace(
      "",
      this.start === this.end && backward ? this.adjacent(this.start, -1) : this.start,
      this.start === this.end && !backward ? this.adjacent(this.end, 1) : this.end,
    );
  }
}
