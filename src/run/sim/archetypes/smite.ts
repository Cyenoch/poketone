// Smites: a strike from the sky on each target in range after a telegraph of `dur` seconds.

import { acquire, anywhere, area, inDisc, type ArchetypeDef, type Zone } from "./kit";
import { SMITE } from "../content/params/archetypes";

/** Seconds the struck spot stays drawn after the bolt lands. */
const SMITE_LINGER = 0.25;

export const smiteArea: Zone = { shape: inDisc, reaches: anywhere, knock: SMITE.knock };

export const smite: ArchetypeDef = {
  heavy: true,
  windup: (p) => p.dur,
  cast(ctx, player, def, p) {
    const { world } = ctx;
    const targets = acquire(world, player, p.count, SMITE.range);
    if (targets.length === 0) return false;
    for (const target of targets)
      area(world, player, def, p, "smite", {
        x: target.x,
        z: target.z,
        delay: p.dur,
        life: p.dur + SMITE_LINGER,
      });
    return true;
  },
};
