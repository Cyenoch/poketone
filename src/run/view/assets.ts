import {
  type AnimationClip,
  Box3,
  type Bone,
  Group,
  Mesh,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  NoColorSpace,
  type Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { loadGlb, type LoadedModel } from "../../game/models/loadGlb";
import { enemies, type EnemyId } from "../sim/content/enemies";
import { formDefs, lineForms, type FormId, type StarterId } from "../sim/content/lines/index";
import { PROP_HEIGHT } from "../sim/mapgen/index";
import type { Obstacle, StationKind } from "../sim/state/entities";
import type { World } from "../sim/state/world";
import type { GroundTextures } from "./environment/ground";
import { stageThemes } from "./stageThemes";
import { stageDefs, type StageId } from "../sim/content/stages/index";
import { rigTail, type TailSpec } from "./tail";
import { fetchAsset } from "../../prepare/fetch";
import { Shared, type Handle, type Lane } from "../../prepare/handle";
import type { AppRenderer } from "../../rendering/app-renderer";
import type { Need } from "../../prepare/preparation";
import type { IdleKind, UnitSize } from "../../prepare/idle";
import { glbUnitSize } from "../../game/models/glbSize";
import { resources, type DecodedImage } from "../../platform/resources";

export interface InstanceSource {
  geometry: BufferGeometry;
  material: Material;
  /** Model height in local units after normalisation (base at y = 0). */
  height: number;
}

export interface PlayerModel {
  form: FormId;
  /** Holder normalised to the form's height, feet on y = 0, facing +Z. */
  holder: Group;
  /** This player's copy of the canonical model (`instantiate`). */
  model: ModelInstance;
  /** The tail chain `rigTail` added, root first; empty without a `tail` spec. */
  tail: Bone[];
}

/** One player's model of every form of its line: each player needs its own copy to mount. */
export type PlayerModels = ReadonlyMap<FormId, PlayerModel>;

export interface RunAssets {
  /** Index-aligned with `world.players`. */
  players: readonly PlayerModels[];
  enemies: Partial<Record<EnemyId, InstanceSource>>;
  props: Record<Obstacle["kind"], InstanceSource[]>;
  scenery: Record<string, InstanceSource>;
  stations: Record<StationKind, InstanceSource>;
  ground: GroundTextures;
  /** Frees the GPU copies the run owns (its skeletons); shared models and maps are the store's. */
  releaseUploads(): void;
  dispose(): void;
}

/** Each species' GLB (Tripo, `public/models/game-models.provenance.json`). */
export const enemyModel = (id: EnemyId) => `/models/enemies/${enemies[id].model ?? id}.glb`;

/** All zones are prepared together: captured partners and later floors never fetch mid-fight. */
export function stageEnemyIds(stage: StageId): EnemyId[] {
  return [
    ...new Set(
      stageDefs[stage].zones.flatMap((zone) => [
        ...zone.roster.map(([, id]) => id),
        zone.guardian.species,
        ...zone.beats.flatMap(([, beat]) => ("species" in beat ? [beat.species].flat() : [])),
      ]),
    ),
  ];
}

/** Station models (Tripo, `public/models/game-models.provenance.json`) and their drawn heights. */
export const stationFiles: Record<StationKind, { url: string; height: number }> = {
  hypno: { url: "/models/props/hypno.glb", height: 1.9 },
  bill: { url: "/models/props/bill-machine.glb", height: 1.7 },
};

export interface FormModel {
  url: string;
  /**
   * Ground speed (world units/s) of the in-place run clip at timeScale 1 and the form's `height` (sim `FormDef`,
   * which the model is scaled to): the median backward speed of each foot bone's sole vertices while it moves back.
   * Clips keyed by `assets/characters/run-bipeds.py` use its scripted planted speed instead: their heels peel up
   * about the planted tip, which pulls that median a few percent low. Scales linearly with height.
   */
  runClipSpeed: number;
  /** Gait cycles (two steps) in one loop of the run clip: Tripo's run clips hold two, the hand-keyed ones one. */
  runCycles: number;
  /**
   * Rise (world units) that puts each clip's lowest point over the clip on the rest pose's ground: Tripo's in-place
   * runs lower the hips. Prepared biped idle feet are pinned, so idle uses zero.
   * Scales linearly with height; the view corrects any extra penetration during quaternion blends.
   */
  lift: { run: number; idle: number };
  /** Tail centreline for the procedural tail chain (`view/tail.ts`); forms without a visible tail have none. */
  tail?: TailSpec;
}

/**
 * Every playable form's model; clip speeds, cycles and lifts measured with `assets/measure-run-clip.py` (see
 * `runClipSpeed` for the hand-keyed runs), tail
 * centrelines read off rest-pose vertex plots (bind space is the GLB's own units, about 1 tall).
 */
export const formModels: Record<FormId, FormModel> = {
  charmander: {
    url: "/models/charmander.glb",
    runClipSpeed: 1.28,
    runCycles: 1,
    lift: { run: 0.02, idle: 0 },
    tail: {
      parent: "Pelvis",
      carriers: ["Pelvis"],
      points: [
        [-0.04, 0.21, 0.02],
        [-0.13, 0.16, -0.03],
        [-0.34, 0.33, -0.18],
        [-0.38, 0.48, -0.2],
        [-0.37, 0.64, -0.19],
      ],
      radius: 0.14,
    },
  },
  charmeleon: {
    url: "/models/charmeleon.glb",
    runClipSpeed: 1.464,
    runCycles: 2,
    lift: { run: 0.1352, idle: 0 },
    tail: {
      parent: "Pelvis",
      carriers: ["Pelvis"],
      points: [
        [-0.07, 0.22, -0.07],
        [-0.17, 0.17, -0.15],
        [-0.31, 0.36, -0.3],
        [-0.33, 0.48, -0.3],
        [-0.34, 0.6, -0.28],
      ],
      radius: 0.14,
    },
  },
  charizard: {
    url: "/models/charizard.glb",
    runClipSpeed: 1.488,
    runCycles: 2,
    lift: { run: 0.1856, idle: 0 },
    tail: {
      parent: "Pelvis",
      carriers: ["Pelvis"],
      points: [
        [-0.05, 0.16, -0.01],
        [-0.17, 0.07, -0.09],
        [-0.32, 0.1, -0.25],
        [-0.44, 0.29, -0.35],
        [-0.43, 0.41, -0.34],
      ],
      radius: 0.14,
    },
  },
  bulbasaur: {
    url: "/models/bulbasaur.glb",
    runClipSpeed: 1.248,
    runCycles: 1,
    lift: { run: 0.0064, idle: 0 },
  },
  ivysaur: {
    url: "/models/ivysaur.glb",
    runClipSpeed: 1.248,
    runCycles: 1,
    lift: { run: 0.0008, idle: 0 },
  },
  venusaur: {
    url: "/models/venusaur.glb",
    runClipSpeed: 1.8,
    runCycles: 1,
    lift: { run: 0.0008, idle: 0 },
  },
  // One tail, curling out on Squirtle's left (−Z); the asset pipeline cuts the mesh's duplicate on the right.
  squirtle: {
    url: "/models/squirtle.glb",
    runClipSpeed: 1.28,
    runCycles: 1,
    lift: { run: 0.0088, idle: 0 },
    tail: {
      parent: "Pelvis",
      carriers: ["Waist", "Pelvis"],
      points: [
        [-0.11, 0.18, -0.09],
        [-0.16, 0.15, -0.15],
        [-0.28, 0.21, -0.24],
        [-0.33, 0.21, -0.33],
        [-0.4, 0.25, -0.39],
      ],
      radius: 0.18,
    },
  },
  // Wartortle's fluffy tail fans out behind both sides of the shell: one chain would bend the fan, so it stays rigid.
  wartortle: {
    url: "/models/wartortle.glb",
    runClipSpeed: 1.248,
    runCycles: 1,
    lift: { run: 0.004, idle: 0 },
  },
  // Blastoise's stub tail hides under the shell: no chain.
  blastoise: {
    url: "/models/blastoise.glb",
    runClipSpeed: 1.736,
    runCycles: 2,
    lift: { run: 0.1696, idle: 0 },
  },
  pikachu: {
    url: "/models/pikachu.glb",
    runClipSpeed: 1.264,
    runCycles: 1,
    lift: { run: 0.0128, idle: 0 },
    // The flat blade rises up and to the left behind the body (`run-bipeds.py` moves it off the head bone).
    tail: {
      parent: "Pelvis",
      carriers: ["Pelvis"],
      points: [
        [-0.05, 0.14, 0.03],
        [-0.13, 0.27, 0],
        [-0.21, 0.48, -0.15],
        [-0.28, 0.51, -0.26],
        [-0.43, 0.79, -0.43],
      ],
      radius: 0.18,
    },
  },
  raichu: {
    url: "/models/raichu.glb",
    runClipSpeed: 1.488,
    runCycles: 1,
    lift: { run: 0, idle: 0 },
    // The hand-built tail (`add_tail` in the asset pipeline): down behind the body, round the right foot on the
    // ground, then the bolt standing on its end.
    tail: {
      parent: "Pelvis",
      carriers: ["Pelvis"],
      points: [
        [-0.08, 0.28, 0],
        [-0.2, 0.24, 0.01],
        [-0.31, 0.09, 0.09],
        [-0.3, 0.03, 0.24],
        [-0.2, 0.03, 0.32],
        [-0.2, 0.38, 0.44],
      ],
      radius: 0.1,
    },
  },
};

/**
 * Tripo exports mostly face +X. Measured by rendering shipping GLBs in their rest pose
 * from its glTF +X and +Z sides (all eleven player forms face +X); the view rotates each model so it faces +Z like
 * the simulation.
 */
const facingYaw: Record<string, number> = {
  "forest-landmark": 0,
  "desert-landmark": 0,
  "coast-landmark": 0,
  "glacier-landmark": 0,
  "volcano-landmark": 0,
  "tower-landmark": 0,
  "tower-column": 0,
  "tower-tomb-1": 0,
  "tower-tomb-2": 0,
  "tower-tomb-3": 0,
  caterpie: (-3 * Math.PI) / 4,
  ekans: Math.PI,
  metapod: -Math.PI / 4,
  butterfree: -Math.PI / 6,
  venomoth: Math.PI / 2,
  electrode: (-3 * Math.PI) / 4,
};
const DEFAULT_YAW = -Math.PI / 2;

export function yawFor(url: string): number {
  return facingYaw[modelFile(url).replace(/\.glb$/, "")] ?? DEFAULT_YAW;
}

// ── Model store (readiness design §5.2) ──────────────────────────────────────────────────────

/**
 * One prepared model per URL, shared by every consumer (runs, the lobby podium, the 图鉴).
 *
 * **Cache-owned**: the parsed model with its geometry, original materials and textures. A player
 * form gets its tail chain (`rigTail`) here, once, before anything clones it, so the rewritten skin
 * attributes are part of the canonical rig. Instance sources (enemies, props, stations) are baked
 * here per height.
 *
 * **Consumer-owned**: what `instantiate` makes (a skeleton clone with its bone texture) and what
 * the consumer builds on it (mixers, run materials). A consumer disposes only those; shared
 * geometry, materials and textures go when the store drops the entry (its last handle released).
 */
export interface CanonicalModel {
  readonly url: string;
  readonly model: LoadedModel;
  /** The tail chain `rigTail` added (canonical bones), root first; empty without a `tail` spec. */
  readonly tail: readonly Bone[];
  /** The single mesh baked into a base-on-y=0 geometry `height` tall, made once per height. */
  instance(height: number): InstanceSource;
}

/** A consumer's own copy of a canonical model: its skeleton and bones, sharing everything else. */
export interface ModelInstance {
  readonly root: Object3D;
  readonly animations: AnimationClip[];
  /** The clone's tail chain, root first. */
  readonly tail: Bone[];
  /** Context lost: frees the GPU copies the consumer owns (bone textures); they upload again. */
  releaseUploads(): void;
  /** Frees only the consumer's copies (skeletons and their bone textures). */
  dispose(): void;
}

interface StoreEntry<T> {
  readonly shared: Shared<T>;
  fetch: Handle<Blob> | null;
  value: T | null;
  dropped: boolean;
  /** Set while a fetched entry waits for leave to run its main-thread prepare; opens the gate. */
  go: (() => void) | null;
  /** Its idle-lane unit size, once read, and the unit's cancel while queued. */
  size: UnitSize | null;
  queued: (() => void) | null;
}

/** Lanes whose prepare runs as soon as the bytes are in; the others wait for the idle lane. */
const urgent = (lane: Lane | null) =>
  lane === null || lane === "critical" || lane === "interactive";

/**
 * A keyed cache over `fetchAsset`: one network request and one prepare per key, kept while any
 * handle holds it and dropped at the last release (pending work aborted, prepared value disposed).
 * A failed key leaves the table so the next acquire tries again.
 */
function keyedStore<T>(
  make: (url: string, blob: Blob) => Promise<T>,
  drop: (value: T) => void,
  /** Given when `make` is main-thread work: its idle-lane unit (`prepare/idle.ts`). */
  unit?: { kind: IdleKind; size(blob: Blob): Promise<UnitSize> },
): {
  acquire(url: string, lane: Lane): Handle<T>;
  each(visit: (value: T) => void): void;
  /** Offers every entry still waiting to the idle lane (the store just got its app). */
  offerWaiting(): void;
} {
  const entries = new Map<string, StoreEntry<T>>();
  /** Offers a waiting entry to the idle lane; one the allowlist refuses waits for a lane rise. */
  const offer = (entry: StoreEntry<T>) => {
    const go = entry.go;
    if (!unit || !go || !entry.size || entry.queued || !boundTo || entry.shared.lane === "keep") {
      return;
    }
    entry.queued = boundTo.trySchedule({
      kind: unit.kind,
      size: entry.size,
      // A unit queued before a downgrade to `keep` that still runs starts nothing.
      run: () => {
        entry.queued = null;
        if (entry.shared.lane !== "keep") go();
      },
    });
  };
  const start = (url: string, lane: Lane): StoreEntry<T> => {
    const entry: StoreEntry<T> = {
      fetch: null,
      value: null,
      dropped: false,
      go: null,
      size: null,
      queued: null,
      shared: new Shared<T>(
        url,
        {
          lane(next) {
            entry.fetch?.setLane(next);
            if (urgent(next)) entry.go?.();
            else if (next === "keep") {
              // `keep` starts nothing: a parse waiting on the idle lane leaves it.
              entry.queued?.();
              entry.queued = null;
            } else offer(entry);
          },
          empty() {
            entry.dropped = true;
            if (entries.get(url) === entry) entries.delete(url);
            entry.fetch?.release();
            entry.go?.();
            if (entry.value) drop(entry.value);
          },
        },
        { bytesTotal: null },
      ),
    };
    /** Resolves when the prepare may run: now for urgent lanes, else when the idle lane admits it. */
    const gate = (blob: Blob) =>
      new Promise<void>((resolve, reject) => {
        if (!unit || urgent(entry.shared.lane)) return resolve();
        entry.go = () => {
          entry.go = null;
          entry.queued?.();
          entry.queued = null;
          resolve();
        };
        // A file that is no GLB (truncated, an HTML page served as 200) fails the entry here.
        void unit.size(blob).then(
          (size) => {
            entry.size = size;
            offer(entry);
          },
          (cause: unknown) => {
            entry.go = null;
            reject(new Error(`${url} 不是可读的 GLB。`, { cause }));
          },
        );
      });
    entries.set(url, entry);
    const fetched = fetchAsset(url, { lane });
    entry.fetch = fetched;
    fetched.watch(() => {
      if (fetched.network) entry.shared.progress(fetched.network);
    });
    void (async () => {
      try {
        const blob = await fetched.result;
        fetched.release();
        entry.fetch = null;
        await gate(blob);
        if (entry.dropped) return;
        const value = await make(url, blob);
        if (entry.dropped) return drop(value);
        entry.value = value;
        entry.shared.resolve(value);
      } catch (cause) {
        if (entry.dropped) return;
        if (entries.get(url) === entry) entries.delete(url);
        entry.shared.reject(cause);
      }
    })();
    return entry;
  };
  return {
    acquire: (url, lane) => (entries.get(url) ?? start(url, lane)).shared.acquire(lane),
    each(visit) {
      for (const entry of entries.values()) if (entry.value) visit(entry.value);
    },
    offerWaiting() {
      for (const entry of entries.values()) offer(entry);
    },
  };
}

async function parseGlb(url: string, blob: Blob): Promise<LoadedModel> {
  return loadGlb(new File([blob], modelFile(url), { type: "model/gltf-binary" }));
}

const tailSpecs = new Map(
  Object.values(formModels).flatMap((form) => (form.tail ? [[form.url, form.tail] as const] : [])),
);

/** The canonical preparation: a form's tail is rigged before anything can clone the model. */
export function canonicalModel(url: string, model: LoadedModel): CanonicalModel {
  const spec = tailSpecs.get(url);
  const tail = spec ? rigTail(model.root, spec, url) : [];
  const instances = new Map<number, InstanceSource>();
  const canonical: CanonicalModel = {
    url,
    model,
    tail,
    instance(height) {
      let source = instances.get(height);
      if (!source) {
        source = toInstanceSource(model, height, url);
        instances.set(height, source);
      }
      return source;
    },
  };
  bakedSources.set(canonical, instances);
  return canonical;
}

/** Baked instance geometries belong to the cache entry, like the model's own. */
const bakedSources = new WeakMap<CanonicalModel, Map<number, InstanceSource>>();
const bakedGeometries = (canonical: CanonicalModel) =>
  [...(bakedSources.get(canonical)?.values() ?? [])].map((source) => source.geometry);

function disposeCanonical(canonical: CanonicalModel): void {
  for (const geometry of bakedGeometries(canonical)) geometry.dispose();
  canonical.model.dispose();
}

const modelEntries = keyedStore<CanonicalModel>(
  async (url, blob) => {
    const model = await parseGlb(url, blob);
    try {
      return canonicalModel(url, model);
    } catch (cause) {
      // The cache owns only a successful canonical result; until then the loader owns the model.
      model.dispose();
      throw cause;
    }
  },
  disposeCanonical,
  { kind: "glb-parse", size: glbUnitSize },
);

/** Ground and other world textures, decoded off the main thread and shared like models. */
const textureImages = new WeakMap<Texture, DecodedImage>();
const textureEntries = keyedStore<Texture>(
  async (url, blob) => {
    // Bitmaps are decoded upright; the texture must not flip them again.
    const image = await resources().decodeImage(blob, true);
    const texture = resources().createTexture();
    texture.image = image.source;
    textureImages.set(texture, image);
    texture.flipY = false;
    texture.colorSpace = url.endsWith("-detail.png") ? NoColorSpace : SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  },
  (texture) => {
    texture.dispose();
    textureImages.get(texture)!.release();
    textureImages.delete(texture);
  },
);

export const models = {
  acquire: (url: string, lane: Lane): Handle<CanonicalModel> => modelEntries.acquire(url, lane),
  acquireTexture: (url: string, lane: Lane): Handle<Texture> => textureEntries.acquire(url, lane),
  /**
   * Context lost: frees the GPU copies of every cached model and texture (CPU data stays, so the
   * next draw re-uploads). Registered once with the app renderer by the first GPU consumer.
   */
  releaseUploads(): void {
    modelEntries.each((canonical) => {
      canonical.model.releaseUploads();
      for (const geometry of bakedGeometries(canonical)) geometry.dispose();
    });
    textureEntries.each((texture) => texture.dispose());
  },
};

let boundTo: AppRenderer | null = null;
/** Makes the store a loss resident of `app` (idempotent). */
export function bindModelStore(app: AppRenderer): void {
  if (boundTo === app) return;
  boundTo = app;
  app.resident({ release: () => models.releaseUploads() });
  modelEntries.offerWaiting();
}

/** A consumer's copy: its own skeleton (and bone texture), sharing geometry, materials, textures. */
export function instantiate(canonical: CanonicalModel): ModelInstance {
  const root = cloneSkinned(canonical.model.root);
  const skeletons = new Set<Skeleton>();
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
  });
  const tail = canonical.tail.map((bone) => {
    const copy = root.getObjectByName(bone.name);
    if (!(copy instanceof Object3D) || !("isBone" in copy)) {
      throw new Error(`${canonical.url} 的克隆缺少尾骨 ${bone.name}。`);
    }
    return copy as Bone;
  });
  return {
    root,
    animations: canonical.model.animations,
    tail,
    // Skeleton.dispose only frees the bone texture; the next draw computes and uploads it again.
    releaseUploads() {
      for (const skeleton of skeletons) skeleton.dispose();
    },
    dispose() {
      for (const skeleton of skeletons) skeleton.dispose();
    },
  };
}

