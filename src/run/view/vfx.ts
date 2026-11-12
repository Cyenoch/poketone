import { ZONE_GUARDIAN } from "../sim/content/params/late-zones";
import {
  BoxGeometry,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  OctahedronGeometry,
  Shape,
  type BufferGeometry,
  type Material,
  type ShaderMaterial,
} from "three";
import { buffCue, healCue, itemBurst } from "./vfx/items";
import { archetypes } from "../sim/archetypes/index";
import { moves, type MoveId } from "../sim/content/moves";
import type { ReactionId } from "../sim/content/reactions";
import { formOf } from "../sim/evolution";
import { CHEST } from "../sim/content/params/combat";
import { difficulties } from "../sim/content/difficulties";
import {
  AIR_SLASH,
  BOSS_RECOVER,
  FISSURE,
  HYDRO_PUMP,
  STOMP,
} from "../sim/content/params/guardian";
import { zoneDef } from "../sim/currentZone";
import type { StageId } from "../sim/content/stages/index";
import { type World } from "../sim/state/world";
import type { Hazard, Player, PlayerId } from "../sim/state/entities";
import type { RunEvent } from "../sim/state/events";
import * as common from "./vfx/common";
import * as skills from "./vfx/enemySkills";
import * as zone from "./vfx/zoneSkills";
import * as desert from "./vfx/desertSkills";
import * as coast from "./vfx/coastSkills";
import * as guardians from "./vfx/guardianSkills";
import { PSYBEAM, VINE, ROCKFALL } from "../sim/content/params/enemy-skills";

import { Decals } from "./vfx/decals";
import { defaultAreaLook, defaultShotLook } from "./vfx/defaults";
import {
  chain,
  electroBall,
  electroBurst,
  electrocute,
  thunder,
  thunderShock,
} from "./vfx/electric";
import {
  ember,
  fireBlast,
  fireBlastBurst,
  fireSpin,
  fireSpinBurst,
  flamethrower,
  spreadBurn,
} from "./vfx/fire";
import { uploadRange } from "./vfx/gl";
import { Echoes, type AreaLook, type Fx, type Ground, type ShotLook } from "./vfx/fx";
import { razorLeaf, sleepPowder, solarBeam, vineWhip } from "./vfx/grass";
import { Ribbons } from "./vfx/ribbons";
import { Sprites } from "./vfx/sprites";
import { STATUS_SPRITES, statusMarks } from "./vfx/status";
import { TELL_SPRITES, Tells } from "./vfx/tells";
import { createVolumes, type Volume } from "./vfx/volumes";
import { bubbleShot, hydroPump, rapidSpin, steamBurst, waterGun } from "./vfx/water";
import { drainBack, gigaDrain, shockWave, willOWisp } from "./vfx/homing";
import { seedBomb, seedBombBurst } from "./vfx/lob";
import { discharge, lavaPlume } from "./vfx/nova";
import { evolveColumn, ultCast, ultPulse } from "./vfx/ultimates";
import { partnerAttack, partnerGuard, partnerMarker } from "./vfx/partners";
import { PARTNER_ATTACK } from "../sim/content/params/partners";
import { partnerRadius } from "../sim/partners";
import { surf, whirlpool, whirlpoolBurst } from "./vfx/wave";
import {
  ballStorm,
  ballStormBurst,
  fireWhirl,
  fireWhirlBurst,
  floralBeam,
  floralBloom,
  hydroSpiral,
  hydroSpiralBurst,
} from "./vfx/fusion";

/** Bespoke looks by move; the rest fall back to their archetype's default (vfx/defaults.ts). */
const shotLooks: Partial<Record<MoveId, ShotLook>> = {
  "will-o-wisp": willOWisp,
  "shock-wave": shockWave,
  "giga-drain": gigaDrain,
  "seed-bomb": seedBomb,
  surf,
  ember,
  "fire-blast": fireBlast,
  "razor-leaf": razorLeaf,
  "water-gun": waterGun,
  bubble: bubbleShot,
  "thunder-shock": thunderShock,
  "electro-ball": electroBall,
  // 花朵光束's leaf blades fly like Razor Leaf.
  "floral-beam": razorLeaf,
};

