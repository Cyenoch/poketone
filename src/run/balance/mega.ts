// Mega evolution (openspec add-mega-evolution) as a model-local stage after a line's final form.
// The sim does not carry it yet: every number here is the proposal the sim implementer copies
// (docs/BALANCE.md「超级进化」). Stats ride on the player's lab list, so `playerStats` folds them
// exactly like a form step; nothing in the shared content tables is mutated.
import { moveParams } from "../sim/attacks";
import { abilities } from "../sim/content/abilities";
import type { Modifier } from "../sim/content/effects";
import { moves, WEATHER_MOVE, type MoveDef } from "../sim/content/moves";
import { castPeriod } from "./output";
import type { Player } from "../sim/state/entities";
import type { PlayerStats } from "../sim/stats";
import type { WeatherId } from "../sim/state/field";
import { itemSlots, moveSlots, newMoveState } from "../sim/upgrades";
import { currentAbility } from "../sim/stats";

export type MegaBranch = "x" | "y";
/** `extra`: the signature move is learned in an added slot; `replace`: it takes the weakest move's. */
export type MegaGrant = "extra" | "replace";

/** The mega state of a model sample; `stone` is held, `active` is the form. */
export interface MegaState {
  branch: MegaBranch;
  grant: MegaGrant;
  stone: boolean;
  active: boolean;
  /** Run second of the evolution. */
  at: number | null;
}

/** The only line with a mega branch so far. */
export const MEGA_LINE = "charmander";
/** Route step (0-based) whose guardian trophy offers the stones: the second map. */
export const MEGA_STONE_STEP = 1;
/** Item slots the held stone occupies. */
export const MEGA_STONE_SLOTS = 1;

/**
 * Tunable proposal. HP and speed are form deltas over 喷火龙 (141 / 4.4). `modifiers` is the
 * "damage direction" of the form (not an ability); the sim needs a place for it on `MegaDef`.
 */
export const MEGA_PARAMS = {
  /** 硬爪: physical move damage ×. */
  toughClaws: 1.3,
  /** 日照: Drought's 大晴天 length at mega evolution and on every map entry. */
  droughtSeconds: WEATHER_MOVE.seconds,
  flareBlitz: {
    /** The model casts it with 龙之俯冲's geometry (physical wave) and its card stats. */
    shape: "dragon-rush",
    dmg: 50,
    cd: 3.2,
    /** Burn chance is the canon 10%. */
    statusChance: 0.1,
    /** Max-HP share lost per cast that hits (never lethal, like poison). */
    recoil: 0.002,
  },
  x: {
    id: "charizard-x",
    name: "超级喷火龙Ｘ",
    hp: 14,
    speed: 0,
    modifiers: [{ stat: "armor", op: "add", value: 8 }],
  },
  y: {
    id: "charizard-y",
    name: "超级喷火龙Ｙ",
    hp: 10,
    speed: 0,
    modifiers: [{ stat: "damage", op: "mul", value: 1.35, when: "special" }],
  },
} as const satisfies {
  toughClaws: number;
  droughtSeconds: number;
  flareBlitz: object;
  x: { id: string; name: string; hp: number; speed: number; modifiers: readonly object[] };
  y: { id: string; name: string; hp: number; speed: number; modifiers: readonly object[] };
};

/** The signature move each branch learns on evolving (模型里只学一招；候选池的第二招未建模). */
export const MEGA_SIGNATURE = { x: "dragon-rush", y: "solar-beam" } as const;

const evolution = { kind: "evolution" } as const;

/** The form's modifiers over the final form, with the replaced ability's own modifiers undone. */
function megaModifiers(player: Player, branch: MegaBranch): Modifier[] {
  const p = MEGA_PARAMS[branch];
  const list: Modifier[] = [
    { stat: "maxHp", op: "add", value: p.hp, source: evolution },
    { stat: "speed", op: "add", value: p.speed, source: evolution },
    ...(p.modifiers as readonly Omit<Modifier, "source">[]).map((m) => ({
      ...m,
      source: evolution,
    })),
  ];
  // The mega ability replaces the owner's: undo it exactly (mul ↔ div, add negated).
  for (const def of abilities[currentAbility(player)].effect.modifiers) {
    const value = def.value[player.stage]!;
    const op = def.op === "mul" ? "div" : def.op === "div" ? "mul" : def.op;
    list.push({
      ...def,
      op,
      value: def.op === "add" || def.op === "extra" || def.op === "pct" ? -value : value,
      source: evolution,
    });
  }
  if (branch === "x")
    list.push({
      stat: "damage",
      op: "mul",
      value: MEGA_PARAMS.toughClaws,
      when: "physical",
      source: evolution,
    });
  return list;
}

