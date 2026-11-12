// Looks for the desert's attacks and ground (docs/state-machines/simulation.md): bone lanes and spinning
// bones (Cubone, Marowak), rockfall circles (Rhydon, Aerodactyl), Rapidash's burning trail, the
// quicksand and burning-ground patches the map stamps, and Sandslash's quicksand pit. Telegraphs fill
// on the danger layer like the forest's; standing ground (patches, trails, the pit) keeps one constant
// alpha in its element's colour, so it never reads as a wind-up (§1.6).

import { ROCKFALL } from "../../sim/content/params/enemy-skills";
import { QUICKSAND_PIT } from "../../sim/content/params/guardian";
import type { SurfacePatch } from "../../sim/surface";
import { ICE_COLOR, ICE_DEEP } from "../environment/ice-surface";
import type { World } from "../../sim/state/world";
import type { Hazard } from "../../sim/state/entities";
import { Decal } from "./decals";
import { perFrame, rand, spray, type Fx } from "./fx";
import { danger, fire, poison, stone, water, white, wind } from "./palette";
import { rgb } from "./gl";
import { Shape, sprite } from "./sprites";

const bone = sprite({ shape: Shape.shard, from: wind.cream, accent: stone.dark });
const boneHalo = sprite({
  shape: Shape.glow,
  from: wind.cream,
  accent: white,
  alpha: 0.35,
  add: 0.3,
});
const ghostBone = sprite({ shape: Shape.shard, from: poison.light, accent: poison.deep });
const ghostBoneHalo = sprite({
  shape: Shape.glow,
  from: poison.purple,
  accent: poison.light,
  alpha: 0.45,
});
const rock = sprite({ shape: Shape.shard, from: stone.light, accent: stone.dark });
const dust = sprite({
  shape: Shape.puff,
  life: 0.5,
  grow: 1.6,
  from: stone.light,
  to: stone.dark,
  accent: stone.dark,
  alpha: 0.8,
  drag: 3,
  gravity: -0.6,
});
const flame = sprite({
  shape: Shape.flame,
  life: 0.5,
  grow: 0.6,
  from: fire.yellow,
  to: fire.red,
  accent: fire.deep,
  add: 0.5,
  gravity: -1.4,
});
const sandGrain = sprite({
  shape: Shape.puff,
  life: 0.7,
  grow: 1.3,
  from: rgb("#b69a6e"),
  to: rgb("#8b7151"),
  accent: rgb("#75604a"),
  alpha: 0.28,
  drag: 2,
  gravity: -0.2,
});

/** Burning ground and trails: one glow and ember-flecked scorch, constant alpha, rising flames. */
const BURN_ALPHA = 0.75;
/** Quicksand keeps its boundary while the sand settles toward its centre. */
const SAND_ALPHA = 0.85;
const sandDark = rgb("#8b7151");
const sandRidge = rgb("#c0a77e");
const ember = rgb("#a66e36");

/** A bone lane: the bone's reach out, filling toward its end as the wind-up runs out. */
export function boneWarnHazard(fx: Fx, hazard: Hazard, x: number, z: number, charge: number): void {
  const w = hazard.radius;
  fx.danger
    .put(Decal.danger, x, z, hazard.length, Math.atan2(hazard.dirX, hazard.dirZ))
    .rect(-w, 0, w, hazard.length)
    .tint(
      hazard.element === "ghost"
        ? poison.purple
        : hazard.element === "ice"
          ? water.light
          : hazard.element
            ? danger.red
            : wind.cream,
      0.9,
      danger.deep,
      0,
    )
    .args(charge, w);
}

/** A bone in flight, spinning, with a ring beneath it like every enemy shot. */
export function boneHazard(fx: Fx, hazard: Hazard, x: number, y: number, z: number): void {
  const r = hazard.radius;
  fx.danger
    .put(Decal.ring, x, z, r * 1.6)
    .tint(hazard.element === "ghost" ? poison.purple : wind.cream, 0.9, danger.deep, 0)
    .args(0, 0.3, 1);
  fx.sprites.draw(hazard.element === "ghost" ? ghostBoneHalo : boneHalo, x, y, z, r * 2.4);
  fx.sprites.draw(
    hazard.element === "ghost" ? ghostBone : bone,
    x,
    y,
    z,
    r * 1.8,
    1,
    hazard.vx,
    hazard.vz,
    14,
    hazard.id,
  );
}

/**
 * A rockfall circle: fills toward its rim while a rock drops onto it (t 0 → 1), then dust and cracks.
 * Red for the guardian and elites, stone for the swarm. `fresh` is the first frame after the hit.
 */
export function rockfallHazard(
  fx: Fx,
  world: World,
  hazard: Hazard,
  t: number,
  fresh: boolean,
): void {
  const caster = world.enemies.find((enemy) => enemy.id === hazard.caster);
  const red = !caster || caster.boss || caster.elite;
  const a = red ? danger.red : stone.light;
  const b = red ? danger.deep : stone.dark;
  const r = hazard.radius;
  if (hazard.dmg > 0) {
    fx.danger
      .put(Decal.telegraph, hazard.x, hazard.z, r, 0, hazard.id * 0.618)
      .tint(a, 0.95, b, 0)
      .args(t);
    // The rock is in sight for the last half of the fall.
    if (t > 0.5) {
      const drop = (1 - t) * 2;
      fx.sprites.draw(rock, hazard.x, hazard.y + 0.5 + drop * 7, hazard.z, r * 0.35, 1, 0, 0, 3);
    }
    return;
  }
  const fade = Math.max(0, hazard.life / ROCKFALL.residue);
  fx.danger
    .put(Decal.ring, hazard.x, hazard.z, r)
    .tint(a, fade, b, 0)
    .args(1 - fade, 0.25);
  fx.decals
    .put(Decal.cracks, hazard.x, hazard.z, r * 0.8, 0, hazard.id)
    .tint(stone.dark, fade, stone.dark, 0)
    .args(1 - fade);
  if (fresh) spray(fx, dust, hazard.x, hazard.y + 0.1, hazard.z, 10, r * 2, 1.2, 0.35);
}

