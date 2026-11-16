import { COMBO } from "../content/params/archetypes";
import { acquire, aim, area, chestOf, inSector, onStep, type ArchetypeDef, type Zone } from "./kit";

export const comboArea: Zone = {
  shape: (a, enemy) =>
    (enemy.x - a.x) * a.dirX + (enemy.z - a.z) * a.dirZ >= 0 && inSector(a, enemy),
  reaches: onStep,
  knock: COMBO.knock,
  knockFor: (a) => (a.released === a.count - 1 ? COMBO.finisherKnock : COMBO.knock),
};

export const combo: ArchetypeDef = {
  shortReach: true,
  windup: COMBO.delay,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const [target] = acquire(world, player, 1, p.area + COMBO.aimPadding);
    if (!target) return false;
    const [dirX, dirZ] = aim(world.map.terrain, player, chestOf(world.map.terrain, player), target);
    const count = Math.ceil(p.count);
    for (let i = 0; i < count; i++) {
      const delay = COMBO.delay + i * COMBO.stagger;
      area(world, player, def, p, "combo", {
        dirX,
        dirZ,
        length: p.area,
        angle: COMBO.angle,
        delay,
        life: delay + COMBO.swing,
        follow: true,
        count,
        released: i,
        dmg: p.dmg * (i === count - 1 ? COMBO.finisherDamage : 1),
      });
    }
    return true;
  },
};
