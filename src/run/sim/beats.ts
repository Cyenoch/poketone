import { ERUPTION } from "./content/params/late-zones";
import { addHazard } from "./skills/kit";
// Timeline beats (`StageDef.beats`): one rule per kind, each spawning around the director's target and
// raising its banner. The beat carries its own numbers, so a new kind is a spec plus a rule here. Every
// spot goes through the director's placement, which pushes it off every player's screen.

import { difficulties } from "./content/difficulties";
import { enemies as enemyDefs, type EnemyId } from "./content/enemies";
import { spawnOnRing, spawnReachable } from "./director";
import { pick, range } from "./rng";
import type { World } from "./state/world";
import type { Player } from "./state/entities";
import { cos, sin } from "./math";
import {
  BEAT_RINGS,
  ALPHA_HP,
  ELITE_WAVE_SIZE,
  STAMPEDE_SIZE,
  STAMPEDE_SPEEDUP,
  STAMPEDE_FORMATION,
  SWARM_SIZE,
} from "./content/params/pacing";

/** A boosted elite (头目) from the current pool. */
export interface AlphaBeat {
  kind: "alpha";
}
/** `ELITE_WAVE_SIZE` elites from the current pool. */
export interface EliteWaveBeat {
  kind: "elite-wave";
}
/** A ring around the player of these species in turn. */
export interface SwarmBeat {
  kind: "swarm";
  species: readonly [EnemyId, ...EnemyId[]];
  banner: string;
}
/** A herd of one species running straight across the player's spot. */
export interface StampedeBeat {
  kind: "stampede";
  species: EnemyId;
  banner: string;
}

export interface EruptionBeat {
  kind: "eruption";
}
export type Beat = AlphaBeat | EliteWaveBeat | SwarmBeat | StampedeBeat | EruptionBeat;
export type BeatKind = Beat["kind"];

type BeatRule<B extends Beat> = (world: World, beat: B, player: Player) => void;

const beatRules: { [K in BeatKind]: BeatRule<Extract<Beat, { kind: K }>> } = {
  eruption(world) {
    addHazard(world, {
      kind: "eruption",
      x: 0,
      y: 0,
      z: 0,
      radius: 0,
      life: ERUPTION.duration + 0.01,
      duration: ERUPTION.duration + 0.01,
    });
    world.events.push({ t: "banner", text: "火山喷发", tone: "danger", kind: "eruption" });
  },
  alpha(world, _beat, player) {
    const { min, max } = BEAT_RINGS.alpha;
    const enemy = spawnOnRing(world, pick(world.rng, world.spawn.pool), player, min, max, true);
    if (!enemy) return;
    enemy.alpha = true;
    enemy.hp *= ALPHA_HP;
    enemy.maxHp *= ALPHA_HP;
    world.events.push({
      t: "banner",
      text: `头目 ${enemyDefs[enemy.species].name} 出现`,
      tone: "danger",
      kind: "alpha",
    });
  },
  "elite-wave"(world, _beat, player) {
    for (let i = 0; i < ELITE_WAVE_SIZE; i++) {
      const { min, max } = BEAT_RINGS.eliteWave;
      spawnOnRing(world, pick(world.rng, world.spawn.pool), player, min, max, true);
    }
    world.events.push({ t: "banner", text: "精英群来袭", tone: "danger", kind: "elite-wave" });
  },
  swarm(world, { species, banner }, player) {
    const count = Math.round(SWARM_SIZE * difficulties[world.difficulty].amount);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      spawnReachable(
        world,
        species[i % species.length]!,
        player,
        player.x + cos(angle) * BEAT_RINGS.swarm,
        player.z + sin(angle) * BEAT_RINGS.swarm,
      );
    }
    world.events.push({ t: "banner", text: banner, tone: "danger", kind: "swarm" });
  },
  stampede(world, { species, banner }, player) {
    const angle = range(world.rng, 0, Math.PI * 2);
    const dirX = cos(angle);
    const dirZ = sin(angle);
    for (let i = 0; i < STAMPEDE_SIZE; i++) {
      const side = (i - STAMPEDE_SIZE / 2) * STAMPEDE_FORMATION.lateral;
      const back = BEAT_RINGS.stampede + (i % STAMPEDE_FORMATION.rows) * STAMPEDE_FORMATION.depth;
      const enemy = spawnReachable(
        world,
        species,
        player,
        player.x - dirX * back - dirZ * side,
        player.z - dirZ * back + dirX * side,
      );
      if (!enemy) continue;
      enemy.charge = true;
      enemy.dashX = dirX;
      enemy.dashZ = dirZ;
      enemy.speed *= STAMPEDE_SPEEDUP;
    }
    world.events.push({ t: "banner", text: banner, tone: "danger", kind: "stampede" });
  },
};

export function fireBeat(world: World, beat: Beat, player: Player): void {
  (beatRules[beat.kind] as BeatRule<Beat>)(world, beat, player);
}
