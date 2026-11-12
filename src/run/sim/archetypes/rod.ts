// 电球风暴 (reference fu-25): a big electro ball hovers over the horde as a lightning rod; strikes
// chain out of it, then it falls.

import { ROD } from "../content/params/archetypes";
import { damageEnemy } from "../combat";
import { moves } from "../content/moves";
import { heightAt } from "../terrain";
import { finale, partHit } from "./fusionParts";
import { acquire, aim, area, chestOf, nearest, type ArchetypeDef, type Driven } from "./kit";
import { hypot } from "../math";

export const rodArea: Driven = {
  drive(ctx, a, owner, dt) {
    const f = ROD;
    const def = moves[a.move!];
    const { world } = ctx;
    if (a.delay > 0) {
      a.delay -= dt;
      return;
    }
    a.tickTimer -= dt;
    if (a.tickTimer <= 0) {
      a.tickTimer += a.tick;
      const top = heightAt(world.map.terrain, a.x, a.z) + f.height;
      // Struck from the sky, the ball arcs to its nearest visible enemies in a chain.
      const struck = nearest(world, a.x, top, a.z, a.count, a.radius);
      const points = [a.x, a.z];
      for (const enemy of struck) points.push(enemy.x, enemy.z);
      world.events.push({ t: "chain", points, type: def.type, lift: f.height });
      for (const enemy of struck)
        damageEnemy(
          ctx,
          enemy,
          partHit(owner, def, a, f.boltDmg, def.statusChance, f.boltKnock, a.x, a.z),
        );
    }
    if (a.life <= 0) finale(ctx, owner, def, a, f.blast * a.scale, f.blastDmg, f.blastChance);
  },
};

export const rod: ArchetypeDef = {
  heavy: true,
  windup: ROD.flight,
  cast(ctx, player, def, p) {
    const f = ROD;
    const { world } = ctx;
    const eye = chestOf(world.map.terrain, player);
    const [target] = acquire(world, player, 1, f.range);
    if (!target) return false;
    const [dirX, dirZ] = aim(world.map.terrain, player, eye, target);
    const out = Math.min(f.max, Math.max(f.min, hypot(target.x - player.x, target.z - player.z)));
    area(world, player, def, p, "rod", {
      x: player.x + dirX * out,
      z: player.z + dirZ * out,
      dirX,
      dirZ,
      length: out,
      radius: p.area,
      delay: f.flight,
      life: f.flight + p.dur,
      tick: f.tick,
      scale: p.area / def.area,
      count: f.bolts + Math.min(f.boltsMax, Math.floor(p.count)),
    });
    return true;
  },
};
