import type { ElementType } from "../../run/sim/content/elements";
import { cubicBezier } from "./focus-mark";

/** Element accents (DESIGN.md › type-*): the type colour and its soft face. */
export const typeColors: Record<ElementType, { type: string; soft: string }> = {
  fire: { type: "#f0702e", soft: "#ffe2cf" },
  water: { type: "#2f8fe0", soft: "#d6ecff" },
  grass: { type: "#3e9e3a", soft: "#dcf3d2" },
  electric: { type: "#d9a400", soft: "#fff2c2" },
  normal: { type: "#8a8574", soft: "#efece4" },
  poison: { type: "#9a4fc7", soft: "#f0dcfa" },
  bug: { type: "#7f9a1c", soft: "#eef3cf" },
  flying: { type: "#6f86d0", soft: "#e3e9fa" },
  rock: { type: "#a8913a", soft: "#f2ebcf" },
  ground: { type: "#c07a3e", soft: "#f8e6d4" },
  fighting: { type: "#c4402f", soft: "#f8dcd6" },
  psychic: { type: "#e5487a", soft: "#fde0ea" },
  ghost: { type: "#6b5a9e", soft: "#e6e0f4" },
  fairy: { type: "#e07cb4", soft: "#fce4f1" },
  steel: { type: "#62869c", soft: "#e1e9ef" },
  ice: { type: "#5caab8", soft: "#e3f7fa" },
  dragon: { type: "#5640d8", soft: "#e1dcfb" },
};

/** The crest's idle pose: rotation (deg), scale and lift (px, down positive). */
export type CrestPose = readonly [number, number, number];

interface RunTheme {
  deep: string;
  light: string;
  /** `--theme-grain` as GLSL: sets `grain` (0–1) at `p` (px, y down), `aa` half a pixel. */
  grain: string;
  grainInk: string;
  /** `--theme-edge` as GLSL: sets `edge` (0/1) at `x` along the band, `d` px up from its foot. */
  edge: (x: string, d: string) => string;
  /** `--theme-motion` at `t` seconds. */
  motion: (t: number) => CrestPose;
}

/** 0 → 1 → 0 over two `duration`s, eased like CSS `ease-in-out alternate`. */
function swing(t: number, duration: number): number {
  const progress = (t % (duration * 2)) / duration;
  return cubicBezier(progress < 1 ? progress : 2 - progress, 0.42, 0, 0.58, 1);
}
const still: CrestPose = [0, 1, 0];

/**
 * The run themes (DESIGN.md › 属性主题): a starter type's deep and light steps, grain, band edge
 * and crest motion. Key order is the grain index the HUD's shared programs switch on.
 */
