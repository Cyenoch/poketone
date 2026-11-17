import { Container, Content, Image, Text } from "@pmndrs/uikit";
import { Color, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";
import { images } from "../../prepare/images";
import { lineForms, starters, type StarterId } from "../../run/sim/content/lines/index";
import { trainerArt, trainerOrder, trainers } from "../../trainers";
import {
  RELEASE,
  TrainerCues,
  type ActiveTrainerCue,
  type TrainerCue,
} from "../../run/trainer-cues";
import { RevisionGate, type PageAcquisition, type PageSource } from "./fonts";
import { fade, stack } from "./layer";
import { EASE, POP, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, SLANT, srgb, ui } from "./tokens";
import { playerColors } from "../player-colors";
import type { UiStage } from "./stage";
import { UiShaderMaterial } from "./ui-shader";

/** Room around the band's box for its hard shadow and the ultimate's colour ribbon. */
const REACH = 18;
/** Where the ultimate's ribbon sits behind the band, down and right (px). */
const RIBBON = { x: 12, y: 8 } as const;
const INK = ui.ink;
const PAPER = ui.paper;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
/** Progress of a step `start`–`start + length` ms into a cue. */
const step = (age: number, start: number, length: number) => clamp((age - start) / length);
/** The font every cue string draws with. */
const FONT = "ui-800";

/** The font pages a cue's strings draw from: what must be resident before they are set. */
export interface CueGlyphs {
  pagesFor(text: string, font: typeof FONT): Set<string>;
  readonly registry: PageSource;
}

/** Ink text on a light plate, paper text on a dark one. */
const textOn = (hex: string) => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.32 ? INK : PAPER;
};

/**
 * The cut-in band in one quad, on the shared slant, radius and hard shadow (`tokens`): ink fill, the
 * trainer slab on its left, a thin accent top line, the crest's tinted disc and rim on the
 * right, speed streaks, a light sweep and a slanted wipe. An ultimate adds the trainer-colour
 * ribbon behind the band, a glint on its leading end and the release burst (an accent wash and a
 * shock ring from the crest). Name and seat tags are `SlantPlate`s.
 */
