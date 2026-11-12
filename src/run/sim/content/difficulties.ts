export type Difficulty = 0 | 1 | 2;

/** Swarm/elite toughness only; the shared HP growth curve also feeds partner damage. */
export const SWARM_HP = 1 / 1.1;

export interface DifficultyDef {
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  amount: number;
  /** Reward per enemy; extra supply on harder tiers must not rush the whole evolution curve. */
  xp: number;
  eliteChance: number;
  /** Seconds earlier than their stage time every timeline beat fires, like the reference's `early`. */
  earlyBy: number;
  /** × the guardian's wind-up and recovery (bosses/scyther.ts): lower is a shorter tell. */
  bossTelegraph: number;
  /** Air Slash blades the guardian fires below half HP. */
  airSlashBlades: number;
  /**
   * The guardian's HP and damage (contact, dash, Air Slash) on top of the tier's `hp` / `dmg`, so its
   * fight can be tuned apart from the swarm. Read the effective hp/dmg products when comparing tiers.
   */
  guardianHp: number;
  guardianDmg: number;
}

export const difficulties: readonly [DifficultyDef, DifficultyDef, DifficultyDef] = [
  {
    name: "普通",
    hp: 1.35,
    dmg: 0.75,
    speed: 1,
    amount: 0.7,
    xp: 1,
    eliteChance: 0,
    earlyBy: 0,
    bossTelegraph: 1,
    airSlashBlades: 8,
    guardianHp: 1.25,
    guardianDmg: 1,
  },
  {
    name: "困难",
    hp: 1.45,
    dmg: 1.1,
    speed: 1.06,
    amount: 1,
    xp: 0.85,
    eliteChance: 0.004,
    earlyBy: 15,
    bossTelegraph: 0.9,
    airSlashBlades: 10,
    guardianHp: 1.4,
    guardianDmg: 1,
  },
  {
    name: "噩梦",
    hp: 1.9,
    dmg: 1.6,
    speed: 1.12,
    amount: 1.15,
    xp: 0.75,
    eliteChance: 0.008,
    earlyBy: 30,
    bossTelegraph: 0.8,
    airSlashBlades: 12,
    guardianHp: 1.3,
    guardianDmg: 0.9,
  },
];
