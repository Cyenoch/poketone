// Cross-engine determinism harness. Pure: no node:*, no DOM, no rAF, so `run.mjs` bundles it once and
// runs the very same file in bun (JSC), headless Chrome (V8) and Playwright WebKit (JSC).
//   - runCase(name): golden v2's digests for one case (scripts/golden.mjs semantics).
//   - mapDigest(seeds): bit-exact hashes of every map stage for each seed.
//   - startProbe / stopProbe: wrap the non-correctly-rounded Math functions, count calls per function,
//     hash every (input, output) bit pattern and keep a sample of distinct inputs.
//   - evalCorpus(corpus): evaluate given inputs in this engine with the native Math functions (engine
//     facts; the sim no longer calls them) and with sim/math.ts (must agree everywhere), as bit patterns.
import { generateMap, MapGenError, shoreDistance } from "../../src/run/sim/mapgen/index.ts";
import { stageDefs } from "../../src/run/sim/content/stages/index.ts";
import * as simMath from "../../src/run/sim/math.ts";
import { createWorld } from "../../src/run/sim/world.ts";
import { CASES, replay } from "../golden-replay.mjs";
import { createHash } from "./sha256.mjs";

const forestMap = stageDefs.forest.map;

export const caseNames = () => CASES.map((spec) => spec.name);

export function runCase(name, perTick = false) {
  const spec = CASES.find((c) => c.name === name);
  if (!spec) throw new Error(`determinism: no case ${name}`);
  const ticks = [];
  const started = performance.now();
  const result = replay(spec, perTick ? (world) => ticks.push(tickDigest(world)) : undefined);
  return { ...result, ms: Math.round(performance.now() - started), ticks };
}

// ---------------------------------------------------------------------------------------------------
// Bit-exact digests (no 1e-6 quantisation: any ULP difference shows).

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
const hashNumbers = (hash, values) => hash.update(Float64Array.from(values));
const hex = (hash) => hash.digest().slice(0, 16);

/** Positions, HP and timers of everything moving, at full precision; used to find the first diverging tick. */
function tickDigest(world) {
  const h = createHash();
  const nums = [world.tick];
  for (const p of world.players) nums.push(p.x, p.z, p.hp, p.xp, p.ult.charge);
  for (const e of world.enemies) nums.push(e.id, e.x, e.z, e.hp);
  for (const p of world.projectiles) nums.push(p.id, p.x, p.z);
  for (const p of world.pickups) nums.push(p.id, p.x, p.z);
  for (const p of world.partners) nums.push(p.id, p.x, p.z);
  hashNumbers(h, nums);
  h.update(JSON.stringify(world.rng));
  return hex(h);
}