class CutinBand {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: -REACH,
    positionTop: -REACH,
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  readonly uniforms = {
    boxSize: { value: new Vector2(1, 1) },
    fill: { value: srgb(INK) },
    accent: { value: srgb(INK) },
    light: { value: srgb(PAPER) },
    /** x: slab width in band units (0: none), y: top line px. */
    slab: { value: new Vector2(0, 0) },
    /** Ball ring centre (u, y) and radius; radius 0 draws none. */
    ring: { value: new Vector3(0, 0, 0) },
    radius: { value: RADIUS },
    reveal: { value: 1 },
    shine: { value: -1 },
    /** Streak phase (seconds of travel; negative draws none) and strength. */
    streak: { value: -1 },
    streakGain: { value: 0.28 },
    /** The ribbon's wipe 0 → 1 behind the band (0: none). */
    ribbon: { value: 0 },
    /** The leading end's glint, 1 → 0. */
    glint: { value: 0 },
    /** The release burst's progress 0 → 1 (negative: none). */
    burst: { value: -1 },
    opacity: { value: 1 },
  };
  private readonly material = new UiShaderMaterial("trainer-skew", {
    uniforms: this.uniforms,
    vertexShader: /* glsl */ `
      varying vec2 boxPoint;
      uniform vec2 boxSize;
      #include <clipping_planes_pars_vertex>
      void main() {
        boxPoint = vec2(uv.x, 1. - uv.y) * (boxSize + vec2(${2 * REACH}.)) - vec2(${REACH}.);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 boxSize, slab;
      uniform vec3 fill, accent, light, ring;
      uniform float radius, reveal, shine, streak, streakGain, ribbon, glint, burst, opacity;
      varying vec2 boxPoint;
      #include <clipping_planes_pars_fragment>
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
      float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
      // Along the band, the slant taken out: 0 at the left edge on every row.
      float along(vec2 p) { return p.x - (boxSize.y - p.y) * ${SLANT.toFixed(5)}; }
      float shape(vec2 p) {
        float h = boxSize.y;
        vec2 half_ = vec2((boxSize.x - h * ${SLANT.toFixed(5)}) * .5, h * .5);
        return roundBox(vec2(along(p), p.y) - half_, half_, radius) * .97;
      }
      float hash(float n) { return fract(sin(n * 91.345) * 47453.21); }
      void over(inout vec4 acc, vec3 ink, float a) { acc = vec4(ink * a + acc.rgb * (1. - a), a + acc.a * (1. - a)); }
      void main() {
        #include <clipping_planes_fragment>
        vec2 p = boxPoint;
        float aa = .5 * max(fwidth(p.x), fwidth(p.y));
        float h = boxSize.y, w = boxSize.x - h * ${SLANT.toFixed(5)};
        vec4 acc = vec4(0.);
        // The shared hard shadow, down-right.
        over(acc, vec3(0.), ${HARD_SHADOW.alpha} * (1. - smoothstep(-aa, aa, shape(p - vec2(${HARD_SHADOW.offset}.)))));
        float k = burst >= 0. ? (1. - burst) * (1. - burst) : 0.;
        if (ribbon > 0.) {
          // The trainer's colour ribbon: the band's shape behind it, wiped in a beat late.
          vec2 o = vec2(${RIBBON.x}., ${RIBBON.y}.);
          float dr = max(shape(p - o), along(p - o) - ribbon * (w + 8.));
          if (dr < aa) {
            float row = floor((p.y - o.y) / 3.);
            float x = fract(along(p - o) / w * 2.4 + streak * 2.2 * (1. + hash(row + 11.)) + hash(row + 5.));
            float line = (1. - smoothstep(0., .05, x - .25)) * step(.45, hash(row + 2.));
            vec3 rc = mix(accent, light, .55 * line + .5 * k);
            over(acc, rc, 1. - smoothstep(-aa, aa, dr));
          }
        }
        float d = shape(p);
        float u = along(p);
        if (d < aa) {
          vec3 col = fill;
          if (slab.x > 0.) {
            col = mix(col, accent, 1. - smoothstep(-aa, aa, u - slab.x));
            col = mix(col, light, (1. - smoothstep(-aa, aa, abs(u - slab.x - 1.5) - 1.5)));
          }
          if (slab.y > 0.) col = mix(col, accent, (1. - smoothstep(-aa, aa, p.y - slab.y)) * step(slab.x + 3., u));
          if (streak >= 0.) {
            float row = floor(p.y / 5.);
            float x = fract(u / w * 1.6 + streak * (1.4 + hash(row)) + hash(row + 7.));
            float line = (1. - smoothstep(.0, .06, x - .2)) * step(.3, hash(row + 3.)) * (1. - smoothstep(.35, .5, abs(fract(p.y / 5.) - .5)));
            // A few rows run in the trainer's colour, the rest in its light.
            vec3 ink = mix(light, accent, step(.82, hash(row + 13.)));
            col = mix(col, ink, streakGain * line * step(slab.x + 3., u));
          }
          if (ring.z > 0.) {
            vec2 q = vec2(u, p.y) - ring.xy;
            float r = ring.z;
            // The crest's seat: a tinted disc with a light rim, wholly inside the band.
            float circle = abs(length(q) - r) - 2.;
            col = mix(col, accent, .22 * (1. - smoothstep(-aa, aa, length(q) - r)));
            col = mix(col, light, .9 * (1. - smoothstep(-aa, aa, circle)));
            if (burst >= 0.) {
              // The release: the band takes the trainer's colour for a beat and a ring runs out
              // from the crest.
              col = mix(col, accent, .34 * k * step(slab.x + 3., u));
              float wave = abs(length(q) - r - burst * h * 1.2) - (1. + 3. * k);
              col = mix(col, light, (1. - burst) * (1. - smoothstep(-aa, aa, wave)));
            }
          }
          if (shine >= 0.) {
            float c = mix(-48., boxSize.x + 48., shine);
            float b0 = (u - c) / 18., b1 = (u - c + 34.) / 5.;
            col = mix(col, vec3(1.), .45 * min(1., exp(-b0 * b0) + .6 * exp(-b1 * b1)));
          }
          // The leading end's glint while the band arrives: a narrow light edge, not a flash.
          col = mix(col, light, glint * .85 * (1. - smoothstep(0., 26., w - u)));
          over(acc, col, 1. - smoothstep(-aa, aa, d));
        }
        // The slanted wipe: shown up to reveal of the band's length.
        acc *= 1. - smoothstep(-aa, aa, u - reveal * (w + 8.));
        if (acc.a <= 0.) discard;
        gl_FragColor = vec4(toLinear(acc.rgb / acc.a), acc.a * opacity);
        #include <colorspace_fragment>
      }`,
  });
  private readonly host: Container;
  private size = "";