const areaLooks: Partial<Record<MoveId, AreaLook>> = {
  "fire-spin": fireSpin,
  flamethrower,
  "vine-whip": vineWhip,
  "sleep-powder": sleepPowder,
  "solar-beam": solarBeam,
  "rapid-spin": rapidSpin,
  "hydro-pump": hydroPump,
  thunder,
  "lava-plume": lavaPlume,
  discharge,
  whirlpool,
  "floral-beam": floralBeam,
  "fire-whirl": fireWhirl,
  "hydro-spiral": hydroSpiral,
  "ball-storm": ballStorm,
};

/** The `burst` areas that orbs and vortices leave behind, by the move that made them. */
const burstLooks: Partial<Record<MoveId, AreaLook>> = {
  "fire-spin": fireSpinBurst,
  "fire-blast": fireBlastBurst,
  "electro-ball": electroBurst,
  "seed-bomb": seedBombBurst,
  whirlpool: whirlpoolBurst,
  "floral-beam": floralBloom,
  "fire-whirl": fireWhirlBurst,
  "hydro-spiral": hydroSpiralBurst,
  "ball-storm": ballStormBurst,
};

interface ShotTrack {
  id: number;
  seen: number;
  /** Drawn offset from the sim path at launch (muzzle − launch point), easing to 0 over `LAUNCH_BLEND`. */
  ox: number;
  oy: number;
  oz: number;
  age: number;
}

/**
 * Seconds a shot takes to blend from the animated model's muzzle onto its sim path. The sim launches
 * from the body edge (deterministic, co-op safe); the drawn shot starts where the mouth really is.
 */
const LAUNCH_BLEND = 0.15;

/** A drawn player's muzzle this frame (head socket), set by the run view before `update`. */
export interface Muzzle {
  x: number;
  y: number;
  z: number;
  /** Facing of the model on the ground plane. */
  faceX: number;
  faceZ: number;
}

interface AreaTrack {
  id: number;
  seen: number;
  /** Telegraph length when first seen, for the 0 → 1 charge. */
  delay: number;
  struck: boolean;
}

interface WarnTrack {
  id: number;
  seen: number;
  life: number;
  /** Its hit has been drawn (the one-off burst of a landing, blast or stomp). */
  struck: boolean;
}

/** Events drawn at the player, who is only known once `update` sees the world. */
type PlayerEvent = Extract<
  RunEvent,
  { t: "dash" | "level" | "revive" | "player-hit" | "drain" | "evolve" | "ult" | "heal" | "buff" }
>;

const dummy = new Object3D();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Drops tracks not seen this frame (their sim object is gone). */
function sweep<T extends { id: number; seen: number }>(
  tracks: Map<number, T>,
  frame: number,
  gone?: (track: T) => void,
): void {
  for (const track of tracks.values()) {
    if (track.seen === frame) continue;
    tracks.delete(track.id);
    gone?.(track);
  }
}

function owner(world: World, id: number): Player | undefined {
  for (const player of world.players) if (player.id === id) return player;
  return undefined;
}

function commit(mesh: InstancedMesh, count: number): void {
  mesh.count = Math.min(count, mesh.instanceMatrix.count);
  mesh.visible = mesh.count > 0;
  uploadRange(mesh.instanceMatrix, mesh.count * 16);
}

function instanced(geometry: BufferGeometry, material: Material, capacity: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return mesh;
}

/** 星星沙子: a flat four-point star standing up, so it reads apart from the faceted candy and berry. */
function stardustGeometry(): BufferGeometry {
  const shape = new Shape();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? 0.3 : 0.1;
    const a = (i / 8) * Math.PI * 2;
    if (i === 0) shape.moveTo(0, r);
    else shape.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
  geometry.translate(0, 0, -0.04);
  return geometry;
}

