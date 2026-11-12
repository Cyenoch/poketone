// 花朵光束 (reference fu-1): a solar beam [beam] sprouting leaf blades on both sides [leaves], a petal
// burst at its end [flower].

import { BLOOM } from "../content/params/archetypes";
import { damageEnemy } from "../combat";
import { moves } from "../content/moves";
import { CHEST } from "../content/params/combat";
import { coverHit, enemyFeet, enemyHeight } from "../sight";
import { heightAt } from "../terrain";
import type { Enemy } from "../state/entities";
import { finale, partHit } from "./fusionParts";
import { acquire, aim, area, chestOf, type ArchetypeDef, type Driven } from "./kit";
import { hypot } from "../math";

export const bloomArea: Driven = {
  drive(ctx, a, owner, dt) {
    const f = BLOOM;
    const def = moves[a.move!];
    const { world } = ctx;
    const ground = heightAt(world.map.terrain, a.x, a.z);
    a.length = Math.min(
      f.reach,
      coverHit(world, a.x, ground + CHEST, a.z, a.dirX, a.dirZ, a.rise, f.reach),
    );
    if (a.delay > 0) {
      a.delay -= dt;
      return;
    }
    // Beam: a lane at the beam's height (it may be pitched up or down a slope).
    a.tickTimer -= dt;
    if (a.tickTimer <= 0) {
      a.tickTimer += a.tick;
      const targets: Enemy[] = [];
      ctx.grid.query(a.x, a.z, a.length + 1.4, (enemy) => {
        if (enemy.hp <= 0) return;
        const dx = enemy.x - a.x;
        const dz = enemy.z - a.z;
        const along = dx * a.dirX + dz * a.dirZ;
        if (along < -f.rearReach || along > a.length) return;
        if (Math.abs(dx * a.dirZ - dz * a.dirX) > a.radius + enemy.radius) return;
        const y = ground + CHEST + a.rise * Math.max(0, along);
        const feet = enemyFeet(world.map.terrain, enemy);
        if (y < feet - a.radius || y > feet + enemyHeight(enemy) + a.radius) return;
        targets.push(enemy);
      });
      for (const enemy of targets)
        damageEnemy(
          ctx,
          enemy,
          partHit(owner, def, a, f.beamDmg, f.beamChance, f.beamKnock, a.x, a.z),
        );
    }
    // Leaves: released evenly over the beam's life from random points along it, flying out sideways.
    const beamLife = a.maxLife - f.delay;
    const due = Math.min(
      a.count,
      Math.ceil(((beamLife - Math.max(0, a.life)) / beamLife) * a.count),
    );
    for (; a.released < due; a.released++) {
      // Golden-ratio stepping distributes leaves deterministically, without RNG draws.
      const t = f.leafStart + f.leafSpan * ((a.released * 0.618034) % 1);
      const side = a.released % 2 ? -1 : 1;
      const sx = a.x + a.dirX * a.length * t;
      const sz = a.z + a.dirZ * a.length * t;
      const vx = -a.dirZ * side + a.dirX * f.leafForward;
      const vz = a.dirX * side + a.dirZ * f.leafForward;
      const norm = hypot(vx, vz);
      const y = heightAt(world.map.terrain, sx, sz) + CHEST;
      world.projectiles.push({
        id: world.nextId++,
        owner: owner.id,
        move: def.id,
        archetype: "bolt",
        type: def.type,
        x: sx,
        y,
        z: sz,
        px: sx,
        py: y,
        pz: sz,
        vx: (vx / norm) * f.leafSpeed,
        vy: 0,
        vz: (vz / norm) * f.leafSpeed,
        life: f.leafLife,
        radius: f.leafRadius * a.scale,
        dmg: a.dmg * f.leafDmg,
        pierce: f.leafPierce,
        area: f.leafRadius * a.scale,
        dur: f.leafLife,
        statusChance: 0,
        crit: a.crit,
        hit: [],
        delay: 0,
        target: -1,
      });
    }
    if (a.life <= 0) {
      const end = { ...a, x: a.x + a.dirX * a.length, z: a.z + a.dirZ * a.length };
      finale(ctx, owner, def, end, f.flower * a.scale, f.flowerDmg, f.flowerChance);
    }
  },
};

export const bloom: ArchetypeDef = {
  heavy: true,
  windup: BLOOM.delay,
  cast(ctx, player, def, p) {
    const f = BLOOM;
    const { world } = ctx;
    const eye = chestOf(world.map.terrain, player);
    const [target] = acquire(world, player, 1, f.range);
    if (!target) return false;
    const [dirX, dirZ, rise] = aim(world.map.terrain, player, eye, target);
    const life = f.delay + f.life * p.dur;
    area(world, player, def, p, "bloom", {
      dirX,
      dirZ,
      rise,
      length: f.reach,
      radius: p.area / 2,
      delay: f.delay,
      life,
      tick: f.tick,
      follow: true,
      scale: p.area / def.area,
      count: f.leaves + Math.min(f.leavesMax, f.leavesPerCount * Math.floor(p.count)),
    });
    return true;
  },
};