const runThemes = {
  fire: {
    deep: "#9c3412",
    light: "#ffb36b",
    // Sparks: two offset dot lattices.
    grain: `float a=length(mod(p,vec2(11.,9.))-vec2(2.75,6.75));
      float b=length(mod(p,vec2(7.))-vec2(4.9,2.1));
      grain=max((1.-smoothstep(1.5-aa,2.+aa,a))*.55,(1.-smoothstep(1.-aa,1.5+aa,b))*.35);`,
    grainInk: "#ffecaa",
    // Flame tongues.
    edge: (x, d) => `vec2 e=vec2((mod(${x},9.)-4.5)/3.6,(${d})/8.);edge=step(dot(e,e),1.);`,
    motion: (t) => {
      const p = swing(t, 1.4);
      return [-3 + p * 6, 1 + p * 0.08, -p];
    },
  },
  grass: {
    deep: "#1f5e22",
    light: "#9be07a",
    // Leaf veins: a 35° hatch.
    grain: `grain=(1.-smoothstep(2.-aa,2.+aa,mod(-p.x*.819152+p.y*.573576,9.)))*.3;`,
    grainInk: "#e8ffd6",
    // Leaves.
    edge: (x, d) => `vec2 e=vec2(mod(${x},14.)/14.,(${d})/6.4);edge=step(dot(e,e),.49);`,
    motion: (t) => [-9 + swing(t, 2.6) * 16, 1, 0],
  },
  water: {
    deep: "#164f8c",
    light: "#8fd0ff",
    // Ripples: arcs on a staggered lattice.
    grain: `float d=length(mod(p,vec2(12.,7.))-vec2(6.,9.1));grain=(1.-smoothstep(.5-aa,1.+aa,abs(d-5.5)))*.4;`,
    grainInk: "#e1f5ff",
    // Waves.
    edge: (x, d) => `vec2 e=vec2((mod(${x},16.)-8.)/9.6,(${d})/5.6);edge=step(dot(e,e),1.);`,
    motion: (t) => {
      const p = swing(t, 2.2);
      return [0, 1 + p * 0.04, 1 - p * 3];
    },
  },
  electric: {
    deep: "#7d5a00",
    light: "#ffe45c",
    // Zigzag.
    grain: `vec2 q=mod(p+vec2(4.,0.),8.);grain=max(step(q.x+q.y,4.),step(8.,q.x-q.y+4.))*.34;`,
    grainInk: "#fffcdc",
    // Saw teeth.
    edge: (x, d) => `edge=step(${d},8.-abs(mod(${x},14.)-7.));`,
    // Two quick zaps every 2.4s.
    motion: (t) => {
      const u = (t % 2.4) / 2.4;
      return (u >= 0.9 && u < 0.94) || u >= 0.97 ? [-6, 1.12, 0] : still;
    },
  },
  ghost: {
    deep: "#3a2d63",
    light: "#c7b8f2",
    // Eyes in the dark: staggered pairs of upright ovals, a hollow wisp bubble between the rows.
    grain: `vec2 q=mod(p+vec2(mod(floor(p.y/12.),2.)*7.,0.),vec2(14.,12.))-vec2(7.,6.);
      float eyes=length(vec2(abs(q.x)-2.,q.y*.8))-1.1;
      float wisp=abs(length(mod(p+vec2(3.5,6.),vec2(14.,12.))-vec2(7.,6.))-2.4)-.5;
      grain=max((1.-smoothstep(-aa,aa,eyes))*.45,(1.-smoothstep(-aa,aa,wisp))*.28);`,
    grainInk: "#efe6ff",
    // Wisps: tapering tails that lean back.
    edge: (x, d) =>
      `float u=mod(${x}+(${d})*.6,12.)-6.;edge=step(abs(u)+.001,3.4*sqrt(max(0.,1.-(${d})/8.)));`,
    // Drifts: a float with a lazy sway a quarter-beat behind.
    motion: (t) => [-5 + swing(t + 0.6, 2.4) * 10, 1, 1.5 - swing(t, 2.4) * 4],
  },
  dragon: {
    deep: "#2a1c7a",
    light: "#aa9dff",
    // Scales: rows of lower arcs, each row offset half a scale.
    grain: `float row=floor(p.y/6.6);
      vec2 q=vec2(mod(p.x+mod(row,2.)*6.,12.)-6.,p.y-row*6.6);
      grain=(1.-smoothstep(.55-aa,.55+aa,abs(length(q)-6.)))*.3;`,
    grainInk: "#e6e1ff",
    // Dorsal fins: swept-back spines.
    edge: (x, d) => `edge=step(${d},8.*pow(1.-mod(${x},13.)/13.,1.7));`,
    // Rears its head: a slow lift back and up.
    motion: (t) => {
      const p = swing(t, 2.8);
      return [4 - p * 8, 1 + p * 0.05, -p * 1.5];
    },
  },
  fighting: {
    deep: "#7a1d14",
    light: "#ff9e84",
    // Impact marks: three short strokes bursting up-right, staggered.
    grain: `vec2 q=mod(p+vec2(mod(floor(p.y/14.),2.)*8.,0.),vec2(16.,14.))-vec2(5.,10.);
      vec2 r0=vec2(.173648,-.984808),r1=vec2(.707107,-.707107),r2=vec2(.984808,-.173648);
      float s=min(length(q-r0*clamp(dot(q,r0),3.,7.)),length(q-r1*clamp(dot(q,r1),3.,7.5)));
      s=min(s,length(q-r2*clamp(dot(q,r2),3.,7.)));
      grain=(1.-smoothstep(.8-aa,.8+aa,s))*.4;`,
    grainInk: "#ffe0d6",
    // Knuckles: a row of squared, rounded blocks.
    edge: (x, d) =>
      `vec2 e=vec2(mod(${x},11.)-5.5,(${d})-2.);edge=step(length(max(abs(e)-vec2(2.8,2.),0.)),1.6);`,
    // A jab every 1.8s: a short wind-up, the punch, a settle.
    motion: (t) => {
      const u = (t % 1.8) / 1.8;
      if (u >= 0.78 && u < 0.84) return [6, 0.94, 1];
      if (u >= 0.84 && u < 0.92) return [-8, 1.16, -2];
      if (u >= 0.92 && u < 0.96) return [-3, 1.05, -0.5];
      return still;
    },
  },
} satisfies Partial<Record<ElementType, RunTheme>>;
type RunThemeType = keyof typeof runThemes;
const runThemeTypes = Object.keys(runThemes) as RunThemeType[];