/** Burning ground along a strip from (x, z): scorch blots a metre apart and flames over them. */
function burningStrip(fx: Fx, hazard: Hazard, alpha: number): void {
  const steps = Math.max(1, Math.ceil(hazard.length));
  const r = hazard.radius * 1.4;
  for (let i = 0; i <= steps; i++) {
    const along = (i / steps) * hazard.length;
    const bx = hazard.x + hazard.dirX * along;
    const bz = hazard.z + hazard.dirZ * along;
    fx.danger.put(Decal.glow, bx, bz, r).tint(fire.soot, 0.65 * alpha, fire.soot, 0);
    fx.danger
      .put(Decal.scorch, bx, bz, r, 0, hazard.id + i)
      .tint(fire.soot, alpha, ember, 0.2)
      .args(0.3);
  }
  for (let i = perFrame(fx, 10 * Math.max(1, hazard.length) * alpha); i > 0; i--) {
    const along = rand(0, hazard.length);
    const bx = hazard.x + hazard.dirX * along + rand(-0.4, 0.4);
    const bz = hazard.z + hazard.dirZ * along + rand(-0.4, 0.4);
    fx.sprites.emit(flame, bx, fx.ground.heightAt(bx, bz) + 0.1, bz, 0, 0.6, 0, rand(0.18, 0.3));
  }
}

/** Rapidash's trail while it charges (laid behind it), then the burning strip fading at its end. */
export function trailHazard(fx: Fx, hazard: Hazard): void {
  if (hazard.length <= 0) return;
  const fade = hazard.kind === "burning-trail" ? Math.min(1, hazard.life / 0.5) : 1;
  burningStrip(fx, hazard, BURN_ALPHA * fade);
}

/** Sand-coloured ripples contract slowly; no white whirl or filling warning circle. */
function quicksand(fx: Fx, x: number, z: number, r: number, alpha: number, seed: number): void {
  fx.danger.put(Decal.glow, x, z, r).tint(sandDark, 0.7 * alpha, sandDark, 0);
  fx.danger
    .put(Decal.ring, x, z, r)
    .tint(sandDark, 0.42 * alpha, sandDark, 0)
    .args(0, 0.025, 1);
  for (let i = 0; i < 3; i++) {
    const phase = (fx.time * 0.12 + seed * 0.173 + i / 3) % 1;
    const radius = r * (0.18 + 0.76 * (1 - phase));
    const fade = Math.sin(phase * Math.PI);
    fx.danger
      .put(Decal.ring, x, z, radius)
      .tint(sandRidge, alpha * fade * 0.46, sandDark, 0)
      .args(0, 0.035, 1);
  }
  for (let i = perFrame(fx, 4 * r); i > 0; i--) {
    const a = rand(0, Math.PI * 2);
    const d = r * rand(0.5, 0.95);
    const gx = x + Math.cos(a) * d;
    const gz = z + Math.sin(a) * d;
    fx.sprites.emit(
      sandGrain,
      gx,
      fx.ground.heightAt(gx, gz) + 0.05,
      gz,
      -Math.cos(a) * 0.8,
      0,
      -Math.sin(a) * 0.8,
      0.12,
    );
  }
}

/** Sandslash's pit: the static quicksand's look, fading over its last second. */
export function quicksandPitHazard(fx: Fx, hazard: Hazard): void {
  const fade = Math.min(1, hazard.life, (QUICKSAND_PIT.life - hazard.life) * 4);
  quicksand(fx, hazard.x, hazard.z, hazard.radius, SAND_ALPHA * fade, hazard.id);
}

/** The map's surface patches, every frame (a handful per map). */
export function surfacePatches(fx: Fx, patches: readonly SurfacePatch[]): void {
  patches.forEach((patch, i) => {
    if (patch.kind === "ice-slick") return; // Static ice belongs to the lit terrain.
    if (patch.kind === "quicksand") {
      quicksand(fx, patch.x, patch.z, patch.radius, SAND_ALPHA, i);
      return;
    }
    fx.danger.put(Decal.glow, patch.x, patch.z, patch.radius).tint(fire.soot, 0.65, fire.soot, 0);
    fx.danger
      .put(Decal.scorch, patch.x, patch.z, patch.radius, 0, i)
      .tint(fire.soot, BURN_ALPHA, ember, 0.2)
      .args(0.3);
    for (let n = perFrame(fx, 6 * patch.radius); n > 0; n--) {
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(Math.random()) * patch.radius * 0.85;
      const px = patch.x + Math.cos(a) * d;
      const pz = patch.z + Math.sin(a) * d;
      fx.sprites.emit(flame, px, fx.ground.heightAt(px, pz) + 0.1, pz, 0, 0.6, 0, rand(0.16, 0.28));
    }
  });
}

/** Temporary sliding ground uses the same ice material as static lakes. */
export function iceSlick(
  fx: Fx,
  x: number,
  z: number,
  radius: number,
  fade: number,
  seed: number,
): void {
  fx.decals.put(Decal.ice, x, z, radius, 0, seed).tint(ICE_COLOR, fade, ICE_DEEP, 0);
}
