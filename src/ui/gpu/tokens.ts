import { Color, Vector3 } from "three";

/**
 * The shared visual language (2026-11 redesign): structural colours and the one slant, radius and
 * hard shadow every slanted surface uses. Type and theme colours stay in `run-theme.ts`; functional
 * colours (HP, XP, danger, rarity) stay with their surfaces.
 */
export const ui = {
  /** Main text and dark plates. */
  ink: "#16161d",
  /** The stage's ground. */
  paper: "#fafafa",
  mist: "#eceef2",
  line: "#d6d9df",
  muted: "#8b919c",
  /** Poké Ball red: the primary action. */
  ball: "#e8392c",
  /** Cleared. */
  success: "#287a58",
  white: "#ffffff",
} as const;

/** Every slanted element leans skewX(−14°): its top edge sits h·tan14° right of its bottom edge. */
export const SLANT_DEG = 14;
export const SLANT = Math.tan((SLANT_DEG * Math.PI) / 180);
/** How far a slanted box's top edge sits right of its bottom edge at height `h`. */
export const slantOf = (h: number): number => h * SLANT;

/** Corner radius of an outer slanted surface and of a block inside one. */
export const RADIUS = 6;
export const RADIUS_INNER = 4;

/** The hard drop shadow: offset right and down by 3–5px, black 22%. */
export const HARD_SHADOW = { offset: 4, alpha: 0.22 } as const;

/** sRGB components of a CSS colour, for shaders that blend in display space as CSS does. */
export function srgb(hex: string, out = new Vector3()): Vector3 {
  const c = new Color(hex).convertLinearToSRGB();
  return out.set(c.r, c.g, c.b);
}
