import { Content } from "@pmndrs/uikit";
import {
  AnimationMixer,
  Box3,
  DataTexture,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SkinnedMesh,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from "three";
import type { CodexModel } from "../../run/codex";
import {
  enemyModel,
  formModels,
  instantiate,
  models,
  stationFiles,
  yawFor,
} from "../../run/view/assets";

/** Idle turn (rad/s), the pause after the player turns it, and the turn per arrow key / pixel. */
const SPIN = 0.45;
const SPIN_RESUME_MS = 2500;
export const KEY_TURN = Math.PI / 6;
const DRAG_TURN = 0.012;
/** Models kept while the 图鉴 is open, so browsing back and forth does not refetch. */
const CACHE = 8;
/** The three-quarter turn every picture starts from. */
const START_YAW = -0.5;
/** Thumbnail side in pixels: a 36px row icon at 150% on a 3× screen. */
const THUMB = 160;

function modelUrl(model: CodexModel): string {
  return model.kind === "form"
    ? formModels[model.id].url
    : model.kind === "enemy"
      ? enemyModel(model.id)
      : stationFiles[model.id].url;
}

interface Prepared {
  url: string;
  /** The 图鉴's own copy of the shared model (its skeleton) and its hold on the shared entry. */
  loaded: { releaseUploads(): void; dispose(): void };
  /** Facing and unit height applied; turns about its own centre. */
  holder: Group;
  radius: number;
  mixer?: AnimationMixer;
}

/**
 * The model from the shared store (the run and the lobby hold the same entry, so a line already in
 * memory is neither refetched nor re-parsed), copied for the 图鉴 and centred at unit height, facing
 * +Z like the run view.
 */
async function loadPrepared(url: string, signal: AbortSignal): Promise<Prepared> {
  const handle = models.acquire(url, "interactive");
  const abort = () => handle.release();
  signal.addEventListener("abort", abort, { once: true });
  const canonical = await handle.result.finally(() => signal.removeEventListener("abort", abort));
  if (signal.aborted) {
    handle.release();
    throw signal.reason;
  }
  const copy = instantiate(canonical);
  const loaded = {
    // Shared geometry, materials and textures are the store's; the copy owns its skeletons.
    releaseUploads: () => copy.releaseUploads(),
    dispose() {
      copy.dispose();
      handle.release();
    },
  };
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
  holder.updateMatrixWorld(true);
  const sphere = new Box3().setFromObject(holder, true).getBoundingSphere(new Sphere());
  const idle = copy.animations.find((clip) => /idle/i.test(clip.name));
  let mixer: AnimationMixer | undefined;
  if (idle) {
    mixer = new AnimationMixer(root);
    mixer.clipAction(idle).play();
  }
  return { url, loaded, holder, radius: sphere.radius, ...(mixer ? { mixer } : {}) };
}

/** Light rig shared by the stage and the thumbnails, so a thumbnail looks like its model. */
export function studio(turntable: Group): Scene {
  const scene = new Scene();
  const key = new DirectionalLight("#ffffff", 2.2);
  key.position.set(-2, 4, 5);
  const rim = new DirectionalLight("#cfe8ff", 1.1);
  rim.position.set(3, 2, -4);
  scene.add(new HemisphereLight("#ffffff", "#7d93a8", 2.4), key, rim, turntable);
  return scene;
}

/** Fits the bounding sphere in the narrower field of view, seen slightly from above. */
function frame(camera: PerspectiveCamera, radius: number, aspect: number): void {
  camera.aspect = aspect;
  const vertical = (camera.fov * Math.PI) / 360;
  const fit = Math.min(Math.tan(vertical), Math.tan(vertical) * aspect);
  const distance = (radius / fit) * 1.04;
  camera.position.set(0, distance * 0.2, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

/**
 * Shows a picture of an opaque model over a clear background, which is premultiplied. The window
 * fades it through `opacity`; the inherited UIKit text colour must not tint it.
 */
function pictureMaterial(name: string, map: Texture): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    map,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  material.customProgramCacheKey = () => `poketone-codex-${name}`;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `vec4 shot=texture2D(map,vMapUv);
      diffuseColor=vec4(shot.a>0.?shot.rgb/shot.a:vec3(0.),shot.a*opacity);`,
    );
  };
  return material;
}

function pictureContent(mesh: Mesh): Content {
  const content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  content.add(mesh);
  content.notifyAncestorsChanged();
  return content;
}

/** Renders `scene` into `target` without disturbing the window pass that follows. */
function renderInto(renderer: WebGLRenderer, target: WebGLRenderTarget, draw: () => void): void {
  const previous = renderer.getRenderTarget();
  const autoClear = renderer.autoClear;
  renderer.autoClear = true;
  renderer.setRenderTarget(target);
  try {
    draw();
  } finally {
    renderer.setRenderTarget(previous);
    renderer.autoClear = autoClear;
  }
}

/**
 * The selected entry's GLB, drawn by the UI renderer into its own render target and shown in the
 * layout as ordinary UIKit content (so it is placed, clipped, faded and layered like the rest of the
 * window). It renders only when the picture changes: a load, a turn, a resize, or the idle spin.
 * A model's programs compile in parallel before its first frame, so a first view never stalls.
 */