/** Steps a station paints a move type with when that type is no run theme. */
const moveSteps: Partial<Record<ElementType, { deep: string; light: string }>> = {
  normal: { deep: "#5f5a4e", light: "#d1cabb" },
  poison: { deep: "#60307e", light: "#ddb5ed" },
};

function isRunTheme(type: ElementType): type is RunThemeType {
  return type in runThemes;
}
/** A type's grain, edge and motion; any other type keeps electric's grain and edge, and stands still. */
function lookOf(type: ElementType): RunTheme {
  return isRunTheme(type) ? runThemes[type] : { ...runThemes.electric, motion: () => still };
}

export interface ThemeColors {
  theme: string;
  deep: string;
  light: string;
  soft: string;
}
const colorCache = new Map<ElementType, ThemeColors>();

/** A type's theme steps; a type with neither a run theme nor move steps takes normal's. */
export function themeColors(type: ElementType): ThemeColors {
  const own: ElementType = isRunTheme(type) || moveSteps[type] ? type : "normal";
  let colors = colorCache.get(own);
  if (!colors) {
    const steps = isRunTheme(own) ? runThemes[own] : moveSteps[own]!;
    const { type: theme, soft } = typeColors[own];
    colorCache.set(own, (colors = { theme, soft, deep: steps.deep, light: steps.light }));
  }
  return colors;
}

/** The level-up chest's banner grain: gold coin dots. */
const chestGrain = `grain=(1.-smoothstep(1.5-aa,2.+aa,length(mod(p,vec2(10.,9.))-vec2(3.,6.3))))*.45;`;

/** `--theme-grain`: its GLSL, ink and index (`runThemes` order; the chest after them). */
export function themeGrain(theme: ElementType | "chest"): {
  kind: number;
  color: string;
  glsl: string;
} {
  if (theme === "chest") return { kind: runThemeTypes.length, color: "#ffffff", glsl: chestGrain };
  const look = lookOf(theme);
  return {
    kind: runThemeTypes.indexOf(isRunTheme(theme) ? theme : "electric"),
    color: look.grainInk,
    glsl: look.grain,
  };
}

/** Every run theme's grain in one program, chosen by the float `kind` (a `themeGrain` index). */
export function themeGrainSwitch(kind: string): string {
  return runThemeTypes
    .map((type, i) => `${i ? "else " : ""}if(${kind}<${i}.5){${runThemes[type].grain}}`)
    .join("");
}

/** `--theme-edge` as GLSL: sets `edge` at `x` along the band, `depth` px up from its foot. */
export function themeEdge(theme: ElementType, x: string, depth: string): string {
  return `{${lookOf(theme).edge(x, depth)}}`;
}

/** `--theme-motion`: the crest's idle pose `t` seconds in. */
export function crestPose(theme: ElementType, t: number): CrestPose {
  return lookOf(theme).motion(t);
}
