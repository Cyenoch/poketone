// 烈焰旋风 (reference fu-4): a fire vortex [vortex] fed by a flame jet [jet] grows, throws spiral
// flames, then explodes.

import { FIRESTORM } from "../content/params/archetypes";
import { moves } from "../content/moves";
import { elapsedOf, finale, partHit, strikeDisc, strikeLane } from "./fusionParts";
import { acquire, aim, area, chestOf, type ArchetypeDef, type Driven } from "./kit";
import { pullToward } from "./vortex";
import { cos, hypot, sin } from "../math";

export const firestormArea: Driven = {
  drive(ctx, a, owner, dt) {
    const f = FIRESTORM;
    const def = moves[a.move!];
    const elapsed = elapsedOf(a);
    const base = def.area * a.scale;
    // The jet runs from the cast, before the vortex lands, and feeds it.
    const jets = Math.min(Math.round(f.jetFor / f.jetTick), Math.floor(elapsed / f.jetTick) + 1);
    const spirals = elapsed >= f.jetFor ? Math.floor((elapsed - f.jetFor) / f.spiralTick) + 1 : 0;
    const lived = Math.max(0, elapsed - f.delay);
    a.radius = base * (1 + f.growth * Math.min(1, lived / Math.max(0.01, a.maxLife - f.delay)));
    for (; a.released < jets + spirals; a.released++) {
      if (a.released < jets) {
        // From where it was cast: the jet is a fixed line into the vortex.
        const fromX = a.x - a.dirX * a.length;
        const fromZ = a.z - a.dirZ * a.length;
        strikeLane(ctx, fromX, fromZ, a.dirX, a.dirZ, a.length, f.jetWidth * a.scale, () =>
          partHit(owner, def, a, f.jetDmg, f.jetChance, f.jetKnock, fromX, fromZ),
        );
      } else {
        const spin = (a.released - jets) * f.spiralTick * f.spiralSpin;
        for (let arm = 0; arm < f.arms; arm++) {
          const angle = spin + (arm / f.arms) * Math.PI * 2;
          const out = a.radius + f.spiralReach * a.scale;
          const x = a.x + cos(angle) * out;
          const z = a.z + sin(angle) * out;
          strikeDisc(ctx, x, z, f.spiralRadius * a.scale, () =>
            partHit(owner, def, a, f.spiralDmg, f.spiralChance, f.spiralKnock, a.x, a.z),
          );
        }
      }
    }
    if (a.delay > 0) {
      a.delay -= dt;
      return;
    }
    pullToward(ctx, a, dt);
    a.tickTimer -= dt;
    if (a.tickTimer <= 0) {
      a.tickTimer += a.tick;
      strikeDisc(
        ctx,
        a.x,
        a.z,
        a.radius,
        () => partHit(owner, def, a, f.vortexDmg, def.statusChance, 0, a.x, a.z),
        true,
      );
    }
    if (a.life <= 0) finale(ctx, owner, def, a, f.blast * a.scale, f.blastDmg, f.blastChance);
  },
};

export const firestorm: ArchetypeDef = {
  heavy: true,
  windup: FIRESTORM.delay,
  cast(ctx, player, def, p) {
    const f = FIRESTORM;
    const { world } = ctx;
    const eye = chestOf(world.map.terrain, player);
    const [target] = acquire(world, player, 1, f.range);
    if (!target) return false;
    const [dirX, dirZ] = aim(world.map.terrain, player, eye, target);
    const out = Math.min(f.reach, hypot(target.x - player.x, target.z - player.z));
    area(world, player, def, p, "firestorm", {
      x: player.x + dirX * out,
      z: player.z + dirZ * out,
      dirX,
      dirZ,
      length: out,
      delay: f.delay,
      life: f.delay + p.dur,
      tick: f.tick,
      scale: p.area / def.area,
    });
    return true;
  },
};
