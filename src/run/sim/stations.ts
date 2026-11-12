// Map stations (openspec/specs/combat-builds/spec.md 换招): Hypno (引梦貘人) forgets a move or an item for 星星沙子, Bill's
// machine (正辉的机器) fuses the line's signature pair once per run. Each stands on one of the map's
// guaranteed building pads (docs/MAPGEN.md); standing in its zone shows a prompt, and the interact
// command (R / the touch prompt) opens its dialog, which freezes the run like a level-up card.

import { stageDefs } from "./content/stages/index";
import { addCircleBlocker } from "./nav/index";
import { formOf } from "./evolution";
import { fusionStatus } from "./fusion";
import { FORGET } from "./content/params/economy";
import { STATION_RADIUS, STATION_REACH } from "./content/params/stations";
import { earnStardust, playerStats } from "./stats";
import { offerKey } from "./upgrades";
import type { Command } from "./state/commands";
import type { ItemState, MoveState, Player, Station } from "./state/entities";
import type { World } from "./state/world";
import { hypot } from "./math";

/** One station per building pad, in the stage's `stations` order; each body blocks the nav like a rock. */
export function placeStations(world: World): Station[] {
  const kinds = stageDefs[world.stage].stations;
  const pads = world.map.pads.filter((pad) => pad.tag === "building");
  if (pads.length < kinds.length)
    throw new Error(`地图只有 ${pads.length} 块 building 平台，放不下 ${kinds.length} 个站点。`);
  return kinds.map((kind, i) => {
    const pad = pads[i]!;
    const radius = STATION_RADIUS[kind];
    addCircleBlocker(world.nav, pad.x, pad.z, radius);
    return { id: world.nextId++, kind, x: pad.x, z: pad.z, radius, used: [] };
  });
}

/** Whether walking in now does something: something left to forget, or the fusion ready and unused. */
export function stationUsable(player: Player, station: Station): boolean {
  if (station.kind === "hypno") return player.moves.length > 1 || player.items.length > 0;
  return !station.used.includes(player.id) && fusionStatus(player).ready;
}

/**
 * Whether a station still opens: Hypno always (with nothing to forget it shows the kit greyed out), Bill's
 * machine until used (not yet ready, it shows what the fusion needs). Maps point at open stations.
 */
export function stationOpen(station: Station, player: Player): boolean {
  return station.kind === "hypno" || !station.used.includes(player.id);
}

/** The open station whose zone the player stands in. */
export function stationHere(world: World, player: Player): Station | undefined {
  const body = formOf(player).radius;
  return world.stations.find(
    (station) =>
      hypot(station.x - player.x, station.z - player.z) <= station.radius + body + STATION_REACH &&
      stationOpen(station, player),
  );
}

/** Opens the dialog of the station the player stands at (cards are answered first). */
export function interact(world: World, player: Player): void {
  if (!player.alive || player.dialog || player.pending.length > 0) return;
  const station = stationHere(world, player);
  if (station) player.dialog = { id: world.nextId++, station: station.id };
}

export function forgetRefund(entry: MoveState | ItemState, kind: "move" | "item"): number {
  return entry.level * FORGET[kind];
}

/**
 * Forgets one move (never the last) or item, pays the refund (星星沙子) and banishes it for the run, so the card
 * that taught it does not come straight back.
 */
export function forget(
  player: Player,
  target: Extract<Command, { t: "forget" }>["target"],
): boolean {
  if (target.kind === "move") {
    const state = player.moves.find((move) => move.id === target.id);
    if (!state || player.moves.length <= 1) return false;
    player.moves = player.moves.filter((move) => move !== state);
    player.banished.push(offerKey.move(state.id));
    earnStardust(player, forgetRefund(state, "move"));
    return true;
  }
  const item = player.items.find((owned) => owned.id === target.id);
  if (!item) return false;
  player.items = player.items.filter((owned) => owned !== item);
  player.banished.push(offerKey.item(item.id));
  earnStardust(player, forgetRefund(item, "item"));
  // Max HP from HP Up goes with it.
  player.hp = Math.min(player.hp, playerStats(player).maxHp);
  return true;
}
