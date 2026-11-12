import { zoneGuardianBrain } from "./zone-guardians";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { aerodactylBrain } from "./aerodactyl";
import { gyaradosBrain } from "./gyarados";
import { kinglerBrain } from "./kingler";
import { starmieBrain } from "./starmie";
import { marowakBrain } from "./marowak";
import { nidokingBrain } from "./nidoking";
import { sandslashBrain } from "./sandslash";
import { pinsirBrain } from "./pinsir";
import { scytherBrain } from "./scyther";

/**
 * A guardian's per-tick movement: returns [moveX, moveZ, speed] for `enemies.ts` to apply. `speed` comes
 * in as its chase speed after paralysis and wet.
 */
export type GuardianBrain = (
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
) => [number, number, number];

const brainsTable = {
  "haunter-guardian": zoneGuardianBrain,
  muk: zoneGuardianBrain,
  "mr-mime": zoneGuardianBrain,
  golbat: zoneGuardianBrain,
  alakazam: zoneGuardianBrain,
  "marowak-ghost": zoneGuardianBrain,
  gengar: zoneGuardianBrain,
  dewgong: zoneGuardianBrain,
  cloyster: zoneGuardianBrain,
  lapras: zoneGuardianBrain,
  magmar: zoneGuardianBrain,
  arcanine: zoneGuardianBrain,
  dragonite: zoneGuardianBrain,

  scyther: scytherBrain,
  pinsir: pinsirBrain,
  nidoking: nidokingBrain,
  sandslash: sandslashBrain,
  marowak: marowakBrain,
  aerodactyl: aerodactylBrain,
  kingler: kinglerBrain,
  gyarados: gyaradosBrain,
  starmie: starmieBrain,
} satisfies Record<string, GuardianBrain>;

export type GuardianBrainId = keyof typeof brainsTable;

/** Picked by `StageDef.guardian.brain`. */
export const guardianBrains: Record<GuardianBrainId, GuardianBrain> = brainsTable;
