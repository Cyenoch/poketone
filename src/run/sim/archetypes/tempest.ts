// 苍龙风暴: a dragon storm gathers round the caster and erupts into one dragon-pulse stream per `count`.
// Each stream leaves the storm's rim toward an enemy of its own; the streams with no enemy of their own
// leave from further round the rim and converge on the aimed one. Every stream is a held lane that ends
// in a dragon burst; the storm stays where it was cast.

import { moves } from "../content/moves";
import { TEMPEST } from "../content/params/archetypes";
import { CHEST } from "../content/params/combat";
import { aimHeight, coverHit, enemyFeet, enemyHeight } from "../sight";
import { heightAt } from "../terrain";
import type { Enemy } from "../state/entities";
import { atan2, cos, hypot, sin } from "../math";
import { beamArea } from "./beam";
import { finale } from "./fusionParts";
import { acquire, area, type ArchetypeDef, type Zone } from "./kit";

export const tempestArea: Zone = {
  ...beamArea,
  knock: TEMPEST.knock,
  track(world, a, ground) {
    a.length = Math.min(
      TEMPEST.reach,
      coverHit(world, a.x, ground + CHEST, a.z, a.dirX, a.dirZ, a.rise, TEMPEST.reach),
    );
  },
  expire(ctx, a, owner) {
    const f = TEMPEST;
    const end = { ...a, x: a.x + a.dirX * a.length, z: a.z + a.dirZ * a.length };
    finale(
      ctx,
      owner,
      moves[a.move!],
      end,
      f.burst * a.scale,
      f.burstDmg / f.streamDmg,
      f.burstChance,
    );
  },
};

/** Streams one cast fires: one per whole `count`, within the cap. */
export const tempestStreams = (count: number): number =>
  Math.max(1, Math.min(TEMPEST.streamsMax, Math.floor(count)));

const TAU = 2 * Math.PI;
/** Absolute difference of two headings, 0…π. */
const apart = (a: number, b: number) =>
  Math.abs(((((a - b + Math.PI) % TAU) + TAU) % TAU) - Math.PI);

/** Where each stream leaves the rim (a heading from the caster) and the enemy it goes for. */
interface Stream {
  rim: number;
  target: Enemy;
}

/**
 * The aimed enemy first, then other enemies nearest-first at least `spread` from every stream taken;
 * the rest fall back on the aimed enemy from rim points fanned out round it, alternating sides.
 */
function streams(main: Stream, others: readonly Stream[], n: number): Stream[] {
  const f = TEMPEST;
  const taken = [main];
  for (const s of others) {
    if (taken.length >= n) break;
    if (taken.every((t) => apart(s.rim, t.rim) >= f.spread)) taken.push(s);
  }
  const spare = n - taken.length;
  const step = Math.min(f.spread, f.fan / Math.ceil(spare / 2));
  for (let k = 1; k <= spare; k++) {
    const side = k % 2 ? 1 : -1;
    taken.push({ rim: main.rim + side * Math.ceil(k / 2) * step, target: main.target });
  }
  return taken;
}

export const tempest: ArchetypeDef = {
  heavy: true,
  windup: TEMPEST.delay,
  cast(ctx, player, def, p) {
    const f = TEMPEST;
    const { world } = ctx;
    const { terrain } = world.map;
    const n = tempestStreams(p.count);
    const [first, ...rest] = acquire(world, player, n * f.candidates, f.range);
    if (!first) return false;
    const toward = (target: Enemy): Stream => ({
      rim: atan2(target.x - player.x, target.z - player.z),
      target,
    });
    const scale = p.area / def.area;
    const hit = { ...p, dmg: p.dmg * f.streamDmg };
    const rim = f.rim * scale;
    streams(toward(first), rest.map(toward), n).forEach(({ rim: angle, target }, i) => {
      // An enemy inside the rim would sit behind a rim point: those streams leave from the caster.
      const inside = hypot(target.x - player.x, target.z - player.z) <= rim;
      const x = inside ? player.x : player.x + sin(angle) * rim;
      const z = inside ? player.z : player.z + cos(angle) * rim;
      const dx = target.x - x;
      const dz = target.z - z;
      const distance = hypot(dx, dz) || 1;
      const eye = heightAt(terrain, x, z) + CHEST;
      const goal = aimHeight(enemyFeet(terrain, target), enemyHeight(target), eye);
      const delay = f.delay + i * f.stagger;
      area(world, player, def, hit, "tempest", {
        x,
        z,
        dirX: dx / distance,
        dirZ: dz / distance,
        rise: (goal - eye) / distance,
        length: f.reach,
        radius: p.area / 2,
        delay,
        tick: f.tick,
        life: delay + f.life * p.dur,
        scale,
      });
    });
    return true;
  },
};
