import {
  AnimationMixer,
  Box3,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LinearSRGBColorSpace,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SkinnedMesh,
  Vector2,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderer,
} from "three";
import { images } from "../../prepare/images";
import type { AppRenderer } from "../../rendering/app-renderer";
import type { ElementType } from "../../run/sim/content/elements";
import type { FormId } from "../../run/sim/content/lines/index";
import { applyWorldOutput } from "../../run/view/grade";
import {
  bindModelStore,
  formModels,
  instantiate,
  models,
  shinyMapNeed,
  yawFor,
  type ModelInstance,
} from "../../run/view/assets";
import type { Handle } from "../../prepare/handle";
import { trainerArt, trainerOrder, type TrainerId } from "../../trainers";
import { BALL_STAGE_GLSL } from "./ball-stage";
import { studio } from "./codex-model";
import { cubicBezier } from "./focus-mark";
import { EASE, idleTicked, patternDrift, SNAP } from "./motion";
import { themeColors } from "./run-theme";
import { SLANT, srgb, ui } from "./tokens";
import { crestSrc } from "./type-icon";

/** A form's model as the lobby shows it: the store's copy, unit high, centred, facing the camera. */
interface Staged {
  url: string;
  holder: Group;
  mixer?: AnimationMixer;
  copy: ModelInstance;
}

/** Normalises the store's copy as the 图鉴 does (unit height about its centre, `yawFor` facing). */
function stage(url: string, copy: ModelInstance): Staged {
  const root = copy.root;
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root, true);
  const size = bounds.getSize(new Vector3());
  const centre = bounds.getCenter(new Vector3());
  const scale = 1 / size.y;
  const body = new Group();
  body.scale.setScalar(scale);
  body.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
  body.add(root);
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) node.frustumCulled = false;
  });
  const holder = new Group();
  holder.rotation.y = yawFor(url);
  holder.add(body);
  const idle = copy.animations.find((clip) => /idle/i.test(clip.name));
  if (!idle) return { url, holder, copy };
  const mixer = new AnimationMixer(root);
  mixer.clipAction(idle).play();
  return { url, holder, copy, mixer };
}

/** Where the lobby's layout puts the scene, in CSS pixels from the canvas's top left. */
export interface LobbySceneLayout {
  width: number;
  height: number;
  /** Where the trainer slab's edge meets the top of the screen; it leans left going down. */
  slab: number;
  /**
   * The trainer's full-body art: its centre line, top and drawn height (the screen cuts its legs),
   * and the right edge it may reach (a wide pose is drawn smaller to stay inside it).
   */
  trainer: { x: number; y: number; h: number; right: number };
  /** The partner's feet (the ball stage's centre), the stage's rim radius and the partner's height. */
  feet: { x: number; y: number };
  rx: number;
  /** The stage box the partner fits into, above the feet and centred on them. */
  heroW: number;
  heroH: number;
}

/** The partner pops onto the stage (0.45s, a small overshoot); the last one sinks first. */
const ENTER_MS = 450;
const SINK_MS = 160;
/** A switch's ripple off the ball's rim, and the slab's cross-fade to the new type. */
const BURST_MS = 620;
const TYPE_MS = 300;
/** The slab sweeps in from −112% (SNAP), the trainer follows 60ms later (EASE). */
const SLAB_MS = 420;
const TRAINER_MS = 550;
const TRAINER_DELAY = 60;
/** The three-quarter view, the slow sway around it and its period. */
const START_YAW = -0.45;
const SWAY = 0.15;
const SWAY_MS = 6000;
/** The bob of a model without an idle clip (2.6s, as the old stage). */
const BOB_MS = 2600;
/** How much of the frame's height the unit-high model fills. */
const FILL = 0.94;
/** A model whose lowest point stands this share of its height above its origin floats; it fills
 *  FLOAT_FILL of the stage's height, centred, so it hovers clear of the ball. */
