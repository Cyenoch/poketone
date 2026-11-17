import { rgb } from "./gl";

export const white = rgb("#ffffff");
export const ink = rgb("#142f50");

export const fire = {
  core: rgb("#fff2a8"),
  yellow: rgb("#ffc21a"),
  orange: rgb("#ff7a12"),
  red: rgb("#e8401c"),
  deep: rgb("#a3200f"),
  ash: rgb("#9a8580"),
  smoke: rgb("#5b4645"),
  soot: rgb("#2e2222"),
};

export const grass = {
  light: rgb("#d8ff8f"),
  leaf: rgb("#7ad640"),
  deep: rgb("#1f6b2a"),
  sun: rgb("#fff7c2"),
  gold: rgb("#ffe066"),
  lime: rgb("#b8f04a"),
};

export const powder = {
  lilac: rgb("#d4c4ff"),
  pink: rgb("#ffb5e2"),
  mist: rgb("#f3e8ff"),
};

export const water = {
  foam: rgb("#f2fdff"),
  light: rgb("#94e0ff"),
  mid: rgb("#3aa6f0"),
  deep: rgb("#1d5fc4"),
  dark: rgb("#123f86"),
};

export const electric = {
  white: rgb("#ffffff"),
  yellow: rgb("#ffe94a"),
  gold: rgb("#ffb400"),
  cyan: rgb("#aef1ff"),
};

export const wind = {
  white: rgb("#ffffff"),
  cream: rgb("#fbf3e1"),
  cyan: rgb("#a6e6ff"),
  dust: rgb("#d6c196"),
};

export const danger = {
  red: rgb("#ff2b3d"),
  deep: rgb("#8a0a1c"),
  pale: rgb("#ffe0e3"),
};

export const poison = {
  purple: rgb("#b14dff"),
  deep: rgb("#4b137a"),
  light: rgb("#e7c0ff"),
};

export const gold = {
  yellow: rgb("#ffd45b"),
  deep: rgb("#c48a2a"),
  white: rgb("#fff8dc"),
};

export const stone = {
  light: rgb("#bcae98"),
  dark: rgb("#6c5f52"),
};

// Gastly line: near-black indigo bodies with a hot magenta rim. Enemy poison is a bright, saturated
// violet blob; the player's ghost reads by its dark value and the magenta, never by that violet.
export const ghost = {
  ink: rgb("#1d1433"),
  shade: rgb("#3d2970"),
  veil: rgb("#7650cc"),
  glow: rgb("#ff6fd8"),
  light: rgb("#ffd9f6"),
  smog: rgb("#8c7a99"),
  soot: rgb("#3a2f47"),
  sludge: rgb("#5e2a72"),
};

// Dratini line: jade dragon-fire over royal indigo with gold scales; jade stays clear of the
// cyan-blue XP candy and of the yellow-green grass by its blue-green hue and its indigo ink.
export const dragon = {
  deep: rgb("#1b2068"),
  indigo: rgb("#4b47e6"),
  teal: rgb("#14c7a5"),
  light: rgb("#c8fff1"),
  scale: rgb("#ffcd3c"),
};

// Machop line: amber force with cream cores and brown ink; shapes (fists, blades, cracks) keep it
// apart from fire, which never draws them.
export const fighting = {
  amber: rgb("#ffa424"),
  cream: rgb("#fff4d8"),
  ochre: rgb("#c4660f"),
  dust: rgb("#cdb58f"),
  deep: rgb("#5a3418"),
};

// Abra line: bright pink thought-light over a pale core with a cool lilac edge. It reads by its high
// value against the ghost line's near-black bodies, and stays pink, never the enemies' red or violet.
export const psychic = {
  core: rgb("#fff1fa"),
  light: rgb("#ffc6ea"),
  pink: rgb("#ff74c4"),
  rose: rgb("#d2479a"),
  lilac: rgb("#c8bcff"),
  ink: rgb("#4b2257"),
  // Psybeam's prism hints: thin strands only, never blobs (XP candy is cyan-blue).
  mint: rgb("#bff7e4"),
  lemon: rgb("#fff3a6"),
};

// Geodude line: grey-brown stone and warm earth with dark clay ink. No glow on rock: the weight is in
// value, chunky silhouettes and dust, which keeps it apart from fighting's amber force.
export const rock = {
  light: rgb("#d8cab0"),
  stone: rgb("#a3907a"),
  dark: rgb("#62523f"),
  ink: rgb("#33281e"),
  earth: rgb("#b5874e"),
  dust: rgb("#e2cfa6"),
  clay: rgb("#7a5230"),
};