/** Projectiles, areas, hazards, pickups and particles. Reads world state; never writes it. */
export class Vfx {
  readonly root = new Group();
  private readonly fx: Fx;
  private readonly volumes: Volume[];
  private readonly decalMaterial: ShaderMaterial;
  private readonly dangerMaterial: ShaderMaterial;
  private readonly candies: InstancedMesh;
  private readonly berries: InstancedMesh;
  private readonly chests: InstancedMesh;
  private readonly stardust: InstancedMesh;
  private readonly shots = new Map<number, ShotTrack>();
  private readonly areas = new Map<number, AreaTrack>();
  private readonly freeShots: ShotTrack[] = [];
  private readonly freeAreas: AreaTrack[] = [];
  /** Bounded by the events drained before a rendered frame, never by run history. */
  private readonly projectileBeats = new Map<number, number>();
  private readonly warnings = new Map<number, WarnTrack>();
  /** Enemy wind-up glints; the run view reads it for the body flash. */
  readonly tells: Tells;
  /** Events that need the player's position, replayed in `update`. */
  private readonly playerEvents: PlayerEvent[] = [];
  /** Heal pulses still growing (skills/healPulse.ts). */
  private readonly mends: zone.Mend[] = [];
  private readonly uniforms = { uTime: { value: 0 } };
  private frame = 0;

  constructor(ground: Ground, stage: StageId) {
    this.tells = new Tells();
    this.decalMaterial = Decals.material(this.uniforms, ground.uniforms);
    this.dangerMaterial = Decals.material(this.uniforms, ground.uniforms);
    // Tower warnings are drawn over masonry; their ground footprint still matches the hitbox.
    this.dangerMaterial.depthTest = stage !== "tower";
    const volumes = createVolumes(this.uniforms, ground.uniforms);
    this.volumes = Object.values(volumes);
    this.fx = {
      sprites: new Sprites(this.uniforms, 2800, 600 + STATUS_SPRITES + TELL_SPRITES, TELL_SPRITES),
      decals: new Decals(this.decalMaterial, 160, 0.05),
      // Nightmare / rampage peak near 90 live telegraphs; a dropped one would hit unseen.
      danger: new Decals(this.dangerMaterial, 192, 0.08),
      ribbons: new Ribbons(this.uniforms, 6000),
      volumes,
      echoes: new Echoes(64),
      ground,
      viewYaw: 0,
      time: 0,
      dt: 0,
    };
    // Ground first, enemy danger last so player effects never bury a telegraph.
    const layers = [
      this.fx.decals.mesh,
      ...this.volumes.map((volume) => volume.mesh),
      this.fx.ribbons.mesh,
      this.fx.sprites.mesh,
      this.fx.danger.mesh,
    ];
    layers.forEach((mesh, order) => (mesh.renderOrder = order + 1));
    this.candies = instanced(
      new OctahedronGeometry(0.22, 0),
      new MeshLambertMaterial({ color: "#59c8ff", emissive: "#1f6fb0" }),
      600,
    );
    this.berries = instanced(
      new IcosahedronGeometry(0.28, 0),
      new MeshLambertMaterial({ color: "#3d7bf0", emissive: "#173a80" }),
      40,
    );
    this.chests = instanced(
      new BoxGeometry(0.8, 0.6, 0.6),
      new MeshLambertMaterial({ color: "#ffd45b", emissive: "#6b4a00" }),
      20,
    );
    this.stardust = instanced(
      stardustGeometry(),
      new MeshLambertMaterial({ color: "#ffe1f4", emissive: "#c2508e" }),
      60,
    );
    this.root.add(...layers, this.candies, this.berries, this.chests, this.stardust);
  }

