/**
 * The game's one Web Audio engine: menu, UI and runs share it. Samples come from `public/audio`
 * (mastered and listed in `bank.json` by `pnpm audio:master --publish`, see docs/AUDIO.md).
 *
 * Every sound belongs to an importance tier; per-sound cooldowns and a voice cap keep a 200-enemy
 * swarm from turning hits into noise (docs/GAME-FEEL.md). A sound's hit is placed on its effect's key
 * frame with `keyMs`, and repeated sounds rotate through their takes with a small pitch jitter.
 */
import { assetUrl } from "../prepare/asset-url";
import { fetchAsset } from "../prepare/fetch";
import { allOf, Shared, type Handle, type Lane } from "../prepare/handle";
import { soundStart, untilNextBeat } from "./schedule";
import { runtime } from "../platform/runtime";
import { resources } from "../platform/resources";

export const SFX_NAMES = [
  "hit",
  "hit-fire",
  "hit-water",
  "hit-grass",
  "hit-electric",
  "crit",
  "kill",
  "elite-kill",
  "candy",
  "berry",
  "chest",
  "level",
  "dash",
  "hurt",
  "reaction",
  "freeze",
  "danger",
  "boss",
  "tell",
  "tell-danger",
  "enemy-heal",
  "evolve",
  "ult",
  "revive",
  "capture",
  "cast-fire",
  "cast-water",
  "cast-grass",
  "cast-electric",
  "victory",
  "defeat",
  "ui-move",
  "ui-confirm",
  "ui-back",
  "ui-denied",
  "ui-start",
  "ui-transition",
] as const;
export type SfxName = (typeof SFX_NAMES)[number];
/** Sounds any screen plays (menus, windows, the run's windows): held for the page's lifetime. */
export const UI_SOUNDS = SFX_NAMES.filter((name) => name.startsWith("ui-"));
/**
 * Sounds the run plays (createRun's `drain`: hits by element and crits, kills, pickups, cues and
 * tells, casts by element, the outcome): every effect that is not a UI sound. A run, and the lobby
 * ahead of it, hold these; `scripts/ui-audio-holders.test.mjs` checks every `sfx` call against
 * the two lists.
 */
export const RUN_SOUNDS = SFX_NAMES.filter((name) => !name.startsWith("ui-"));
/** The run's tracks, played in turn: one pass each, and the next run starts on the next one. */
export const RUN_TRACKS = ["run-1", "run-2", "run-3"] as const;
export type RunTrack = (typeof RUN_TRACKS)[number];
export type MusicTrack = "menu" | "boss" | RunTrack;
/** What the screens ask for: `run` is the run's rotation. */
export type MusicWish = "menu" | "run" | "boss";
/** What `acquire` loads by name: an effect (all its takes) or a music track. */
export type AudioName = SfxName | `music:${MusicTrack}`;

interface Rule {
  /** Minimum seconds between two plays of this sound. */
  cooldown: number;
  /** Decision cues and big moments never yield to the voice cap. */
  always?: true;
  /** A few percent of random pitch so repeats don't sound mechanical (never for UI). */
  jitter?: true;
  /** Dips the music by this many dB for the length of the sound, so the cue is not buried. */
  duck?: number;
  /** Played instead when this sound is inside its cooldown, so a dropped one still leaves a sound. */
  fallback?: SfxName;
  /** A high-rate bed sound (hits, kills, candy): it dips under every cue that ducks the music. */
  bed?: true;
}

