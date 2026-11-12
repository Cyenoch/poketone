import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { sha256 } from "../src/ui/gpu/sha256.ts";

// The fallback for plain-HTTP origins verifies the same font digests as crypto.subtle: it must
// agree with SHA-256 on every length, including the padding boundaries (55/56/64 bytes).
test("the JS SHA-256 fallback matches node's SHA-256", () => {
  const lengths = [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 65537];
  for (const length of lengths) {
    const bytes = randomBytes(length);
    const expected = createHash("sha256").update(bytes).digest("hex");
    assert.equal(
      Buffer.from(sha256(new Uint8Array(bytes))).toString("hex"),
      expected,
      `length ${length}`,
    );
  }
});