  handle(event: RunEvent): void {
    const fx = this.fx;
    switch (event.t) {
      case "hit":
        if (event.confirmedContact) break;
        common.hit(fx, event.x, event.z, event.crit);
        break;
      case "contact":
        common.hit(fx, event.x, event.z, false);
        break;
      case "death":
        common.death(fx, event.x, event.z, event.elite);
        break;
      case "reaction": {
        const y = fx.ground.heightAt(event.x, event.z) + 0.7;
        const look: Record<ReactionId, typeof electrocute> = {
          shock: electrocute,
          steam: steamBurst,
          wildfire: spreadBurn,
        };
        look[event.reaction](fx, event.x, y, event.z);
        break;
      }
      case "chain":
        chain(fx, event.points, event.lift);
        break;
      case "impact":
        // Shared terrain dust also serves hostile shots; the projectile event owns the move beat.
        common.impact(fx, event.x, event.y, event.z);
        break;
      case "projectile-feedback": {
        if ((this.projectileBeats.get(event.id) ?? -1) >= event.tick) break;
        this.projectileBeats.set(event.id, event.tick);
        const look = shotLooks[event.move] ?? defaultShotLook(event.archetype, event.type);
        const track = this.shots.get(event.id);
        if (event.ended) {
          if (track) {
            this.shots.delete(event.id);
            this.releaseShot(track);
          } else look.launch?.(fx, event.fromX, event.fromY, event.fromZ);
        }
        for (let hit = 0; hit < event.hits; hit++) look.hit?.(fx, event.x, event.y, event.z);
        if (event.reason === "terrain") look.hit?.(fx, event.x, event.y, event.z);
        else if (event.reason === "expired") look.fade?.(fx, event.x, event.y, event.z);
        break;
      }
      case "dash":
      case "level":
      case "revive":
      case "player-hit":
      case "drain":
      case "evolve":
      case "ult":
      case "heal":
      case "buff":
        this.playerEvents.push(event);
        break;
      case "ult-pulse":
        ultPulse(fx, event);
        break;
      case "item-burst":
        itemBurst(fx, event);
        break;
      case "capture":
        evolveColumn(fx, event.x, event.z);
        break;
      case "partner-attack":
        partnerAttack(
          fx,
          event.style,
          event.type,
          event.x,
          event.z,
          event.tx,
          event.tz,
          PARTNER_ATTACK[event.style].reach,
        );
        break;
      case "partner-guard":
        partnerGuard(fx, event.type, event.x, event.z, event.tx, event.tz);
        break;
      case "tell":
        this.tells.add(event);
        break;
      case "heal-pulse":
        this.mends.push({ x: event.x, z: event.z, age: 0 });
        break;
      default:
        break;
    }
  }

  /** `self` is the local player (status marks rank by distance to them); `muzzles` by player id. */
  update(
    world: World,
    alpha: number,
    dt: number,
    viewYaw: number,
    self: Player,
    muzzles: ReadonlyMap<PlayerId, Muzzle>,
  ): void {
    const fx = this.fx;
    fx.dt = dt;
    fx.viewYaw = viewYaw;
    fx.time += dt;
    this.uniforms.uTime.value = fx.time;
    this.frame++;
    fx.decals.begin(dt);
    fx.danger.begin(dt);
    fx.ribbons.begin();
    for (const volume of this.volumes) volume.begin();
    this.replayPlayerEvents(world, alpha);
    // Projectile heads and hazards paint over the status marks.
    statusMarks(fx, world, alpha, self);
    skills.skillBodies(fx, world, alpha);
    zone.zoneBodies(fx, world, alpha);
    coast.coastBodies(fx, world, alpha);
    this.updateMends(dt);
    this.updateShots(world, alpha, muzzles);
    this.updateAreas(world, alpha);
    fx.echoes.update(fx);
    desert.surfacePatches(fx, world.map.terrain.surface?.patches ?? []);
    this.updateHazards(world, alpha);
    this.airSlashWarning(world);
    for (const partner of world.partners)
      partnerMarker(
        fx,
        partner,
        lerp(partner.px, partner.x, alpha),
        lerp(partner.pz, partner.z, alpha),
        partnerRadius(partner),
      );
    this.updatePickups(world);
    fx.decals.end();
    fx.danger.end();
    fx.ribbons.end();
    for (const volume of this.volumes) volume.end();
    // Attack tells last, so nothing paints over a warning; their slots were held back all frame.
    fx.sprites.release();
    this.tells.draw(fx);
    fx.sprites.update(dt);
    this.projectileBeats.clear();
  }

