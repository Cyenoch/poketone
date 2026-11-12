// 水旋涡 (reference fu-7): a spin in the shell shoving the close ring away [shell], jets sweeping like a
// sprinkler [jets], a final splash.

import { SPRINKLER } from "../content/params/archetypes";
import { moves } from "../content/moves";
import { elapsedOf, finale, partHit, strikeDisc, strikeLane } from "./fusionParts";
import { acquire, aim, area, chestOf, type ArchetypeDef, type Driven } from "./kit";
import { atan2, cos, sin } from "../math";

export const sprinklerArea: Driven = {
  drive(ctx, a, owner, dt) {
    const f = SPRINKLER;
    const def = moves[a.move!];
    const elapsed = elapsedOf(a);
    if (a.released === 0) {
      a.released = 1;
      strikeDisc(ctx, a.x, a.z, f.shell * a.scale, () =>
        partHit(owner, def, a, f.shellDmg, 0, f.shellKnock, a.x, a.z, undefined),
      );
    }
    a.tickTimer -= dt;
    if (a.tickTimer <= 0) {
      a.tickTimer += a.tick;
      const turn = a.angle + elapsed * f.spin;
      for (let jet = 0; jet < a.count; jet++) {
        const angle = turn + (jet / a.count) * Math.PI * 2;
        strikeLane(ctx, a.x, a.z, cos(angle), sin(angle), a.length, a.radius, () =>
          partHit(owner, def, a, f.jetDmg, def.statusChance, f.jetKnock, a.x, a.z),
        );
      }
    }
    if (a.life <= 0) finale(ctx, owner, def, a, f.splash * a.scale, f.splashDmg, f.splashChance);
  },
};

export const sprinkler: ArchetypeDef = {
  heavy: true,
  cast(ctx, player, def, p) {
    const f = SPRINKLER;
    const { world } = ctx;
    const eye = chestOf(world.map.terrain, player);
    const scale = p.area / def.area;
    const [target] = acquire(world, player, 1, p.area + f.range);
    if (!target) return false;
    const [dirX, dirZ] = aim(world.map.terrain, player, eye, target);
    area(world, player, def, p, "sprinkler", {
      dirX,
      dirZ,
      length: p.area,
      radius: f.jetWidth * scale,
      angle: atan2(dirZ, dirX),
      tick: f.jetTick,
      follow: true,
      scale,
      count: f.jets + Math.min(f.jetsMax, Math.floor(p.count)),
    });
    return true;
  },
};
