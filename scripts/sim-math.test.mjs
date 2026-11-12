// The sim's deterministic math (src/run/sim/math.ts): it must stay accurate, and sim code must not
// reach around it. Lint bans the Math.* functions; `**` has no lint rule in oxlint, so it is checked here.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { atan, atan2, cos, exp, hypot, sin } from "../src/run/sim/math.ts";

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
/** Doubles as ordered integers, so the difference of two is their distance in ULP. */
const ordered = (v) => {
  f64[0] = v;
  return i64[0] < 0n ? -(i64[0] & 0x7fffffffffffffffn) : i64[0];
};
const ulps = (a, b) => Number(ordered(a) - ordered(b));

test("sim math stays within 2 ULP of the platform Math on sim-sized inputs", () => {
  let seed = 0x2545f491;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const signed = (scale) => (rand() * 2 - 1) * scale;
  const many = (draw) => Array.from({ length: 10000 }, draw);
  // Multiples of π/2 are where the range reduction cancels hardest.
  const angles = [1, 2, 3, 355, 710, 103993, 1048575].map((n) => [(n * Math.PI) / 2]);
  angles.push(...many(() => [signed(rand() < 0.5 ? 7 : 2e4)]));
  const cases = [
    ["sin", angles, sin, Math.sin],
    ["cos", angles, cos, Math.cos],
    ["atan", many(() => [signed(rand() < 0.5 ? 3 : 1e3)]), atan, Math.atan],
    ["atan2", many(() => [signed(100), signed(100)]), atan2, Math.atan2],
    ["exp", many(() => [signed(30)]), exp, Math.exp],
    ["hypot", many(() => [signed(100), signed(100)]), hypot, Math.hypot],
  ];
  for (const [name, inputs, ours, platform] of cases)
    for (const args of inputs) {
      const off = Math.abs(ulps(ours(...args), platform(...args)));
      assert.ok(off <= 2, `${String(name)}(${args.join(", ")}) is ${off} ULP off`);
    }
});

test("sim sources use ** only with the literal exponent 2", () => {
  const files = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : entry.name.endsWith(".ts")
          ? [join(dir, entry.name)]
          : [],
    );
  const offenders = [];
  for (const file of [...files("src/run/sim"), "src/run/lab.ts"]) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
      .replace(/\/\/.*$/gm, "");
    code.split("\n").forEach((line, i) => {
      if (/\*\*(?!\s*2(?![\d.]))/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], "use powInt / exp from src/run/sim/math.ts");
});