  private replayPlayerEvents(world: World, alpha: number): void {
    for (const event of this.playerEvents) {
      const player = owner(world, event.player);
      if (!player) continue;
      const x = lerp(player.px, player.x, alpha);
      const z = lerp(player.pz, player.z, alpha);
      if (event.t === "dash") common.dash(this.fx, x, z, player.dashX, player.dashZ);
      else if (event.t === "level" || event.t === "revive") common.levelUp(this.fx, x, z);
      else if (event.t === "drain") drainBack(this.fx, event.x, event.z, x, z);
      else if (event.t === "evolve") evolveColumn(this.fx, x, z);
      else if (event.t === "ult") ultCast(this.fx, event.line, x, z);
      else if (event.t === "heal") healCue(this.fx, x, z, formOf(player).radius, event.share);
      else if (event.t === "buff") {
        const form = formOf(player);
        buffCue(this.fx, x, z, form.radius, form.height);
      } else common.playerHurt(this.fx, x, z);
    }
    this.playerEvents.length = 0;
  }

  private updateShots(world: World, alpha: number, muzzles: ReadonlyMap<PlayerId, Muzzle>): void {
    const fx = this.fx;
    for (const shot of world.projectiles) {
      if (shot.delay > 0) continue;
      const look = shotLooks[shot.move] ?? defaultShotLook(shot.archetype, shot.type);
      let x = lerp(shot.px, shot.x, alpha);
      let y = lerp(shot.py, shot.y, alpha);
      let z = lerp(shot.pz, shot.z, alpha);
      let track = this.shots.get(shot.id);
      if (!track) {
        track = this.freeShots.pop() ?? {
          id: 0,
          seen: 0,
          ox: 0,
          oy: 0,
          oz: 0,
          age: 0,
        };
        track.id = shot.id;
        track.seen = 0;
        track.ox = track.oy = track.oz = track.age = 0;
        this.shots.set(shot.id, track);
        // Only shots heading the way the model faces start at its mouth; one fired backwards leaves
        // the body edge as simulated, rather than passing through the model.
        const muzzle = muzzles.get(shot.owner);
        if (
          muzzle &&
          archetypes[shot.archetype].launch !== "chest" &&
          shot.vx * muzzle.faceX + shot.vz * muzzle.faceZ > 0
        ) {
          track.ox = muzzle.x - x;
          track.oy = muzzle.y - y;
          track.oz = muzzle.z - z;
        }
        if (muzzle) look.launch?.(fx, muzzle.x, muzzle.y, muzzle.z);
        else {
          const caster = owner(world, shot.owner);
          if (caster) {
            const cx = lerp(caster.px, caster.x, alpha);
            const cz = lerp(caster.pz, caster.z, alpha);
            look.launch?.(fx, cx, fx.ground.heightAt(cx, cz) + CHEST, cz);
          }
        }
      } else track.age += fx.dt;
      const blend = Math.max(0, 1 - track.age / LAUNCH_BLEND) ** 2;
      x += track.ox * blend;
      y += track.oy * blend;
      z += track.oz * blend;
      track.seen = this.frame;
      look.fly(fx, shot, x, y, z);
    }
    sweep(this.shots, this.frame, this.releaseShot);
  }

  // Retain only a small simultaneous volley, never every historical projectile id.
  private readonly releaseShot = (track: ShotTrack): void => {
    if (this.freeShots.length < 128) this.freeShots.push(track);
  };

  private readonly releaseArea = (track: AreaTrack): void => {
    if (this.freeAreas.length < 64) this.freeAreas.push(track);
  };

