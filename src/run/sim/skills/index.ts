import { trail } from "./trail";
import { teleport, hazards as teleportHazards } from "./teleport";
import { sing, singWide, dragonPulse } from "./radial";
import { icicle, flamethrower } from "./shot";
import { iceBeam } from "./psybeam";
import { bellySlide, firePunch } from "./lunge";
import { melt, bodySlam, tripleBurrow } from "./landing";
// Swarm skills: one module per behaviour, each exporting its `SkillDef` and the rules of the
// hazards it leaves; tuning lives in content/params/enemy-skills.ts. `EnemyDef.skill` names one by id. Every attack with a wind-up shows where it will
// land before it can hurt, needs a clear line through terrain and solid props to start (sight.ts), and
// keeps its state in Enemy / Hazard fields so a host can snapshot it. Reconciliation: src/run/sim/content/README.md.
// Load order: modules import kit / telegraph, never this file at runtime.

import type { EnemyStatusId } from "../content/statuses";
import type { World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import type { PartnerStyle } from "../state/events";
import { acid, eggBarrage, eggBomb, hazards as acidHazards } from "./acid";
import { aura, fireAura } from "./aura";
import { harden } from "./harden";
import { healPulse } from "./healPulse";
import { bonemerang, hazards as boomerangHazards } from "./boomerang";
import {
  burrow,
  dig,
  highJumpKick,
  leap,
  leapHeavy,
  shadowSneak,
  hazards as landingHazards,
} from "./landing";
import {
  aquaJet,
  dive,
  doublePeck,
  flameCharge,
  flameTrail,
  hornAttack,
  hornRush,
  megahorn,
  razorDash,
  roll,
  takeDown,
  triplePeck,
  hazards as lungeHazards,
} from "./lunge";
import { psybeam, psybeamHeavy, vineBind, hazards as psybeamHazards } from "./psybeam";
import {
  discharge,
  dischargeQuick,
  dischargeWide,
  dragonRage,
  selfDestruct,
  hazards as radialHazards,
} from "./radial";
import { rockfall, hazards as rockfallHazards } from "./rockfall";
import {
  ember,
  payDay,
  pinMissile,
  poisonFan,
  poisonSting,
  spikeCannon,
  thunderShock,
  waterGun,
  hazards as shotHazards,
} from "./shot";
import { bubble, bubbleBurst, spore, hazards as sporeHazards } from "./spore";
import { stunSpore, hazards as stunSporeHazards } from "./stunSpore";
import type { HazardRule } from "./kit";

/** Movement while a skill owns it: unit heading and speed. */
export type SkillMove = [number, number, number];

export interface SkillDef {
  /** The skill only starts with the target this close (and in sight). */
  range: number;
  /** How a captured partner of the species fights, and the status its hits inflict. */
  partner: { style: PartnerStyle; status?: EnemyStatusId };
  /** Seconds a telegraphed skill holds still before it leaves; a stagger inside them cancels it. */
  windup?: number;
  /**
   * Each tick the species chases (never a stampede runner or the guardian), before it steers: its
   * movement while the skill owns it, or null to chase. `speed` is the chase speed after paralysis and
   * wet; `every` the mean seconds between uses (`EnemyDef.skill.every`).
   */
  step(
    world: World,
    enemy: Enemy,
    target: Player,
    speed: number,
    dt: number,
    every: number,
  ): SkillMove | null;
}

const skillsTable = {
  trail,
  teleport,
  sing,
  "sing-wide": singWide,
  "dragon-pulse": dragonPulse,
  icicle,
  flamethrower,
  "ice-beam": iceBeam,
  "belly-slide": bellySlide,
  "fire-punch": firePunch,
  melt,
  "body-slam": bodySlam,
  "triple-burrow": tripleBurrow,
  "fire-aura": fireAura,
  dive,
  roll,
  acid,
  "stun-spore": stunSpore,
  psybeam,
  harden,
  "poison-sting": poisonSting,
  ember,
  "flame-charge": flameCharge,
  discharge,
  "self-destruct": selfDestruct,
  spore,
  // Forest zones 2–3 (docs/state-machines/simulation.md).
  "poison-fan": poisonFan,
  "thunder-shock": thunderShock,
  bubble,
  "bubble-burst": bubbleBurst,
  "egg-bomb": eggBomb,
  "egg-barrage": eggBarrage,
  "horn-attack": hornAttack,
  "vine-bind": vineBind,
  burrow,
  "shadow-sneak": shadowSneak,
  leap,
  "leap-heavy": leapHeavy,
  aura,
  "heal-pulse": healPulse,
  // Desert zones 1–3 (docs/state-machines/simulation.md).
  "double-peck": doublePeck,
  "triple-peck": triplePeck,
  "pay-day": payDay,
  bonemerang,
  "take-down": takeDown,
  "high-jump-kick": highJumpKick,
  "horn-rush": hornRush,
  dig,
  "flame-trail": flameTrail,
  "razor-dash": razorDash,
  "spike-cannon": spikeCannon,
  rockfall,
  // Coast zones 1–3 (docs/state-machines/simulation.md).
  "aqua-jet": aquaJet,
  megahorn,
  "psybeam-heavy": psybeamHeavy,
  "water-gun": waterGun,
  "pin-missile": pinMissile,
  "discharge-wide": dischargeWide,
  "discharge-quick": dischargeQuick,
  "dragon-rage": dragonRage,
} satisfies Record<string, SkillDef>;

export type SkillId = keyof typeof skillsTable;
export const skills: Record<SkillId, SkillDef> = skillsTable;

/** Rules of the hazards the skills leave, by hazard kind (sim/hazards.ts adds the guardian's). */
export const skillHazards = {
  ...teleportHazards,
  ...lungeHazards,
  ...acidHazards,
  ...stunSporeHazards,
  ...psybeamHazards,
  ...shotHazards,
  ...radialHazards,
  ...sporeHazards,
  ...landingHazards,
  ...boomerangHazards,
  ...rockfallHazards,
} satisfies Record<string, HazardRule>;
