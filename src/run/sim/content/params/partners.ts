// 支援队伍 (partners.ts): slots, capture odds, 护主, follow geometry and attack shapes.
// Distances are world units, times seconds, angles radians, damage shares dimensionless.

import type { PartnerStyle } from "../../state/events";

/** Partner slots before the lab (研究所 支援队伍 +1), as the reference: 2 → 3. */
export const BASE_PARTNER_SLOTS = 2;
/**
 * Chance that defeating an elite captures it while its killer has a free slot: the timeline's alpha
 * (头目), any other elite (elite waves, random elites on the harder tiers).
 */
export const CAPTURE_CHANCE = { alpha: 0.6, elite: 0.4 } as const;

/**
 * 护主: a swarm touch that lands on the owner calls its nearest ready partner that can get to the owner
 * (within `PARTNER.leash`; a walker needs a walkable line), which shields the owner from every hit for
 * `shield` seconds; then it rests `every` seconds. The next touch after the shield calls the next ready
 * partner, so a party covers a long catch in turns. It only pays when more hits would have followed, so
 * it breaks the catches of a player who gets cornered and does little for one who is rarely touched.
 */
export const GUARD = { every: 6, shield: 1 } as const;

export const PARTNER = {
  /** Body size over the species' (an alpha is 1.9×; a partner stays smaller than the player's view). */
  scale: 1.3,
  /** Walking speed: faster than any starter, so it keeps up without a dash. */
  speed: 6.5,
  /** Follow spot behind the owner, and the half-angle the slots fan out by. */
  follow: 1.8,
  spread: 0.9,
  /** Only enemies this close to the owner draw a partner off its follow spot. */
  leash: 7,
  /** Farther than this from the owner (left behind a cliff, outrun by a dash), it rejoins at once. */
  regroup: 14,
  /** Stop within this distance of the follow spot. */
  followStop: 0.3,
  /** Aim height as a share of the scaled species height, with CHEST as its minimum. */
  eyeHeight: 0.7,
  /** Nearest shot candidates to inspect before excluding the guardian. */
  shotCandidates: 2,
  /** Stop chasing at these shares of the attack reach. */
  tackleStop: 0.5,
  areaStop: 0.6,
  tackleKnock: 2,
  shotKnock: 0.8,
  /** Pulse line-of-sight height above the ground. */
  pulseLift: 0.5,
  /** Cloud/pulse status application probability. */
  areaStatusChance: 1,
} as const;

/**
 * Per attack shape: seconds between attacks, reach (tackle: gap past touching; shot: range; cloud:
 * radius) and damage as a share of `partnerHit`. Tackle and shot work out to about half a full hit
 * per second on one target; the cloud trades that for an area and paralysis.
 */
export const PARTNER_ATTACK: Record<PartnerStyle, { every: number; reach: number; dmg: number }> = {
  tackle: { every: 1, reach: 0.35, dmg: 0.7 },
  shot: { every: 1.6, reach: 8, dmg: 0.85 },
  cloud: { every: 3, reach: 2.4, dmg: 0.4 },
  pulse: { every: 3, reach: 2.8, dmg: 0.6 },
};
