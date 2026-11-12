/**
 * Deterministic math for the sim: the same inputs give the same bits in every JS engine.
 *
 * Why: `Math.sin` / `cos` / `atan` / `atan2` / `exp` / `hypot` / `pow` (and `**` with a non-2
 * exponent) are not required to be correctly rounded, and V8 and JavaScriptCore differ by 1–4 ULP.
 * One ULP in a position grows into different kills and level-up cards within a minute, and into
 * different puddle shapes at map generation (docs/research/DETERMINISM.md). Everything here is built
 * from IEEE-exact operations only: `+ - * /`, `Math.sqrt`, `Math.round` / `abs`.
 *
 * Rule: code under `src/run/sim/` and `src/run/lab.ts` never calls those `Math.*` functions or `**`
 * with an exponent other than the literal 2 (`x ** 2` is exactly `x * x` everywhere). Lint enforces
 * it (`.oxlintrc.json`). `src/run/view` may use `Math.*`: it only presents and never feeds back.
 *
 * Accuracy: `sin` / `cos` / `atan` / `atan2` / `exp` are fdlibm's algorithms and coefficients
 * (FreeBSD msun), under 1 ULP from the true value on their domains; `hypot` is within 1 ULP (one
 * rounding in the sum, one in the square root), with no overflow guard (sim coordinates are ±100).
 */

// ── sin / cos ───────────────────────────────────────────────────────────────────────────────────────

/** 2/π, and π/2 split into 33-bit pieces (fdlibm e_rem_pio2.c): `n * PIO2_k` is exact for |n| < 2^20. */
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.0222662487111664558e-21;
const PIO2_3T = 8.47842766036889956997e-32;
/** 2^20 · π/2: past this, `n * PIO2_1` is no longer exact and the reduction loses bits. */
const TRIG_LIMIT = 1647099;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** sin(x + y) on [-π/4, π/4], `y` the tail of the reduced argument (fdlibm k_sin.c). */
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos(x + y) on [-π/4, π/4] (fdlibm k_cos.c). */
function kernelCos(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const one = 1 - hz;
  return one + (1 - one - hz + (z * r - x * y));
}

/**
 * x = n·π/2 + (hi + lo), |hi + lo| ≤ π/4 (fdlibm e_rem_pio2.c, medium case). Each further round
 * subtracts more bits of π/2 and runs only on heavy cancellation, where the previous round's
 * subtraction was exact. fdlibm tests exponents; `|hi| < |x|·2^-17` (2^-50) implies its test, so
 * this enters a subset of its rounds and keeps its exactness argument.
 */
let reducedHi = 0;
let reducedLo = 0;
function reduce(x: number): number {
  const ax = Math.abs(x);
  if (!(ax <= TRIG_LIMIT)) throw new RangeError(`sim math: angle ${x} out of range`);
  const n = Math.round(x * INV_PIO2);
  let r = x - n * PIO2_1;
  let w = n * PIO2_1T;
  let hi = r - w;
  if (Math.abs(hi) < ax * 7.62939453125e-6) {
    let t = r;
    w = n * PIO2_2;
    r = t - w;
    w = n * PIO2_2T - (t - r - w);
    hi = r - w;
    if (Math.abs(hi) < ax * 8.881784197001252e-16) {
      t = r;
      w = n * PIO2_3;
      r = t - w;
      w = n * PIO2_3T - (t - r - w);
      hi = r - w;
    }
  }
  reducedHi = hi;
  reducedLo = r - hi - w;
  return n & 3;
}

/** |x| ≤ 2^20·π/2 (throws past it); under 1 ULP. */
export function sin(x: number): number {
  // sin x = x below 2^-27, as in fdlibm; it also keeps -0's sign, which the reduction would drop.
  if (Math.abs(x) < 7.450580596923828e-9) return x;
  const quadrant = reduce(x);
  if (quadrant === 0) return kernelSin(reducedHi, reducedLo);
  if (quadrant === 1) return kernelCos(reducedHi, reducedLo);
  if (quadrant === 2) return -kernelSin(reducedHi, reducedLo);
  return -kernelCos(reducedHi, reducedLo);
}

/** |x| ≤ 2^20·π/2 (throws past it); under 1 ULP. */
export function cos(x: number): number {
  const quadrant = reduce(x);
  if (quadrant === 0) return kernelCos(reducedHi, reducedLo);
  if (quadrant === 1) return -kernelSin(reducedHi, reducedLo);
  if (quadrant === 2) return -kernelCos(reducedHi, reducedLo);
  return kernelSin(reducedHi, reducedLo);
}

// ── atan / atan2 ────────────────────────────────────────────────────────────────────────────────────