const RULES: Record<SfxName, Rule> = {
  hit: { cooldown: 0.045, jitter: true, bed: true },
  // Hits sound like the move's element; each family keeps its own cooldown.
  "hit-fire": { cooldown: 0.06, jitter: true, bed: true },
  "hit-water": { cooldown: 0.06, jitter: true, bed: true },
  "hit-grass": { cooldown: 0.06, jitter: true, bed: true },
  "hit-electric": { cooldown: 0.06, jitter: true, bed: true },
  // At hit level on the bed: a crit reads as a heavier hit, not a cue. Crits closer than 0.35 s
  // merge into one, the rest fall back to the plain (or element) hit.
  crit: { cooldown: 0.35, jitter: true, fallback: "hit", bed: true },
  kill: { cooldown: 0.06, jitter: true, bed: true },
  "elite-kill": { cooldown: 0.2, always: true, duck: -4 },
  // The caller raises the pitch along the pickup chain.
  candy: { cooldown: 0.035, bed: true },
  berry: { cooldown: 0.2 },
  chest: { cooldown: 0.4, always: true },
  level: { cooldown: 0.3, always: true },
  dash: { cooldown: 0.1, jitter: true, bed: true },
  hurt: { cooldown: 0.15, always: true, jitter: true },
  reaction: { cooldown: 0.12, jitter: true },
  freeze: { cooldown: 0.25, jitter: true, bed: true },
  danger: { cooldown: 1, always: true, duck: -5 },
  boss: { cooldown: 2, always: true, duck: -6 },
  tell: { cooldown: 0.3, always: true, jitter: true },
  // A red tell inside its cooldown still sounds as a blue one, so a batch never goes silent.
  "tell-danger": { cooldown: 0.45, always: true, duck: -3, fallback: "tell" },
  // A healer's pulse (skills/healPulse.ts): a soft breath, never a tell; it may yield to the voice cap.
  "enemy-heal": { cooldown: 0.4, jitter: true },
  evolve: { cooldown: 1, always: true, duck: -6 },
  ult: { cooldown: 0.5, always: true, duck: -5 },
  revive: { cooldown: 1, always: true },
  capture: { cooldown: 0.3, always: true },
  "cast-fire": { cooldown: 0.25, jitter: true },
  "cast-water": { cooldown: 0.25, jitter: true },
  "cast-grass": { cooldown: 0.25, jitter: true },
  "cast-electric": { cooldown: 0.25, jitter: true },
  victory: { cooldown: 3, always: true },
  defeat: { cooldown: 3, always: true },
  "ui-move": { cooldown: 0.04, always: true },
  "ui-confirm": { cooldown: 0.05, always: true },
  "ui-back": { cooldown: 0.05, always: true },
  "ui-denied": { cooldown: 0.1, always: true },
  "ui-start": { cooldown: 0.5, always: true },
  "ui-transition": { cooldown: 0.3, always: true },
};

const MAX_VOICES = 14;
/** Starting mix, set by ear in the browser: music sits under the effects, UI between. */
const BUS_GAIN = { music: 0.5, sfx: 0.9, ui: 0.8 };
const PITCH_JITTER = 0.06;
/** Repeated sounds also vary in level by up to this many dB either way (pitch alone still repeats). */
const LEVEL_JITTER_DB = 1.5;
/** The bed dips by this share of a ducking cue's dB, so a lead cue is not buried under a swarm. */
const BED_DUCK_SHARE = 0.5;
const MUSIC_FADE = 0.9;
const PAUSED_MUSIC = 0.3;

interface BankJson {
  sfx: Record<string, { files: string[]; hitMs: number[] }>;
  music: Record<string, { file: string; bpm: number }>;
}

interface Sample {
  buffers: AudioBuffer[];
  hitMs: number[];
}

interface Playing {
  track: MusicTrack;
  source: AudioBufferSourceNode;
  /** Its own fade-out gain, apart from the fade-in, so a switch during a fade-in cannot cancel it. */
  out: GainNode;
  startedAt: number;
  duration: number;
  bpm: number;
}

export interface SfxOptions {
  pitch?: number;
  /** Level offset in dB on top of the mix (a candy chain starts quiet and swells). */
  gainDb?: number;
  keyMs?: number;
  fallback?: SfxName;
}