  private updateAreas(world: World, alpha: number): void {
    for (const area of world.areas) {
      if (!area.move) continue;
      const look =
        (area.kind === "burst" ? burstLooks : areaLooks)[area.move] ??
        defaultAreaLook(area.kind, area.type);
      let track = this.areas.get(area.id);
      if (!track) {
        track = this.freeAreas.pop() ?? { id: 0, seen: 0, delay: 0, struck: false };
        track.id = area.id;
        track.seen = 0;
        track.delay = area.delay;
        track.struck = false;
        this.areas.set(area.id, track);
      }
      track.seen = this.frame;
      // Following areas ride the interpolated owner, like the avatar does.
      const player = area.follow ? owner(world, area.owner) : undefined;
      let x = player ? lerp(player.px, player.x, alpha) : area.x;
      let z = player ? lerp(player.pz, player.z, alpha) : area.z;
      // A held beam leaves the body edge, like shots do, not the caster's centre.
      if (player && archetypes[moves[area.move].archetype].launch === "edge") {
        const reach = formOf(player).radius;
        x += area.dirX * reach;
        z += area.dirZ * reach;
      }
      if (area.delay <= 0 && !track.struck) {
        track.struck = true;
        look.strike?.(this.fx, area, x, z);
      }
      const charge = track.delay > 0 ? Math.min(1, 1 - area.delay / track.delay) : 1;
      look.live?.(this.fx, area, x, z, charge);
    }
    sweep(this.areas, this.frame, this.releaseArea);
  }

