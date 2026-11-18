/** Trainer item timers are in simulation seconds; radius is in world units. */
export const TRAINER = {
  cooldown: 90,
  radius: 2.5,
  xSpeed: { seconds: 8, movement: 1.2, attackRate: 1.15 },
  superPotion: { hp: 0.12 },
  direHit: { seconds: 6 },
  fullHeal: { seconds: 4 },
  scout: { markerRange: 1.5 },
  tinker: { refund: 1.5 },
  naturalist: { shiny: 1.5, seen: 1.5 },
  caretaker: { damage: 1.15, interval: 0.9 },
} as const;
