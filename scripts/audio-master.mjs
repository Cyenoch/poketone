/**
 * Masters the ElevenLabs raw takes listed in assets/audio/elevenlabs/manifest.json (docs/AUDIO.md).
 *
 *   node scripts/audio-master.mjs --report [id ...]   metrics + flags for every raw SFX take
 *   node scripts/audio-master.mjs [id ...]            master the picked takes into master/
 *   node scripts/audio-master.mjs --publish           copy what the game plays to public/audio + bank.json
 *
 * The report flags are advice for picking takes, not a gate: a long ring that `maxMs` trims off
 * is fine, a near-silent take is not (mastering refuses it), and HARSH (too much energy above
 * 4 kHz) is corrected by mastering with a shelf, so it only tells you which takes will be dulled.
 *
 * Raw levels differ by tens of dB between takes of one prompt, so nothing ships un-mastered.
 * SFX: mono FLAC (lossless, no codec delay, which matters for hit feedback), trimmed to the
 * sound and levelled by RMS of its active region. Music: stereo AAC levelled by integrated
 * loudness; loops get their tail crossfaded into their head so the file end flows into its start.
 * Needs ffmpeg on PATH.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 44100;
const HOP = Math.round(SR * 0.005);
const SILENT_PEAK_DB = -35;
const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "audio", "elevenlabs");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const timingPath = join(dir, "master", "timing.json");
/** Per mastered file: when it really hits. Wiring uses it to land the hit on the visual (docs/AUDIO.md). */
const timings = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf8")) : {};

/**
 * Importance tier (docs/GAME-FEEL.md) sets the level: rms is the target RMS (dBFS) of the active
 * region, ceilingDb the peak limit. The smaller the event, the lower its ceiling, so a frequent
 * little sound can never startle; only big moments may reach near full scale.
 */
const SFX_TIERS = {
  small: { rms: -26, ceilingDb: -6, maxMs: 220 },
  medium: { rms: -22, ceilingDb: -3, maxMs: 600 },
  large: { rms: -18, ceilingDb: -1, maxMs: 3000 },
  ui: { rms: -24, ceilingDb: -6, maxMs: 500 },
};
/**
 * Comfort: the ear is most sensitive around 2-5 kHz, and hissy, bright sounds there are what makes
 * a loud game tiring. Above HARSH_HZ a sound may hold at most this share of its energy; mastering
 * shelves the excess down (big moments keep their loudness, they lose the sizzle).
 */
const HARSH_HZ = 4000;
const HARSH_SHARE = { frequent: 0.15, other: 0.4 };
/** A frequent sound with more than this share of its energy in one narrow band rings like a bell. */
const TONAL_SHARE = 0.7;
/** How far (linear) a take may be pushed past its peak ceiling before the limiter catches it. */
const PEAK_HEADROOM = 3.2;
const TONAL_FROM_HZ = 100;
/** Sounds that play many times a second must be short, snappy and not bright, or they tire the ear. */
const FREQUENT_LIMITS = { attackMs: 40, decayMs: 160, centroidHz: 5000 };
/** Phone speakers reproduce almost nothing below ~300 Hz (docs/LESSONS.md). */
const LOW_CENTROID_HZ = 300;
const NEAR_SILENT_LUFS = -45;
const MUSIC_LUFS = { loop: -20, jingle: -18 };
/** alimiter defaults to auto-levelling (undoes our loudness targets) and to delaying the output. */
const LIMITER_FLAGS = "level=false:latency=true";

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
const lin = (d) => 10 ** (d / 20);