  private updateHazards(world: World, alpha: number): void {
    for (const hazard of world.hazards) {
      if ((hazard.delay ?? 0) > 0) continue;
      const x = lerp(hazard.px, hazard.x, alpha);
      const y = lerp(hazard.py, hazard.y, alpha);
      const z = lerp(hazard.pz, hazard.z, alpha);
      switch (hazard.kind) {
        case "poison-sting-warn":
        case "ember-warn":
        case "thunder-shock-warn":
        case "poison-fan-warn":
        case "pay-day-warn":
        case "spike-cannon-warn":
        case "water-gun-warn":
        case "pin-missile-warn":
        case "icicle-warn":
        case "flamethrower-warn":
          skills.shotWarn(this.fx, hazard, x, z);
          break;
        case "ember":
        case "poison-sting":
        case "thunder-shock":
        case "poison-fan":
        case "pay-day":
        case "spike-cannon":
        case "water-gun":
        case "pin-missile":
        case "icicle":
        case "flamethrower":
          skills.shotHazard(this.fx, hazard, x, y, z);
          break;
        case "bone-warn": {
          const track = this.warning(hazard);
          desert.boneWarnHazard(this.fx, hazard, x, z, 1 - hazard.life / track.life);
          break;
        }
        case "bone":
          desert.boneHazard(this.fx, hazard, x, y, z);
          break;
        case "rockfall": {
          const track = this.warning(hazard);
          const fresh = this.struck(track, hazard);
          const charge = 1 - (hazard.life - ROCKFALL.residue) / (track.life - ROCKFALL.residue);
          desert.rockfallHazard(this.fx, world, hazard, charge, fresh);
          break;
        }
        case "flame-trail":
        case "burning-trail":
          desert.trailHazard(this.fx, hazard);
          break;
        case "quicksand-pit":
          desert.quicksandPitHazard(this.fx, hazard);
          break;
        case "bubble":
          zone.bubbleHazard(this.fx, hazard, x, y, z);
          break;
        case "egg":
          zone.eggHazard(this.fx, hazard, x, y, z);
          break;
        case "egg-blast":
          zone.eggBlastHazard(this.fx, hazard, this.struck(this.warning(hazard), hazard));
          break;
        case "vine": {
          const charge = Math.min(1, 1 - (hazard.life - VINE.active) / VINE.windup);
          zone.vineHazard(this.fx, hazard, x, y, z, hazard.life > VINE.active ? charge : 1);
          break;
        }
        case "landing": {
          const track = this.warning(hazard);
          const fresh = this.struck(track, hazard);
          zone.landingHazard(this.fx, world, hazard, 1 - hazard.life / track.life, fresh);
          break;
        }
        case "fissure": {
          const track = this.warning(hazard);
          const charge = 1 - (hazard.life - FISSURE.active) / (track.life - FISSURE.active);
          zone.fissureHazard(this.fx, hazard, charge);
          break;
        }
        case "stomp": {
          const track = this.warning(hazard);
          const fresh = this.struck(track, hazard);
          const charge = 1 - (hazard.life - STOMP.active) / (track.life - STOMP.active);
          zone.stompHazard(this.fx, hazard, charge, fresh);
          break;
        }
        case "rock-shard":
          zone.shardHazard(this.fx, hazard, x, y, z);
          break;
        case "discharge":
        case "self-destruct":
        case "discharge-wide":
        case "discharge-quick":
        case "dragon-rage":
        case "dragon-pulse":
        case "sing":
        case "sing-wide":
          skills.radialHazard(this.fx, hazard, x, z);
          break;
        case "crabhammer":
        case "thunder-bolt": {
          const track = this.warning(hazard);
          const fresh = this.struck(track, hazard);
          const charge = 1 - (hazard.life - ROCKFALL.residue) / (track.life - ROCKFALL.residue);
          if (hazard.kind === "crabhammer") coast.crabhammerHazard(this.fx, hazard, charge, fresh);
          else coast.thunderBoltHazard(this.fx, hazard, charge, fresh);
          break;
        }
        case "hydro-pump": {
          const track = this.warning(hazard);
          coast.hydroPumpHazard(this.fx, hazard, x, y, z, track.life - HYDRO_PUMP.active);
          break;
        }
        case "twister":
          coast.twisterHazard(this.fx, hazard, this.struck(this.warning(hazard), hazard));
          break;
        case "spore":
          common.sporeHazard(this.fx, hazard, x, y, z);
          break;
        case "slash":
          common.slashHazard(this.fx, hazard, x, y, z);
          break;
        case "acid":
          skills.acidHazard(this.fx, hazard, x, y, z);
          break;
        case "acid-pool":
          skills.acidPoolHazard(this.fx, hazard, x, z);
          break;
        case "stun-spore":
          skills.stunSporeHazard(this.fx, hazard, x, y, z);
          break;
        case "ice-beam":
        case "psybeam": {
          const track = this.warning(hazard);
          skills.psybeamHazard(this.fx, hazard, x, y, z, track.life - PSYBEAM.active);
          break;
        }
        case "teleport-mark":
          guardians.teleportMark(this.fx, hazard);
          break;
        case "boss-fall": {
          const track = this.warning(hazard);
          const fresh = this.struck(track, hazard);
          guardians.fallingStrike(
            this.fx,
            hazard,
            Math.max(
              0,
              1 -
                (hazard.life - ZONE_GUARDIAN.fallResidue) /
                  (hazard.duration! - ZONE_GUARDIAN.fallResidue),
            ),
            fresh,
          );
          break;
        }
        case "boss-beam":
          guardians.bossBeam(this.fx, hazard);
          break;
        case "boss-shot":
          guardians.bossShot(this.fx, hazard, x, y, z);
          break;
        case "cone":
          guardians.coneHazard(this.fx, hazard);
          break;
        case "closing-box":
          guardians.closingBox(this.fx, hazard);
          break;
        case "orbit":
          guardians.orbitHazard(this.fx, hazard);
          break;
        case "curse-mark":
          guardians.curseMark(this.fx, hazard);
          break;
        case "sweep":
          guardians.sweepHazard(this.fx, world, hazard);
          break;
        case "ice-trail":
          guardians.iceTrail(this.fx, hazard);
          break;
        case "ice-mist":
          guardians.iceMist(this.fx, hazard);
          break;
        case "burning-pool":
          guardians.burningPool(this.fx, hazard);
          break;
        case "ghost-fire":
          guardians.ghostFire(this.fx, hazard, x, z);
          break;
        case "eruption":
          break;
        case "dash-warn": {
          const track = this.warning(hazard);
          common.dashWarnHazard(this.fx, hazard, x, z, 1 - hazard.life / track.life);
          break;
        }
      }
    }
    sweep(this.warnings, this.frame);
  }

