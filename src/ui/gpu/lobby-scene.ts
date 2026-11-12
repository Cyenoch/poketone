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
  yawFor,
  type CanonicalModel,
  type ModelInstance,
} from "../../run/view/assets";
import type { Handle } from "../../prepare/handle";
import { studio } from "./codex-model";
import { cubicBezier, uiEaseOut } from "./focus-mark";
import { idleTicked } from "./motion";
import { themeColors } from "./run-choice-surface";

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
  /** Podium box (the image is 1200 × 406; its top face's centre is at 50%, 33%). */
  podium: { x: number; y: number; w: number; h: number };
  /** The hero's feet (the podium's top face centre) and its drawn height. */
  feet: { x: number; y: number };
  heroH: number;
}

/** The app's one world backdrop (DESIGN.md背景); its size is read from the image. */
const BACKDROP = "/art/lobby/backdrop.webp";
const ENTER_MS = 420;
const SINK_MS = 160;
/** The three-quarter view, the slow sway around it and its period. */
const START_YAW = -0.45;
const SWAY = 0.15;
const SWAY_MS = 6000;
/** The bob of a model without an idle clip (2.6s, as the old stage). */
const BOB_MS = 2600;
/** How much of the frame's height the unit-high model fills. */
const FILL = 0.94;
const easeInOut = (t: number) => cubicBezier(t, 0.42, 0, 0.58, 1);

/** A view of the image store's shared Source (one upload for every scene and screen). */
function texture(url: string, onLoad: () => void): Texture {
  return images().texture(url, "art", onLoad);
}

/** sRGB components of a CSS colour (the layers compute in display space). */
function display(hex: string): Color {
  const c = new Color(hex).convertLinearToSRGB();
  return new Color().setRGB(c.r, c.g, c.b, LinearSRGBColorSpace);
}

/**
 * The scene's flat layers in one fullscreen pass (DESIGN.md layers 1–5): the coastal
 * backdrop (cover), the type aura, the rising crests, the podium, the type ring on its top face and
 * the hero's contact shade. It writes display colour straight out (the world target holds display
 * colour, `rendering/world-pass.ts`).
 */
const LAYERS_FRAGMENT = /* glsl */ `
uniform vec2 viewSize, coastSize;
uniform sampler2D coast, podium, crest;
uniform vec4 podiumBox; // x, y, w, h (CSS px)
uniform vec2 feet;
uniform float heroH, time, reveal, heroIn, ready;
uniform vec3 theme, light, deep;
varying vec2 vUv;
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float ellipse(vec2 p, vec2 r) {
  float k = length(p / r);
  return k * (k - 1.) / max(length(p / (r * r)), 1e-4);
}
vec4 tex(sampler2D map, vec2 u) { return texture2D(map, vec2(u.x, 1. - u.y)); }
void main() {
  vec2 p = vec2(vUv.x, 1. - vUv.y) * viewSize;
  float aa = .5 * max(fwidth(p.x), fwidth(p.y));
  // 1. The coastal backdrop, cover-fit.
  float s = max(viewSize.x / coastSize.x, viewSize.y / coastSize.y);
  vec2 cu = (p - viewSize * .5) / (coastSize * s) + .5;
  vec3 col = toSrgb(tex(coast, cu).rgb);
  float pw = podiumBox.z;
  // The type light opens from the feet on a switch (a circle, 420ms).
  float open = reveal * 1.6 * max(viewSize.x, viewSize.y);
  float shown = 1. - smoothstep(open - 2., open, length(p - feet));
  // 2. The aura: light 80% → 33% at 55% → 0, around the hero's middle.
  vec2 ac = feet - vec2(0., heroH * .5);
  float ar = heroH * .62;
  float at = length(p - ac) / ar;
  float aura = at < .55 ? mix(.8, .33, at / .55) : mix(.33, 0., min(1., (at - .55) / .45));
  col = mix(col, light, aura * shown);
  // 3. Crests rising through the aura's box (7s, staggered by 1s).
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float m = fract((time + fi) / 7.);
    float alpha = m < .12 ? .5 * m / .12 : m < .75 ? mix(.5, .25, (m - .12) / .63) : mix(.25, 0., (m - .75) / .25);
    // A fading crest also shrinks, so it vanishes rather than drifting as a pale ghost over the sky.
    float side = (mod(fi, 2.) < .5 ? 20. : 30.) * (.45 + 1.1 * alpha);
    vec2 mc = vec2(ac.x - ar + ar * 2. * (.08 + fi * .14), ac.y + ar - 2. * ar * m);
    float ang = -radians(50.) * m;
    vec2 r = p - mc;
    r = vec2(cos(ang) * r.x - sin(ang) * r.y, sin(ang) * r.x + cos(ang) * r.y) / side + .5;
    if (all(greaterThanEqual(r, vec2(0.))) && all(lessThanEqual(r, vec2(1.)))) {
      vec4 mote = tex(crest, r);
      float edge = smoothstep(0., .08, min(min(r.x, 1. - r.x), min(r.y, 1. - r.y)));
      col = mix(col, toSrgb(mote.rgb / max(mote.a, 1e-4)), mote.a * edge * alpha * shown);
    }
  }
  // 4. The podium.
  vec2 pu = (p - podiumBox.xy) / podiumBox.zw;
  if (all(greaterThanEqual(pu, vec2(0.))) && all(lessThanEqual(pu, vec2(1.)))) {
    vec4 stone = tex(podium, pu);
    // The image's outermost texels are not quite clear (lossy WebP): nothing counts within 1%.
    float inner = smoothstep(0., .01, min(min(pu.x, 1. - pu.x), min(pu.y, 1. - pu.y)));
    col = mix(col, toSrgb(stone.rgb), stone.a * inner);
  }
  // 5. The type ring on the top face (4px light, an 18px theme glow), and the hero's contact shade.
  vec2 rr = vec2(.36, .075) * pw;
  float rd = ellipse(p - feet, rr);
  float stroke = max(2., pw / 125.);
  float line = 1. - smoothstep(stroke - aa, stroke + aa, abs(rd));
  float glow = exp(-pow(abs(rd) / (pw / 28.), 2.));
  col = mix(col, theme, .55 * glow * shown);
  col = mix(col, light, line * shown);
  float shade = 1. - smoothstep(-.2, 1., length((p - feet) / (vec2(.2, .045) * pw)));
  col = mix(col, vec3(.051, .137, .247), .28 * shade * heroIn * ready);
  gl_FragColor = vec4(col, 1.);
}
`;