/** atan(0.5), atan(1), atan(1.5), atan(∞) as hi + lo, and the polynomial (fdlibm s_atan.c). */
const ATAN_HALF_HI = 4.63647609000806093515e-1;
const ATAN_HALF_LO = 2.26987774529616870924e-17;
const ATAN_ONE_HI = 7.85398163397448278999e-1;
const ATAN_ONE_LO = 3.06161699786838301793e-17;
const ATAN_ONE_HALF_HI = 9.82793723247329054082e-1;
const ATAN_ONE_HALF_LO = 1.39033110312309984516e-17;
const ATAN_INF_HI = 1.570796326794896558;
const ATAN_INF_LO = 6.12323399573676603587e-17;
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.1111110405462355788e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.6531572744216915527e-2;
const AT10 = 1.62858201153657823623e-2;

/** Under 1 ULP. */
export function atan(x: number): number {
  const ax = Math.abs(x);
  if (!(ax < 7.378697629483821e19)) return x !== x ? x : x > 0 ? ATAN_INF_HI : -ATAN_INF_HI; // 2^66
  if (ax < 7.450580596923828e-9) return x; // 2^-27: atan(x) rounds to x
  // atan(ax) = hi + atan(t): reduce to |t| < 0.4375 around 0, 0.5, 1, 1.5 or ∞.
  let t = ax;
  let hi = 0;
  let lo = 0;
  if (ax >= 2.4375) {
    t = -1 / ax;
    hi = ATAN_INF_HI;
    lo = ATAN_INF_LO;
  } else if (ax >= 1.1875) {
    t = (ax - 1.5) / (1 + 1.5 * ax);
    hi = ATAN_ONE_HALF_HI;
    lo = ATAN_ONE_HALF_LO;
  } else if (ax >= 0.6875) {
    t = (ax - 1) / (ax + 1);
    hi = ATAN_ONE_HI;
    lo = ATAN_ONE_LO;
  } else if (ax >= 0.4375) {
    t = (2 * ax - 1) / (2 + ax);
    hi = ATAN_HALF_HI;
    lo = ATAN_HALF_LO;
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  const r = hi === 0 ? t - t * (s1 + s2) : hi - (t * (s1 + s2) - lo - t);
  return x < 0 ? -r : r;
}

const PI = Math.PI;
const PI_LO = 1.2246467991473532e-16;

/** Same quadrant and signed-zero rules as `Math.atan2` for finite inputs (NaN and infinities are not handled); under 2 ULP (fdlibm e_atan2.c). */
export function atan2(y: number, x: number): number {
  const negX = x < 0 || (x === 0 && 1 / x < 0);
  if (y === 0) return negX ? (1 / y < 0 ? -PI : PI) : y;
  if (x === 0) return y < 0 ? -PI / 2 : PI / 2;
  const z = atan(Math.abs(y / x));
  if (!negX) return y < 0 ? -z : z;
  return y < 0 ? z - PI_LO - PI : PI - (z - PI_LO);
}

// ── exp ─────────────────────────────────────────────────────────────────────────────────────────────

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

/** y · 2^k by exact doublings / halvings (no bit tricks, no `Math.pow`). */
function scaleByPow2(y: number, k: number): number {
  let step = k < 0 ? 0.5 : 2;
  for (let n = Math.abs(k); n > 0; n >>= 1) {
    if (n & 1) y *= step;
    step *= step;
  }
  return y;
}

/** |x| ≤ 708 (throws past it: the result would leave the normal range); under 1 ULP (fdlibm e_exp.c). */
export function exp(x: number): number {
  const ax = Math.abs(x);
  if (!(ax <= 708)) throw new RangeError(`sim math: exp(${x}) out of range`);
  if (ax < 3.725290298461914e-9) return 1 + x; // 2^-28
  let k = 0;
  let hi = x;
  let lo = 0;
  if (ax > 0.5 * Math.LN2) {
    k = ax < 1.5 * Math.LN2 ? (x < 0 ? -1 : 1) : Math.trunc(INV_LN2 * x + (x < 0 ? -0.5 : 0.5));
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
  }
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  return scaleByPow2(1 - (lo - (r * c) / (2 - c) - hi), k);
}

// ── hypot / integer powers ──────────────────────────────────────────────────────────────────────────

export const hypot = (x: number, z: number): number => Math.sqrt(x * x + z * z);

export const hypot3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** base^n for a whole n ≥ 0 by left-to-right multiplication, so every engine rounds the same steps. */
export function powInt(base: number, n: number): number {
  if (!(Number.isInteger(n) && n >= 0)) throw new RangeError(`sim math: powInt exponent ${n}`);
  let out = 1;
  for (let i = 0; i < n; i++) out *= base;
  return out;
}