export interface Audio {
  dispose(): Promise<void>;
  /**
   * Holds the named sounds fetched and decoded while the handle lives (readiness design §4): an
   * effect plays only while someone holds it, and is freed when the last holder releases it.
   * `bank.json` is only the manifest of what exists. Sound is never a hard need: a file that cannot
   * be fetched or decoded is reported once through `onError`, and its hold settles with that sound
   * silent until a hold after the last release tries again.
   */
  acquire(names: readonly AudioName[], lane?: Lane): Handle<void>;
  /** Holds the named sounds' files downloaded but not decoded (music decodes when it is played).
   *  A failed download is reported like a failed `acquire`, and settles the handle all the same. */
  prefetch(names: readonly AudioName[], lane?: Lane): Handle<void>;
  setEnabled(enabled: boolean): void;
  /**
   * `pitch` scales the speed; `keyMs` is how long from now the effect's key frame lands (default 0:
   * the hit lands now and the sample's lead-in is skipped). `fallback` replaces the rule's fallback
   * for this call (a crit in a fire build falls back to the fire hit).
   */
  sfx(name: SfxName, options?: SfxOptions): void;
  music: {
    /**
     * The wanted music; null fades it out. Switches inside a run (boss, the next run track) wait
     * for the beat. Leaving the run moves the rotation on, so the next run opens on the next track.
     */
    play(wish: MusicWish | null): void;
    /** The run track `play("run")` starts with, for the run to hold before it is ready. */
    runTrack(): RunTrack;
    /** The pause menu lowers the music instead of stopping it. */
    setPaused(paused: boolean): void;
  };
  /** Load failures (a sound or track that cannot be fetched or decoded), each reported once. */
  onError(listener: (error: Error) => void): () => void;
}

const lin = (db: number) => 10 ** (db / 20);
const FADE_IN = Float32Array.from({ length: 32 }, (_, i) => Math.sin((i / 31) * (Math.PI / 2)));
const FADE_OUT = Float32Array.from({ length: 32 }, (_, i) => Math.cos((i / 31) * (Math.PI / 2)));

/** One file through the shared fetch (its lane, its waiters), decoded off the main thread. */
function decodeFile(
  decoder: OfflineAudioContext,
  url: string,
  lane: Lane,
): { result: Promise<AudioBuffer>; setLane(lane: Lane): void; release(): void } {
  const download = fetchAsset(url, { lane });
  const result = download.result
    .catch((cause: unknown) => {
      throw new Error(`音频载入失败：${url}`, { cause });
    })
    .then(async (blob) => {
      try {
        return await decoder.decodeAudioData(await blob.arrayBuffer());
      } catch (cause) {
        throw new Error(`音频无法解码：${url}`, { cause });
      }
    });
  // Settled either way, the download is let go; the cleanup's own promise never rejects.
  const done = () => download.release();
  result.then(done, done);
  return { result, setLane: (next) => download.setLane(next), release: () => download.release() };
}