export class CodexModelStage {
  /** 8-bit sRGB storage: renderable with MSAA in core WebGL 2, and no banding in the darks. */
  private readonly target = new WebGLRenderTarget(1, 1, {
    samples: 4,
    colorSpace: SRGBColorSpace,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = pictureMaterial("model", this.target.texture);
  private readonly turntable = new Group();
  private readonly scene = studio(this.turntable);
  private readonly camera = new PerspectiveCamera(26, 1, 0.05, 50);
  private readonly cache: Prepared[] = [];
  /** Models whose programs this context has compiled. */
  private compiled = new WeakSet<Prepared>();
  private compiling = false;
  private current: Prepared | undefined;
  private content: Content | undefined;
  /** The mounted picture; hidden until the wanted model has drawn, so the last one never shows. */
  private mesh: Mesh | undefined;
  private wanted: string | undefined;
  private request: AbortController | undefined;
  private yaw = START_YAW;
  private sinceTurn = SPIN_RESUME_MS;
  private dirty = true;
  /** Load state of the wanted model, for the window's error text. */
  state: "idle" | "loading" | "ready" | "error" = "idle";
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  /** A fresh layout node showing the model; the window disposes it with its subtree. */
  mount(): Content {
    const mesh = new Mesh(this.geometry, this.material);
    mesh.visible = false;
    const content = pictureContent(mesh);
    this.content = content;
    this.mesh = mesh;
    this.dirty = true;
    content.abortSignal.addEventListener("abort", () => {
      if (this.content === content) this.content = undefined;
    });
    return content;
  }

  show(model: CodexModel | undefined): void {
    const url = model && modelUrl(model);
    if (url === this.wanted) return;
    this.wanted = url;
    this.request?.abort();
    this.request = undefined;
    this.turntable.clear();
    this.current = undefined;
    if (this.mesh) this.mesh.visible = false;
    this.yaw = START_YAW;
    this.sinceTurn = SPIN_RESUME_MS;
    this.dirty = true;
    if (!url) {
      this.state = "idle";
      return;
    }
    const at = this.cache.findIndex((entry) => entry.url === url);
    if (at >= 0) {
      const [known] = this.cache.splice(at, 1);
      this.cache.push(known!);
      this.use(known!);
      return;
    }
    this.state = "loading";
    const request = (this.request = new AbortController());
    void loadPrepared(url, request.signal).then(
      (prepared) => {
        if (request.signal.aborted) return;
        this.cache.push(prepared);
        while (this.cache.length > CACHE) this.cache.shift()!.loaded.dispose();
        this.use(prepared);
        this.onChange();
      },
      (error: unknown) => {
        if (request.signal.aborted) return;
        console.error(error);
        this.state = "error";
        this.onChange();
      },
    );
  }

  private use(prepared: Prepared): void {
    this.current = prepared;
    this.turntable.clear();
    this.turntable.add(prepared.holder);
    this.state = "ready";
    this.dirty = true;
  }

  /** Player turn (drag or arrow keys); the idle spin waits a moment before taking over again. */
  turn(radians: number): void {
    if (!this.current) return;
    this.yaw += radians;
    this.sinceTurn = 0;
    this.dirty = true;
  }

  drag(pixels: number): void {
    this.turn(pixels * DRAG_TURN);
  }

  /** Advances the spin and the idle clip; true while the picture changes. */
  /** `tick`: the window's 30Hz idle clock; continuous motion redraws only on it. */
  update(deltaMs: number, tick: boolean): boolean {
    if (!this.current || !this.content?.isVisible.value || this.content.isClipped.value)
      return false;
    if (!this.compiled.has(this.current)) return this.dirty;
    this.sinceTurn += deltaMs;
    const spinning = this.sinceTurn >= SPIN_RESUME_MS;
    if (spinning) this.yaw += (SPIN * deltaMs) / 1000;
    this.current.mixer?.update(deltaMs / 1000);
    // The idle spin and the creature's own animation redraw at 30Hz, as the starter stage does;
    // a player turn marks the picture dirty itself, so a drag follows the pointer every frame.
    if (tick && (spinning || this.current.mixer)) this.dirty = true;
    return this.dirty;
  }

  /** Draws the target when the picture changed; call before the window's own pass. */
  render(renderer: WebGLRenderer, scale: number): void {
    const current = this.current;
    const size = this.content?.size.value;
    if (!current || !size || !this.content?.isVisible.value) return;
    const pixels = renderer.getPixelRatio() * scale;
    const width = Math.max(1, Math.round(size[0] * pixels)),
      height = Math.max(1, Math.round(size[1] * pixels));
    if (width !== this.target.width || height !== this.target.height) {
      this.target.setSize(width, height);
      this.dirty = true;
    }
    if (!this.dirty) return;
    this.turntable.rotation.y = this.yaw;
    frame(this.camera, current.radius, width / height);
    if (!this.compiled.has(current)) {
      if (this.compiling) return;
      // Program keys depend on the bound target (output colour space), so compile under it.
      this.compiling = true;
      const compiled = this.compiled;
      let ready: Promise<unknown> = Promise.resolve();
      renderInto(renderer, this.target, () => {
        ready = renderer.compileAsync(this.scene, this.camera);
      });
      void ready.then(() => {
        this.compiling = false;
        compiled.add(current);
        this.dirty = true;
        this.onChange();
      });
      return;
    }
    this.dirty = false;
    renderInto(renderer, this.target, () => renderer.render(this.scene, this.camera));
    if (this.mesh) this.mesh.visible = true;
  }

  /** Context lost: drop GPU copies only; the next render uploads (and compiles) again. */
  releaseUploads(): void {
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose();
    for (const entry of this.cache) entry.loaded.releaseUploads();
    this.compiled = new WeakSet();
    this.compiling = false;
    this.dirty = true;
  }

  dispose(): void {
    this.request?.abort();
    for (const entry of this.cache) entry.loaded.dispose();
    this.cache.length = 0;
    this.turntable.clear();
    this.target.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}

interface Thumb {
  /** CPU pixels survive a lost context; the texture uploads them again. */
  texture?: DataTexture;
  meshes: Set<Mesh>;
  queued: boolean;
}

/**
 * Still pictures of models that have no drawn icon (the swarm, Bill's machine), for list rows and
 * links. Each model loads once when a row first asks for it, renders once at the stage's starting
 * turn, and is read back to CPU pixels; the GLB is then released.
 */
export class CodexThumbs {
  private readonly target = new WebGLRenderTarget(THUMB, THUMB, {
    samples: 4,
    colorSpace: SRGBColorSpace,
  });
  private readonly turntable = new Group();
  private readonly scene = studio(this.turntable);
  private readonly camera = new PerspectiveCamera(26, 1, 0.05, 50);
  private readonly geometry = new PlaneGeometry(1, 1);
  /** Until its picture exists a row draws nothing, through the same program. */
  private readonly empty = new DataTexture(new Uint8Array(4), 1, 1);
  private readonly thumbs = new Map<string, Thumb>();
  private readonly queue: string[] = [];
  private loading: AbortController | undefined;
  private readonly ready: Prepared[] = [];
  private readonly onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    this.empty.needsUpdate = true;
  }

  /** A layout node that fills its parent with the model's picture once it exists. */
  mount(model: CodexModel): Content {
    const url = modelUrl(model);
    let thumb = this.thumbs.get(url);
    if (!thumb) this.thumbs.set(url, (thumb = { meshes: new Set(), queued: false }));
    const material = pictureMaterial("thumb", thumb.texture ?? this.empty);
    const mesh = new Mesh(this.geometry, material);
    mesh.visible = !!thumb.texture;
    const content = pictureContent(mesh);
    const own = thumb;
    own.meshes.add(mesh);
    content.abortSignal.addEventListener("abort", () => {
      own.meshes.delete(mesh);
      material.dispose();
    });
    if (!thumb.texture && !thumb.queued) {
      thumb.queued = true;
      this.queue.push(url);
    }
    return content;
  }

  /** Starts the next load; one at a time so the visible rows fill in order. */
  update(): void {
    if (this.loading || !this.queue.length) return;
    const url = this.queue.shift()!;
    const request = (this.loading = new AbortController());
    void loadPrepared(url, request.signal).then(
      (prepared) => {
        if (request.signal.aborted) return;
        this.loading = undefined;
        this.ready.push(prepared);
        this.onChange();
      },
      (error: unknown) => {
        if (request.signal.aborted) return;
        this.loading = undefined;
        // The row keeps its type plate; the stage shows the failure when the entry is opened.
        console.error(error);
        this.onChange();
      },
    );
  }

  /** Pictures one loaded model a frame, before the window's pass; true when one was added. */
  render(renderer: WebGLRenderer): boolean {
    const prepared = this.ready.shift();
    if (!prepared) return false;
    this.turntable.clear();
    this.turntable.add(prepared.holder);
    this.turntable.rotation.y = START_YAW;
    frame(this.camera, prepared.radius, 1);
    const pixels = new Uint8Array(THUMB * THUMB * 4);
    renderInto(renderer, this.target, () => {
      renderer.render(this.scene, this.camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, THUMB, THUMB, pixels);
    });
    this.turntable.clear();
    prepared.loaded.dispose();
    const texture = new DataTexture(pixels, THUMB, THUMB);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    const thumb = this.thumbs.get(prepared.url)!;
    thumb.texture = texture;
    for (const mesh of thumb.meshes) {
      (mesh.material as MeshBasicMaterial).map = texture;
      mesh.visible = true;
    }
    return true;
  }

  /** Context lost: GPU copies only; the pixels stay and upload again. */
  releaseUploads(): void {
    this.target.dispose();
    this.geometry.dispose();
    this.empty.dispose();
    for (const thumb of this.thumbs.values()) thumb.texture?.dispose();
  }

  dispose(): void {
    this.loading?.abort();
    for (const prepared of this.ready) prepared.loaded.dispose();
    this.ready.length = 0;
    this.releaseUploads();
    this.thumbs.clear();
  }
}