function ffmpeg(args, input) {
  const run = spawnSync("ffmpeg", ["-v", "error", "-nostats", ...args], {
    input,
    maxBuffer: 1 << 30,
  });
  if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${String(run.stderr)}`);
  return run;
}

/**
 * 1: a stereo file averaged to mono (ffmpeg's default downmix would lift a dual-mono source by
 * 3 dB), 2: stereo, null: the file's own channels (to re-measure what we wrote).
 */
function decode(file, channels) {
  const mix =
    channels === 1 ? ["-af", "pan=mono|c0=0.5*c0+0.5*c1"] : channels === 2 ? ["-ac", "2"] : [];
  const out = ffmpeg(["-i", file, ...mix, "-ar", String(SR), "-f", "f32le", "-"]);
  const bytes = out.stdout;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
}

const f32 = (samples) => Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);

function envelope(x) {
  const env = [];
  for (let i = 0; i + HOP <= x.length; i += HOP) {
    let sum = 0;
    for (let j = i; j < i + HOP; j++) sum += x[j] * x[j];
    env.push(Math.sqrt(sum / HOP));
  }
  return env;
}

/** Radix-2 FFT power spectrum (bins 0..n/2) of the first `len` samples from `start`, zero-padded to n. */
function powerSpectrum(x, start, n, len, windowed) {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < len; i++) {
    const hann = windowed ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)) : 1;
    re[i] = (x[start + i] ?? 0) * hann;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const b = a + size / 2;
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        [re[b], im[b]] = [re[a] - tr, im[a] - ti];
        [re[a], im[a]] = [re[a] + tr, im[a] + ti];
      }
    }
  }
  return Float64Array.from({ length: n / 2 }, (_, k) => re[k] ** 2 + im[k] ** 2);
}

/** Magnitude-weighted mean frequency of a 4096-sample window; the brightness measure. */
function centroidHz(x, start) {
  const n = 4096;
  const power = powerSpectrum(x, start, n, n, true);
  let weighted = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    const mag = Math.sqrt(power[k]);
    weighted += mag * ((k * SR) / n);
    total += mag;
  }
  return weighted / Math.max(total, 1e-9);
}

/** Share (0..1) of a clip's energy above HARSH_HZ: how hissy or piercing it is. */
function highShare(x) {
  const n = 2 ** Math.ceil(Math.log2(x.length));
  const power = powerSpectrum(x, 0, n, x.length, false);
  let high = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    total += power[k];
    if ((k * SR) / n >= HARSH_HZ) high += power[k];
  }
  return high / Math.max(total, 1e-20);
}

/**
 * Share (0..1) of a clip's energy within 6% of its strongest frequency: how much it rings like a bell.
 * A pure tone repeated several times a second is heard as ding-ding-ding (docs/LESSONS.md), whatever
 * its level or brightness, so the 4 kHz share cannot catch it.
 */
function tonalShare(x) {
  const n = 2 ** Math.ceil(Math.log2(x.length));
  const power = powerSpectrum(x, 0, n, x.length, true);
  // The strongest bin at or above TONAL_FROM_HZ: DC and sub-bass leakage must not win the search.
  let strongest = Math.ceil((TONAL_FROM_HZ * n) / SR);
  for (let k = strongest; k < n / 2; k++) if (power[k] > power[strongest]) strongest = k;
  let near = 0;
  let total = 0;
  for (let k = 1; k < n / 2; k++) {
    if ((k * SR) / n < TONAL_FROM_HZ) continue;
    total += power[k];
    if (Math.abs(k - strongest) <= strongest * 0.06) near += power[k];
  }
  return near / Math.max(total, 1e-20);
}

/** RBJ high-shelf biquad (slope 1): lowers everything above `hz` by `gainDb`. */
function highShelf(x, hz, gainDb) {
  const A = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * hz) / SR;
  const cos = Math.cos(w0);
  const sq = 2 * Math.sqrt(A) * ((Math.sin(w0) / 2) * Math.SQRT2);
  const a0 = A + 1 - (A - 1) * cos + sq;
  const b0 = (A * (A + 1 + (A - 1) * cos + sq)) / a0;
  const b1 = (-2 * A * (A - 1 + (A + 1) * cos)) / a0;
  const b2 = (A * (A + 1 + (A - 1) * cos - sq)) / a0;
  const a1 = (2 * (A - 1 - (A + 1) * cos)) / a0;
  const a2 = (A + 1 - (A - 1) * cos - sq) / a0;
  const y = new Float32Array(x.length);
  let [x1, x2, y1, y2] = [0, 0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    y[i] = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    [x2, x1, y2, y1] = [x1, x[i], y1, y[i]];
  }
  return y;
}

/**
 * Brings a clip's share of energy above HARSH_HZ under `limit` with a gentle shelf (at most
 * -12 dB). The first estimate treats the shelf as a step, so it is refined against the real result.
 */
function tameHighs(clip, limit) {
  let tamed = clip;
  let shelfDb = 0;
  for (let pass = 0; pass < 3; pass++) {
    const share = highShare(tamed);
    if (share <= limit || shelfDb <= -12) break;
    const step = Math.max(
      -12 - shelfDb,
      10 * Math.log10((limit * (1 - share)) / (share * (1 - limit))),
    );
    tamed = highShelf(tamed, HARSH_HZ, step);
    shelfDb += step;
  }
  return { tamed, shelfDb };
}

/** Where the sound lives: first/last hop within 35/40 dB of the loudest hop. */
function activeRegion(x) {
  const env = envelope(x);
  const top = Math.max(...env);
  const peakHop = env.indexOf(top);
  const first = env.findIndex((v) => v >= top * lin(-35));
  const last = env.findLastIndex((v) => v >= top * lin(-40));
  const decayHop = env.slice(peakHop).findIndex((v) => v < top * lin(-30));
  return {
    start: Math.max(0, (first - 1) * HOP),
    end: Math.min(x.length, (last + 2) * HOP),
    startMs: (Math.max(0, (first - 1) * HOP) * 1000) / SR,
    attackMs: ((peakHop - Math.max(0, first - 1)) * HOP * 1000) / SR,
    decayMs: ((decayHop < 0 ? env.length - peakHop : decayHop) * HOP * 1000) / SR,
    peakHop,
  };
}

function levels(x) {
  let peak = 0;
  let energy = 0;
  for (const v of x) {
    peak = Math.max(peak, Math.abs(v));
    energy += v * v;
  }
  return { peak, rmsDb: db(Math.sqrt(energy / x.length)) };
}

/** lenMs, hitMs: first 5 ms window within 6 dB of the loudest one, peakMs: the loudest window. */
function timing(x) {
  const env = envelope(x);
  const top = Math.max(...env);
  const ms = (hop) => (hop * HOP * 1000) / SR;
  return {
    lenMs: Math.round((x.length * 1000) / SR),
    hitMs: Math.round(ms(env.findIndex((v) => v >= top * lin(-6)))),
    peakMs: Math.round(ms(env.indexOf(top))),
  };
}

const monoOf = (x) =>
  Float32Array.from({ length: x.length / 2 }, (_, i) => (x[i * 2] + x[i * 2 + 1]) / 2);

function measure(file) {
  const x = decode(file, 1);
  const region = activeRegion(x);
  return {
    lenMs: (x.length * 1000) / SR,
    peakDb: db(levels(x).peak),
    ...region,
    share: highShare(x.slice(region.start, region.end)),
    tonal: tonalShare(x.slice(region.start, region.end)),
    centroidHz: centroidHz(x, Math.max(0, region.peakHop * HOP - 441)),
  };
}

function flagsFor(asset, m) {
  const flags = [];
  if (m.peakDb < SILENT_PEAK_DB) flags.push("SILENT");
  if (asset.frequent && m.attackMs > FREQUENT_LIMITS.attackMs) flags.push("SLOW-ATTACK");
  if (asset.frequent && m.decayMs > FREQUENT_LIMITS.decayMs) flags.push("LONG-DECAY");
  if (asset.frequent && m.centroidHz > FREQUENT_LIMITS.centroidHz) flags.push("BRIGHT");
  if (m.share > (asset.frequent ? HARSH_SHARE.frequent : HARSH_SHARE.other)) flags.push("HARSH");
  if (asset.frequent && m.tonal > TONAL_SHARE) flags.push("TONAL");
  if (m.centroidHz < LOW_CENTROID_HZ) flags.push("LOW");
  return flags.join(" ");
}

function report(ids) {
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (asset.kind !== "sfx" || (ids.length && !ids.includes(id))) continue;
    console.log(`${id} (${asset.tier}${asset.frequent ? ", frequent" : ""})`);
    for (const take of asset.takes) {
      const m = measure(join(dir, "raw", take.file));
      const picked = asset.pick.includes(take.file) ? "*" : " ";
      console.log(
        ` ${picked} ${take.file.padEnd(22)} len ${m.lenMs.toFixed(0).padStart(5)}ms  peak ${m.peakDb.toFixed(1).padStart(6)}dB  onset ${m.startMs.toFixed(0).padStart(4)}ms  attack ${m.attackMs.toFixed(0).padStart(4)}ms  decay-30dB ${m.decayMs.toFixed(0).padStart(5)}ms  centroid ${m.centroidHz.toFixed(0).padStart(5)}Hz  >${HARSH_HZ / 1000}k ${(m.share * 100).toFixed(0).padStart(3)}%  tonal ${(m.tonal * 100).toFixed(0).padStart(3)}%  ${flagsFor(asset, m)}`,
      );
    }
  }
}

function masterSfx(asset, take, outName) {
  const x = decode(join(dir, "raw", take), 1);
  const region = activeRegion(x);
  const start = region.start;
  const maxMs = asset.maxMs ?? SFX_TIERS[asset.tier].maxMs;
  const end = Math.min(region.end, start + Math.round((maxMs * SR) / 1000));
  const raw = x.slice(start, end);
  if (db(levels(raw).peak) < SILENT_PEAK_DB)
    throw new Error(`${take} is near-silent (${db(levels(raw).peak).toFixed(1)} dBFS)`);
  const shareBefore = highShare(raw);
  const { tamed: clip, shelfDb } = tameHighs(
    raw,
    asset.frequent ? HARSH_SHARE.frequent : HARSH_SHARE.other,
  );
  const { peak, rmsDb } = levels(clip);
  const { rms: target, ceilingDb } = SFX_TIERS[asset.tier];
  const fadeIn = Math.round(SR * 0.002);
  const fadeOut = Math.min(Math.round(SR * 0.04), Math.floor(clip.length / 3));
  const out = join(dir, "master", `${outName}.flac`);
  const limiter = `alimiter=limit=${lin(ceilingDb).toFixed(3)}:attack=2:release=30:${LIMITER_FLAGS}`;
  const render = (gain) => {
    const shaped = Float32Array.from(clip, (v, i) => {
      const inGain = Math.min(1, i / fadeIn);
      const outGain = Math.min(1, (clip.length - 1 - i) / fadeOut);
      return v * gain * inGain * Math.sin((outGain * Math.PI) / 2);
    });
    ffmpeg(
      [
        "-f",
        "f32le",
        "-ar",
        String(SR),
        "-ac",
        "1",
        "-i",
        "-",
        "-af",
        limiter,
        "-sample_fmt",
        "s16",
        "-y",
        out,
      ],
      f32(shaped),
    );
    return target - levels(decode(out, null)).rmsDb;
  };
  // The limiter tames spiky transients but also eats level, so a sound with sharp clicks (a chest
  // latch, a hurt slap) gets its shortfall back over a few passes, up to PEAK_HEADROOM past the ceiling.
  const most = (PEAK_HEADROOM * lin(ceilingDb)) / peak;
  let gain = Math.min(lin(target - rmsDb), most);
  for (let pass = 0, short = render(gain); pass < 2 && short > 1 && gain < most; pass++) {
    gain = Math.min(gain * lin(short), most);
    short = render(gain);
  }
  const finished = decode(out, null);
  timings[`${outName}.flac`] = timing(finished);
  const done = levels(finished);
  const short = target - done.rmsDb;
  console.log(
    `${outName}.flac  ${((clip.length * 1000) / SR).toFixed(0)}ms  rms ${done.rmsDb.toFixed(1)}dB (target ${target})  peak ${db(done.peak).toFixed(1)}dB${shelfDb < 0 ? `  tamed ${shelfDb.toFixed(1)}dB above ${HARSH_HZ / 1000}k (${(shareBefore * 100).toFixed(0)}% -> ${(highShare(clip) * 100).toFixed(0)}% of energy)` : ""}${short > 3 ? `  LOW-LEVEL: ${short.toFixed(1)}dB under target, held back by its peak` : ""}`,
  );
  return `${outName}.flac`;
}

const FLUX_HOP = 512;

/** Rise in level (dB) per hop of the mono mix: the beat pattern, used to line up loop seams. */
function onsetStrength(x) {
  const out = [];
  let prev = -180;
  for (let i = 0; i + FLUX_HOP <= x.length / 2; i += FLUX_HOP) {
    let sum = 0;
    for (let j = i; j < i + FLUX_HOP; j++) {
      const mono = (x[j * 2] + x[j * 2 + 1]) / 2;
      sum += mono * mono;
    }
    const level = db(Math.sqrt(sum / FLUX_HOP));
    out.push(Math.max(0, level - prev));
    prev = level;
  }
  return out;
}

function correlation(a, b) {
  const mean = (v) => v.reduce((s, n) => s + n, 0) / v.length;
  const [ma, mb] = [mean(a), mean(b)];
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(Math.max(aa * bb, 1e-12));
}

/**
 * A generated track's tempo is only nominal, so a cut on the computed bar line can land a fraction
 * of a beat off. Search ±1 beat for the loop end whose tail beat pattern best matches the head's.
 */
function bestLoopEnd(x, start, nominal, beat) {
  const flux = onsetStrength(x);
  const len = Math.floor(beat / FLUX_HOP);
  const hopOf = (frame) => Math.floor(frame / FLUX_HOP);
  const head = flux.slice(hopOf(start), hopOf(start) + len);
  const scoreAt = (end) => correlation(flux.slice(hopOf(end), hopOf(end) + len), head);
  // The windows are scored on the flux grid, so only ends with the same grid phase as `start`
  // are compared; otherwise the scored window and the actual cut differ by up to a hop.
  const onGrid = (frame) => start + Math.round((frame - start) / FLUX_HOP) * FLUX_HOP;
  const fits = (end) => end > start && end + beat <= x.length / 2;
  let best;
  for (let end = onGrid(nominal - beat); end <= nominal + beat; end += FLUX_HOP) {
    if (!fits(end)) continue;
    const score = scoreAt(end);
    if (!best || score > best.score) best = { end, score };
  }
  if (!best)
    throw new Error("loop does not fit: start + loopBars bars + 1 beat runs past the file");
  return { ...best, nominalScore: fits(onGrid(nominal)) ? scoreAt(onGrid(nominal)) : NaN };
}

/** The tail (one beat past `end`) crossfades into the head, so the file end flows into its start. */
function bakeLoop(x, start, end, xfade) {
  const out = new Float32Array((end - start) * 2);
  for (let i = 0; i < xfade; i++) {
    const head = Math.sin((i / xfade) * (Math.PI / 2));
    const tail = Math.cos((i / xfade) * (Math.PI / 2));
    for (let c = 0; c < 2; c++) {
      out[i * 2 + c] = x[(end + i) * 2 + c] * tail + x[(start + i) * 2 + c] * head;
    }
  }
  out.set(x.subarray((start + xfade) * 2, end * 2), xfade * 2);
  return out;
}

function integratedLufs(samples) {
  const run = spawnSync(
    "ffmpeg",
    [
      "-nostats",
      "-f",
      "f32le",
      "-ar",
      String(SR),
      "-ac",
      "2",
      "-i",
      "-",
      "-af",
      "ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { input: f32(samples), maxBuffer: 1 << 30 },
  );
  const found = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(String(run.stderr));
  if (!found) throw new Error(`no loudness reading: ${String(run.stderr)}`);
  return Number(found[1]);
}

function masterMusic(asset, take, outName) {
  let x = decode(join(dir, "raw", take), 2);
  let note = "";
  const filters = [`alimiter=limit=0.84:${LIMITER_FLAGS}`];
  if (asset.kind === "loop") {
    const beat = Math.round((SR * 60) / asset.bpm);
    const start = Math.round(SR * (asset.startSec ?? 0));
    const found = bestLoopEnd(x, start, start + asset.loopBars * 4 * beat, beat);
    x = bakeLoop(x, start, found.end, beat);
    note = `seam beat-match ${Number.isNaN(found.nominalScore) ? "n/a" : found.nominalScore.toFixed(2)} -> ${found.score.toFixed(2)}`;
  } else {
    const audible = (v) => Math.abs(v) > lin(-50);
    const firstFrame = Math.floor(x.findIndex(audible) / 2);
    const lastFrame = Math.ceil((x.findLastIndex((v) => Math.abs(v) > lin(-45)) + 1) / 2);
    x = x.slice(
      Math.max(0, firstFrame - Math.round(SR * 0.01)) * 2,
      Math.min(lastFrame + Math.round(SR * 0.15), x.length / 2) * 2,
    );
    filters.unshift(`afade=t=out:st=${(x.length / 2 / SR - 0.12).toFixed(3)}:d=0.12`);
  }
  const lufs = integratedLufs(x);
  if (lufs < NEAR_SILENT_LUFS) throw new Error(`${take} is near-silent (${lufs} LUFS)`);
  const gain = lin(MUSIC_LUFS[asset.kind] - lufs);
  for (let i = 0; i < x.length; i++) x[i] *= gain;
  const out = join(dir, "master", `${outName}.m4a`);
  ffmpeg(
    [
      "-f",
      "f32le",
      "-ar",
      String(SR),
      "-ac",
      "2",
      "-i",
      "-",
      "-af",
      filters.join(","),
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-y",
      out,
    ],
    f32(x),
  );
  if (asset.kind === "jingle") timings[`${outName}.m4a`] = timing(monoOf(x));
  console.log(
    `${outName}.m4a  ${(x.length / 2 / SR).toFixed(1)}s  gain ${db(gain).toFixed(1)}dB  ${note}`,
  );
  return `${outName}.m4a`;
}

function master(ids) {
  const unknown = ids.filter((id) => !manifest.assets[id]);
  if (unknown.length) throw new Error(`unknown asset id: ${unknown.join(", ")}`);
  const masterDir = join(dir, "master");
  mkdirSync(masterDir, { recursive: true });
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (ids.length && !ids.includes(id)) continue;
    if (asset.pick.length === 0) {
      console.log(`${id}: no pick, skipped`);
      continue;
    }
    const written = asset.pick.map((take, i) => {
      if (!existsSync(join(dir, "raw", take))) throw new Error(`${id}: missing raw/${take}`);
      const outName = asset.pick.length === 1 ? id : `${id}-${i + 1}`;
      return (asset.kind === "sfx" ? masterSfx : masterMusic)(asset, take, outName);
    });
    // Outputs of an earlier, longer pick list would otherwise stay next to the new ones.
    const own = new RegExp(`^${id}(-\\d+)?\\.(flac|m4a)$`);
    for (const file of readdirSync(masterDir)) {
      if (own.test(file) && !written.includes(file)) {
        unlinkSync(join(masterDir, file));
        delete timings[file];
      }
    }
  }
  const sorted = Object.fromEntries(Object.entries(timings).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(timingPath, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * The game plays what the manifest marks with `ship` (its in-game name). Effects ship every picked
 * take as a variant; a loop ships its first pick. bank.json carries each take's hit time so the
 * engine can land it on the effect's key frame.
 */
function publish() {
  const target = join(dir, "..", "..", "..", "public", "audio");
  const bank = { sfx: {}, music: {} };
  const shipped = new Set();
  const copy = (master, to) => {
    const from = join(dir, "master", master);
    if (!existsSync(from))
      throw new Error(`${master} is not mastered yet: run bun run audio:master first`);
    mkdirSync(dirname(join(target, to)), { recursive: true });
    copyFileSync(from, join(target, to));
    shipped.add(to);
  };
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (!asset.ship) continue;
    if (asset.pick.length === 0) throw new Error(`${id}: marked ship but nothing is picked`);
    if (bank[asset.kind === "sfx" ? "sfx" : "music"][asset.ship])
      throw new Error(`${id}: ship name "${asset.ship}" is already taken by another asset`);
    const many = asset.pick.length > 1;
    const masterOf = (i, ext) => (many ? `${id}-${i + 1}.${ext}` : `${id}.${ext}`);
    if (asset.kind === "sfx") {
      const files = asset.pick.map((_, i) => ({
        master: masterOf(i, "flac"),
        to: `sfx/${asset.ship}${many ? `-${i + 1}` : ""}.flac`,
      }));
      for (const file of files) copy(file.master, file.to);
      bank.sfx[asset.ship] = {
        files: files.map((file) => file.to),
        hitMs: files.map((file) => {
          const entry = timings[file.master];
          if (!entry)
            throw new Error(`${file.master} has no timing: run bun run audio:master first`);
          return entry.hitMs;
        }),
      };
    } else {
      copy(masterOf(0, "m4a"), `music/${asset.ship}.m4a`);
      bank.music[asset.ship] = { file: `music/${asset.ship}.m4a`, bpm: asset.bpm };
    }
  }
  writeFileSync(join(target, "bank.json"), `${JSON.stringify(bank, null, 2)}\n`);
  // Files of an earlier shipping list would otherwise stay in the build.
  for (const folder of ["sfx", "music"]) {
    for (const file of readdirSync(join(target, folder))) {
      if (!shipped.has(`${folder}/${file}`)) unlinkSync(join(target, folder, file));
    }
  }
  console.log(
    `published ${Object.keys(bank.sfx).length} effects and ${Object.keys(bank.music).length} tracks`,
  );
}

const args = process.argv.slice(2);
const ids = args.filter((a) => !a.startsWith("--"));
if (args.includes("--report")) report(ids);
else if (args.includes("--publish")) publish();
else master(ids);
