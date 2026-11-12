// Ultimate output in closed form: one cast's swarm clearing and guardian damage from the same pulse
// timelines the sim plays (sim/content/ultimates.ts), and its charge rate (docs/BALANCE.md 终极技).

import { starters } from "../sim/content/lines/index";
import { playerStats } from "../sim/stats";
import type { Player } from "../sim/state/entities";
import { timeline, ultDamage, ultRate, ultScale } from "../sim/ultimates/index";
import { ULT_CHARGE } from "../sim/content/params/ultimates";
import { ultimates } from "../sim/content/ultimates";
import { AIM_DISTANCE, critFactor, MAX_DENSITY, TERRAIN_SIGHT, type Target } from "./output";

export interface UltCast {
  /** Swarm HP removed (overkill discarded) and guardian damage, per cast. */
  useful: number;
  single: number;
  heal: number;
  /** Seconds from the first pulse to the last (no charge meanwhile). */
  duration: number;
}

export function ultCast(player: Player, target: Target): UltCast {
  const stats = playerStats(player);
  const { ultimate } = starters[player.starter];
  const { type } = ultimates[ultimate];
  const scale = ultScale(player);
  const base =
    ultDamage(player, player.stage) * stats.damage * critFactor(stats.crit, stats.critDamage);
  const density = Math.min(MAX_DENSITY, target.density);
  const rE = target.radius;
  const rB = target.boss.radius;
  const disc = (r: number) => density * Math.PI * (r + rE) ** 2;
  const out: UltCast = { useful: 0, single: 0, heal: 0, duration: 0 };
  for (const p of timeline(ultimate, player.stage)) {
    out.duration = Math.max(out.duration, p.at);
    const r = p.radius * scale;
    const count = p.count ?? 1;
    const length = (p.length ?? 0) * scale;
    if (p.kind === "heal") {
      out.heal += stats.maxHp * (p.heal ?? 0);
      continue;
    }
    // Swarm targets of the pulse, and the share of it that lands on a guardian kiting at AIM_DISTANCE.
    let crowd: number;
    let onBoss: number;
    switch (p.kind) {
      case "ring":
        crowd = disc(r);
        onBoss = Math.min(1, (r + rB) / AIM_DISTANCE);
        break;
      case "spots":
        crowd = count * disc(r);
        onBoss = Math.min(1, (count * Math.PI * (r + rB) ** 2) / (Math.PI * AIM_DISTANCE ** 2));
        break;
      case "lines":
        crowd = count * density * length * 2 * (r + rE);
        onBoss =
          length >= AIM_DISTANCE
            ? Math.min(1, (count * 2 * (r + rB)) / (2 * Math.PI * AIM_DISTANCE))
            : 0;
        break;
      case "strike":
      case "hop":
        crowd = Math.min(count, target.living) * Math.max(1, disc(r));
        onBoss = p.toughest
          ? 1
          : p.kind === "strike"
            ? Math.min(1, count / (target.living + 1))
            : 1 / 8;
        break;
      case "sweep": {
        const arc = p.arc ?? 0;
        crowd = 2 * density * arc * ((length + rE) ** 2 / 2);
        onBoss = length >= AIM_DISTANCE ? Math.min(1, (2 * arc) / (2 * Math.PI)) : 0;
        break;
      }
    }
    const hit = base * p.mul * target.typeVs[type];
    out.useful += TERRAIN_SIGHT * crowd * Math.min(hit, target.hp);
    out.single += TERRAIN_SIGHT * onBoss * base * p.mul * target.boss.typeVs[type];
  }
  return out;
}

/**
 * Charge per second: time plus the damage credit, which is the XP worth of the HP removed (swarm
 * kills, elite kills at `ELITE.xp`, guardian damage at its XP) capped by the refilling budget.
 */
export function ultChargeRate(
  player: Player,
  damageXp: number,
  /** Share of the guardian's HP removed per second, and its actual scaled XP worth. */
  bossShare: number,
  guardianXp: number,
): number {
  const credit = damageXp * ULT_CHARGE.perXp + bossShare * guardianXp * ULT_CHARGE.perXp;
  return (ULT_CHARGE.time + Math.min(ULT_CHARGE.room, credit)) * ultRate(player);
}