function typedArrays(object) {
  return Object.entries(object)
    .filter(([, v]) => ArrayBuffer.isView(v))
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

function navDigest(nav) {
  const h = createHash();
  for (const [key, array] of typedArrays(nav.grid)) h.update(key).update(array);
  for (const layer of nav.layers)
    for (const [key, array] of typedArrays(layer)) h.update(key).update(array);
  h.update(JSON.stringify(nav.blockers));
  return hex(h);
}

/** Signed shore distance on a 41×41 grid over each puddle's reach. */
function shoreDigest(puddles) {
  const h = createHash();
  const values = [];
  for (const puddle of puddles)
    for (let j = 0; j <= 40; j++)
      for (let i = 0; i <= 40; i++) {
        const x = puddle.x + (i / 20 - 1) * puddle.radius;
        const z = puddle.z + (j / 20 - 1) * puddle.radius;
        values.push(shoreDistance(puddle, x, z));
      }
  hashNumbers(h, values);
  return hex(h);
}

function stageDigests({ terrain, water, pads, obstacles }, nav) {
  const stages = {
    terrain: hex(createHash().update(terrain.heights)),
    pads: hex(
      hashNumbers(
        createHash().update(pads.map((p) => p.tag).join()),
        pads.flatMap((p) => [p.x, p.z, p.radius, p.height]),
      ),
    ),
    puddles: hex(
      createHash().update(
        JSON.stringify(water.puddles, (_, v) => {
          if (typeof v !== "number") return v;
          f64[0] = v;
          return [...new Uint8Array(f64.buffer)].map((b) => b.toString(16)).join("");
        }),
      ),
    ),
    waterDepth: hex(createHash().update(water.depth.values)),
    shore: shoreDigest(water.puddles),
    obstacles: hex(
      hashNumbers(
        createHash().update(obstacles.map((o) => `${o.kind}${o.solid}`).join()),
        obstacles.flatMap((o) => [o.x, o.z, o.radius, o.scale, o.rotation]),
      ),
    ),
  };
  if (nav) stages.nav = navDigest(nav);
  return stages;
}

/** Per seed: every map stage's bit-exact hash, or the MapGenError message. Golden seeds also hash the world's nav. */
export function mapDigest(seeds) {
  const out = {};
  for (const seed of seeds) {
    try {
      const world = [4242, 7].includes(seed)
        ? createWorld({ stage: "forest", seed, difficulty: 0, players: [{ starter: "pikachu" }] })
        : null;
      const map = world ? world.map : generateMap(seed, forestMap).map;
      out[seed] = stageDigests(map, world?.nav);
    } catch (error) {
      if (!(error instanceof MapGenError)) throw error;
      out[seed] = { error: error.message };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Math probe.

export const PROBED = [
  "sin",
  "cos",
  "tan",
  "atan",
  "atan2",
  "asin",
  "acos",
  "exp",
  "expm1",
  "log",
  "log1p",
  "log2",
  "log10",
  "pow",
  "hypot",
  "cbrt",
  "sinh",
  "cosh",
  "tanh",
];
const originals = Object.fromEntries(PROBED.map((name) => [name, Math[name]]));
let probe = null;

/** FNV-1a over the 32-bit halves of each double. */
function mix(state, value) {
  f64[0] = value;
  state = Math.imul(state ^ u32[0], 0x01000193) >>> 0;
  return Math.imul(state ^ u32[1], 0x01000193) >>> 0;
}

/** Hashes every call; keeps a reservoir sample (seeded, so the same in every engine) of the inputs. */
export function startProbe(sampleLimit = 50000) {
  probe = {};
  let seed = 0x2545f491;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  for (const name of PROBED) {
    const original = originals[name];
    const record = { calls: 0, hash: 0x811c9dc5, inputs: [] };
    probe[name] = record;
    Math[name] = function probed(...args) {
      const result = original.apply(Math, args);
      record.calls++;
      let h = record.hash;
      for (const a of args) h = mix(h, a);
      record.hash = mix(h, result);
      if (record.inputs.length < sampleLimit) record.inputs.push(args);
      else {
        const slot = Math.floor(rand() * record.calls);
        if (slot < sampleLimit) record.inputs[slot] = args;
      }
      return result;
    };
  }
}

export function stopProbe() {
  for (const name of PROBED) Math[name] = originals[name];
  const out = {};
  for (const [name, r] of Object.entries(probe))
    if (r.calls > 0)
      out[name] = { calls: r.calls, hash: r.hash.toString(16).padStart(8, "0"), inputs: r.inputs };
  probe = null;
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Corpus evaluation. Inputs travel as bit-pattern hex, never as JS numbers, so no protocol
// serialiser (CDP, WebKit inspector) can round them on the way. `**` runs on operands decoded at
// runtime, so neither the bundler nor the engine can fold it.

const bits = (v) => {
  f64[0] = v;
  return u32[1].toString(16).padStart(8, "0") + u32[0].toString(16).padStart(8, "0");
};
const fromBits = (hex) => {
  u32[1] = parseInt(hex.slice(0, 8), 16);
  u32[0] = parseInt(hex.slice(8), 16);
  return f64[0];
};
const bitsHex = (v) => bits(v);
const powOp = (a, b) => a ** b;

/** { fn: number[][] } → { fn: string[] } (each call's arguments as comma-joined bit patterns). */
export const encodeCorpus = (corpus) =>
  Object.fromEntries(
    Object.entries(corpus).map(([fn, inputs]) => [fn, inputs.map((args) => args.map(bits).join())]),
  );

/** The sim's replacements, keyed by the Math function they replace (run on the same inputs). */
const SIM_MATH = {
  sin: simMath.sin,
  cos: simMath.cos,
  atan: simMath.atan,
  atan2: simMath.atan2,
  exp: (x) => (Math.abs(x) <= 708 ? simMath.exp(x) : NaN),
  hypot: simMath.hypot,
};

/**
 * corpus: encodeCorpus output. Returns { fn: hex[] } in input order, plus "pow**" for the operator,
 * "sim.<fn>" for sim/math.ts and "<fn>#in" echoing the decoded inputs (proves the transfer was lossless).
 */
export function evalCorpus(corpus) {
  const out = {};
  for (const [name, encoded] of Object.entries(corpus)) {
    const inputs = encoded.map((key) => key.split(",").map(fromBits));
    const fn = originals[name];
    out[`${name}#in`] = inputs.map((args) => args.map(bits).join());
    out[name] = inputs.map((args) => bits(fn.apply(Math, args)));
    if (name === "pow") out["pow**"] = inputs.map(([a, b]) => bits(powOp(a, b)));
    const sim = SIM_MATH[name];
    if (sim) out[`sim.${name}`] = inputs.map((args) => bits(sim(...args)));
  }
  return out;
}

/** The same corpus evaluated again after warming each function, to catch JIT-tier differences. */
export function evalCorpusHot(corpus, rounds = 20) {
  for (let r = 0; r < rounds; r++) evalCorpus(corpus);
  return evalCorpus(corpus);
}

/** Probe build only: run cases and map seeds under the probe; per-function call counts and I/O hashes. */
export function probeRun(names, seeds, sampleLimit = 0) {
  startProbe(sampleLimit);
  const ends = {};
  try {
    for (const name of names) ends[name] = runCase(name).end;
    mapDigest(seeds);
  } catch (error) {
    stopProbe();
    throw error;
  }
  return { ends, math: stopProbe() };
}

/** Bisect aid: one seed's puddles with every number as its bit pattern. */
export function puddleDump(seed) {
  const { water } = generateMap(seed, forestMap).map;
  return JSON.stringify(
    water.puddles,
    (_, v) => (typeof v === "number" ? `${v}|${bitsHex(v)}` : v),
    1,
  );
}

/**
 * Bisect aid (probe build): runs a case up to `maxTick` and, per tick, the full-precision state digest
 * plus per-function hashes of inputs and outputs. On `dumpTick` it keeps every call as
 * "fn(args bits) = result bits". The first tick where a function's output hash differs while its input
 * hash agrees names the function that diverged first; the dump also records each call's caller frame.
 */
export function probeTicks(name, maxTick, dumpTick = -1) {
  const spec = CASES.find((c) => c.name === name);
  if (!spec) throw new Error(`determinism: no case ${name}`);
  const saved = {};
  const ticks = [];
  const dump = [];
  let tick = 0;
  const state = {};
  for (const fn of PROBED) {
    const original = originals[fn];
    state[fn] = { in: 0x811c9dc5, out: 0x811c9dc5 };
    saved[fn] = Math[fn];
    Math[fn] = function probed(...args) {
      const result = original.apply(Math, args);
      const s = state[fn];
      for (const a of args) s.in = mix(s.in, a);
      s.out = mix(s.out, result);
      if (tick === dumpTick) {
        // Caller frame: V8 "    at name (url:line:col)", JSC "name@url:line:col".
        const frame = new Error().stack
          .split("\n")
          .find((line, i) => i > 0 && !/probed/.test(line));
        dump.push({ call: `${fn}(${args.map(bits).join()}) = ${bits(result)}`, at: frame?.trim() });
      }
      return result;
    };
  }
  try {
    replay({ ...spec, ticks: maxTick }, (world) => {
      const math = {};
      for (const [fn, s] of Object.entries(state)) {
        if (s.in !== 0x811c9dc5) math[fn] = [s.in, s.out];
        s.in = s.out = 0x811c9dc5;
      }
      ticks.push({ tick: world.tick, state: tickDigest(world), math });
      tick = world.tick;
    });
  } finally {
    for (const fn of PROBED) Math[fn] = saved[fn];
  }
  return { ticks, dump };
}