/** A fresh engine; the game uses the one `getAudio()` instance (browser checks build their own). */
export function createAudio(): Audio {
  // Decoding needs no running context, so effects load before the first gesture; the real context
  // is created on that gesture (browsers refuse to start one earlier).
  const decoder = runtime().createAudioDecoder();
  let ctx: AudioContext | undefined;
  let buses:
    | {
        sfx: GainNode;
        bed: GainNode;
        ui: GainNode;
        music: GainNode;
        duck: GainNode;
        bedDuck: GainNode;
        pause: GainNode;
      }
    | undefined;
  let enabled = true;
  let bank: BankJson | undefined;
  /** Decoded effects and tracks: present exactly while someone holds them (`acquire`). */
  const samples = new Map<SfxName, Sample>();
  const tracks = new Map<MusicTrack, AudioBuffer>();
  const entries = new Map<AudioName, Shared<void>>();
  const abandon = new Map<AudioName, () => void>();
  /** Held names whose load failed: silent, already reported. */
  const failed = new Set<AudioName>();
  let manifest: Promise<BankJson> | undefined;
  /** The player's hold on the wanted track. */
  let player: { track: MusicTrack; hold: Handle<void> } | null = null;
  const lastPlayed = new Map<SfxName, number>();
  const lastTake = new Map<SfxName, number>();
  let voices = 0;
  let wanted: MusicWish | null = null;
  /** The rotation: the run track `run` stands for, and whether it has started since it became it. */
  let runAt = 0;
  let runStarted = false;
  let turn: ReturnType<typeof setTimeout> | undefined;
  let applying: Handle<void> | null = null;
  let playing: Playing | null = null;
  let paused = false;
  /** The music dip in force (linear gain) and when it releases; overlapping cues share one dip. */
  let duckDepth = 1;
  let duckUntil = 0;
  const listeners = new Set<(error: Error) => void>();
  const log: { name: string; take: number; delay: number; offset: number }[] = [];

  /** A broken file is news once per page: the lobby prefetch, 出发 and the run each retry it, and
   *  every name waiting on a failed `bank.json` shares its error. */
  const reported = new Set<string>();
  function report(error: unknown): void {
    const value = error instanceof Error ? error : new Error(String(error));
    if (reported.has(value.message)) return;
    reported.add(value.message);
    console.error(value);
    for (const listener of listeners) listener(value);
  }

  function start(): void {
    if (ctx) return;
    const context = runtime().createAudioContext();
    const master = context.createGain();
    // A gentle bus compressor keeps stacked hits from clipping.
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    master.connect(limiter).connect(context.destination);
    const bus = (gain: number) => {
      const node = context.createGain();
      node.gain.value = gain;
      return node;
    };
    const sfx = bus(BUS_GAIN.sfx);
    const bed = bus(BUS_GAIN.sfx);
    const ui = bus(BUS_GAIN.ui);
    const music = bus(BUS_GAIN.music);
    // Ducking and pausing get their own nodes so neither fights the other or the mix level.
    const duck = bus(1);
    const bedDuck = bus(1);
    const pause = bus(paused ? PAUSED_MUSIC : 1);
    music.connect(duck).connect(pause).connect(master);
    sfx.connect(master);
    bed.connect(bedDuck).connect(master);
    ui.connect(master);
    buses = { sfx, bed, ui, music, duck, bedDuck, pause };
    ctx = context;
    if (!enabled) void context.suspend();
    void applyMusic();
  }

  // Browsers only let a context run after a user gesture.
  runtime().activateAudio(() => {
    start();
    if (enabled && ctx?.state === "suspended") void ctx.resume();
    return ctx?.state === "running";
  });

  /** `bank.json`: what exists (files, key frames, tempo). Fetched once; a failed fetch is retried. */
  function manifestOf(): Promise<BankJson> {
    manifest ??= (async () => {
      const response = await resources().read(assetUrl("/audio/bank.json"));
      if (!response.ok) throw new Error(`音频清单载入失败：/audio/bank.json（${response.status}）`);
      // A name missing from the manifest fails only that sound (filesOf), never the whole bank.
      const json = (await response.json()) as BankJson;
      bank = json;
      void applyMusic();
      return json;
    })();
    manifest.catch(() => (manifest = undefined));
    return manifest;
  }

  /** One named sound's shared load: its files fetched at the waiters' lane and decoded; freed
   *  (or abandoned, if unfinished) when its last holder releases it. */
  function hold(name: AudioName, lane: Lane): Handle<void> {
    let operation = entries.get(name);
    if (!operation) {
      // The waiters' highest lane, also for files started after the manifest arrives.
      let current = lane;
      const decodes: { setLane(lane: Lane): void; release(): void }[] = [];
      const created = new Shared<void>(name, {
        lane(next) {
          current = next;
          for (const decode of decodes) decode.setLane(next);
        },
        empty() {
          if (entries.get(name) !== created) return;
          entries.delete(name);
          failed.delete(name);
          abandon.get(name)?.();
          abandon.delete(name);
          if (name.startsWith("music:")) tracks.delete(name.slice(6) as MusicTrack);
          else samples.delete(name as SfxName);
        },
      });
      operation = created;
      entries.set(name, created);
      abandon.set(name, () => decodes.forEach((decode) => decode.release()));
      const live = () => entries.get(name) === created;
      void manifestOf()
        .then(async (json) => {
          if (!live()) return;
          const track = name.startsWith("music:") ? (name.slice(6) as MusicTrack) : null;
          const files = filesOf(json, name);
          const started = files.map((file) => decodeFile(decoder, `/audio/${file}`, current));
          decodes.push(...started);
          const buffers = await Promise.all(started.map((decode) => decode.result));
          if (!live()) return;
          abandon.delete(name);
          if (track) tracks.set(track, buffers[0]!);
          else samples.set(name as SfxName, { buffers, hitMs: json.sfx[name as SfxName]!.hitMs });
          created.resolve();
        })
        .catch((cause: unknown) => {
          if (!live()) return;
          // Not a blocker: reported, and silent while held. Its other files are let go.
          abandon.get(name)?.();
          abandon.delete(name);
          failed.add(name);
          report(cause);
          created.resolve();
        });
    }
    return operation.acquire(lane);
  }

  /** The files a name stands for, from the manifest. */
  function filesOf(json: BankJson, name: AudioName): string[] {
    if (name.startsWith("music:")) {
      const track = json.music[name.slice(6)];
      if (!track) throw new Error(`音乐「${name.slice(6)}」不在 bank.json 里。`);
      return [track.file];
    }
    const sfx = json.sfx[name as SfxName];
    if (!sfx) throw new Error(`音效「${name}」不在 bank.json 里。`);
    return sfx.files;
  }

  function prefetch(names: readonly AudioName[], lane: Lane = "background"): Handle<void> {
    // Shared with a later decode of the same file (one request per URL while anyone holds it).
    const downloads: Handle<Blob>[] = [];
    let released = false;
    // A lane set before the manifest arrives applies to the downloads it then starts.
    let current = lane;
    const ready = manifestOf()
      .then((json) => {
        if (released) return;
        const loads: Promise<unknown>[] = [];
        for (const name of names) {
          let files: string[];
          try {
            files = filesOf(json, name);
          } catch (cause) {
            report(cause);
            continue;
          }
          for (const file of files) {
            const url = `/audio/${file}`;
            const download = fetchAsset(url, { lane: current });
            downloads.push(download);
            loads.push(
              download.result.catch((cause: unknown) => {
                throw new Error(`音频载入失败：${url}`, { cause });
              }),
            );
          }
        }
        return Promise.all(loads).then(() => {});
      })
      .catch((cause: unknown) => {
        if (!released) report(cause);
      });
    return {
      key: `audio-bytes:${names.join(",")}`,
      result: ready,
      network: null,
      watch: () => () => {},
      setLane(next) {
        current = next;
        for (const download of downloads) download.setLane(next);
      },
      release() {
        released = true;
        for (const download of downloads) download.release();
      },
    };
  }

  function acquire(names: readonly AudioName[], lane: Lane = "background"): Handle<void> {
    return allOf(
      `audio:${names.join(",")}`,
      names.map((name) => hold(name, lane)),
    );
  }

  function fadeOut(old: Playing, at: number, seconds: number): void {
    old.out.gain.setValueCurveAtTime(FADE_OUT, at, seconds);
    old.source.stop(at + seconds + 0.1);
    old.source.onended = () => old.out.disconnect();
  }

  /** The player holds only the wanted track: switching away (the menu theme during a run) frees
   *  the old one unless someone else holds it; a playing source keeps its own buffer. */
  function follow(): void {
    const track = wanted === "run" ? RUN_TRACKS[runAt]! : wanted;
    if (track === (player?.track ?? null)) return;
    const previous = player;
    // Background: music is never a surface's need, so it waits for what is (the first screen).
    player = track ? { track, hold: acquire([`music:${track}`], "background") } : null;
    previous?.hold.release();
    void applyMusic();
  }

  function advanceRun(): void {
    runAt = (runAt + 1) % RUN_TRACKS.length;
    runStarted = false;
  }

  /** After one pass of a run track, the rotation turns to the next. The check reads the context's
   *  clock, which stops while the sound is off, so a suspended pass waits instead of skipping. */
  function scheduleTurn(pass: Playing): void {
    clearTimeout(turn);
    const check = () => {
      if (playing !== pass || wanted !== "run" || !ctx) return;
      const left = pass.duration - (ctx.currentTime - pass.startedAt);
      if (left > 0.05) return void (turn = setTimeout(check, Math.max(1, left) * 1000));
      advanceRun();
      follow();
    };
    check();
  }

  async function applyMusic(): Promise<void> {
    const target = player?.track ?? null;
    if (!ctx || !buses || !bank || target === (playing?.track ?? null)) return;
    // Only this hold is already applying; replaying the same track creates a new request.
    if (player !== null && applying === player.hold) return;
    const context = ctx;
    if (target === null) {
      if (playing) fadeOut(playing, context.currentTime, 0.7);
      playing = null;
      return;
    }
    // The player's own hold on the wanted track (`follow`).
    const hold = player!.hold;
    applying = hold;
    try {
      await hold.result;
    } catch {
      // Rejects only when released for a newer wish.
      return;
    } finally {
      if (applying === hold) applying = null;
    }
    // A same-track replay also replaces the hold while this request waits.
    if (player?.hold !== hold || target === (playing?.track ?? null)) return;
    // A track that failed to load was reported by its hold; the wish stays, silent.
    const buffer = tracks.get(target);
    if (!buffer) return;
    const bpm = bank.music[target]!.bpm;
    const now = context.currentTime;
    const old = playing;
    // A switch inside the run (boss, the next run track) starts on the next beat of the playing loop.
    const onBeat = old && old.track !== "menu" && target !== "menu";
    const at =
      now +
      (onBeat
        ? untilNextBeat(Math.max(0, now - old.startedAt) % old.duration, 60 / old.bpm)
        : 0.02);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const fadeIn = context.createGain();
    fadeIn.gain.value = 0;
    fadeIn.gain.setValueCurveAtTime(FADE_IN, at, MUSIC_FADE);
    const out = context.createGain();
    source.connect(fadeIn).connect(out).connect(buses.music);
    source.start(at);
    playing = { track: target, source, out, startedAt: at, duration: buffer.duration, bpm };
    if (old) fadeOut(old, at, MUSIC_FADE);
    if (target.startsWith("run-")) {
      runStarted = true;
      scheduleTurn(playing);
    }
  }

  // Dev-only handle for browser checks (what played, which track runs). Stripped from builds.
  if (import.meta.env.DEV) {
    Object.assign(window, {
      __poketoneAudio: () => ({
        context: ctx?.state ?? "not started",
        enabled,
        voices,
        effects: samples.size,
        tracks: [...tracks.keys()],
        music: playing?.track ?? null,
        wanted,
        runTrack: RUN_TRACKS[runAt],
        recent: [...log],
      }),
    });
  }

  const unheld = new Set<SfxName>();
  function sfx(name: SfxName, options?: SfxOptions): void {
    const sample = samples.get(name);
    // A sound nobody holds stays silent; development names it once (QA fails on warnings).
    if (
      !sample &&
      import.meta.env.DEV &&
      entries.get(name)?.state !== "pending" &&
      !failed.has(name) &&
      !unheld.has(name)
    ) {
      unheld.add(name);
      console.warn(`音效未载入：${name}（没有持有者，见 UI_SOUNDS / RUN_SOUNDS）`);
    }
    if (!enabled || !ctx || !buses || !sample) return;
    const context = ctx;
    // iOS reports "interrupted" after a call or an app switch; any sound inside a gesture revives it.
    if (context.state !== "running") void context.resume();
    const rule = RULES[name];
    const now = context.currentTime;
    if (now - (lastPlayed.get(name) ?? -Infinity) < rule.cooldown) {
      // A sound dropped by its cooldown can still leave its fallback (a crit becomes a plain hit).
      const fallback = options?.fallback ?? rule.fallback;
      if (fallback)
        sfx(fallback, { pitch: options?.pitch, gainDb: options?.gainDb, keyMs: options?.keyMs });
      return;
    }
    // Low-tier sounds yield when the mix is busy; important ones always play.
    if (voices >= MAX_VOICES && !rule.always) return;
    lastPlayed.set(name, now);
    // Rotate through the takes without repeating the last one.
    const count = sample.buffers.length;
    const previous = lastTake.get(name) ?? -1;
    let take = Math.floor(Math.random() * count);
    if (count > 1 && take === previous) take = (take + 1) % count;
    lastTake.set(name, take);
    const { delay, offset } = soundStart(sample.hitMs[take]!, options?.keyMs ?? 0);
    const source = context.createBufferSource();
    source.buffer = sample.buffers[take]!;
    const jitter = rule.jitter ? 1 + (Math.random() * 2 - 1) * PITCH_JITTER : 1;
    source.playbackRate.value = (options?.pitch ?? 1) * jitter;
    const out = name.startsWith("ui-") ? buses.ui : rule.bed ? buses.bed : buses.sfx;
    const levelDb =
      (options?.gainDb ?? 0) + (rule.jitter ? (Math.random() * 2 - 1) * LEVEL_JITTER_DB : 0);
    const level = levelDb !== 0 ? context.createGain() : null;
    if (level) {
      level.gain.value = lin(levelDb);
      source.connect(level).connect(out);
    } else source.connect(out);
    source.start(now + delay, offset);
    voices++;
    source.onended = () => {
      voices--;
      level?.disconnect();
    };
    if (rule.duck !== undefined) {
      const gain = buses.duck.gain;
      const begin = now + delay;
      const until = begin + (source.buffer.duration - offset) / source.playbackRate.value;
      // Cues that overlap keep the deeper dip and the later release.
      const active = duckUntil > begin;
      duckDepth = active ? Math.min(duckDepth, lin(rule.duck)) : lin(rule.duck);
      duckUntil = active ? Math.max(duckUntil, until) : until;
      for (const [param, depth] of [
        [gain, duckDepth],
        [buses.bedDuck.gain, duckDepth ** BED_DUCK_SHARE],
      ] as const) {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(depth, begin, 0.05);
        param.setTargetAtTime(1, duckUntil, 0.35);
      }
    }
    if (import.meta.env.DEV) {
      log.push({ name, take, delay, offset });
      if (log.length > 60) log.shift();
    }
  }

  return {
    acquire,
    prefetch,
    setEnabled(value) {
      enabled = value;
      if (!ctx) return;
      void (value ? ctx.resume() : ctx.suspend());
    },
    sfx,
    music: {
      play(wish) {
        // Callers repeat the wish every snapshot; a failed track is reported once, not refetched.
        if (wish === wanted) return;
        // Leaving the run (its end, or the menu) moves the rotation past the track it played.
        if (wish !== "run" && wish !== "boss" && runStarted) advanceRun();
        wanted = wish;
        follow();
      },
      runTrack: () => RUN_TRACKS[runAt]!,
      setPaused(value) {
        paused = value;
        if (!ctx || !buses) return;
        buses.pause.gain.setTargetAtTime(value ? PAUSED_MUSIC : 1, ctx.currentTime, 0.1);
      },
    },
    async dispose() {
      if (turn !== undefined) clearTimeout(turn);
      wanted = null;
      player?.hold.release();
      player = null;
      if (ctx) await ctx.close();
    },
    onError(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let instance: Audio | undefined;

// A second engine instance after a hot update would leave the old one's music playing.

export function getAudio(): Audio {
  instance ??= createAudio();
  return instance;
}
