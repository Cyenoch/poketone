// Signature fusions (openspec/specs/combat-builds/spec.md 融合; reference `fusions.json` fu-1 / fu-4 / fu-7 / fu-25 and
// `fusion-scaling.json`). Bill's machine fuses the line's two max-level signature moves once per run into
// one fusion move that keeps both moves' upgrades. Each fusion casts as its own archetype
// (sim/archetypes/bloom, firestorm, sprinkler, rod).

import { signatureFusions } from "./content/fusions";
import type { MoveId } from "./content/moves";
import type { MoveMods, MoveState, Player } from "./state/entities";
import { offerKey } from "./upgrades";
import { MAX_MOVE_LEVEL } from "./content/params/cards";
import { NEW_MOVE_COOLDOWN } from "./content/params/moves";

// ── Bill's machine ────────────────────────────────────────────────────────────────────────────────

export interface FusionPart {
  id: MoveId;
  level: number;
  owned: boolean;
}

/** The line's signature recipe and how far the player is from it (both parts at `MAX_MOVE_LEVEL`). */
export function fusionStatus(player: Player): {
  move: MoveId;
  parts: [FusionPart, FusionPart];
  ready: boolean;
} {
  const {
    result: move,
    match: { pair },
  } = signatureFusions[player.starter];
  const part = (id: MoveId): FusionPart => {
    const state = player.moves.find((s) => s.id === id);
    return { id, level: state?.level ?? 0, owned: state !== undefined };
  };
  const parts: [FusionPart, FusionPart] = [part(pair[0]), part(pair[1])];
  return { move, parts, ready: parts.every((p) => p.level >= MAX_MOVE_LEVEL) };
}

/** Both moves' upgrades carry over (reference `eT`): additive mods add, the cooldown factor multiplies. */
export function mergeMods(a: MoveMods, b: MoveMods): MoveMods {
  return {
    dmg: a.dmg + b.dmg,
    cd: a.cd * b.cd,
    count: a.count + b.count,
    area: a.area + b.area,
    speed: a.speed + b.speed,
    dur: a.dur + b.dur,
    pierce: a.pierce + b.pierce,
    crit: a.crit + b.crit,
    status: a.status + b.status,
  };
}

/**
 * Fuses the signature pair: the fusion (★1) takes the slot of whichever part comes first and the other
 * slot frees up; both parts are banished for the run. Returns false when the pair is not ready.
 */
export function fuseMoves(player: Player): boolean {
  const status = fusionStatus(player);
  if (!status.ready) return false;
  const [a, b] = status.parts.map((p) => player.moves.find((s) => s.id === p.id)!) as [
    MoveState,
    MoveState,
  ];
  const fused: MoveState = {
    id: status.move,
    level: 1,
    cooldown: NEW_MOVE_COOLDOWN,
    damage: 0,
    mods: mergeMods(a.mods, b.mods),
  };
  const first = Math.min(player.moves.indexOf(a), player.moves.indexOf(b));
  player.moves[first] = fused;
  player.moves = player.moves.filter((s) => s !== a && s !== b);
  // The parts live on in the fusion; they are not offered again.
  player.banished.push(offerKey.move(a.id), offerKey.move(b.id));
  return true;
}