const HOVER = 0.03;
const FLOAT_FILL = 0.8;
/** A model's camera fit for one layout: the zoom and the shift that centres it on the stage. */
interface Fit {
  key: string;
  zoom: number;
  x: number;
  y: number;
}
const easeInOut = (t: number) => cubicBezier(t, 0.42, 0, 0.58, 1);
/** Back-out with a ~6% overshoot: the partner pops onto the stage. */
const popOut = (t: number) => {
  const c = 1.2;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** sRGB components of a CSS colour (the layers compute in display space). */
function display(hex: string, out = new Color()): Color {
  const c = srgb(hex);
  return out.setRGB(c.x, c.y, c.z, LinearSRGBColorSpace);
}

const glsl = (hex: string) => {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
};

/**
 * The scene's flat layers in one fullscreen pass, in display colour (the world target holds
 * display colour, `rendering/world-pass.ts`): the paper ground with the ball/cloud/star pattern;
 * the line-drawn ball stage; the trainer slab (type colour, the type's card face
 * soft-light, a faint crest) with its white and type edge bands; the trainer's full-body art with
 * its hard shadow over everything.
 */
const LAYERS_FRAGMENT = /* glsl */ `
uniform vec2 viewSize, trainerSize;
uniform sampler2D pattern, cardA, cardB, crest, trainer;
uniform vec4 trainerBox; // left, top, w, h (CSS px)
uniform vec2 feet, drift, cardDrift;
uniform float rx, time, slab, slabShift, trainerShift, trainerIn, patternOn, cardAOn, cardBOn;
uniform float crestOn, typeMix, burst;
uniform vec3 themeA, themeB;
varying vec2 vUv;
const float SLANT = ${SLANT.toFixed(6)};
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
vec4 tex(sampler2D map, vec2 u) { return texture2D(map, vec2(u.x, 1. - u.y)); }
bool inside(vec2 u) { return all(greaterThanEqual(u, vec2(0.))) && all(lessThanEqual(u, vec2(1.))); }
float sides(float x) { return smoothstep(0., .04, x) * smoothstep(1., .96, x); }
vec3 softLight(vec3 b, vec3 s) {
  vec3 d = mix(sqrt(b), ((16. * b - 12.) * b + 4.) * b, step(b, vec3(.25)));
  return mix(b + (2. * s - 1.) * (d - b), b - (1. - 2. * s) * b * (1. - b), step(s, vec3(.5)));
}
${BALL_STAGE_GLSL}
// The slab's face for one type: its colour with the card face soft-light, one card covering the
// slab's box (tiling it would show the card's edges as seams).
vec3 slabFace(vec3 theme, sampler2D card, float on, vec2 p) {
  // Drifting with the ground: mirrored past its box, so the card never shows an edge.
  vec2 u = 1. - abs(1. - mod((p - cardDrift) / max(slab, viewSize.y), 2.));
  return mix(theme, softLight(theme, toSrgb(tex(card, u).rgb)), .9 * on);
}
void main() {
  vec2 p = vec2(vUv.x, 1. - vUv.y) * viewSize;
  float aa = .5 * max(fwidth(p.x), fwidth(p.y));
  vec3 typeColor = mix(themeA, themeB, typeMix);
  // 1. Paper with the transition pattern at 28% (360px tiles).
  vec3 col = ${glsl(ui.paper)};
  col = mix(col, toSrgb(tex(pattern, (p - drift) / 360.).rgb), .28 * patternOn);
  // 2. The ball stage, and a switch's ripple off its rim in the new type's colour.
  col = ballStage(col, p, feet, rx, time, typeColor, aa);
  if (burst < 1.) {
    float wave = 1. - (1. - burst) * (1. - burst) * (1. - burst);
    vec2 q = (p - feet) / (rx * mix(1., 1.45, wave) * vec2(1., .35));
    float d = abs(length(q) - 1.) * rx * .35;
    col = mix(col, typeColor, (1. - burst) * .55 * (1. - smoothstep(1.5 - aa, 3. + aa, d)));
  }
  // 3. The slab: everything left of its edge (which leans with the slant), shifted while it enters.
  float e = (p.x - slabShift) - (slab - p.y * SLANT);
  if (e < 28. + aa) {
    vec2 sp = p - vec2(slabShift, 0.);
    vec3 face = mix(slabFace(themeA, cardA, cardAOn, sp), slabFace(themeB, cardB, cardBOn, sp), typeMix);
    // A faint white crest, turned -12 deg and floating 10px over 6s.
    vec2 cc = vec2(slab * .66, viewSize.y * .34 - 5. + 5. * cos(time * 1.0472));
    float side = slab * .62;
    float ang = radians(12.);
    vec2 r = sp - cc;
    r = vec2(cos(ang) * r.x - sin(ang) * r.y, sin(ang) * r.x + cos(ang) * r.y) / side + .5;
    if (inside(r)) face = mix(face, vec3(1.), .16 * crestOn * tex(crest, r).a);
    col = mix(col, face, 1. - smoothstep(-aa, aa, e));
    // Its edge: a 14px white band, 8px of ground, a 6px type band.
    col = mix(col, vec3(1.), smoothstep(-aa, aa, e) * (1. - smoothstep(14. - aa, 14. + aa, e)));
    col = mix(col, typeColor, smoothstep(22. - aa, 22. + aa, e) * (1. - smoothstep(28. - aa, 28. + aa, e)));
  }
  // 4. The trainer over everything, with a hard black 18% shadow down and right.
  if (trainerIn > 0.) {
    vec2 at = trainerBox.xy + vec2(trainerShift, 0.);
    float drop = trainerBox.w * .0095;
    // The art is cropped tight (a hand or the ball can touch its box): its sides fade out, art and
    // shadow alike, so a box edge on screen never reads as a cut line.
    vec2 su = (p - at - vec2(drop)) / trainerBox.zw;
    if (inside(su)) col = mix(col, vec3(0.), .18 * trainerIn * tex(trainer, su).a * sides(su.x));
    vec2 tu = (p - at) / trainerBox.zw;
    if (inside(tu)) {
      vec4 t = tex(trainer, tu);
      // Straight alpha, as both platforms decode it (an ImageBitmap with premultiplyAlpha none,
      // sharp's raw RGBA): the colour is used as is.
      col = mix(col, toSrgb(t.rgb), t.a * trainerIn * sides(tu.x));
    }
  }
  gl_FragColor = vec4(col, 1.);
}
`;

/**
 * The lobby's world client (DESIGN.md render owner's world-client contract): the scene under
 * every lobby control — paper ground, ball stage, trainer slab and art, and the selected line's
 * live GLB. It draws into the world target only when its picture moves: entrances and switches
 * every frame, the idle loop (dashes, crest, idle clip, sway) on the page's 30Hz idle clock, nothing
 * while covered. The entrances start on the first uncovered frame.
 */
export class LobbyScene {
  private readonly app: AppRenderer;
  private readonly notify: (message: string) => void;
  private readonly layers = new Scene();
  private readonly flat = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly turntable = new Group();
  private readonly hero = studio(this.turntable);
  private readonly camera = new PerspectiveCamera(26, 1, 0.05, 50);
  private readonly clear = new Color();
  private readonly probe = new Vector3();
  private readonly probe2 = new Vector3();
  /** Each model's camera fit for the current layout (see `fitFor`). */
  private readonly fits = new WeakMap<Staged, Fit>();
  private layout: LobbySceneLayout | null = null;
  private form: FormId | null = null;
  private shiny = false;
  private type: ElementType | null = null;
  private trainerId: TrainerId | null = null;
  private trainerLocked = false;
  /** Trainer art views that have arrived (the others load once the first is in). */
  private readonly trainerArt = new Map<string, { view: Texture; loaded: boolean }>();
  /** Every image view this scene made (the store leaves view disposal to its consumer). */
  private readonly views = new Set<Texture>();
  private current: Staged | null = null;
  private leaving: { prepared: Staged; age: number } | null = null;
  /** Models held from the store (with a shiny copy's map): the current pick on the interactive
   *  lane, earlier ones on keep. Keyed by the model and its look. */
  private readonly held = new Map<
    string,
    { handles: Handle<unknown>[]; staged: Promise<Staged> }
  >();
  private compiled = new WeakSet<Staged>();
  private request = 0;
  private age = 0;
  private heroAge = ENTER_MS;
  private burstAge = BURST_MS;
  private typeAge = TYPE_MS;
  private slabAge = 0;
  /** Since the current trainer's art arrived (its entrance waits for it). */
  private trainerAge = -1;
  private covered = false;
  private dirty = true;
  private disposed = false;
  private readonly releaseWorld: () => void;
  private readonly releaseResident: () => void;

  constructor(app: AppRenderer, notify: (message: string) => void) {
    this.app = app;
    this.notify = notify;
    this.geometry.setAttribute(
      "position",
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.material = new ShaderMaterial({
      uniforms: {
        viewSize: { value: new Vector2(1, 1) },
        pattern: {
          value: this.view("/art/transition-pattern.webp", "pattern", () => {
            this.material.uniforms.patternOn!.value = 1;
            this.dirty = true;
          }),
        },
        patternOn: { value: 0 },
        cardA: { value: null },
        cardB: { value: null },
        cardAOn: { value: 0 },
        cardBOn: { value: 0 },
        themeA: { value: new Color() },
        themeB: { value: new Color() },
        typeMix: { value: 1 },
        crest: { value: null },
        crestOn: { value: 0 },
        trainer: { value: null },
        trainerSize: { value: new Vector2(1, 1) },
        trainerBox: { value: new Vector4() },
        trainerIn: { value: 0 },
        trainerShift: { value: 0 },
        slab: { value: 0 },
        slabShift: { value: 0 },
        feet: { value: new Vector2() },
        rx: { value: 1 },
        burst: { value: 1 },
        time: { value: 0 },
        drift: { value: new Vector2() },
        cardDrift: { value: new Vector2() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: LAYERS_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.layers.add(quad);
    this.turntable.rotation.y = START_YAW;
    this.releaseWorld = app.setWorld({
      advance: (deltaMs) => this.advance(deltaMs),
      draw: (renderer) => this.draw(renderer),
    });
    this.releaseResident = app.resident({ release: () => this.releaseUploads() });
    // The store's models release (and re-upload) through its own resident.
    bindModelStore(app);
  }

  /** Where the scene sits; the lobby calls it on every resize (CSS px). */
  setLayout(layout: LobbySceneLayout): void {
    this.layout = layout;
    const u = this.material.uniforms;
    u.viewSize!.value.set(layout.width, layout.height);
    u.feet!.value.set(layout.feet.x, layout.feet.y);
    u.rx!.value = layout.rx;
    u.slab!.value = layout.slab;
    this.dirty = true;
  }

  /**
   * Shows `form` (its type on the slab and stage, its live model) in its normal or shiny colours;
   * the previous model sinks out. The same partner in its other colours swaps in place once the
   * new copy is ready: same pose, no sink, and the stage's ripple marks the change.
   */
  show(form: FormId, type: ElementType, shiny = false): void {
    if (form === this.form && shiny === this.shiny) return;
    const recolour = form === this.form && this.current?.holder.parent === this.turntable;
    const first = this.form === null;
    this.form = form;
    this.shiny = shiny;
    const request = ++this.request;
    const failed = (error: unknown) => {
      // Released before it arrived (the lobby unmounted or moved on): not a failure.
      if (request !== this.request || this.disposed) return;
      console.error("大厅模型载入失败", form, shiny, error);
      this.notify("模型载入失败，请检查网络后再试。");
    };
    if (recolour) {
      const was = this.current!;
      void this.model(form, shiny).then((prepared) => {
        if (request !== this.request || this.disposed) return;
        this.compile(prepared).then(() => {
          if (request !== this.request || this.disposed) return;
          if (was.mixer && prepared.mixer) prepared.mixer.setTime(was.mixer.time);
          was.holder.removeFromParent();
          this.turntable.add(prepared.holder);
          this.current = prepared;
          this.burstAge = 0;
          this.dirty = true;
        }, failed);
      }, failed);
      return;
    }
    this.setType(type, first);
    this.burstAge = first ? BURST_MS : 0;
    // Only a partner that has stood on the stage sinks; one still waiting for the last sink is
    // dropped and the sink already running carries on.
    if (this.current?.holder.parent === this.turntable)
      this.leaving = { prepared: this.current, age: 0 };
    this.current = null;
    this.turntable.clear();
    if (this.leaving) this.turntable.add(this.leaving.prepared.holder);
    void this.model(form, shiny).then((prepared) => {
      if (request !== this.request || this.disposed) return;
      this.compile(prepared).then(() => {
        if (request !== this.request || this.disposed) return;
        this.current = prepared;
        this.heroAge = 0;
        this.dirty = true;
      }, failed);
    }, failed);
    this.dirty = true;
  }

  /** The slab takes the type's colour, card and crest, cross-fading from the last type. */
  private setType(type: ElementType, first: boolean): void {
    if (type === this.type) return;
    this.type = type;
    const u = this.material.uniforms;
    // The old face becomes A, the new one B; the mix runs A → B. The face before it is done with.
    this.drop(u.cardA!.value as Texture | null);
    u.cardA!.value = u.cardB!.value;
    u.cardAOn!.value = u.cardBOn!.value;
    (u.themeA!.value as Color).copy(u.themeB!.value as Color);
    const card = this.view(`/art/cards/${type}.webp`, "pattern", () => {
      if (u.cardB!.value === card) u.cardBOn!.value = 1;
      else if (u.cardA!.value === card) u.cardAOn!.value = 1;
      this.dirty = true;
    });
    u.cardB!.value = card;
    u.cardBOn!.value = 0;
    display(themeColors(type).theme, u.themeB!.value as Color);
    const crest = this.view(crestSrc(type), "art", () => {
      if (u.crest!.value === crest) u.crestOn!.value = 1;
      this.dirty = true;
    });
    this.drop(u.crest!.value as Texture | null);
    u.crest!.value = crest;
    u.crestOn!.value = 0;
    this.typeAge = first ? TYPE_MS : 0;
  }

  /** Shows the trainer: the slab sweeps in again and the art follows once it has arrived. */
  showTrainer(id: TrainerId, locked = false): void {
    if (id === this.trainerId && locked === this.trainerLocked) return;
    this.trainerId = id;
    this.trainerLocked = locked;
    const art = this.art(id, locked);
    const u = this.material.uniforms;
    u.trainer!.value = art.view;
    this.slabAge = 0;
    this.trainerAge = art.loaded ? 0 : -1;
    this.dirty = true;
  }

  private art(id: TrainerId, locked = false): { view: Texture; loaded: boolean } {
    const url = trainerArt(id, locked ? "lobby-locked" : "lobby");
    let art = this.trainerArt.get(url);
    if (art) return art;
    const entry: { view: Texture; loaded: boolean } = {
      view: this.view(url, "art", () => {
        entry.loaded = true;
        if (this.trainerId === id && this.trainerLocked === locked && this.trainerAge < 0)
          this.trainerAge = 0;
        this.dirty = true;
        // Once the shown trainer is in, the others load, so a switch shows them at once.
        for (const other of trainerOrder) this.art(other);
      }),
      loaded: false,
    };
    art = entry;
    this.trainerArt.set(url, art);
    return art;
  }

  /** A view of the image store's shared Source (one upload for every scene and screen); its load
   *  callback is dropped once the scene is gone. */
  private view(url: string, kind: "art" | "pattern", onLoad: () => void): Texture {
    const view = images().texture(url, kind, () => {
      if (!this.disposed) onLoad();
    });
    this.views.add(view);
    return view;
  }

  /** A view the scene no longer samples. */
  private drop(view: Texture | null): void {
    if (!view) return;
    view.dispose();
    this.views.delete(view);
  }

  /** A window or a screen lies over the lobby: nothing here moves or redraws. */
  setCovered(covered: boolean): void {
    this.covered = covered;
    if (!covered) this.dirty = true;
  }

  /** The store's model in its own copy; a shiny copy has its own recoloured materials (and the
   *  form's shiny map where it has one), so the store's shared materials are never patched. */
  private model(form: FormId, shiny: boolean): Promise<Staged> {
    const url = formModels[form].url;
    const key = shiny ? `${url}#shiny` : url;
    // The previous pick stays warm on the keep lane; the new one loads as interactive.
    for (const [held, entry] of this.held)
      for (const handle of entry.handles) handle.setLane(held === key ? "interactive" : "keep");
    let entry = this.held.get(key);
    if (!entry) {
      const model = models.acquire(url, "interactive");
      const map = shiny ? shinyMapNeed(form)?.acquire("interactive") : undefined;
      const handles: Handle<unknown>[] = map ? [model, map] : [model];
      entry = {
        handles,
        staged: Promise.all([model.result, map?.result])
          .then(([canonical, texture]) =>
            stage(url, instantiate(canonical, shiny ? { form, map: texture } : undefined)),
          )
          .catch((error: unknown) => {
            if (this.held.get(key) === entry) {
              this.held.delete(key);
              for (const handle of handles) handle.release();
            }
            throw error;
          }),
      };
      this.held.set(key, entry);
    }
    return entry.staged;
  }

  /** Compiles the model's programs under the world target before its first frame. */
  private compile(prepared: Staged): Promise<void> {
    if (this.compiled.has(prepared)) return Promise.resolve();
    const scene = studio(new Group().add(prepared.holder));
    applyWorldOutput(scene);
    const renderer = this.app.renderer;
    const ready = this.app.inWorldTarget(() => renderer.compileAsync(scene, this.camera));
    return ready.then(() => {
      this.compiled.add(prepared);
      prepared.holder.removeFromParent();
    });
  }

  private advance(deltaMs: number): boolean {
    if (this.disposed || this.covered || !this.layout) return false;
    this.age += deltaMs;
    this.heroAge += deltaMs;
    this.burstAge += deltaMs;
    this.typeAge += deltaMs;
    this.slabAge += deltaMs;
    if (this.trainerAge >= 0) this.trainerAge += deltaMs;
    const u = this.material.uniforms;
    u.time!.value = (this.age / 1000) % 7200;
    (u.drift!.value as Vector2).set(...patternDrift());
    // The card's mirrored repeat is twice its box.
    const card = 2 * Math.max(this.layout.slab, this.layout.height);
    (u.cardDrift!.value as Vector2).set(...patternDrift(card));
    u.burst!.value = Math.min(1, this.burstAge / BURST_MS);
    u.typeMix!.value = Math.min(1, this.typeAge / TYPE_MS);
    const width = this.layout.width;
    u.slabShift!.value = -1.12 * width * (1 - SNAP(Math.min(1, this.slabAge / SLAB_MS)));
    const art = Math.max(0, Math.min(1, (this.trainerAge - TRAINER_DELAY) / TRAINER_MS));
    const shown = this.trainerAge < 0 ? 0 : EASE(art);
    u.trainerIn!.value = shown;
    u.trainerShift!.value = -0.14 * (u.trainerBox!.value as Vector4).z * (1 - shown);
    let moving =
      this.heroAge < ENTER_MS ||
      this.burstAge < BURST_MS ||
      this.typeAge < TYPE_MS ||
      this.slabAge < SLAB_MS ||
      (this.trainerAge >= 0 && this.trainerAge < TRAINER_DELAY + TRAINER_MS);
    const leaving = this.leaving;
    if (leaving) {
      leaving.age += deltaMs;
      moving = true;
      if (leaving.age >= SINK_MS) {
        leaving.prepared.holder.removeFromParent();
        this.leaving = null;
      }
    }
    const current = this.current;
    if (current) {
      // The new partner pops in once the old one has sunk: the two never share the stage.
      if (this.leaving) this.heroAge = 0;
      else if (current.holder.parent !== this.turntable) this.turntable.add(current.holder);
      current.mixer?.update(deltaMs / 1000);
    }
    // The page's idle clock, read as the UI reads it: a UI loop that stepped last frame repaints
    // this frame (its stage updates after it invalidates), so the scene steps on the same frame.
    const draw = this.dirty || moving || idleTicked(30);
    this.dirty = false;
    return draw;
  }

  private draw(renderer: WebGLRenderer): void {
    const layout = this.layout;
    if (!layout) return;
    renderer.setClearColor(this.clear.setRGB(0.98, 0.98, 0.98, LinearSRGBColorSpace), 1);
    renderer.clear(true, true, true);
    const u = this.material.uniforms;
    // The trainer's box from the art's real size (the three are not the same width).
    const image = (u.trainer!.value as Texture | null)?.image as
      | { width?: number; height?: number }
      | null
      | undefined;
    if (image?.width && image.height) {
      const { x, right } = layout.trainer;
      // Its left side runs off the screen, never short of it: the right edge is the smaller of
      // x + w/2 and 0.96w, so the widest box that stays inside `right` is the larger bound.
      const w = Math.min(
        (layout.trainer.h * image.width) / image.height,
        Math.max(2 * (right - x), right / 0.96),
      );
      const h = (w * image.height) / image.width;
      const left = Math.min(x - w / 2, -0.04 * w);
      (u.trainerBox!.value as Vector4).set(left, layout.trainer.y, w, h);
    }
    renderer.render(this.layers, this.flat);
    if (!this.current && !this.leaving) return;
    const shown = this.current?.holder.parent === this.turntable ? this.current : null;
    const progress = Math.min(1, this.heroAge / ENTER_MS);
    // The hero: a unit-high model filling FILL of a square frame whose bottom sits on the feet.
    const frame = layout.heroH / FILL;
    const left = layout.feet.x - frame / 2,
      top = layout.feet.y - frame;
    const camera = this.camera;
    camera.aspect = 1;
    const distance = 0.5 / (FILL * Math.tan((camera.fov * Math.PI) / 360));
    camera.position.set(0, distance * 0.18, distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.zoom = 1;
    camera.setViewOffset(frame, frame, -left, -top, layout.width, layout.height);
    camera.updateProjectionMatrix();
    // Perspective draws the toes (nearer the camera) lower and larger than the unit box's centre
    // line: fit the model's own drawn silhouette instead, measured once per model and layout at
    // its resting turn (the sway would make it breathe). The leaving model keeps its fit.
    const fitted = shown ?? this.leaving?.prepared;
    const fit = fitted ? this.fitFor(fitted, layout) : null;
    if (fit) {
      camera.zoom = fit.zoom;
      camera.setViewOffset(frame, frame, -left + fit.x, -top + fit.y, layout.width, layout.height);
      camera.updateProjectionMatrix();
    }
    const t = this.age;
    this.turntable.rotation.y = START_YAW + SWAY * Math.sin((t / SWAY_MS) * Math.PI * 2);
    const leaving = this.leaving;
    if (leaving) {
      const k = Math.min(1, leaving.age / SINK_MS);
      leaving.prepared.holder.position.y = -0.2 * k;
      leaving.prepared.holder.scale.setScalar(1 - 0.45 * k);
    }
    if (shown) {
      const holder = shown.holder;
      // Popping in: from 0.6 and 80px down with a small overshoot; without an idle clip, a bob.
      const enter = popOut(progress);
      const rise = (80 / layout.heroH) * (1 - Math.min(1, enter));
      const leg = (t / BOB_MS) % 2;
      const bob = shown.mixer ? 0 : easeInOut(leg < 1 ? leg : 2 - leg) * 0.012;
      holder.position.y = -rise + bob;
      holder.scale.setScalar(0.6 + 0.4 * enter);
    }
    applyWorldOutput(this.hero);
    renderer.clearDepth();
    renderer.render(this.hero, camera);
  }

  /**
   * Fits the model's drawn silhouette (its posed vertices at the resting turn) into the stage box
   * `heroW` × `heroH` above the feet, centred on the ball. A form that stands on the ground puts its
   * lowest point on the ball's centre; one that floats in its model (lowest point above its own
   * origin, as Gastly and Geodude) hovers a tenth of the box above the ball.
   */
  private fitFor(staged: Staged, layout: LobbySceneLayout): Fit {
    const key = [
      layout.width,
      layout.height,
      layout.heroH,
      layout.heroW,
      layout.feet.x,
      layout.feet.y,
    ].join(",");
    const known = this.fits.get(staged);
    if (known?.key === key) return known;
    const camera = this.camera;
    const holder = staged.holder;
    const rotation = this.turntable.rotation.y;
    const position = holder.position.y,
      scale = holder.scale.x;
    this.turntable.rotation.y = START_YAW;
    holder.position.y = 0;
    holder.scale.setScalar(1);
    this.turntable.updateMatrixWorld(true);
    const root = staged.copy.root;
    const ground = root.localToWorld(this.probe2.set(0, 0, 0)).y;
    const point = this.probe;
    let low = Infinity,
      high = -Infinity,
      x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const count = (node.geometry as BufferGeometry).getAttribute("position").count;
      for (let i = 0; i < count; i++) {
        node.getVertexPosition(i, point).applyMatrix4(node.matrixWorld);
        low = Math.min(low, point.y);
        high = Math.max(high, point.y);
        point.project(camera);
        const x = ((point.x + 1) / 2) * layout.width,
          y = ((1 - point.y) / 2) * layout.height;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    });
    this.turntable.rotation.y = rotation;
    holder.position.y = position;
    holder.scale.setScalar(scale);
    const floats = (low - ground) / (high - low) > HOVER;
    const zoom = Math.min(
      (layout.heroH * (floats ? FLOAT_FILL : 1)) / Math.max(1, y1 - y0),
      layout.heroW / Math.max(1, x1 - x0),
    );
    // The zoom scales about the camera's axis: the frame's centre, `frame / 2` above the feet.
    const axisY = layout.feet.y - layout.heroH / FILL / 2;
    const at = (v: number, c: number) => c + (v - c) * zoom;
    const x = (at(x0, layout.feet.x) + at(x1, layout.feet.x)) / 2 - layout.feet.x;
    // A floating form hovers a tenth of the box above the ball: one as tall as FLOAT_FILL is
    // centred in the box; a short, wide one (Geodude) stays low rather than hanging in mid-air.
    const bottom = at(y1, axisY);
    const y = bottom - layout.feet.y + (floats ? (layout.heroH * (1 - FLOAT_FILL)) / 2 : 0);
    const fit = { key, zoom, x, y };
    this.fits.set(staged, fit);
    return fit;
  }

  /** Context lost: GPU copies only; the next frames upload and compile again. */
  private releaseUploads(): void {
    this.material.dispose();
    this.geometry.dispose();
    // Our views' GPU copies; the views stay bound and upload again when next drawn.
    for (const view of this.views) view.dispose();
    // Our copies' bone textures and shiny materials (the shared model and map are the store's own
    // loss residents); the next draw compiles them again.
    for (const { staged } of this.held.values())
      void staged.then(
        (entry) => entry.copy.releaseUploads(),
        () => {},
      );
    this.compiled = new WeakSet();
    this.dirty = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseWorld();
    this.releaseResident();
    this.turntable.clear();
    this.material.dispose();
    this.geometry.dispose();
    for (const view of this.views) view.dispose();
    this.views.clear();
    this.trainerArt.clear();
    // Our copies' skeletons (and a shiny copy's materials); the shared geometry, materials and
    // textures stay with the store.
    for (const { handles, staged } of this.held.values()) {
      void staged.then(
        (entry) => entry.copy.dispose(),
        () => {},
      );
      for (const handle of handles) handle.release();
    }
    this.held.clear();
  }
}
