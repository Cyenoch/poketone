// Ultimate timelines (openspec/specs/combat-builds/spec.md 被动与终极技; reference `game-definitions.json` → `Ev`).
// Each tier is a list of pulses: instant damaging beats at a time after the cast. Sizes are the
// reference's × 0.45 (our moves sit at about half the reference's reach, docs/BALANCE.md 招式大小),
// and grow with the area stat only as √areaGrowth (≤ 1.3×). The balance model reads these lists too.

import type { ElementType } from "./elements";
import type { EnemyStatusId } from "./statuses";
import type { UltLook } from "../state/events";

export type PulseKind =
  /** A disc on the player as they stand now; `pull` drags non-bosses toward the centre first. */
  | "ring"
  /** `count` discs on a circle of `spread` around the cast origin. */
  | "spots"
  /** `count` lanes in a star from the player, `length` long and 2 × `radius` wide, cut by cover. */
  | "lines"
  /** Sky strikes on `count` visible enemies within `range` (random, or the toughest first). */
  | "strike"
  /** Two opposite beams sweeping the arc [turn, turn + arc] (radians from the aim), `length` long. */
  | "sweep"
  /** Jump to the nearest uncrossed visible enemy within `range` of the last hop and strike it. */
  | "hop"
  /** Heal `heal` of max HP; no damage. */
  | "heal";

export interface Pulse {
  at: number;
  kind: PulseKind;
  look: UltLook;
  radius: number;
  /** Damage as a multiple of the ultimate's base hit (`ultDamage`). */
  mul: number;
  status?: EnemyStatusId;
  chance?: number;
  knock?: number;
  count?: number;
  length?: number;
  spread?: number;
  turn?: number;
  arc?: number;
  range?: number;
  toughest?: boolean;
  pull?: number;
  heal?: number;
}

/** A line's ultimate (`LineDef.ultimate`): one name and one pulse list per stage of the line. */
export interface UltimateDef<Id extends string = UltimateId> {
  id: Id;
  /** Element of every pulse's hit. */
  type: ElementType;
  names: readonly string[];
  tiers: readonly (readonly Pulse[])[];
}

const every = (from: number, to: number, step: number, make: (at: number, i: number) => Pulse) => {
  const out: Pulse[] = [];
  for (let at = from, i = 0; at <= to + 1e-9; at += step, i++) out.push(make(at, i));
  return out;
};

const roots = (count: number, length: number): Pulse => ({
  at: 0,
  kind: "lines",
  look: "roots",
  count,
  length,
  radius: 0.9,
  mul: 1.1,
  status: "paralysis",
  chance: 0.9,
  knock: 1,
});
const sunAndSpores: Pulse[] = [
  { at: 0.35, kind: "heal", look: "sun", radius: 1.1, mul: 0, heal: 0.2 },
  { at: 0.35, kind: "ring", look: "spores", radius: 4.5, mul: 0.6, status: "sleep", chance: 0.6 },
];

/** Burning ground: `count` spots around the cast origin ticking for 2.4 s. */
const embers = (from: number, count: number, spread: number): Pulse[] =>
  every(from, from + 2.4, 0.3, (at) => ({
    at,
    kind: "spots",
    look: "embers",
    count,
    spread,
    radius: 1,
    mul: 0.18,
    status: "burn",
    chance: 0.5,
  }));
const fireRing = (at: number, radius: number): Pulse => ({
  at,
  kind: "ring",
  look: "ring",
  radius,
  mul: 1.3,
  status: "burn",
  chance: 0.9,
  knock: 4,
});
const cracks = (at: number, count: number, length: number, mul: number): Pulse => ({
  at,
  kind: "lines",
  look: "crack",
  count,
  length,
  radius: 0.6,
  mul,
  status: "burn",
  chance: 0.8,
});
const pillar: Pulse = { at: 0, kind: "ring", look: "pillar", radius: 1.1, mul: 0.5, knock: 2 };

const whirl = (to: number): Pulse[] =>
  every(0, to, 0.25, (at) => ({
    at,
    kind: "ring",
    look: "whirl",
    radius: 2.3,
    mul: 0.32,
    status: "wet",
    chance: 0.6,
    knock: 0,
    pull: 0.7,
  }));
const wave = (at: number, radius: number, mul: number): Pulse => ({
  at,
  kind: "ring",
  look: "wave",
  radius,
  mul,
  status: "wet",
  chance: 1,
  knock: 6,
});
const CANNON_FROM = 0.5;
const CANNON_FOR = 2.2;
const CANNON_STEP = 0.15;
/** 1.1 turns over the sweep, each tick covering the arc since the last one. */
const CANNON_TURN = (Math.PI * 2 * 1.1 * CANNON_STEP) / CANNON_FOR;

