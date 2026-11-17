import { Container, Content, Image, Text } from "@pmndrs/uikit";
import { Color, Mesh, PlaneGeometry, Vector2, Vector3 } from "three";
import { images } from "../../prepare/images";
import { lineForms, starters, type StarterId } from "../../run/sim/content/lines/index";
import { TrainerCues, type ActiveTrainerCue, type TrainerCue } from "../../run/trainer-cues";
import { trainerArt, trainerOrder, trainers } from "../../trainers";
import { RevisionGate, type PageAcquisition, type PageSource } from "./fonts";
import { fade, stack } from "./layer";
import { EASE, SNAP } from "./motion";
import { SlantPlate } from "./slant-plate";
import { HARD_SHADOW, RADIUS, RADIUS_INNER, SLANT, srgb, ui } from "./tokens";
import { playerColors } from "../player-colors";
import type { UiStage } from "./stage";
import { UiShaderMaterial } from "./ui-shader";

/** Room around the band's box for its hard shadow. */
const REACH = 12;
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
 * right, speed streaks, a light sweep and a slanted wipe. Name and seat tags are `SlantPlate`s.
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
    streak: { value: -1 },
    flash: { value: 0 },
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
      uniform float radius, reveal, shine, streak, flash, opacity;
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
            col = mix(col, light, .28 * line * step(slab.x + 3., u));
          }
          if (ring.z > 0.) {
            vec2 q = vec2(u, p.y) - ring.xy;
            float r = ring.z;
            // The crest's seat: a tinted disc with a light rim, wholly inside the band.
            float circle = abs(length(q) - r) - 2.;
            col = mix(col, accent, .22 * (1. - smoothstep(-aa, aa, length(q) - r)));
            col = mix(col, light, .9 * (1. - smoothstep(-aa, aa, circle)));
          }
          if (shine >= 0.) {
            float c = mix(-48., boxSize.x + 48., shine);
            float b0 = (u - c) / 18., b1 = (u - c + 34.) / 5.;
            col = mix(col, vec3(1.), .45 * min(1., exp(-b0 * b0) + .6 * exp(-b1 * b1)));
          }
          col = mix(col, vec3(1.), flash);
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
      ? { height: 60, line: 18, name: 12, portrait: 116, enter: 260, exit: 220 }
      : { height: 84, line: 26, name: 15, portrait: 160, enter: 260, exit: 220 };
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
    this.portrait.setProperties({
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
    this.portrait.setProperties({ positionLeft: -look.portrait * 0.06 });
    const box = this.band.update();
    const u = this.band.uniforms;
    if (box) {
      u.slab.value.set(lead * 0.62, ult ? 3 : 2);
      u.ring.value.set(box[0] - slant - tail * 0.5 - slant * 0.5, h / 2, h * 0.3);
    }

    const age = now - cue.born;
    const leaving = clamp(1 - (cue.duration - age) / look.exit);
    const out = SNAP(leaving);
    const scale = look.enter / 420;
    const sweep = SNAP(step(age, 0, look.enter));
    const width = box?.[0] ?? 400;
    this.root.setProperties({
      transformTranslateX: -(1 - sweep) * 1.12 * (width + left) - out * 0.4 * width,
    });
    fade(this.root, 1 - leaving);
    const figure = EASE(step(age, 60 * scale, 550 * scale));
    fade(this.portrait, figure).setProperties({
      transformTranslateX: -(1 - figure) * 0.14 * look.portrait,
      transformScaleX: ult ? 1 + 0.08 * (1 - figure) : 1,
      transformScaleY: ult ? 1 + 0.08 * (1 - figure) : 1,
    });
    const plate = SNAP(step(age, 180 * scale, 400 * scale));
    this.name.plate.set({ reveal: plate });
    this.seat.plate.set({ reveal: plate });
    fade(this.name.label, step(age, 300 * scale, 160));
    fade(this.seat.label, step(age, 300 * scale, 160));
    const words = EASE(step(age, 260 * scale, 380 * scale));
    fade(this.line, words).setProperties({ transformTranslateX: -(1 - words) * 16 });
    fade(this.crest, EASE(step(age, 200 * scale, 300 * scale)));
    u.reveal.value = 1;
    u.shine.value = ult || cue.kind === "deploy" ? step(age, look.enter * 0.6, 520) : -1;
    if (u.shine.value >= 1) u.shine.value = -1;
    u.streak.value = ult ? age / 1000 : -1;
    u.flash.value = ult ? 0.6 * (1 - step(age, 0, 140)) : 0;
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