  /** The hazard's track, made the first frame it is seen (its life then is the full wind-up). */
  private warning(hazard: Hazard): WarnTrack {
    let track = this.warnings.get(hazard.id);
    if (!track) {
      track = { id: hazard.id, seen: 0, life: hazard.life, struck: false };
      this.warnings.set(hazard.id, track);
    }
    track.seen = this.frame;
    return track;
  }

  /** True on the first frame a hazard has spent its hit (`dmg` 0), for its one-off burst. */
  private struck(track: WarnTrack, hazard: Hazard): boolean {
    if (track.struck || hazard.dmg > 0) return false;
    track.struck = true;
    return true;
  }

  private updateMends(dt: number): void {
    let kept = 0;
    for (const mend of this.mends) {
      zone.mendRing(this.fx, mend);
      mend.age += dt;
      if (mend.age < zone.MEND_SECONDS) this.mends[kept++] = mend;
    }
    this.mends.length = kept;
  }

  /** Scyther's Air Slash wind-up (bosses/scyther.ts): it stands still while `attackTimer` runs out. */
  private airSlashWarning(world: World): void {
    if (zoneDef(world).guardian.brain !== "scyther") return;
    const boss = world.enemies.find((enemy) => enemy.id === world.bossId);
    if (!boss || boss.phase !== "windup" || boss.attackTimer <= 0) return;
    const { airSlashBlades, bossTelegraph } = difficulties[world.difficulty];
    const t = 1 - boss.attackTimer / (BOSS_RECOVER * bossTelegraph);
    const reach = AIR_SLASH.speed * AIR_SLASH.life;
    common.airSlashWarn(this.fx, boss.x, boss.z, airSlashBlades, AIR_SLASH.radius, reach, t);
  }

  /** A player fell (the run view sees `alive` turn false); drawn at the body it leaves. */
  faint(x: number, z: number, radius: number, height: number): void {
    common.faint(this.fx, x, z, radius, height);
  }

  private updatePickups(world: World): void {
    let candies = 0;
    let berries = 0;
    let chests = 0;
    let stardust = 0;
    const bob = Math.sin(this.fx.time * 4) * 0.08;
    for (const pickup of world.pickups) {
      const mesh = {
        xp: this.candies,
        berry: this.berries,
        chest: this.chests,
        stardust: this.stardust,
      }[pickup.kind];
      const index =
        pickup.kind === "xp"
          ? candies++
          : pickup.kind === "berry"
            ? berries++
            : pickup.kind === "chest"
              ? chests++
              : stardust++;
      if (index >= mesh.instanceMatrix.count) continue;
      // Candy grows with its merged value; an elite's stardust (20) stands out from an ordinary 5.
      const big =
        pickup.kind === "xp"
          ? Math.min(2.2, 1 + Math.log10(pickup.value) * 0.6)
          : pickup.kind === "stardust"
            ? Math.min(1.8, 1 + Math.log10(pickup.value / 5) * 0.6)
            : 1;
      const lift = pickup.kind === "chest" ? 0.3 : 0.45;
      dummy.position.set(
        pickup.x,
        this.fx.ground.heightAt(pickup.x, pickup.z) + lift + bob,
        pickup.z,
      );
      // A flat star never turns edge-on: it sways toward the camera instead of spinning.
      const yaw =
        pickup.kind === "stardust"
          ? this.fx.viewYaw + Math.sin(this.fx.time * 2.5 + pickup.id) * 0.6
          : this.fx.time * 2 + pickup.id;
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(big);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    commit(this.candies, candies);
    commit(this.berries, berries);
    commit(this.chests, chests);
    commit(this.stardust, stardust);
  }

  dispose(): void {
    const fx = this.fx;
    fx.sprites.dispose();
    fx.decals.dispose();
    fx.danger.dispose();
    this.decalMaterial.dispose();
    this.dangerMaterial.dispose();
    fx.ribbons.dispose();
    for (const volume of this.volumes) volume.dispose();
    for (const mesh of [this.candies, this.berries, this.chests, this.stardust]) {
      mesh.geometry.dispose();
      (mesh.material as Material).dispose();
      mesh.dispose();
    }
    this.root.clear();
  }
}