  constructor(host: Container) {
    this.host = host;
    this.content.add(new Mesh(this.geometry, this.material));
    host.add(this.content);
  }

  colors(fill: string, accent: string = fill, light: string = PAPER): void {
    srgb(fill, this.uniforms.fill.value);
    srgb(accent, this.uniforms.accent.value);
    srgb(light, this.uniforms.light.value);
  }

  /** Follows its host box (after layout); returns the box. */
  update(): readonly [number, number] | null {
    const s = this.host.size.value;
    if (!s) return null;
    const key = `${s[0]},${s[1]}`;
    if (key !== this.size) {
      this.size = key;
      this.uniforms.boxSize.value.set(s[0], s[1]);
      this.content.setProperties({ width: s[0] + 2 * REACH, height: s[1] + 2 * REACH });
    }
    return [s[0], s[1]];
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A small slanted tag with one upright label (the name; a teammate's P1–P4). */
class CutinTag {
  readonly root = new Container({ paddingX: 12, paddingY: 3, alignItems: "center", flexShrink: 0 });
  readonly plate: SlantPlate;
  readonly label = new Text({ fontWeight: 800, color: PAPER, lineHeight: "120%" });

  constructor() {
    this.plate = new SlantPlate(this.root, { fill: INK }, RADIUS_INNER);
    this.plate.set({ depth: 3 });
    this.root.add(this.plate.content, stack(this.label, 1));
  }

  set(text: string, fill: string, size: number): void {
    this.plate.set({ fill });
    this.label.setProperties({ text, color: textOn(fill), fontSize: size });
    this.root.setProperties({ paddingX: Math.round(size * 0.75) });
  }
}

interface Look {
  /** Band height, line and name sizes, portrait size (all px). */
  height: number;
  line: number;
  name: number;
  portrait: number;
  /** Entrance and exit lengths (ms). */
  enter: number;
  exit: number;
}

const lookOf = (cue: ActiveTrainerCue, compact: boolean): Look => {
  if (cue.kind === "deploy")
    return compact
      ? { height: 74, line: 22, name: 13, portrait: 142, enter: 420, exit: 300 }
      : { height: 104, line: 32, name: 16, portrait: 200, enter: 420, exit: 300 };
  if (cue.kind === "ultimate" && cue.local)
    return compact
      ? { height: 64, line: 20, name: 12, portrait: 126, enter: 380, exit: 300 }
      : { height: 96, line: 30, name: 16, portrait: 188, enter: 380, exit: 300 };
  return compact
    ? { height: 44, line: 14, name: 11, portrait: 80, enter: 300, exit: 220 }
    : { height: 58, line: 18, name: 13, portrait: 104, enter: 300, exit: 220 };
};

/** Where the HUD leaves room: the slot row's top (from the bottom) and the left column's foot
 *  (from the top), in stage px. */
export interface CutinAnchor {
  bottom: number;
  top: number;
}

/**
 * A passive trainer cut-in on the HUD's own GPU stage, never an input target: a −14° ink band
 * swept in from the left with the trainer's colour slab, the portrait rising over its left end,
 * a slanted name plate on its own row, the line on the next, and the partner's crest in a disc
 * on its right. Its strings are set only once their font pages are resident (`CueGlyphs`):
 * a cue whose pages are still loading stays hidden, and drops if it outlives its time first.
 *
 * The player's own ultimate is the long beat (`cueDuration`): a fast slam with the trainer's
 * ribbon and an afterimage, the line held through the two-second preparation, then the burst on
 * the sim's actual release (`release`), and the exit a second later.
 */
export class GpuTrainerCutin {
  readonly cues = new TrainerCues();
  readonly root = new Container({
    positionType: "absolute",
    display: "none",
    flexDirection: "row",
    alignItems: "center",
  });
  private readonly bandBox = new Container({
    positionType: "absolute",
    width: "100%",
    height: "100%",
  });
  private readonly band = new CutinBand(this.bandBox);
  private readonly portrait = new Image({ positionType: "absolute", positionBottom: 0 });
  /** The portrait's afterimage: trails its entrance and swells out on the release. */
  private readonly echo = new Image({ positionType: "absolute", positionBottom: 0 });
  private readonly lead = new Container({ flexShrink: 0 });
  private readonly copy = new Container({
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
  });
  private readonly nameRow = new Container({ flexDirection: "row", gap: 6, alignItems: "center" });
  private readonly seat = new CutinTag();
  private readonly name = new CutinTag();
  private readonly line = new Text({ fontWeight: 800, color: PAPER, lineHeight: "125%" });
  private readonly tail = new Container({ flexShrink: 0, height: "100%" });
  private readonly crest = new Image({ positionType: "absolute" });
  private readonly held = images().acquireAll(
    [
      ...trainerOrder.map((id) => trainerArt(id, "cutin")),
      ...new Set(
        (Object.keys(starters) as StarterId[]).flatMap((line) =>
          lineForms(line).map((form) => `/art/icons/crests/${form.types[0]}.webp`),
        ),
      ),
    ],
    "art",
    "critical",
  );
  /** The portraits and crests are uploaded. */
  readonly ready = this.held.result;
  private readonly gate: RevisionGate<ActiveTrainerCue>;
  /** The cue whose strings are set and resident; it alone may draw. */
  private committed: ActiveTrainerCue | null = null;
  private requested = 0;
  /** Pages an awaited `prepare` holds until its cue commits. */
  private primed: PageAcquisition | null = null;
  private drawn = 0;
  /** The streaks' travel (s), advanced at the beat's speed; the frame clock it last advanced on. */
  private phase = 0;
  private last = 0;
  private readonly stage: UiStage;
  private readonly glyphs: CueGlyphs;

  constructor(stage: UiStage, glyphs: CueGlyphs) {
    this.stage = stage;
    this.glyphs = glyphs;
    this.ready.catch(() => {});
    this.gate = new RevisionGate(glyphs.registry, (cue) => {
      this.commit(cue);
      this.primed?.release();
      this.primed = null;
    });
    this.nameRow.add(this.seat.root, this.name.root);
    this.copy.add(this.nameRow, this.line);
    this.tail.add(stack(this.crest, 2));
    this.root.add(
      this.bandBox,
      stack(this.echo, 3),
      stack(this.portrait, 3),
      stack(this.lead, 1),
      stack(this.copy, 2),
      stack(this.tail, 1),
    );
    stage.root.add(stack(this.root, 12));
  }

  /** Every string `cue` draws, as the band shows them. */
  private strings(cue: TrainerCue): string[] {
    return [trainers[cue.trainer].name, cue.text, cue.seat === null ? "" : `P${cue.seat + 1}`];
  }

  private keys(cue: TrainerCue): string[] {
    return [...new Set(this.strings(cue).flatMap((text) => [...this.glyphs.pagesFor(text, FONT)]))];
  }

  /** Settles once `cue`'s font pages are resident; they stay held until a cue commits. */
  prepare(cue: TrainerCue): Promise<void> {
    const keys = this.keys(cue);
    if (this.glyphs.registry.resident(keys)) return Promise.resolve();
    this.primed?.release();
    this.primed = this.glyphs.registry.acquire(keys);
    return this.primed.result;
  }

  show(cue: TrainerCue, ageMs = 0): boolean {
    const shown = this.cues.show(cue, performance.now(), ageMs);
    if (shown) this.stage.invalidate();
    return shown;
  }

  /** The sim's `ult-release` for `seat`: the showing ultimate band plays its burst once and holds
   *  for the exit. Nothing replays for a band that is gone, obscured or another player's. */
  release(seat: number | null, local: boolean, ageMs = 0): boolean {
    const released = this.cues.release(seat, local, performance.now(), ageMs);
    if (released) this.stage.invalidate();
    return released;
  }

  clear(): void {
    this.cues.clear();
    this.committed = null;
    this.hide();
  }

  /** The cue on screen now (its strings set), if any. */
  get showing(): ActiveTrainerCue | null {
    return this.committed;
  }

  private hide(): void {
    if (!this.drawn) return;
    this.drawn = 0;
    this.root.setProperties({ display: "none" });
    this.stage.invalidate();
  }

  private commit(cue: ActiveTrainerCue): void {
    this.committed = cue;
    const trainer = trainers[cue.trainer];
    const compact = this.stage.viewport.height <= 480;
    const look = lookOf(cue, compact);
    const mate = cue.seat !== null && !cue.local;
    for (const image of [this.portrait, this.echo])
      image.setProperties({
        src: trainerArt(cue.trainer, "cutin"),
        width: look.portrait,
        height: look.portrait,
      });
    this.crest.setProperties({ src: `/art/icons/crests/${cue.type}.webp` });
    this.name.set(trainer.name, trainer.color, look.name);
    this.seat.set(
      cue.seat === null ? "" : `P${cue.seat + 1}`,
      playerColors[cue.seat ?? 0]!,
      look.name,
    );
    this.seat.root.setProperties({ display: mate ? "flex" : "none" });
    this.line.setProperties({ text: cue.text, fontSize: look.line });
    this.band.colors(INK, trainer.color, trainer.light);
  }

  frame(anchor: CutinAnchor): void {
    const now = performance.now();
    const cue = this.cues.read(now);
    if (!cue) {
      this.committed = null;
      return this.hide();
    }
    if (cue.id !== this.requested) {
      this.requested = cue.id;
      this.gate.set(cue, this.keys(cue));
    }
    if (this.committed?.id !== cue.id) return this.hide();
    const v = this.stage.viewport;
    const compact = v.height <= 480;
    const look = lookOf(cue, compact);
    const h = look.height;
    const slant = h * SLANT;
    const ult = cue.kind === "ultimate";
    const left = Math.max(compact ? 10 : 20, v.safeArea.left + 8);
    // The portrait stands on the band's foot and rises over its top; the slab sits behind it.
    const lead = look.portrait;
    const tail = h * 1.05;
    const rise = look.portrait - h;
    // The opening sits in the lower field; on phones the beats hang under the left column (the
    // lower left is the thumb's), on desktop over the slot row.
    const top = cue.kind !== "deploy" && compact ? anchor.top + rise + 6 : undefined;
    // `anchor.bottom` is already 16px above the slot rows; the band's shadow and the trainer's feet
    // keep a clear gap over them.
    const clear = anchor.bottom + (compact ? 8 : 16);
    const bottom =
      cue.kind === "deploy"
        ? Math.max(v.height * (compact ? 0.2 : 0.17), v.safeArea.bottom + 16, clear)
        : compact
          ? undefined
          : clear;
    this.root.setProperties({
      display: "flex",
      height: h,
      positionLeft: left,
      positionTop: top,
      positionBottom: bottom,
      paddingRight: slant * 0.5,
    });
    this.lead.setProperties({ width: lead });
    this.tail.setProperties({ width: tail });
    this.copy.setProperties({ gap: Math.round(h * 0.06) });
    const crest = h * 0.44;
    this.crest.setProperties({
      width: crest,
      height: crest,
      positionLeft: tail / 2 - slant / 2 - crest / 2,
      positionTop: h / 2 - crest / 2,
    });
    for (const image of [this.portrait, this.echo])
      image.setProperties({ positionLeft: -look.portrait * 0.06 });
    const box = this.band.update();
    const u = this.band.uniforms;
    // The player's own ultimate is the long beat: ribbon, afterimage and the release burst.
    const own = ult && cue.local;
    if (box) {
      u.slab.value.set(lead * 0.62, own ? 4 : ult ? 3 : 2);
      u.ring.value.set(box[0] - slant - tail * 0.5 - slant * 0.5, h / 2, h * 0.3);
    }

    const age = now - cue.born;
    const since = cue.released === null ? -1 : now - cue.released;
    // The release burst 0 → 1 from the actual release, −1 before it and once played.
    const burst = since >= 0 && since < RELEASE.burst ? since / RELEASE.burst : -1;
    const kick = burst >= 0 ? (1 - burst) ** 3 : 0;
    const leaving = clamp(1 - (cue.duration - age) / look.exit);
    const out = SNAP(leaving);
    const scale = look.enter / 420;
    // The ultimate arrives at speed and brakes hard; the other beats cut in on SNAP.
    const sweep = (own ? EASE : SNAP)(step(age, 0, look.enter));
    const width = box?.[0] ?? 400;
    this.root.setProperties({
      transformTranslateX: -(1 - sweep) * 1.12 * (width + left) - out * 0.4 * width + kick * 12,
    });
    fade(this.root, 1 - leaving);
    const figure = EASE(step(age, (own ? 40 : 60) * scale, (own ? 460 : 550) * scale));
    const swell = ult ? (own ? 0.14 : 0.08) * (1 - figure) + 0.05 * kick : 0;
    fade(this.portrait, figure).setProperties({
      transformTranslateX: -(1 - figure) * 0.14 * look.portrait,
      transformScaleX: 1 + swell,
      transformScaleY: 1 + swell,
    });
    // The afterimage trails the slam, then swells out behind the trainer on the release.
    const trail = step(age, 0, 520);
    const echo = !own ? 0 : burst >= 0 ? 0.5 * (1 - burst) : 0.45 * (1 - trail);
    const echoScale = burst >= 0 ? 1 + 0.3 * EASE(burst) : 1.1;
    fade(this.echo, echo).setProperties({
      transformTranslateX: burst >= 0 ? 0 : -(1 - EASE(trail)) * 0.42 * look.portrait,
      transformScaleX: echoScale,
      transformScaleY: echoScale,
    });
    const plate = SNAP(step(age, 180 * scale, 400 * scale));
    this.name.plate.set({ reveal: plate });
    this.seat.plate.set({ reveal: plate });
    fade(this.name.label, step(age, 300 * scale, 160));
    fade(this.seat.label, step(age, 300 * scale, 160));
    const words = EASE(step(age, 260 * scale, 380 * scale));
    // The ultimate's line lands large and settles, and jolts with the release.
    const punch = own ? 0.16 * (1 - words) + 0.05 * kick : 0;
    fade(this.line, words).setProperties({
      transformTranslateX: -(1 - words) * 16,
      transformScaleX: 1 + punch,
      transformScaleY: 1 + punch,
    });
    const crestIn = step(age, 200 * scale, 380 * scale);
    // Held, the crest breathes; on the release it kicks out and twists back.
    const breath = own && crestIn >= 1 ? 0.04 * Math.sin((age / 1000) * Math.PI * 2.5) : 0;
    const crestScale = (own ? 0.3 + 0.7 * POP(crestIn) : 1) + breath + 0.35 * kick;
    fade(this.crest, EASE(step(age, 200 * scale, 300 * scale))).setProperties({
      transformScaleX: crestScale,
      transformScaleY: crestScale,
      transformRotateZ: -12 * kick,
    });
    u.reveal.value = 1;
    const shine = ult || cue.kind === "deploy" ? step(age, look.enter * 0.6, 520) : -1;
    u.shine.value = burst >= 0 ? EASE(burst) : shine >= 1 ? -1 : shine;
    // Streaks race in with the band, run steady through the hold, surge on the release and exit.
    const dt = Math.min(50, Math.max(0, now - this.last));
    const speed = own ? 1 + 1.6 * (1 - step(age, look.enter, 300)) + 2.5 * kick + 1.5 * leaving : 1;
    this.phase = (this.phase + (dt / 1000) * speed) % 1000;
    this.last = now;
    u.streak.value = ult ? this.phase : -1;
    u.streakGain.value = own ? 0.3 + 0.3 * (1 - step(age, look.enter, 400)) + 0.35 * kick : 0.28;
    u.ribbon.value = own ? EASE(step(age, 60, 460)) : 0;
    u.glint.value = own ? 1 - step(age, look.enter * 0.5, 360) : 0;
    u.burst.value = burst;
    u.opacity.value = 1;
    this.drawn = cue.id;
    // Moving parts redraw every frame; a held dialogue band is still and lets the stage rest.
    const settled = age > look.enter + 600 && leaving === 0 && !ult;
    if (!settled) this.stage.invalidate();
  }

  dispose(): void {
    this.gate.dispose();
    this.primed?.release();
    this.held.release();
    this.band.dispose();
    this.name.plate.dispose();
    this.seat.plate.dispose();
  }
}