/** Bakes the single textured mesh into a unit-scaled geometry whose base sits on y = 0. */
function toInstanceSource(model: LoadedModel, height: number, url: string): InstanceSource {
  model.root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  model.root.traverse((node) => {
    if (node instanceof Mesh) meshes.push(node);
  });
  const [mesh] = meshes;
  if (!mesh || meshes.length !== 1 || Array.isArray(mesh.material)) {
    throw new Error(`${url} 必须只包含一个单材质网格。`);
  }
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).rotateY(yawFor(url));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.scale(height / size.y, height / size.y, height / size.y);
  geometry.computeBoundingSphere();
  return { geometry, material: mesh.material, height };
}

/** Bind-pose world position of the hip bone (Tripo biped `Pelvis`, the Bulbasaur line's hand-built `Hip`). */
function hipAnchor(root: Object3D): Vector3 | null {
  let hip: Object3D | undefined;
  for (const pattern of [/pelvis/i, /^hip$/i]) {
    root.traverse((node) => {
      if (!hip && pattern.test(node.name)) hip = node;
    });
    if (hip) break;
  }
  return hip ? hip.getWorldPosition(new Vector3()) : null;
}

function normalisePlayer(model: ModelInstance, form: FormId): PlayerModel {
  const { url } = formModels[form];
  const { height } = formDefs[form];
  model.root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model.root, true);
  const size = bounds.getSize(new Vector3());
  // Anchor on the rig's hip, not the bounding box: tails and ears skew the box, so the body would sit
  // off the simulated position (collision circle, cast origin). Feet stay on the ground (box min).
  const center = hipAnchor(model.root) ?? bounds.getCenter(new Vector3());
  const holder = new Group();
  const scale = height / size.y;
  // Scale a parent: clips may animate the imported root.
  holder.scale.setScalar(scale);
  holder.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  holder.add(model.root);
  model.root.traverse((node) => {
    if (node instanceof Mesh) node.castShadow = true;
    if (node instanceof SkinnedMesh) node.frustumCulled = false;
  });
  const facing = new Group();
  facing.rotation.y = yawFor(url);
  facing.add(holder);
  const wrapper = new Group();
  wrapper.add(facing);
  return { form, holder: wrapper, model, tail: model.tail };
}

