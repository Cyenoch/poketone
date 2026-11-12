// Trigger registry: one rule per `TriggerKind` (content/triggers.ts), each listening on one hook.
// Every hook has one call site: `tick` (world.ts updatePlayer), `damage` (`damageTriggers`, a factor
// before the crit roll) and `hit` (`afterHit`), both in combat.ts damageEnemy, `kill` (combat.ts
// killEnemy) and the thorns hit (`afterTouch`, enemies.ts touch). A player's triggers are
// `currentStats(player).triggers`: items in content order, then the ability.
//
// Rule modules may import combat; this file reads them only inside `rules()`, never at load, so any
// sim module can be imported first without a TDZ error (combat → here → rule → combat).

import { damageEnemy, heal, type Ctx, type Hit } from "../combat";
import type { ResolvedTrigger, TriggerKind } from "../content/triggers";
import { THORNS_KNOCK } from "../content/params/trigger-runtime";
import { currentStats, type ActiveTrigger, type PlayerStats } from "../stats";
import type { Enemy, Player } from "../state/entities";
import { burstOnKill } from "./burstOnKill";
import { contactSpread } from "./contactSpread";
import { contactStatus } from "./contactStatus";
import { healBelow, healEvery, healOnKill } from "./heals";
import { healOnHit } from "./healOnHit";
import { burst } from "./kit";
import { bonk, critStrike, execute, inflictOnHit } from "./onHit";
import { markStrongest, spreadStatus, strike } from "./periodic";
import {
  block,
  buff,
  dashBurst,
  lethalSave,
  overhealShield,
  overhealStore,
  statusOnHurt,
} from "./player";
import { scaling } from "./scaling";
import { zap } from "./zap";

export interface HookPayloads {
  tick: { dt: number };
  hit: { hit: Hit; enemy: Enemy; removed: number; crit: boolean };
  /** `player` is credited with the kill (a DoT kill credits its source). */
  kill: { enemy: Enemy };
}
export type Hook = keyof HookPayloads;

type Of<K extends TriggerKind> = Extract<ResolvedTrigger, { kind: K }>;

export type TriggerRule<K extends TriggerKind> =
  | {
      [H in Hook]: {
        hook: H;
        run(ctx: Ctx, player: Player, trigger: Of<K>, key: string, payload: HookPayloads[H]): void;
      };
    }[Hook]
  /** Read where the thorns hit is built (`afterTouch`) instead of running on a hook. */
  | { hook: "thorns" }
  /** Read where heals land (combat.ts `heal`). */
  | { hook: "heal" }
  /** A damage factor on a hit, before its crit roll (`damageTriggers`). */
  | {
      hook: "damage";
      factor(ctx: Ctx, player: Player, trigger: Of<K>, payload: { hit: Hit; enemy: Enemy }): number;
    };

let table: { [K in TriggerKind]: TriggerRule<K> } | null = null;

function rules(): { [K in TriggerKind]: TriggerRule<K> } {
  table ??= {
    healOnHit,
    contactStatus,
    zap,
    healBelow,
    healEvery,
    healOnKill,
    inflictOnHit,
    bonk,
    execute,
    critStrike,
    burstOnKill,
    strike,
    markStrongest,
    spreadStatus,
    contactSpread,
    scaling,
    buff,
    statusOnHurt,
    lethalSave,
    dashBurst,
    overhealStore,
    overhealShield,
    block,
  };
  return table;
}

/** Runs every trigger of `player` listening on `hook`, in list order. */
export function fire<H extends Hook>(ctx: Ctx, player: Player, hook: H, payload: HookPayloads[H]) {
  for (const { key, def } of currentStats(player).triggers) {
    const rule = rules()[def.kind] as TriggerRule<TriggerKind>;
    if (rule.hook !== hook) continue;
    (rule.run as (c: Ctx, p: Player, t: ResolvedTrigger, k: string, x: HookPayloads[H]) => void)(
      ctx,
      player,
      def,
      key,
      payload,
    );
  }
}

/** The first of `player`'s triggers of one kind. */
export function triggerOf<K extends TriggerKind>(
  stats: PlayerStats,
  kind: K,
): (ActiveTrigger & { def: Of<K> }) | undefined {
  return stats.triggers.find((t): t is ActiveTrigger & { def: Of<K> } => t.def.kind === kind);
}

/** The product of the owner's `damage` triggers for this hit (1 when it has none). */
export function damageTriggers(ctx: Ctx, player: Player, hit: Hit, enemy: Enemy): number {
  let factor = 1;
  for (const { def } of currentStats(player).triggers) {
    const rule = rules()[def.kind] as TriggerRule<TriggerKind>;
    if (rule.hook === "damage")
      factor *= (
        rule.factor as (
          c: Ctx,
          p: Player,
          t: ResolvedTrigger,
          x: { hit: Hit; enemy: Enemy },
        ) => number
      )(ctx, player, def, { hit, enemy });
  }
  return factor;
}

/**
 * What a hit that removed `removed` HP gives back to its owner. Heals do not commute in floats, so
 * the order is fixed: lifesteal, the move's drain, then the owner's hit triggers.
 */
export function afterHit(
  ctx: Ctx,
  hit: Hit,
  enemy: Enemy,
  removed: number,
  stats: PlayerStats,
  crit: boolean,
): void {
  const { owner } = hit;
  if (stats.lifesteal > 0) heal(owner, removed * stats.lifesteal);
  if (hit.drain && owner.alive) {
    heal(owner, removed * hit.drain);
    ctx.world.events.push({ t: "drain", player: owner.id, x: enemy.x, z: enemy.z });
  }
  fire(ctx, owner, "hit", { hit, enemy, removed, crit });
}

/**
 * An enemy's touch landed: thorns hit back, shaped by a `contactStatus` trigger when there is one
 * (Static), or on every enemy around the player with a `contactSpread` one (Sticky Barb).
 */
export function afterTouch(ctx: Ctx, enemy: Enemy, player: Player): void {
  const stats = currentStats(player);
  const contact = triggerOf(stats, "contactStatus")?.def;
  const spread = triggerOf(stats, "contactSpread")?.def;
  if (spread && stats.thorns > 0) {
    burst(ctx, player, player.x, player.z, spread.radius, "spores", {
      type: contact?.type ?? "normal",
      dmg: stats.thorns,
      status: contact?.status ?? spread.status,
      statusChance: 1,
      knock: THORNS_KNOCK,
    });
    return;
  }
  if (stats.thorns <= 0 && !contact) return;
  damageEnemy(ctx, enemy, {
    owner: player,
    move: null,
    type: contact?.type ?? "normal",
    dmg: stats.thorns,
    crit: 0,
    status: contact?.status,
    statusChance: 1,
    knock: THORNS_KNOCK,
    fromX: player.x,
    fromZ: player.z,
    secondary: true,
  });
}
