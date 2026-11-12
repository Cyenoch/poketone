// Chains: an instant arc to the nearest enemy that jumps to up to `count` more within `area` of the
// last one struck. No shot or area; the view draws the `chain` event.

import { CHAIN } from "../content/params/archetypes";
import { damageEnemy } from "../combat";
import { enemyFeet, enemyHeight } from "../sight";
import type { Enemy } from "../state/entities";
import { acquire, hitFrom, nearest, type ArchetypeDef } from "./kit";

export const chain: ArchetypeDef = {
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const { terrain } = world.map;
    const [first] = acquire(world, player, 1, CHAIN.range);
    if (!first) return false;
    const points = [player.x, player.z];
    const struck: Enemy[] = [];
    let current: Enemy | undefined = first;
    while (current && struck.length < p.count + 1) {
      struck.push(current);
      points.push(current.x, current.z);
      const from: Enemy = current;
      const centre = enemyFeet(terrain, from) + enemyHeight(from) / 2;
      current = nearest(world, from.x, centre, from.z, CHAIN.candidates, p.area).find(
        (enemy) => !struck.includes(enemy),
      );
    }
    world.events.push({ t: "chain", points, type: def.type });
    for (const enemy of struck)
      damageEnemy(ctx, enemy, hitFrom(player, def, p, player.x, player.z, 0));
    return true;
  },
};
