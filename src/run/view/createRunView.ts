import type { Steps } from "../../prepare/steps";
import { FLYER_HOVER } from "../sim/content/params/combat";
import { standingHeight } from "../sim/sight";
import {
  CircleGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  LinearSRGBColorSpace,
  SRGBColorSpace,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import { enemies as enemyDefs, type EnemyId } from "../sim/content/enemies";
import { groundBlockedMask } from "../sim/nav/index";
import { PARTNER } from "../sim/content/params/partners";
import { RADIAL } from "../sim/content/params/enemy-skills";
import { stopped } from "../sim/status";
import { heightAt } from "../sim/terrain";
import { TICK, type World } from "../sim/state/world";
import type { Obstacle, Player, PlayerId } from "../sim/state/entities";
import type { FormId } from "../sim/content/lines/index";
import type { RunEvent } from "../sim/state/events";
import { windAt } from "../sim/wind";
import { releaseUploads } from "../../rendering/releaseUploads";
import type { PlayerModels, RunAssets } from "./assets";
import { advanceGait, bodyMotion } from "./enemyMotion";
import { cloysterClosure, foldCloysterShell } from "./cloysterShell";
import { enemyLook, towerEnemySilhouette } from "./enemyLook";
import { shadeUnderClouds } from "./environment/clouds";
import { createFoliage } from "./environment/foliage";
import { createDressing } from "./environment/dressing";
import { lightGroundPools } from "./architecture";
import { createFootprints } from "./environment/footprints";
import { bakeGroundLayers, createGroundUniforms } from "./environment/ground";
import { createWater } from "./environment/water";
import { createSunlight } from "./environment/sunlight";
import { createWindUniforms, swayInWind, updateWindUniforms } from "./environment/wind";
import { createCameraShake } from "./cameraShake";
import { creatureLook, lambertCopy, ownShadowDepth } from "./materials";
import { mountRig, type PlayerRig } from "./playerRig";
import { conformToTerrain, createTerrainMesh, createTerrainUniforms, ditherFade } from "./terrain";
import { formOf } from "../sim/evolution";
import { Vfx, type Muzzle } from "./vfx";
import { statusTint } from "./vfx/status";
import type { PropLook } from "./stageThemes";
import { zoneTheme } from "./zoneThemes";
import { createLandmark } from "./landmark";
import { zoneDef } from "../sim/currentZone";
import { playerRings } from "./player-rings";

const dummy = new Object3D();
const tint = new Color();
const white = new Color(1, 1, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** sim/viewFootprint.ts reproduces this camera (spawns off screen, auto-aim on it): change both together. */
const CAMERA_HEIGHT = 16;
const CAMERA_BACK = 13;
/**
 * Cadence cap in gait cycles (two steps) per second, counted per cycle so it means the same for the Tripo run clips
 * (two cycles in 1.25 s) and the Bulbasaur line's (one in 0.67 s). Above it the feet slide rather than the legs
 * turn into a frantic blur; the Bulbasaur line plants its feet at full speed just under it.
 */
const MAX_CADENCE = 3.4;
/**
 * Shadow window in light space, around a point a few metres ahead of the player. The phone view's
 * (844×390) far corners on flat ground reach ±28.6 m across the sun and ±18.2 m along it (the sun's
 * elevation foreshortens that axis) over every camera yaw; a little more covers lower ground.
 */
const SHADOW_HALF_ACROSS = 29;
const SHADOW_HALF_ALONG = 19;
const SHADOW_MAP = 2048;
/** How far the shadow window and the visible ground centre sit ahead of the player. */
const VIEW_AHEAD = 3.5;
/** combat.ts flashes a struck enemy for this long; the hit reaction below rides the same timer. */
const HIT_FLASH_SECONDS = 0.12;
/** Sideways shake of a struck enemy at the start of its flash (world units). */
const HIT_JITTER = 0.06;
/** Trauma per event (see docs/GAME-FEEL.md); the felt shake is trauma². */
const TRAUMA = {
  playerHit: 0.25,
  bigKill: 0.5,
  guardianDash: 0.35,
  evolve: 0.35,
  ultHeavy: 0.3,
} as const;
/** Ultimate beats heavy enough to knock the camera (the rest stay readable without shake). */
const HEAVY_ULT = new Set(["ring", "blast", "wave", "bolt"]);
/** A guardian dash that ends this close to the player lands as a camera knock. */
const DASH_FELT_WITHIN = 8;
/** Phones and tablets: fewer plants. */
const COARSE_POINTER_DENSITY = 0.6;

export interface RunView {
  scene: Scene;
  camera: PerspectiveCamera;
  /** The haze to clear the world target with, already in the display values the target stores. */
  background: Color;
  /** Debug geometry shares the VFX liquid ceiling. */
  debugHeight(x: number, z: number): number;
  frame(
    alpha: number,
    dt: number,
    events: readonly RunEvent[],
    yaw: number,
    remotePlayerSpeeds?: ReadonlyMap<PlayerId, number>,
  ): void;
  /** World point (y relative to the ground) → CSS pixels inside the canvas, or null when behind the camera. */
  project(x: number, y: number, z: number, width: number, height: number): [number, number] | null;
  /** Frees the GPU copies of the scene and the textures only shader closures hold; the view stays usable. */
  releaseUploads(): void;
  /**
   * Shows everything the run can draw later (every pre-mounted form) for one warm render, or puts it
   * back (`createRun`'s warm under the loading cover).
   */
  warmSet(on: boolean): void;
  dispose(): void;
}

/** A form mounted for the whole run: evolving shows it, it is never rebuilt. */
interface MountedForm {
  rig: PlayerRig;
  holder: Group;
  head: Object3D | undefined;
}

/** One player's drawn body: a stable group that follows them, with every form of its line inside. */
interface Avatar {
  player: Player;
  forms: ReadonlyMap<FormId, MountedForm>;
  group: Group;
  form: FormId;
  rig: PlayerRig;
  /** The form's head bone, where its shots leave the model. */
  head: Object3D | undefined;
  runWeight: number;
  muzzle: Muzzle;
  /** Whether the player was alive last frame: the frame it turns false draws the faint. */
  alive: boolean;
}

interface PropLayer {
  mesh: InstancedMesh;
  placed: Obstacle[];
  fade: InstancedBufferAttribute;
  /** Drawn height at obstacle scale 1, for the occlusion test. */
  height: number;
}

/**
 * Draws `world` for the player `local`: the camera, occlusion, foliage and screen shake follow them.
 * Built in steps (`prepare/steps.ts`) so the construction never becomes one long task.
 */
export function* createRunView(
  world: World,
  assets: RunAssets,
  local: PlayerId,
  coarsePointer: boolean,
): Steps<RunView> {
  const theme = zoneTheme(world);
  const scene = new Scene();
  // Fog is mixed in after the colour grade (grade.ts), so its colour is already the graded haze.
  scene.fog = new Fog(theme.haze.color, theme.haze.near, theme.haze.far);
  // The world target stores display colour and three clears an ordinary target in working
  // (linear) values, so the clear colour carries the haze's display values as its own.
  const haze = new Color(theme.haze.color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
  const background = new Color().setRGB(haze.r, haze.g, haze.b, LinearSRGBColorSpace);
  const camera = new PerspectiveCamera(42, 1, 0.5, 120);
  const disposables: { dispose(): void }[] = [];
  const terrain = world.map.terrain;
  const ground = (x: number, z: number) => heightAt(terrain, x, z);

  const { light } = theme;
  const sunOffset = new Vector3(...light.sunOffset);
  const hemi = new HemisphereLight(light.sky, light.ground, light.hemi);
  const sun = new DirectionalLight(light.sun, light.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  Object.assign(sun.shadow.camera, {
    left: -SHADOW_HALF_ACROSS,
    right: SHADOW_HALF_ACROSS,
    top: SHADOW_HALF_ALONG,
    bottom: -SHADOW_HALF_ALONG,
    near: 1,
    far: 80,
  });
  sun.shadow.normalBias = 0.05;
  // Same five PCF taps spread over ~6 cm: soft edges at no extra cost.
  sun.shadow.radius = 2.5;
  scene.add(hemi, sun, sun.target);
  // Light-space axes of the shadow camera (it looks back along the sun offset with +Y up), for texel snapping.
  const sunBack = sunOffset.clone().normalize();
  const sunRight = new Vector3(0, 1, 0).cross(sunBack).normalize();
  const sunUp = sunBack.clone().cross(sunRight);
  const shadowTexel = [
    (SHADOW_HALF_ACROSS * 2) / SHADOW_MAP,
    (SHADOW_HALF_ALONG * 2) / SHADOW_MAP,
  ] as const;

  const uniforms = createTerrainUniforms(terrain);
  const wind = createWindUniforms(theme.clouds);
  yield;
  const groundLayers = yield* bakeGroundLayers(
    terrain,
    world.map.obstacles,
    groundBlockedMask(world.nav),
    world.map.water,
    world.seed,
  );
  const groundUniforms = createGroundUniforms(groundLayers, assets.ground);
  yield;
  const terrainMesh = createTerrainMesh(
    terrain,
    uniforms,
    groundUniforms,
    wind,
    theme,
    assets.scenery,
  );
  const dressing = yield* createDressing(
    world,
    assets,
    theme,
    groundLayers,
    wind,
    coarsePointer ? COARSE_POINTER_DENSITY : 1,
  );
  for (const mesh of dressing.meshes) scene.add(mesh);
  disposables.push(dressing);
  lightGroundPools(terrainMesh.mesh.material, dressing.pools);
  shadeUnderClouds(terrainMesh.mesh.material, wind);
  const decoration = theme.decorate?.({
    scene,
    terrain: terrainMesh.mesh,
    uniforms,
    wind,
    pools: dressing.pools,
    world,
  });
  if (decoration) disposables.push(decoration);
  scene.add(terrainMesh.mesh);
  const sunlight = createSunlight(terrain, world.map.obstacles, theme, wind);
  scene.add(sunlight.mesh);
  disposables.push(sunlight);
  const footprints = theme.footprints
    ? createFootprints(
        world,
        uniforms,
        groundLayers,
        terrainMesh.surfaceTexture,
        wind,
        theme.footprints,
      )
    : null;
  if (footprints) {
    scene.add(footprints.mesh);
    disposables.push(footprints);
  }
  disposables.push(
    terrainMesh,
    uniforms.uTerrainHeight.value,
    groundLayers.texture,
    groundLayers.shore,
    groundLayers.structure,
  );

  yield;
  const water =
    world.map.water.puddles.length > 0
      ? createWater(world.map.water, wind, groundUniforms, theme)
      : null;
  if (water) {
    scene.add(water.mesh);
    disposables.push(water);
  }

  yield;
  const foliage = yield* createFoliage({
    terrain,
    layers: groundLayers,
    map: world.map,
    seed: world.seed,
    terrainUniforms: uniforms,
    groundUniforms,
    wind,
    theme,
    density: coarsePointer ? COARSE_POINTER_DENSITY : 1,
  });
  for (const mesh of foliage.meshes) scene.add(mesh);
  disposables.push(foliage);

  // Props: instanced per kind, each instance with its own dither-fade value for occlusion.
  const props: PropLayer[] = [];
  for (const [kind, look] of Object.entries(theme.props) as [Obstacle["kind"], PropLook][]) {
    for (const [variant, source] of assets.props[kind].entries()) {
      yield;
      const placed = world.map.obstacles.filter(
        (obstacle, index) =>
          obstacle.kind === kind && index % assets.props[kind].length === variant,
      );
      const material = lambertCopy(source.material);
      // Flat shading uses screen-space normals (no split vertices): each facet catches the sun on its own.
      material.flatShading = look.flat;
      material.color.multiplyScalar(look.tint);
      look.patchMaterial?.(material, source.height);
      ditherFade(material);
      if (look.sway) swayInWind(material, wind, source.height, look.sway[0], look.sway[1]);
      shadeUnderClouds(material, wind);
      const geometry = source.geometry.clone();
      const fade = new InstancedBufferAttribute(new Float32Array(placed.length).fill(1), 1);
      fade.setUsage(DynamicDrawUsage);
      geometry.setAttribute("aFade", fade);
      const mesh = new InstancedMesh(geometry, material, placed.length);
      const { drawScale } = look;
      placed.forEach((obstacle, index) => {
        const scale = obstacle.scale * drawScale;
        // Sink slightly so props on a slope never float on their downhill side.
        dummy.position.set(obstacle.x, ground(obstacle.x, obstacle.z) - 0.15, obstacle.z);
        dummy.rotation.set(0, obstacle.rotation, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.castShadow = look.castShadow;
      mesh.receiveShadow = true;
      scene.add(mesh);
      props.push({ mesh, placed, fade, height: source.height * drawScale });
      disposables.push(mesh, geometry, material);
    }
  }

  // Stations on the building pads: one mesh each.
  const stationMeshes = world.stations.map((station) => {
    const source = assets.stations[station.kind];
    const material = lambertCopy(source.material);
    shadeUnderClouds(material, wind);
    const mesh = new Mesh(source.geometry, material);
    mesh.position.set(station.x, ground(station.x, station.z), station.z);
    // The machine faces the arena centre, where the run starts; Hypno turns to the player each frame.
    if (station.kind === "bill") mesh.rotation.y = Math.atan2(-station.x, -station.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    disposables.push(material, ownShadowDepth(mesh));
    return { station, mesh };
  });
  const landmark = createLandmark(
    world,
    assets.scenery[theme.landmark.model]!,
    theme.landmark,
    wind,
  );
  scene.add(landmark.root);
  disposables.push(landmark);

  yield;
  // Swarm enemies: one instanced draw per species, blob shadows instead of shadow casting.
  const enemyMeshes = {} as Record<EnemyId, InstancedMesh>;
  const enemySilhouettes = new Map<EnemyId, InstancedMesh>();
  const enemyFades = new Map<EnemyId, InstancedBufferAttribute>();
  let shellClose: InstancedBufferAttribute | undefined;
  const shellEnds = new Map<number, number>();
  const guardian = zoneDef(world).guardian.species;
  for (const id of Object.keys(assets.enemies) as EnemyId[]) {
    const source = assets.enemies[id]!;
    const material = creatureLook(lambertCopy(source.material));
    enemyLook(material, id);
    decoration?.patchEnemyMaterial?.(material);
    shadeUnderClouds(material, wind);
    disposables.push(material);
    const capacity = id === guardian ? 2 : 320;
    const kind = enemyDefs[id].skill?.kind;
    const fades =
      enemyDefs[id].types.includes("ghost") ||
      kind === "melt" ||
      kind === "teleport" ||
      id === "alakazam";
    const geometry = fades || id === "cloyster" ? source.geometry.clone() : source.geometry;
    if (fades || id === "cloyster") disposables.push(geometry);
    if (fades) {
      const fade = new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
      fade.setUsage(DynamicDrawUsage);
      geometry.setAttribute("aFade", fade);
      ditherFade(material);
      enemyFades.set(id, fade);
    }
    if (id === "cloyster") {
      shellClose = new InstancedBufferAttribute(new Float32Array(capacity), 1);
      shellClose.setUsage(DynamicDrawUsage);
      geometry.setAttribute("aShellClose", shellClose);
      foldCloysterShell(material);
    }
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Allocated now: the first tint would otherwise add instance colours and change the program.
    for (let i = 0; i < mesh.instanceMatrix.count; i++) mesh.setColorAt(i, white);
    mesh.instanceColor!.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = id === guardian;
    if (id === "cloyster") {
      const depth = ownShadowDepth(mesh);
      foldCloysterShell(depth);
      disposables.push(depth);
    }
    enemyMeshes[id] = mesh;
    scene.add(mesh);
    disposables.push(mesh);
    if (world.stage === "tower") {
      const silhouetteMaterial = towerEnemySilhouette();
      if (fades) ditherFade(silhouetteMaterial);
      const silhouette = new InstancedMesh(geometry, silhouetteMaterial, 0);
      silhouette.instanceMatrix = mesh.instanceMatrix;
      silhouette.frustumCulled = false;
      silhouette.renderOrder = 0.9;
      enemySilhouettes.set(id, silhouette);
      scene.add(silhouette);
      disposables.push(silhouette, silhouetteMaterial);
    }
  }
  const blobGeometry = new CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const blobMaterial = new MeshBasicMaterial({
    color: "#10262a",
    transparent: true,
    opacity: 0.27,
    depthWrite: false,
  });
  conformToTerrain(blobMaterial, uniforms, 0.03);
  const blobs = new InstancedMesh(blobGeometry, blobMaterial, 700);
  blobs.instanceMatrix.setUsage(DynamicDrawUsage);
  blobs.frustumCulled = false;
  scene.add(blobs);
  disposables.push(blobGeometry, blobMaterial, blobs);

  /**
   * Mounts every form of the line at construction, the inactive ones hidden: their materials and
   * programs exist from the start (the run warm compiles them), and evolving is a visibility swap.
   */
  function mountLine(models: PlayerModels, group: Group): Map<FormId, MountedForm> {
    return new Map(
      [...models].map(([form, model]) => {
        const mounted = {
          rig: mountRig(group, model, wind),
          holder: model.holder,
          head: model.model.root.getObjectByName("Head"),
        };
        model.holder.visible = false;
        return [form, mounted] as const;
      }),
    );
  }
  function show(forms: ReadonlyMap<FormId, MountedForm>, form: FormId) {
    const mounted = forms.get(form);
    if (!mounted) throw new Error(`${form} 的模型没有载入。`);
    mounted.holder.visible = true;
    return { form, rig: mounted.rig, head: mounted.head };
  }
  yield;
  // Every player is drawn; each form's model is shown when the sim evolves them.
  const avatars: Avatar[] = world.players.map((player, index) => {
    const models = assets.players[index];
    if (!models) throw new Error(`玩家 ${player.id} 的模型没有载入。`);
    const group = new Group();
    scene.add(group);
    const forms = mountLine(models, group);
    return {
      player,
      forms,
      group,
      ...show(forms, formOf(player).id),
      runWeight: 0,
      muzzle: { x: 0, y: 0, z: 0, faceX: 0, faceZ: 1 },
      alive: player.alive,
    };
  });
  const self = avatars.find((avatar) => avatar.player.id === local);
  if (!self) throw new Error(`本地玩家 ${local} 不在这一局。`);
  const player = self.player;
  const avatar = self.group;
  const identities = playerRings(world);
  scene.add(identities.root);
  disposables.push(identities);
  /** Each drawn player's muzzle this frame, by player id. */
  const muzzles = new Map<PlayerId, Muzzle>();
  const headAt = new Vector3();

  yield;
  // Effects stand on a liquid's surface where it covers the ground, as the decals do.
  const vfx = new Vfx(
    {
      uniforms,
      heightAt: (x, z) => Math.max(ground(x, z), uniforms.uLiquidTop.value),
    },
    world.stage,
  );
  scene.add(vfx.root);

  const shake = createCameraShake();
  let guardianWasDashing = false;
  let elapsed = 0;
  const gaitPhases = new Map<number, number>();
  let hitClock = 0;
  let lastFrameAt = performance.now() / 1000;
  const cameraTarget = new Vector3(player.x, 0, player.z);
  const projected = new Vector3();
  const shadowCentre = new Vector3();
  const toPlayer = new Vector3();
  const toProp = new Vector3();

  function frameEnemies(alpha: number, yaw: number, hitTime: number, dt: number): void {
    const living = new Set([...world.enemies, ...world.partners].map(({ id }) => id));
    for (const id of gaitPhases.keys()) if (!living.has(id)) gaitPhases.delete(id);
    const frameTime = world.time - (1 - alpha) * TICK;
    for (const [id, end] of shellEnds)
      if (cloysterClosure(frameTime, end) === 0 && frameTime > end) shellEnds.delete(id);
    // Screen-right on the ground plane, for the hit reaction's sideways shake.
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    const counts = {} as Record<EnemyId, number>;
    for (const id of Object.keys(enemyMeshes) as EnemyId[]) counts[id] = 0;
    let blobCount = 0;
    for (const enemy of world.enemies) {
      const mesh = enemyMeshes[enemy.species];
      const index = counts[enemy.species]++;
      if (index >= mesh.instanceMatrix.count) continue;
      const def = enemyDefs[enemy.species];
      const x = lerp(enemy.px, enemy.x, alpha);
      const z = lerp(enemy.pz, enemy.z, alpha);
      const speed = Math.hypot(enemy.x - enemy.px, enemy.z - enemy.pz) / TICK;
      const moving = !stopped(enemy) && speed > 0.05;
      if (water && !def.mobility.flying) water.wade(x, z, moving ? 1 : 0.2);
      // Hop cadence follows actual ground speed so small fast critters scurry and big ones lumber.
      const phase = advanceGait(gaitPhases.get(enemy.id) ?? enemy.id * 1.7, speed, enemy.scale, dt);
      gaitPhases.set(enemy.id, phase);
      const hop = moving ? Math.abs(Math.sin(phase)) * 0.12 : 0;
      const height = def.height * enemy.scale;
      const squash = moving ? 1 + Math.sin(phase * 2) * 0.06 : 1;
      // Swimmers and Gyarados ride the water's surface, sunk a quarter of their height while afloat.
      const floor = ground(x, z);
      const surface = def.mobility.water ? standingHeight(terrain, enemy.species, x, z) : floor;
      const base = surface > floor ? surface - height * 0.25 : floor;
      // Sakurai hit reaction: the struck enemy shakes sideways and squashes while its flash lasts, on a
      // real-time clock so it keeps shaking through hit-stop. Elites and guardians barely flinch.
      const hit =
        Math.min(1, enemy.flash / HIT_FLASH_SECONDS) * (enemy.elite || enemy.boss ? 0.4 : 1);
      const jitter = hit * HIT_JITTER * Math.sin(hitTime * 90 + enemy.id * 2.3);
      const flinch = 1 - 0.14 * hit;
      // Self-destruct swells sideways through its wind-up, throbbing harder as the ring fills; its
      // height stays, so the overhead tell keeps clear of the body.
      const charge =
        def.skill?.kind === "self-destruct" && enemy.phase === "windup"
          ? Math.min(1, enemy.phaseTime / RADIAL["self-destruct"].windup) ** 2
          : 0;
      const swell = 1 + charge * (0.22 + 0.06 * Math.sin(elapsed * 28));
      // Jump arcs, burrowing and Haunter's fade (enemyMotion.ts).
      const motion = bodyMotion(world, enemy, alpha);
      if (enemy.species === "cloyster") {
        if (enemy.hardened > 0) shellEnds.set(enemy.id, world.time + enemy.hardened);
        shellClose!.setX(index, cloysterClosure(frameTime, shellEnds.get(enemy.id)));
      }
      const fade = enemyFades.get(enemy.species);
      if (fade) fade.setX(index, motion.show);
      const bodyScale = fade ? 1 : motion.show;
      dummy.position.set(
        x + rightX * jitter,
        base +
          motion.lift +
          (def.mobility.flying ? FLYER_HOVER + Math.sin(phase * 0.5) * 0.15 : hop) * enemy.scale,
        z + rightZ * jitter,
      );
      dummy.rotation.set(motion.pitch, Math.atan2(enemy.faceX, enemy.faceZ), 0);
      dummy.scale.set(
        (height / squash) * (2 - flinch) * swell * bodyScale,
        height * squash * flinch * bodyScale,
        (height / squash) * (2 - flinch) * swell * bodyScale,
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (enemy.flash > 0) tint.setRGB(3, 3, 3);
      else if (!statusTint(enemy, elapsed, tint)) {
        if (enemy.elite) tint.setRGB(1.3, 1.08, 0.7);
        else tint.setRGB(1, 1, 1);
      }
      vfx.tells.tint(enemy.id, tint);
      mesh.setColorAt(index, tint);
      if (blobCount < blobs.instanceMatrix.count) {
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(enemy.radius * 1.15 * motion.show);
        dummy.updateMatrix();
        blobs.setMatrixAt(blobCount++, dummy.matrix);
      }
    }
    // Partners share their species' instanced mesh: natural colours, no hit flinch.
    for (const partner of world.partners) {
      const mesh = enemyMeshes[partner.species];
      const index = counts[partner.species]++;
      if (index >= mesh.instanceMatrix.count) continue;
      const def = enemyDefs[partner.species];
      const x = lerp(partner.px, partner.x, alpha);
      const z = lerp(partner.pz, partner.z, alpha);
      const speed = Math.hypot(partner.x - partner.px, partner.z - partner.pz) / TICK;
      const phase = advanceGait(gaitPhases.get(partner.id) ?? partner.id * 1.7, speed, 1, dt);
      gaitPhases.set(partner.id, phase);
      const hop = speed < 0.05 ? 0 : Math.abs(Math.sin(phase)) * 0.12;
      const height = def.height * PARTNER.scale;
      dummy.position.set(
        x,
        ground(x, z) +
          (def.mobility.flying ? FLYER_HOVER + Math.sin(phase * 0.5) * 0.15 : hop) * PARTNER.scale,
        z,
      );
      dummy.rotation.set(0, Math.atan2(partner.faceX, partner.faceZ), 0);
      dummy.scale.setScalar(height);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, tint.setRGB(1, 1, 1));
      enemyFades.get(partner.species)?.setX(index, 1);
      if (partner.species === "cloyster") shellClose!.setX(index, 0);
      if (blobCount < blobs.instanceMatrix.count) {
        dummy.position.set(x, 0, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(def.radius * PARTNER.scale * 1.15);
        dummy.updateMatrix();
        blobs.setMatrixAt(blobCount++, dummy.matrix);
      }
    }
    for (const id of Object.keys(enemyMeshes) as EnemyId[]) {
      const mesh = enemyMeshes[id];
      mesh.count = Math.min(counts[id], mesh.instanceMatrix.count);
      const silhouette = enemySilhouettes.get(id);
      if (silhouette) silhouette.count = mesh.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const fade = enemyFades.get(id);
      if (fade) fade.needsUpdate = true;
    }
    blobs.count = blobCount;
    if (shellClose) shellClose.needsUpdate = true;
    blobs.instanceMatrix.needsUpdate = true;
  }

  function frameAvatar(body: Avatar, alpha: number, dt: number, remoteSpeed?: number): void {
    const { player, group } = body;
    const form = formOf(player).id;
    if (form !== body.form) {
      body.forms.get(body.form)!.holder.visible = false;
      Object.assign(body, show(body.forms, form));
    }
    const { rig } = body;
    const x = lerp(player.px, player.x, alpha);
    const z = lerp(player.pz, player.z, alpha);
    group.position.set(x, ground(x, z), z);
    const yaw = Math.atan2(player.faceX, player.faceZ);
    let delta = yaw - group.rotation.y;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const turn = delta * Math.min(1, dt * 14);
    group.rotation.y += turn;
    // Host remote poses are already sampled (px === x); their gait retains the sampled speed.
    const speed = remoteSpeed ?? Math.hypot(player.x - player.px, player.z - player.pz) / TICK;
    if (water && player.alive) water.wade(x, z, speed > 0.1 ? 1 : 0.2);
    body.runWeight = lerp(body.runWeight, speed > 0.1 ? 1 : 0, Math.min(1, dt * 12));
    const { runWeight } = body;
    group.position.y += lerp(rig.lift.idle, rig.lift.run, runWeight);
    const runClip = rig.run.getClip().duration;
    const maxScale = (MAX_CADENCE * runClip) / rig.runCycles;
    rig.run.setEffectiveTimeScale(Math.min(maxScale, Math.max(0.6, speed / rig.clipSpeed)));
    rig.run.setEffectiveWeight(runWeight);
    rig.idle.setEffectiveWeight(1 - runWeight);
    const breathe = 1 + Math.sin(elapsed * 3) * 0.015;
    const dashing = player.dashTime > 0;
    group.scale.set(dashing ? 0.85 : 1, (dashing ? 1.12 : 1) * breathe, dashing ? 1.25 : 1);
    if (body.alive && !player.alive) {
      const form = formOf(player);
      vfx.faint(x, z, form.radius, form.height);
    }
    body.alive = player.alive;
    group.visible = !player.alive
      ? false
      : player.invulnerable > 0 && player.hurt > 0
        ? Math.floor(elapsed * 24) % 2 === 0
        : true;
    rig.mixer.update(dt);
    // Quaternion blending follows an arc: planted endpoints can still dip below the floor between clips.
    group.position.y += Math.max(
      0,
      -rig.footFloor() * group.scale.y - lerp(rig.lift.idle, rig.lift.run, runWeight),
    );
    rig.tail?.update(dt, turn, speed, runWeight, (rig.run.time / runClip) * rig.runCycles);
    frameMuzzle(body);
  }

  /** Where the current form's shots leave the model: its head bone, nudged out along the facing. */
  function frameMuzzle({ player, group, head, muzzle }: Avatar): void {
    if (!head) {
      muzzles.delete(player.id);
      return;
    }
    head.getWorldPosition(headAt);
    muzzle.faceX = Math.sin(group.rotation.y);
    muzzle.faceZ = Math.cos(group.rotation.y);
    const reach = formOf(player).radius * 0.5;
    muzzle.x = headAt.x + muzzle.faceX * reach;
    muzzle.y = headAt.y;
    muzzle.z = headAt.z + muzzle.faceZ * reach;
    muzzles.set(player.id, muzzle);
  }

  /** Fade props whose screen footprint covers the player and that sit nearer the camera. */
  function frameOcclusion(dt: number): void {
    toPlayer
      .copy(avatar.position)
      .setY(avatar.position.y + 0.6)
      .project(camera);
    const playerDepth = camera.position.distanceTo(avatar.position);
    const ease = Math.min(1, dt * 8);
    for (const layer of props) {
      const values = layer.fade.array as Float32Array;
      let changed = false;
      layer.placed.forEach((obstacle, index) => {
        let target = 1;
        const base = ground(obstacle.x, obstacle.z);
        toProp.set(obstacle.x, base + layer.height * 0.55 * obstacle.scale, obstacle.z);
        const depth = camera.position.distanceTo(toProp);
        if (depth < playerDepth) {
          toProp.project(camera);
          const reach = (layer.height * obstacle.scale * 0.9) / Math.max(4, depth);
          if (
            Math.abs(toProp.x - toPlayer.x) * camera.aspect < reach &&
            Math.abs(toProp.y - toPlayer.y) < reach * 1.4
          ) {
            target = 0.28;
          }
        }
        const value = values[index]!;
        const next = lerp(value, target, ease);
        if (Math.abs(next - value) > 0.002) {
          values[index] = next;
          changed = true;
        }
      });
      if (changed) layer.fade.needsUpdate = true;
    }
  }

  function frameStations(dt: number): void {
    for (const { station, mesh } of stationMeshes) {
      if (station.kind === "bill") continue;
      const goal = Math.atan2(player.x - station.x, player.z - station.z);
      const delta = Math.atan2(Math.sin(goal - mesh.rotation.y), Math.cos(goal - mesh.rotation.y));
      mesh.rotation.y += delta * Math.min(1, dt * 3);
      mesh.rotation.z = Math.sin(elapsed * 1.6) * 0.04;
    }
  }

  /** The guardian's dash ending near the player lands as a knock (no sim event marks it). */
  function frameGuardianDash(): void {
    const guardian = world.enemies.find((enemy) => enemy.id === world.bossId);
    const dashing = guardian?.phase === "dash";
    if (
      guardian &&
      guardianWasDashing &&
      !dashing &&
      Math.hypot(guardian.x - player.x, guardian.z - player.z) < DASH_FELT_WITHIN
    ) {
      shake.add(TRAUMA.guardianDash);
    }
    guardianWasDashing = dashing;
  }

  /**
   * Centres the shadow window on the visible ground and snaps it to whole shadow texels, so shadow
   * edges stay still instead of crawling as the camera follows the player.
   */
  function frameSun(yaw: number): void {
    shadowCentre.set(
      cameraTarget.x - Math.sin(yaw) * VIEW_AHEAD,
      cameraTarget.y,
      cameraTarget.z - Math.cos(yaw) * VIEW_AHEAD,
    );
    const across = shadowCentre.dot(sunRight);
    const along = shadowCentre.dot(sunUp);
    shadowCentre
      .addScaledVector(sunRight, Math.round(across / shadowTexel[0]) * shadowTexel[0] - across)
      .addScaledVector(sunUp, Math.round(along / shadowTexel[1]) * shadowTexel[1] - along);
    sun.target.position.copy(shadowCentre);
    sun.position.copy(shadowCentre).add(sunOffset);
  }

  return {
    scene,
    camera,
    background,
    debugHeight: (x, z) => Math.max(ground(x, z), uniforms.uLiquidTop.value) + 0.12,
    frame(alpha, dt, events, yaw, remotePlayerSpeeds) {
      elapsed += dt;
      for (const event of events) {
        vfx.handle(event);
        // The camera is the local player's: only their own hurt, evolution and ultimate knock it.
        const mine = "player" in event && event.player === local;
        if (event.t === "player-hit" && mine) shake.add(TRAUMA.playerHit);
        if (event.t === "evolve" && mine) shake.add(TRAUMA.evolve);
        if (event.t === "ult-pulse" && mine && HEAVY_ULT.has(event.look))
          shake.add(TRAUMA.ultHeavy);
        // combat flags the guardian's death as elite too.
        if (event.t === "death" && event.elite) shake.add(TRAUMA.bigKill);
      }
      frameGuardianDash();
      updateWindUniforms(wind, windAt(world.seed, world.time), dt);
      // Real time drives the hit shake so it keeps going through hit-stop (dt slowed), but it stops
      // with the game while frozen (dt 0: pause, level-up choice, end screen).
      const now = performance.now() / 1000;
      if (dt > 0) hitClock += now - lastFrameAt;
      lastFrameAt = now;
      vfx.tells.select(world, alpha, ground, player);
      frameEnemies(alpha, yaw, hitClock, dt);
      frameStations(dt);
      landmark.update(world, elapsed);
      for (const body of avatars)
        frameAvatar(body, alpha, dt, remotePlayerSpeeds?.get(body.player.id));
      identities.update(alpha, dt);
      footprints?.update(alpha);
      vfx.update(world, alpha, dt, yaw, player, muzzles);

      cameraTarget.lerp(avatar.position, Math.min(1, dt * 6));
      camera.position.set(
        cameraTarget.x + Math.sin(yaw) * CAMERA_BACK,
        cameraTarget.y + CAMERA_HEIGHT,
        cameraTarget.z + Math.cos(yaw) * CAMERA_BACK,
      );
      camera.lookAt(cameraTarget.x, cameraTarget.y + 0.6, cameraTarget.z);
      shake.apply(camera, dt);
      camera.updateMatrixWorld();
      frameOcclusion(dt);
      foliage.update(camera, avatar.position);
      dressing.update(camera);
      decoration?.update?.(cameraTarget);
      water?.update(cameraTarget.x, cameraTarget.z);
      frameSun(yaw);
    },
    project(x, y, z, width, height) {
      projected.set(x, ground(x, z) + y, z).project(camera);
      if (projected.z > 1) return null;
      return [(projected.x * 0.5 + 0.5) * width, (-projected.y * 0.5 + 0.5) * height];
    },
    warmSet(on) {
      for (const body of avatars)
        for (const [form, mounted] of body.forms) mounted.holder.visible = on || form === body.form;
    },
    releaseUploads() {
      releaseUploads(scene);
      // Bound in `patchShader` closures only; the ground maps belong to the assets.
      uniforms.uTerrainHeight.value.dispose();
      groundLayers.texture.dispose();
      groundLayers.shore.dispose();
      groundLayers.structure.dispose();
    },
    dispose() {
      for (const body of avatars) for (const mounted of body.forms.values()) mounted.rig.unmount();
      vfx.dispose();
      for (const item of disposables) item.dispose();
      sun.shadow.dispose();
      scene.clear();
    },
  };
}