const storm = (from: number, to: number): Pulse[] =>
  every(from, to, 0.24, (at) => ({
    at,
    kind: "strike",
    look: "storm",
    count: 1,
    range: 6.8,
    radius: 0.9,
    mul: 0.75,
    status: "paralysis",
    chance: 0.5,
  }));
const bolts = (at: number, count: number): Pulse => ({
  at,
  kind: "strike",
  look: "bolt",
  count,
  range: 7.2,
  toughest: true,
  radius: 2,
  mul: 2.2,
  status: "paralysis",
  chance: 1,
  knock: 3,
});

const ultimatesTable = {
  "frenzy-plant": {
    id: "frenzy-plant",
    type: "grass",
    names: ["狂怒之根", "疯狂植物", "巨型花鞭"],
    tiers: [
      [roots(6, 6)],
      [roots(8, 7.2), ...sunAndSpores],
      [
        roots(10, 8),
        ...sunAndSpores,
        ...[4, 5.4, 6.8].map((radius, i): Pulse => ({
          at: 0.7 + i * 0.32,
          kind: "ring",
          look: "petals",
          radius,
          mul: 0.9,
          knock: 3,
        })),
      ],
    ],
  },
  "blast-burn": {
    id: "blast-burn",
    type: "fire",
    names: ["升腾烈焰", "火焰之环", "巨型烈焰"],
    tiers: [
      [pillar, fireRing(0.18, 3.6), ...embers(0.18, 6, 2.2)],
      [
        pillar,
        cracks(0, 6, 5.8, 0.9),
        fireRing(0.18, 3.6),
        fireRing(0.4, 5),
        fireRing(0.62, 6.3),
        ...embers(0.18, 6, 2.2),
      ],
      [
        pillar,
        cracks(0, 6, 5.8, 0.9),
        fireRing(0.18, 3.6),
        fireRing(0.4, 5),
        fireRing(0.62, 6.3),
        ...every(0.3, 2.1, 0.13, (at) => ({
          at,
          kind: "strike",
          look: "meteor",
          count: 1,
          range: 7,
          radius: 1.6,
          mul: 1.2,
          status: "burn",
          chance: 0.8,
        })),
        {
          at: 2.55,
          kind: "ring",
          look: "blast",
          radius: 5.8,
          mul: 2,
          status: "burn",
          chance: 1,
          knock: 6,
        },
        cracks(2.55, 8, 6.8, 0.6),
      ],
    ],
  },
  "hydro-cannon": {
    id: "hydro-cannon",
    type: "water",
    names: ["贝壳旋风", "海啸", "加农水炮"],
    tiers: [
      [...whirl(2.2), wave(2.2, 4, 1.4)],
      [
        wave(0, 7.2, 1.8),
        ...every(0.9, 3.9, 0.6, (at) => ({
          at,
          kind: "ring",
          look: "rain",
          radius: 5,
          mul: 0.15,
          status: "wet",
          chance: 1,
        })),
      ],
      [
        wave(0, 5.4, 1.8),
        ...every(CANNON_FROM, CANNON_FROM + CANNON_FOR - CANNON_STEP, CANNON_STEP, (at, i) => ({
          at,
          kind: "sweep",
          look: "cannon",
          turn: i * CANNON_TURN,
          arc: CANNON_TURN,
          length: 7.6,
          radius: 0.7,
          mul: 0.8,
          status: "wet",
          chance: 1,
          knock: 1.5,
        })),
      ],
    ],
  },
  "volt-tackle": {
    id: "volt-tackle",
    type: "electric",
    names: ["巨型雷鸣", "巨型雷鸣", "疯狂伏特"],
    tiers: [
      [...storm(0, 2.4), bolts(2.45, 3)],
      [...storm(0, 3), bolts(3.05, 4)],
      [
        ...every(0, 0.49, 0.07, (at) => ({
          at,
          kind: "hop",
          look: "zigzag",
          range: 5.4,
          radius: 1,
          mul: 1.2,
          status: "paralysis",
          chance: 1,
          knock: 2,
        })),
        ...storm(0.6, 3.4),
        bolts(3.45, 3),
      ],
    ],
  },
} as const satisfies Record<string, UltimateDef<string>>;

export type UltimateId = keyof typeof ultimatesTable;
export const ultimates: Record<UltimateId, UltimateDef> = ultimatesTable;