/** A line's model needs: every form, so evolving never waits (readiness design §2). */
export function lineNeeds(starter: StarterId): Need<CanonicalModel>[] {
  return lineForms(starter).map(({ id }) => {
    const url = formModels[id].url;
    return { key: url, acquire: (lane: Lane) => models.acquire(url, lane) };
  });
}

export const architectureModels = [
  "tower-column",
  "tower-tomb-1",
  "tower-tomb-2",
  "tower-tomb-3",
] as const;
const sceneryFiles = (theme: import("./themes/types").StageTheme) => [
  ...theme.dressing.map(({ model, height }) => ({ url: model, height })),
  { url: theme.landmark.model, height: theme.landmark.height },
  ...(theme.architecture
    ? architectureModels.map((name) => ({ url: `/models/props/${name}.glb`, height: 1 }))
    : []),
];

/** The shared set S every run of `stage` needs, whatever the line: species, props, stations, ground. */
export function runSharedNeeds(stage: StageId): Need[] {
  const theme = stageThemes[stage];
  const model = (url: string): Need => ({ key: url, acquire: (lane) => models.acquire(url, lane) });
  return [
    ...[...new Set(stageEnemyIds(stage).map(enemyModel))].map(model),
    ...Object.values(theme.props).flatMap((look) => look.models.map(model)),
    ...sceneryFiles(theme).map(({ url }) => model(url)),
    ...Object.values(stationFiles).map((file) => model(file.url)),
    ...[theme.ground.grass, theme.ground.meadow, theme.ground.dirt, theme.ground.cliff].flatMap(
      ({ map, detail }) =>
        [map, detail].map((url): Need => ({
          key: url,
          acquire: (lane) => models.acquireTexture(url, lane),
        })),
    ),
  ];
}

