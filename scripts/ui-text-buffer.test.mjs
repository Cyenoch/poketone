import assert from "node:assert/strict";
import test from "node:test";
import { TextBuffer } from "../src/ui/text-buffer.ts";

test("selection retains its anchor when reversed, collapses before stepping, and replaces Unicode intact", () => {
  const buffer = new TextBuffer("A😀BC");
  buffer.select(3);
  buffer.move(-1, true);
  assert.deepEqual([buffer.start, buffer.end, buffer.backward], [1, 3, true]);
  buffer.move(1, true);
  buffer.move(1, true);
  assert.deepEqual([buffer.start, buffer.end, buffer.backward], [3, 4, false]);
  buffer.move(-1);
  assert.equal(buffer.cursor, 3);
  buffer.delete(true);
  assert.equal(buffer.text, "ABC");
  buffer.select(0, buffer.text.length);
  buffer.replace("存档");
  assert.deepEqual([buffer.text, buffer.cursor], ["存档", 2]);
  buffer.edge(false, true);
  buffer.replace("new");
  assert.deepEqual([buffer.text, buffer.start, buffer.end], ["new", 3, 3]);
});