/**
 * The lobby's world client (DESIGN.mdrender owner's world-client contract): the scene
 * under every lobby control — backdrop, aura, crests, podium, ring and the selected line's live GLB.
 * It draws into the world target only when its picture moves: switch animations every frame, the
 * idle loop (crests, idle clip, sway) on the page's 30Hz idle clock, nothing while covered.
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
  private readonly box = new Box3();
  /** Each model's camera fit for the current layout (see `fitFor`). */
  private readonly fits = new WeakMap<Staged, { key: string; zoom: number; lift: number }>();
  private layout: LobbySceneLayout | null = null;
  private form: FormId | null = null;
  private current: Staged | null = null;
  private leaving: { prepared: Staged; age: number } | null = null;
  /** Models held from the store: the current pick on the interactive lane, earlier ones on keep. */
  private readonly held = new Map<
    string,
    { handle: Handle<CanonicalModel>; staged: Promise<Staged> }
  >();
  private compiled = new WeakSet<Staged>();
  private request = 0;
  private age = 0;
  /** Since the current form was picked (the light's reveal) and since its model arrived. */
  private since = ENTER_MS;
  private heroAge = ENTER_MS;
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
    const redraw = () => (this.dirty = true);
    this.material = new ShaderMaterial({
      uniforms: {
        viewSize: { value: new Vector2(1, 1) },
        coastSize: { value: new Vector2(1, 1) },
        coast: { value: texture(BACKDROP, redraw) },
        podium: { value: texture("/art/lobby/podium.webp", redraw) },
        crest: { value: null },
        podiumBox: { value: new Vector4() },
        feet: { value: new Vector2() },
        heroH: { value: 1 },
        time: { value: 0 },
        reveal: { value: 1 },
        heroIn: { value: 0 },
        ready: { value: 0 },
        theme: { value: new Color() },
        light: { value: new Color() },
        deep: { value: new Color() },
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
    const { x, y, w, h } = layout.podium;
    u.podiumBox!.value.set(x, y, w, h);
    u.feet!.value.set(layout.feet.x, layout.feet.y);
    u.heroH!.value = layout.heroH;
    this.dirty = true;
  }

  /** Shows `form` (its type light and live model); the previous model sinks out. */
  show(form: FormId, type: ElementType): void {
    if (form === this.form) return;
    const first = this.form === null;
    this.form = form;
    const { theme, light, deep } = themeColors(type);
    const u = this.material.uniforms;
    u.theme!.value = display(theme);
    u.light!.value = display(light);
    u.deep!.value = display(deep);
    // Premultiplied, so its mipmaps (a 20–30px mote at DPR 1) do not average in the clear texels'
    // black and turn the crest grey.
    const crest = texture(`/art/icons/crests/${type}.webp`, () => (this.dirty = true));
    crest.premultiplyAlpha = true;
    u.crest!.value = crest;
    this.since = first ? ENTER_MS : 0;
    if (this.current) this.leaving = { prepared: this.current, age: 0 };
    this.current = null;
    this.turntable.clear();
    if (this.leaving) this.turntable.add(this.leaving.prepared.holder);
    const request = ++this.request;
    const failed = (error: unknown) => {
      // Released before it arrived (the lobby unmounted or moved on): not a failure.
      if (request !== this.request || this.disposed) return;
      console.error("大厅模型载入失败", form, error);
      this.notify("模型载入失败，请检查网络后再试。");
    };
    void this.model(form).then((prepared) => {
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

  /** A window or a screen lies over the lobby: nothing here moves or redraws. */
  setCovered(covered: boolean): void {
    this.covered = covered;
    if (!covered) this.dirty = true;
  }

  private model(form: FormId): Promise<Staged> {
    const url = formModels[form].url;
    // The previous pick stays warm on the keep lane; the new one loads as interactive.
    for (const [key, entry] of this.held)
      entry.handle.setLane(key === url ? "interactive" : "keep");
    let entry = this.held.get(url);
    if (!entry) {
      const handle = models.acquire(url, "interactive");
      entry = {
        handle,
        staged: handle.result
          .then((canonical) => stage(url, instantiate(canonical)))
          .catch((error: unknown) => {
            if (this.held.get(url) === entry) {
              this.held.delete(url);
              handle.release();
            }
            throw error;
          }),
      };
      this.held.set(url, entry);
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
    this.since += deltaMs;
    this.heroAge += deltaMs;
    const u = this.material.uniforms;
    u.time!.value = (this.age / 1000) % 7000;
    u.reveal!.value = uiEaseOut(Math.min(1, this.since / ENTER_MS));
    let moving = this.since < ENTER_MS || this.heroAge < ENTER_MS;
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
      if (current.holder.parent !== this.turntable) this.turntable.add(current.holder);
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
    renderer.setClearColor(this.clear.setRGB(0.6, 0.8, 0.95, LinearSRGBColorSpace), 1);
    renderer.clear(true, true, true);
    const u = this.material.uniforms;
    const enter = uiEaseOut(Math.min(1, this.heroAge / ENTER_MS));
    u.heroIn!.value = this.current ? enter : 0;
    u.ready!.value = this.current ? 1 : 0;
    // Cover-fit to the image's real size (an upscale may replace it under the same name).
    const image = (u.coast!.value as Texture).image as { width?: number; height?: number } | null;
    if (image?.width && image.height) u.coastSize!.value.set(image.width, image.height);
    renderer.render(this.layers, this.flat);
    if (!this.current && !this.leaving) return;
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
    // line: fit the model's own screen box instead, measured once per model and layout at its
    // resting turn (the sway would make it breathe), so it stands heroH tall with its footprint's
    // centre on the feet.
    const fit = this.current ? this.fitFor(this.current, layout, frame, left, top) : null;
    if (fit) {
      camera.zoom = fit.zoom;
      camera.setViewOffset(frame, frame, -left, -top + fit.lift, layout.width, layout.height);
      camera.updateProjectionMatrix();
    }
    const t = this.age;
    this.turntable.rotation.y = START_YAW + SWAY * Math.sin((t / SWAY_MS) * Math.PI * 2);
    const leaving = this.leaving;
    if (leaving) {
      const k = Math.min(1, leaving.age / SINK_MS);
      leaving.prepared.holder.position.y = -0.2 * k;
      leaving.prepared.holder.scale.setScalar(1 - 0.3 * k);
    }
    if (this.current) {
      const holder = this.current.holder;
      // Rising in: 28px up and 0.86 → 1; without an idle clip, the 2.6s bob.
      const rise = (28 / layout.heroH) * (1 - enter);
      const leg = (t / BOB_MS) % 2;
      const bob = this.current.mixer ? 0 : easeInOut(leg < 1 ? leg : 2 - leg) * 0.012;
      holder.position.y = -rise + bob;
      holder.scale.setScalar(0.86 + 0.14 * enter);
    }
    applyWorldOutput(this.hero);
    renderer.clearDepth();
    renderer.render(this.hero, camera);
  }

  private fitFor(
    staged: Staged,
    layout: LobbySceneLayout,
    frame: number,
    left: number,
    top: number,
  ): { zoom: number; lift: number } {
    const key = [layout.width, layout.height, layout.heroH, layout.feet.x, layout.feet.y].join(",");
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
    const box = this.box.setFromObject(holder, true);
    const screenY = (x: number, y: number, z: number) =>
      ((1 - this.probe.set(x, y, z).project(camera).y) / 2) * layout.height;
    const span = () => {
      let low = Infinity,
        high = -Infinity;
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const at = screenY(x, y, z);
            low = Math.min(low, at);
            high = Math.max(high, at);
          }
      return high - low;
    };
    const zoom = (layout.heroH / Math.max(1, span())) * camera.zoom;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    const centre = box.getCenter(this.probe2);
    const lift = screenY(centre.x, box.min.y, centre.z) - layout.feet.y;
    camera.zoom = 1;
    camera.setViewOffset(frame, frame, -left, -top, layout.width, layout.height);
    camera.updateProjectionMatrix();
    this.turntable.rotation.y = rotation;
    holder.position.y = position;
    holder.scale.setScalar(scale);
    const fit = { key, zoom, lift };
    this.fits.set(staged, fit);
    return fit;
  }

  /** Context lost: GPU copies only; the next frames upload and compile again. */
  private releaseUploads(): void {
    this.material.dispose();
    this.geometry.dispose();
    // Our copies' bone textures (the shared model is the store's own loss resident).
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
    // Our copies' skeletons only; the shared geometry, materials and textures stay with the store.
    for (const { handle, staged } of this.held.values()) {
      void staged.then(
        (entry) => entry.copy.dispose(),
        () => {},
      );
      handle.release();
    }
    this.held.clear();
  }
}