/** The held stone takes an item slot; a full bag drops its lowest-level item. */
export function takeMegaStone(player: Player): void {
  const mega = (player as { megaProjection?: MegaState }).megaProjection;
  if (!mega || mega.stone) return;
  mega.stone = true;
  const slots = itemSlots(player) - MEGA_STONE_SLOTS;
  while (player.items.length > slots) {
    const lowest = Math.min(...player.items.map((item) => item.level));
    player.items.splice(player.items.map((item) => item.level).lastIndexOf(lowest), 1);
  }
  player.lab = {
    modifiers: player.lab.modifiers,
    rules: {
      ...player.lab.rules,
      itemSlots: (player.lab.rules.itemSlots ?? 0) - MEGA_STONE_SLOTS,
    },
  };
}

/** With `replace` and full slots the least upgraded move (the latest of equals) is forgotten. */
export function evolveMega(player: Player, at: number): void {
  const mega = (player as { megaProjection?: MegaState }).megaProjection!;
  player.lab = {
    modifiers: [...player.lab.modifiers, ...megaModifiers(player, mega.branch)],
    rules: player.lab.rules,
  };
  mega.active = true;
  mega.at = at;
  const learned = MEGA_SIGNATURE[mega.branch];
  if (player.moves.some((state) => state.id === learned)) return;
  if (mega.grant === "extra" || player.moves.length < moveSlots(player)) {
    player.moves.push(newMoveState(learned));
    if (mega.grant === "extra" && player.moves.length > moveSlots(player))
      player.lab = {
        modifiers: player.lab.modifiers,
        rules: { ...player.lab.rules, moveSlots: (player.lab.rules.moveSlots ?? 0) + 1 },
      };
  } else {
    const levels = player.moves.map((state) => state.level);
    player.moves.splice(levels.lastIndexOf(Math.min(...levels)), 1, newMoveState(learned));
  }
}

/** Total speed added by the form: the model's own form-speed reads add it. */
export const megaSpeed = (player: Player) => {
  const mega = (player as { megaProjection?: MegaState }).megaProjection;
  return mega?.active ? MEGA_PARAMS[mega.branch].speed : 0;
};

/** A model-only move definition standing in for a card state (Flare Blitz on 龙之俯冲's shape). */
export interface MoveOverlay {
  def: MoveDef<string>;
  /** The state's own sim def, whose geometry and card stats the model keeps. */
  base: MoveDef<string>;
}

/** Charmander never learns 龙之俯冲, so under Ｘ that state is the 闪焰冲锋. */
export function megaMove(player: Player, id: string): MoveOverlay | undefined {
  const mega = (player as { megaProjection?: MegaState }).megaProjection;
  if (mega?.branch !== "x" || !mega.active || id !== MEGA_PARAMS.flareBlitz.shape) return undefined;
  const base = moves[MEGA_PARAMS.flareBlitz.shape];
  const f = MEGA_PARAMS.flareBlitz;
  return {
    base,
    def: {
      ...base,
      name: "闪焰冲锋",
      type: "fire",
      dmg: f.dmg,
      cd: f.cd,
      status: "burn",
      statusChance: f.statusChance,
      stats: [...base.stats, "status"],
    },
  };
}

/** Max-HP share per second the recoil costs, for the swarm in reach (`living` targets). */
export function recoilShare(
  player: Player,
  stats: PlayerStats,
  weather: WeatherId | null,
  living: number,
): number {
  let share = 0;
  for (const state of player.moves) {
    if (!megaMove(player, state.id)) continue;
    const p = moveParams(state, stats, weather);
    const cd = Math.max(0.1, p.cd * (MEGA_PARAMS.flareBlitz.cd / moves[state.id].cd));
    share += (MEGA_PARAMS.flareBlitz.recoil * Math.min(1, living)) / castPeriod(cd);
  }
  return share;
}

/** The 大晴天 window Drought gives in the zone that started at `zoneStart`, as zone-local seconds. */
export function droughtWindow(
  mega: MegaState | undefined,
  zoneStart: number,
  time: number,
): { id: "sun"; from: number; until: number } | null {
  if (mega?.branch !== "y" || !mega.active || mega.at === null) return null;
  const from = Math.max(0, mega.at - zoneStart);
  if (time < from) return null;
  return { id: "sun", from, until: from + MEGA_PARAMS.droughtSeconds };
}