/**
 * Every form of each player's line (so evolving never waits on the network), the stage's species, and the
 * stage theme's props and ground maps, through the model store at the run's own (critical) lane.
 * Entries the lobby also holds are already in memory and on the GPU; releasing the run's handles
 * keeps them for the next run.
 */
export async function loadRunAssets(world: World, signal: AbortSignal): Promise<RunAssets> {
  const theme = stageThemes[world.stage];
  const handles: Handle<unknown>[] = [];
  const instances: ModelInstance[] = [];
  const hold = <T>(handle: Handle<T>) => {
    handles.push(handle);
    return handle.result;
  };
  const release = () => {
    for (const instance of instances) instance.dispose();
    for (const handle of handles) handle.release();
  };
  signal.addEventListener("abort", release, { once: true });
  try {
    const enemyIds = [
      ...new Set([
        ...stageEnemyIds(world.stage),
        ...world.enemies.map(({ species }) => species),
        ...world.partners.map(({ species }) => species),
      ]),
    ];
    const propKinds = Object.keys(theme.props) as Obstacle["kind"][];
    const scenery = sceneryFiles(theme);
    const stationKinds = Object.keys(stationFiles) as StationKind[];
    const groundMap = async (url: string) => {
      const map = await hold(models.acquireTexture(url, "critical"));
      map.wrapS = map.wrapT = RepeatWrapping;
      // The far half of the view meets the ground at a grazing angle.
      map.anisotropy = 4;
      return map;
    };
    const lines = world.players.map((player) => lineForms(player.starter).map((form) => form.id));
    const [
      lineModels,
      enemyModels,
      propModels,
      stationModels,
      sceneryModels,
      grass,
      meadow,
      dirt,
      cliff,
      grassDetail,
      meadowDetail,
      dirtDetail,
      cliffDetail,
    ] = await Promise.all([
      Promise.all(
        lines.map((forms) =>
          Promise.all(forms.map((form) => hold(models.acquire(formModels[form].url, "critical")))),
        ),
      ),
      Promise.all(enemyIds.map((id) => hold(models.acquire(enemyModel(id), "critical")))),
      Promise.all(
        propKinds.map((kind) =>
          Promise.all(theme.props[kind].models.map((url) => hold(models.acquire(url, "critical")))),
        ),
      ),
      Promise.all(
        stationKinds.map((kind) => hold(models.acquire(stationFiles[kind].url, "critical"))),
      ),
      Promise.all(scenery.map(({ url }) => hold(models.acquire(url, "critical")))),
      groundMap(theme.ground.grass.map),
      groundMap(theme.ground.meadow.map),
      groundMap(theme.ground.dirt.map),
      groundMap(theme.ground.cliff.map),
      groundMap(theme.ground.grass.detail),
      groundMap(theme.ground.meadow.detail),
      groundMap(theme.ground.dirt.detail),
      groundMap(theme.ground.cliff.detail),
    ]);
    signal.throwIfAborted();
    const players = lines.map(
      (forms, i) =>
        new Map(
          forms.map((form, j) => {
            const instance = instantiate(lineModels[i]![j]!);
            instances.push(instance);
            return [form, normalisePlayer(instance, form)] as const;
          }),
        ),
    );
    const bake = <K extends string>(
      keys: readonly K[],
      sources: CanonicalModel[],
      height: (key: K) => number,
    ) =>
      Object.fromEntries(
        keys.map((key, index) => [key, sources[index]!.instance(height(key))]),
      ) as Record<K, InstanceSource>;
    return {
      players,
      enemies: bake(enemyIds, enemyModels, () => 1),
      props: Object.fromEntries(
        propKinds.map((kind, i) => [
          kind,
          propModels[i]!.map((model) => model.instance(PROP_HEIGHT[kind])),
        ]),
      ) as RunAssets["props"],
      scenery: bake(
        scenery.map((file) => file.url),
        sceneryModels,
        (url) => scenery.find((file) => file.url === url)!.height,
      ),
      stations: bake(stationKinds, stationModels, (kind) => stationFiles[kind].height),
      ground: { grass, meadow, dirt, cliff, grassDetail, meadowDetail, dirtDetail, cliffDetail },
      // Shared models and maps are the store's to release on loss; the run owns its skeletons.
      releaseUploads() {
        for (const instance of instances) instance.releaseUploads();
      },
      dispose() {
        signal.removeEventListener("abort", release);
        release();
      },
    };
  } catch (error) {
    signal.removeEventListener("abort", release);
    release();
    throw error;
  }
}

/** The file name of a model path (`squirtle.glb`). */
function modelFile(url: string): string {
  return new URL(url, "http://local/").pathname.split("/").at(-1) ?? "";
}
