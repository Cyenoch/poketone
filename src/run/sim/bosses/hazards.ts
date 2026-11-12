import { FISSURE, STOMP, QUICKSAND_PIT, HYDRO_PUMP, TWISTER } from "../content/params/guardian";
import { zoneHazards } from "./zone-hazards";
// The guardians' hazard rules (numbers in content/params/guardian.ts): Pinsir's rock shards (bosses/pinsir.ts, Sandslash throws
// them too), Nidoking's fissures and stomp (bosses/nidoking.ts, Marowak's bone club is the stomp) and
// Sandslash's quicksand pit (bosses/sandslash.ts), and the coast's Crabhammer, Hydro Pump, Twister and
// thunderbolts (bosses/kingler.ts, gyarados.ts, starmie.ts). Kept apart from the brains, which import the enemy
// loop, so sim/hazards.ts can load these rules first.

import { formOf } from "../evolution";
import { damagePlayer } from "../hurt";
import { mobilityClasses } from "../content/mobility";
import { moveWithSlope } from "../nav/index";
import { sustain } from "../status";
import { QUICKSAND } from "../content/params/environment";
import { quicksandPull } from "../surface-effects";
import { TICK } from "../state/world";
import type { Player } from "../state/entities";
import { heightAt } from "../terrain";
import { hypot } from "../math";
import { inPatch, interruptWindup, type HazardRule } from "../skills/kit";
import { beamHits } from "../skills/psybeam";
import { radialRule } from "../skills/radial";
import { strikeCircle } from "../skills/rockfall";
import { ROCKFALL } from "../content/params/enemy-skills";

export const guardianHazards = {
  ...zoneHazards,
  // A plain shot (sim/hazards.ts): stops at cover and hits the first player it reaches once.
  "rock-shard": {},
  fissure: {
    update(world, line) {
      if (line.life > FISSURE.active) {
        // Before it cracks, sleep or death cancels it with the guardian's wind-up.
        interruptWindup(world, line);
        return;
      }
      for (const player of world.players)
        if (player.alive && beamHits(world, line, player)) damagePlayer(world, player, line.dmg);
    },
  },
  stomp: radialRule(STOMP.active),
  // Kingler's claw and Starmie's thunderbolts: Rhydon's falling-rock circle with their own look.
  crabhammer: strikeCircle,
  "thunder-bolt": strikeCircle,
  "hydro-pump": {
    update(world, beam) {
      if (beam.life > HYDRO_PUMP.active) {
        interruptWindup(world, beam);
        return;
      }
      for (const player of world.players)
        if (player.alive && beamHits(world, beam, player)) damagePlayer(world, player, beam.dmg);
    },
  },
  twister: {
    update(world, twister) {
      if (twister.dmg <= 0) return;
      twister.y = heightAt(world.map.terrain, twister.x, twister.z);
      let nearest: Player | null = null;
      let best = Infinity;
      for (const player of world.players) {
        if (!player.alive) continue;
        const d = hypot(player.x - twister.x, player.z - twister.z);
        if (d < best) [nearest, best] = [player, d];
      }
      twister.vx = nearest && best > 0 ? ((nearest.x - twister.x) / best) * TWISTER.speed : 0;
      twister.vz = nearest && best > 0 ? ((nearest.z - twister.z) / best) * TWISTER.speed : 0;
      if (TWISTER.life - twister.life < TWISTER.arm) return;
      for (const player of world.players)
        if (
          inPatch(world, twister, player, twister.y) &&
          damagePlayer(world, player, twister.dmg)
        ) {
          twister.dmg = 0;
          twister.vx = twister.vz = 0;
          twister.life = Math.min(twister.life, ROCKFALL.residue);
          return;
        }
    },
  },
  "quicksand-pit": {
    update(world, pit) {
      for (const player of world.players) {
        if (!inPatch(world, pit, player, pit.y)) continue;
        sustain(player, "slow", QUICKSAND_PIT.linger, -1);
        const [px, pz] = quicksandPull(pit, player.x, player.z, QUICKSAND.pull * QUICKSAND.speed);
        moveWithSlope(
          world.nav,
          mobilityClasses.ground,
          player,
          px * TICK,
          pz * TICK,
          formOf(player).radius,
        );
      }
    },
  },
} satisfies Record<string, HazardRule>;
