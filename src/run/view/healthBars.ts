import {
  type Camera,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { COOP_SCALING } from "../sim/content/params/coop";
import { LIVE_CAP } from "../sim/content/params/pacing";
import { PLAYER_IFRAMES } from "../sim/content/params/player";
import { formOf } from "../sim/evolution";
import { canBeRescued } from "../sim/rescue";
import { activeWeather } from "../sim/content/weather";
import { currentStats } from "../sim/stats";
import { targetable } from "../sim/status";
import type { Enemy, Player } from "../sim/state/entities";
import type { RunEvent } from "../sim/state/events";
import type { World } from "../sim/state/world";
import { playerColors } from "../../ui/player-colors";
import { themeColors } from "../../ui/gpu/run-theme";
import { PROFILE_BANDS, PROFILE_DIRS, type Profile } from "./assets";

/**
 * Every world HP bar in one instanced draw (DESIGN.md「头顶血条」): Pokémon-style capsules sized in
 * screen pixels, their width following the body. Players carry a level badge (teammates their seat),
 * HP-chunk ticks, a shield extension, status pips and an ultimate-ready spark; elites a framed bar
 * with a diamond; ordinary enemies a thin bar shown only after damage. Guardians have none: the HUD
 * guardian bar carries them. View-only state keyed by entity; reads the world, never writes it.
 */
/**
 * A body as the view drew it this frame: its feet (jumps, hover and a clip's lift included), rest height
 * and footprint radius, facing (null: a crowd's bar ignores it) and silhouette, when loaded.
 */
export interface DrawnBody {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  yaw: number | null;
  profile: Profile | undefined;
}

/** What one frame drew: the camera, the bodies by enemy and player id, and the frame's sim events. */
export interface BarFrame {
  camera: Camera;
  enemies: ReadonlyMap<number, DrawnBody>;
  players: ReadonlyMap<number, DrawnBody>;
  events: readonly RunEvent[];
}

export interface HealthBars {
  mesh: InstancedMesh;
  update(world: World, local: number, dt: number, frame: BarFrame): void;
  dispose(): void;
}

/** The live cap at its largest (four seats), plus encounter spawns and dying bars over it. */
const ENEMY_CAPACITY =
  Math.ceil(LIVE_CAP.max * Math.max(...COOP_SCALING.map((seats) => seats.cap))) + 64;
const CAPACITY = ENEMY_CAPACITY + 4;
/** An ordinary enemy's bar shows this long after its last hit (the last FADE_OUT fading). */
const VISIBLE_FOR = 2.6;
const FADE_OUT = 0.4;
/** A hidden bar fades back in over this long on its next hit. */
const FADE_IN = 0.12;
/**
 * The lost segment's cycle, one timer from the hit: it pops past the frame over CHIP_POP (a back-out
 * overshoot), stays out for CHIP_HOLD, then settles back over CHIP_SETTLE while it drains.
 */
const CHIP_POP = 0.14;
const CHIP_HOLD = 0.35;
const CHIP_SETTLE = 0.22;
/** A hit of this share of max HP or more pops the lost segment the furthest. */
const CHIP_BIG_HIT = 0.25;
const CHIP_DRAIN = 3.2;
const DEATH_TIME = 0.32;
/** Models are normalised to their form height at rest; breathing reaches a little over it. */
const POSE_ROOM = 1.05;
/** One tick per this much HP on a player's bar, a long tick every fourth (read the max at a glance). */
const HP_CHUNK = 25;
/** Below these shares of max HP a player's fill turns yellow, then red (the HUD's danger line). */
const HP_YELLOW = 0.5;
const HP_RED = 0.3;

/** Bar kinds, as the shader reads them. */
const Kind = { Foe: 0, Elite: 1, Alpha: 2, Self: 3, Mate: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

/** Status pips, left to right over a player's bar. */
const POISON = 1;
const SLOW = 2;
const X_SPEED = 4;
const DIRE_HIT = 8;
const FULL_HEAL = 16;
/** Not pips: the ultimate-ready spark and the invulnerable frame. */
const ULT_READY = 32;
const GUARDED = 64;

interface Bar {
  /** HP and shield now, and the trailing lost chunk's end, in HP. */
  value: number;
  chip: number;
  /** Seconds since the lost segment's cycle began (Infinity: none). */
  cycle: number;
  flash: number;
  /** The lost segment's hit size, 0 (a scratch) … 1 (CHIP_BIG_HIT or more): how far it pops. */
  size: number;
  /** The max HP the lost segment is measured against: a change resets it, it is not a hit. */
  cap: number;
  shown: number;
  /** Drawn opacity: rises over FADE_IN on a hit, follows `shown` down. */
  opacity: number;
  death: number;
  alive: boolean;
  /** The body as last drawn (a dying bar keeps it); `posed` false: not drawn this frame. */
  body: DrawnBody;
  posed: boolean;
  hp: number;
  shield: number;
  total: number;
  kind: Kind;
  label: number;
  flags: number;
  tone: number;
}

const vertexShader = /* glsl */ `
attribute vec4 aAnchor;  // the model's screen-top world xyz, body width (world units)
attribute vec4 aBar;     // hp, hp + shield, chip end (shares of the bar), flash
attribute vec4 aLook;    // kind, alpha, HP chunk (share of the bar; 0 none), death 0…1
attribute vec4 aInfo;    // label (level; -seat-1 for "P n"), flags, HP tone, seat
attribute vec2 aChip;    // the lost segment's pop 0…~1.15 (curve), hit size 0…1
uniform vec4 uViewport;  // device px of the drawn viewport
uniform float uDpr;
varying vec2 vPx;
varying vec2 vSize;
varying vec4 vBar;
varying vec4 vLook;
varying vec4 vInfo;
varying vec2 vChip;
varying float vScale;
void main() {
  float kind = aLook.x;
  vec4 clip = projectionMatrix * viewMatrix * vec4(aAnchor.xyz, 1.0);
  // CSS px per world unit at this depth, so the width follows the body and clamps per kind.
  float ppu = uViewport.w * projectionMatrix[1][1] / (2.0 * clip.w) / uDpr;
  float body = aAnchor.w * ppu;
  // Per kind: bar size, the scale of its frame, badge, ticks and pips, and the px gap over the model.
  vec2 size;
  float s;
  float gap = 8.0;
  if (kind < 0.5) { size = vec2(clamp(body, 22.0, 44.0), 4.0); s = 1.4; }
  else if (kind < 2.5) { size = vec2(clamp(body, 40.0, 72.0), 7.0); s = 1.7; }
  else if (kind < 3.5) { size = vec2(clamp(body, 76.0, 104.0), 9.0); s = 1.9; gap = 10.0; }
  else { size = vec2(clamp(body, 64.0, 88.0), 8.0); s = 1.8; gap = 10.0; }
  vec4 margin; // left, right, bottom, top beyond the bar
  // Top and bottom leave room for the lost segment's pop (frame + POP_MAX with its overshoot).
  if (kind < 0.5) margin = vec4(2.0, 2.0, 7.0, 7.0);
  else if (kind < 2.5) margin = vec4(11.0, 3.0, 9.0, 9.0);
  else margin = vec4(30.0, 11.0, 7.0, 17.0);
  margin *= s;
  size.x = floor(size.x * 0.5 + 0.5) * 2.0;
  float pop = 1.0 + aLook.w * 0.35;
  size *= pop;
  vec2 lo = -size * 0.5 - margin.xz;
  vec2 hi = size * 0.5 + margin.yw;
  vec2 local = mix(lo, hi, position.xy + 0.5);
  // The bar's frame clears the model by \`gap\` px; its centre snaps to the device pixel grid.
  vec2 ndc = clip.xy / clip.w;
  vec2 dev = floor((ndc * 0.5 + 0.5) * uViewport.zw + 0.5);
  dev += (local + vec2(0.0, gap + 2.5 * s + size.y * 0.5)) * uDpr;
  clip.xy = ((dev / uViewport.zw) * 2.0 - 1.0) * clip.w;
  gl_Position = clip;
  vPx = local;
  vSize = size;
  vBar = aBar;
  vLook = aLook;
  vInfo = aInfo;
  vChip = aChip;
  vScale = s;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uDpr;
uniform vec3 uTheme;
uniform vec3 uThemeLight;
uniform vec3 uSeat[4];
varying vec2 vPx;
varying vec2 vSize;
varying vec4 vBar;
varying vec4 vLook;
varying vec4 vInfo;
varying vec2 vChip;
varying float vScale;

const vec3 NAVY = vec3(0.051, 0.137, 0.247);
const vec3 CLOUD = vec3(0.961, 0.984, 1.0);
const vec3 GOLD = vec3(1.0, 0.831, 0.357);

vec4 acc = vec4(0.0);
void paint(vec3 c, float a) {
  acc.rgb = c * a + acc.rgb * (1.0 - a);
  acc.a = a + acc.a * (1.0 - a);
}
float box(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - h + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float fw;
float cov(float d) { return clamp(0.5 - d / fw, 0.0, 1.0); }

// 3×5 pixel digits (and P), bit row * 3 + column, row 0 on top.
float glyph(float d) {
  if (d < 0.5) return 31599.0;
  if (d < 1.5) return 29850.0;
  if (d < 2.5) return 29671.0;
  if (d < 3.5) return 31207.0;
  if (d < 4.5) return 18925.0;
  if (d < 5.5) return 31183.0;
  if (d < 6.5) return 31695.0;
  if (d < 7.5) return 18727.0;
  if (d < 8.5) return 31727.0;
  if (d < 9.5) return 31215.0;
  return 5103.0;
}
/** Coverage of the label's pixel text centred on p = 0, \`n\` characters of \`cell\` px. */
float text(vec2 p, float value, float n, float cell) {
  float width = n * 4.0 * cell - cell;
  vec2 q = vec2(p.x + width * 0.5, cell * 2.5 - p.y) / cell;
  if (q.x < 0.0 || q.y < 0.0 || q.y >= 5.0 || q.x >= n * 4.0 - 1.0) return 0.0;
  float slot = floor(q.x / 4.0);
  float col = floor(q.x - slot * 4.0);
  if (col > 2.5) return 0.0;
  float ch;
  if (value < 0.0) ch = slot < 0.5 ? 10.0 : -value;
  else ch = mod(floor(value / pow(10.0, n - 1.0 - slot)), 10.0);
  float code = glyph(ch);
  float bit = floor(q.y) * 3.0 + col;
  return mod(floor(code / exp2(bit)), 2.0);
}

/** A status pip: a coloured disc with a white sign, radius r px. */
void pip(vec2 p, float r, float id, float line) {
  vec2 q = p / r;
  float d = length(p) - r;
  vec3 face;
  float mark;
  float ax = abs(q.x);
  if (id < 1.5) {
    // Poison: two bubbles.
    face = vec3(0.604, 0.31, 0.78);
    mark = max(cov((length(q - vec2(-0.2, -0.18)) - 0.34) * r), cov((length(q - vec2(0.32, 0.36)) - 0.18) * r));
  } else if (id < 2.5) {
    // Slowed: a chevron pointing down.
    face = vec3(0.85, 0.64, 0.0);
    mark = cov((abs(q.y - (ax * 0.9 - 0.3)) * 0.74 - 0.15) * r) * step(ax, 0.6);
  } else if (id < 3.5) {
    // X Speed: two chevrons pointing up.
    face = vec3(0.184, 0.561, 0.878);
    float upper = abs(q.y - (0.42 - ax * 0.9)) * 0.74 - 0.13;
    float lower = abs(q.y - (-0.05 - ax * 0.9)) * 0.74 - 0.13;
    mark = cov(min(upper, lower) * r) * step(ax, 0.6);
  } else if (id < 4.5) {
    // Dire Hit: a crosshair.
    face = vec3(0.878, 0.278, 0.353);
    mark = max(cov((abs(length(q) - 0.48) - 0.11) * r), cov((length(q) - 0.15) * r));
  } else {
    // Full Heal: a plus.
    face = vec3(0.086, 0.663, 0.604);
    mark = cov(max(min(ax, abs(q.y)) - 0.15, max(ax, abs(q.y)) - 0.55) * r);
  }
  paint(NAVY, cov(d - line));
  paint(face, cov(d));
  paint(vec3(1.0), mark * cov(d));
}

void main() {
  fw = max(fwidth(vPx.x), 0.35);
  float kind = vLook.x;
  bool ally = kind > 2.5;
  bool framed = kind > 0.5;
  float W = vSize.x;
  float H = vSize.y;
  vec2 p = vPx;
  float s = vScale;
  float flags = vInfo.y;
  vec3 seat = uSeat[int(clamp(vInfo.w, 0.0, 3.0))];
  bool guarded = mod(floor(flags / 64.0), 2.0) > 0.5;

  // Frame: a light capsule rim on a navy outline (ordinary enemies: the outline only).
  float d = box(p, vec2(W, H) * 0.5, H * 0.5);
  float rim = framed ? 1.5 * s : 0.0;
  vec3 frame = kind > 3.5 ? seat : CLOUD;
  if (guarded) frame = mix(GOLD, vec3(1.0), 0.5 + 0.5 * sin((p.x - p.y) * 0.35 / s - uTime * 7.0));
  // Players: a soft 3px (scaled) shade around the capsule lifts it off a field of enemy bars.
  if (ally) paint(NAVY, 0.4 * clamp(1.0 - (d - rim - s) / (3.0 * s), 0.0, 1.0));
  // Ordinary enemies: a lighter touch, so a damaged crowd reads as red marks, not a dark carpet.
  paint(NAVY, cov(d - rim - s) * (framed ? 1.0 : 0.7));
  if (framed) paint(frame, cov(d - rim));

  // Track and fill.
  float x = p.x + W * 0.5;
  float vy = (p.y + H * 0.5) / H;
  float hp = vBar.x * W, end = vBar.y * W, chip = vBar.z * W;
  vec3 track = NAVY * 0.8;
  vec3 light, base, deep;
  if (!ally) { light = vec3(1.0, 0.541, 0.478); base = vec3(0.851, 0.22, 0.31); deep = vec3(0.725, 0.149, 0.251); }
  else if (vInfo.z < 0.5) { light = vec3(0.608, 0.91, 0.518); base = vec3(0.31, 0.725, 0.322); deep = vec3(0.227, 0.604, 0.271); }
  else if (vInfo.z < 1.5) { light = vec3(1.0, 0.902, 0.561); base = vec3(0.96, 0.757, 0.18); deep = vec3(0.827, 0.604, 0.071); }
  else { light = vec3(1.0, 0.604, 0.533); base = vec3(0.878, 0.278, 0.353); deep = vec3(0.761, 0.184, 0.271); }
  vec3 fill = mix(deep, base, smoothstep(0.0, 0.55, vy));
  fill = mix(fill, light, smoothstep(0.6, 0.75, vy));
  vec3 c = track;
  float chipped = cov(x - chip) * (1.0 - cov(x - end));
  c = mix(c, mix(vec3(1.0, 0.6, 0.3), vec3(1.0), vBar.w), chipped);
  vec3 shield = mix(vec3(0.914, 0.957, 0.984), vec3(0.725, 0.894, 0.961), step(0.5, fract((p.x + p.y) / (4.0 * s))));
  c = mix(c, shield, cov(x - end));
  c = mix(c, fill, cov(x - hp));
  // HP chunks: short ticks every chunk, full-height ones every fourth; thinned out when crowded.
  float chunk = vLook.z * W;
  if (chunk > 0.0) {
    float k = x / chunk;
    float n = floor(k + 0.5);
    float dist = abs(k - n) * chunk;
    bool major = mod(n, 4.0) < 0.5;
    float show = major ? 1.0 : smoothstep(3.0 * s, 5.0 * s, chunk) * step(0.45, vy);
    float tick = cov(dist - 0.5 * s) * show * step(0.5, n) * step(x, end);
    c = mix(c, NAVY, tick * 0.6);
  }
  paint(c, cov(d) * (framed ? 1.0 : mix(0.5, 1.0, max(cov(x - end), chipped))));

  // The lost segment pops out past the frame, top and bottom, then settles back into the bar. Enemies
  // pop further than players (your own bar under chip damage must not jitter); bigger hits further.
  // A segment under a pixel wide keeps a pixel and fades by its width, rather than vanishing.
  float lost = (chip - end) * 0.5;
  float thin = clamp(2.0 * lost / fw, 0.0, 1.0);
  if (vChip.x > 0.001 && thin > 0.0) {
    float width = max(lost, 0.5 * fw);
    float frameOut = rim + s;
    float reach = (ally ? mix(0.4, 1.0, vChip.y) : mix(0.4, 1.4, vChip.y)) * s;
    float popY = H * 0.5 + (frameOut + reach) * vChip.x;
    float cd = box(p - vec2(end + lost - W * 0.5, 0.0), vec2(width, popY), min(width, popY));
    paint(NAVY, cov(cd - s) * thin);
    paint(mix(vec3(1.0, 0.6, 0.3), vec3(1.0), vBar.w * vBar.w), cov(cd) * thin);
  }

  // Elite: a diamond on the left end (violet; the alpha elite gold).
  if (kind > 0.5 && kind < 2.5) {
    vec2 q = p - vec2(-W * 0.5 - s, 0.0);
    float dd = (abs(q.x) + abs(q.y)) * 0.7071 - 4.2 * s;
    paint(NAVY, cov(dd - 2.2 * s));
    paint(CLOUD, cov(dd - 1.2 * s));
    paint(kind > 1.5 ? GOLD : vec3(0.604, 0.31, 0.78), cov(dd));
  }

  if (ally) {
    // Level badge (a teammate's: their seat) overlapping the left end.
    float label = vInfo.x;
    float n = label < 0.0 ? 2.0 : label < 9.5 ? 1.0 : label < 99.5 ? 2.0 : 3.0;
    float cell = max(1.0, floor(1.5 * s * uDpr + 0.5)) / uDpr;
    vec2 halfSize = vec2(max(cell * 2.5 + 2.5 * s, (n * 4.0 * cell - cell) * 0.5 + 3.0 * s), cell * 2.5 + 2.0 * s);
    vec2 bp = p - vec2(-W * 0.5 - halfSize.x + 4.0 * s, 0.0);
    float bd = box(bp, halfSize, halfSize.y);
    paint(NAVY, cov(bd - s));
    paint(kind > 3.5 ? seat : uTheme, cov(bd));
    paint(kind > 3.5 ? seat : NAVY, cov(bd + 1.5 * s));
    paint(kind > 3.5 ? NAVY : vec3(1.0), text(bp, label, n, cell));

    // Status pips over the bar, left-aligned.
    float r = 4.0 * s;
    float slot = 0.0;
    for (int i = 0; i < 5; i++) {
      if (mod(floor(flags / exp2(float(i))), 2.0) < 0.5) continue;
      vec2 at = vec2(-W * 0.5 + r + slot * (2.0 * r + 2.0 * s), H * 0.5 + rim + 2.5 * s + r);
      if (length(p - at) < r + 2.0 * s) pip(p - at, r, float(i + 1), s);
      slot += 1.0;
    }

    // Ultimate ready: a pulsing four-point spark on the right end.
    if (mod(floor(flags / 32.0), 2.0) > 0.5) {
      float pulse = 1.0 + 0.12 * sin(uTime * 4.5);
      float spark = 6.0 * s * pulse;
      vec2 q = (p - vec2(W * 0.5 + 2.0 * s, 0.5 * s)) / spark;
      float star = pow(abs(q.x), 0.55) + pow(abs(q.y), 0.55) - 1.0;
      float sd = star * spark * 0.6;
      paint(NAVY, cov(sd - 1.1 * s));
      paint(kind > 3.5 ? seat : uThemeLight, cov(sd));
      paint(vec3(1.0), cov(length(q) * spark - 1.3 * s));
    }
  }

  // An enemy's death: the bar pops, whitens and fades.
  acc.rgb = mix(acc.rgb, acc.rgb + vec3(0.6), vLook.w);
  float a = acc.a * vLook.y * (1.0 - vLook.w * 0.4);
  if (a < 0.003) discard;
  gl_FragColor = vec4(acc.rgb / max(acc.a, 1e-4), a);
}
`;
/**
 * How far the lost segment has popped past the frame, `cycle` seconds after its hit: a back-out
 * overshoot (about 1.1) over CHIP_POP, out through CHIP_HOLD, then an ease back over CHIP_SETTLE.
 */
export function chipPop(cycle: number): number {
  if (cycle < CHIP_POP) {
    const t = cycle / CHIP_POP - 1;
    const back = 2.2;
    return 1 + (back + 1) * t ** 3 + back * t ** 2;
  }
  const settling = cycle - CHIP_POP - CHIP_HOLD;
  return settling <= 0 ? 1 : Math.max(0, 1 - settling / CHIP_SETTLE) ** 2;
}

const seatColors = playerColors.map((hex) => new Color(hex));

export function createHealthBars(): HealthBars {
  const geometry = new PlaneGeometry(1, 1);
  const attribute = () =>
    new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(DynamicDrawUsage);
  const anchorAttr = attribute();
  const barAttr = attribute();
  const lookAttr = attribute();
  const infoAttr = attribute();
  geometry.setAttribute("aAnchor", anchorAttr);
  geometry.setAttribute("aBar", barAttr);
  geometry.setAttribute("aLook", lookAttr);
  geometry.setAttribute("aInfo", infoAttr);
  const chipAttr = new InstancedBufferAttribute(new Float32Array(CAPACITY * 2), 2).setUsage(
    DynamicDrawUsage,
  );
  geometry.setAttribute("aChip", chipAttr);
  const uniforms = {
    uViewport: { value: new Vector4(0, 0, 1, 1) },
    uDpr: { value: 1 },
    uTime: { value: 0 },
    uTheme: { value: new Color() },
    uThemeLight: { value: new Color() },
    uSeat: { value: seatColors },
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  // The matrix is unused (anchors carry the position); one identity instance keeps three's bounds happy.
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  mesh.frustumCulled = false;
  // Over the move effects and the local foot ring (60+), under the rescue beacons (900).
  mesh.renderOrder = 80;
  mesh.count = 0;
  const identity = new Matrix4();
  for (let i = 0; i < CAPACITY; i++) mesh.setMatrixAt(i, identity);
  const size = new Vector2();
  mesh.onBeforeRender = (renderer) => {
    const viewport = uniforms.uViewport.value;
    renderer.getCurrentViewport(viewport);
    if (viewport.z <= 0) {
      renderer.getDrawingBufferSize(size);
      viewport.set(0, 0, size.x, size.y);
    }
    // Pixels per CSS px of the bound target: the world target has its own resolution, not the canvas's.
    renderer.getSize(size);
    uniforms.uDpr.value = viewport.z / Math.max(1, size.x);
  };
  // The frame camera's ground-plane forward and pitch.
  const forward = new Vector3();
  let leanX = 0;
  let leanZ = 0;
  let leanUp = 1;
  let leanBack = 0;

  const bars = new Map<number, Bar>();
  const players = new Map<number, Bar>();
  const seen = new Set<number>();
  const revived = new Set<number>();
  /** Enemy bars to draw this frame, by draw order: dying, then ordinary, then elite (on top). */
  const tiers: Bar[][] = [[], [], []];
  let themeOf = "";
  // A new map's scene starts clean: the old map's dying or fading bars belong to entities left behind.
  mesh.addEventListener("added", () => {
    bars.clear();
    players.clear();
    mesh.count = 0;
  });

  function fresh(value: number, cap: number): Bar {
    return {
      value,
      chip: value,
      cycle: Infinity,
      flash: 0,
      size: 0,
      cap,
      shown: 0,
      opacity: 0,
      death: 0,
      alive: true,
      body: { x: 0, y: 0, z: 0, height: 0, radius: 0, yaw: null, profile: undefined },
      posed: false,
      hp: 0,
      shield: 0,
      total: cap,
      kind: Kind.Foe,
      label: 0,
      flags: 0,
      tone: 0,
    };
  }

  /** New damage starts (or joins) the chip's cycle: flash, pop, hold, then drain (DESIGN.md 掉血段). */
  function hit(bar: Bar, value: number): void {
    if (value < bar.value - 1e-4) {
      // A hit while the chip is still out or draining joins that cycle: restarting it per hit would
      // pin the chip at the pre-fight HP under steady fire.
      if (bar.chip <= bar.value + 1e-4) {
        bar.chip = bar.value;
        bar.cycle = 0;
      }
      bar.flash = 1;
      bar.shown = VISIBLE_FOR;
      // The whole cycle's loss sets the pop, so steady fire grows it rather than restarting it.
      bar.size = Math.min(1, (bar.chip - value) / bar.total / CHIP_BIG_HIT);
    }
    bar.value = value;
    // Heals shorten or clear the lost segment.
    if (bar.chip < value) bar.chip = value;
  }

  /** A new baseline, not a hit: max HP changed (an HP clamp), a revive, a knockout. */
  function reset(bar: Bar, value: number): void {
    bar.value = bar.chip = value;
    bar.cycle = Infinity;
    bar.flash = bar.size = 0;
  }

  function age(bar: Bar, dt: number): void {
    bar.cycle += dt;
    if (bar.cycle >= CHIP_POP + CHIP_HOLD)
      bar.chip = Math.max(
        bar.value,
        bar.chip - (bar.chip - bar.value + 0.04 * bar.total) * CHIP_DRAIN * dt,
      );
    if (bar.chip <= bar.value) bar.cycle = Infinity;
    bar.flash = Math.max(0, bar.flash - dt * 5);
    bar.shown -= dt;
  }

  function pose(bar: Bar, drawn: DrawnBody | undefined): void {
    bar.posed = drawn !== undefined;
    if (drawn) Object.assign(bar.body, drawn);
  }

  /**
   * The anchor: the point of the drawn body that reaches highest on screen, its top or a lower band
   * reaching back from the camera (a tail flame, wings), for its facing (a player: the bar keeps its gap
   * as the body turns) or, without one, its worst facing (a crowd's bars stay put).
   */
  function crest(index: number, body: DrawnBody): void {
    const { profile, yaw, height } = body;
    let best = leanUp;
    let rise = 1;
    let reach = 0;
    if (profile) {
      let k = 0;
      let f = 0;
      if (yaw !== null) {
        // The camera's back direction in model space, as a fractional index into the directions.
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const turn = Math.atan2(leanX * cos - leanZ * sin, leanX * sin + leanZ * cos);
        const t =
          ((((turn / (2 * Math.PI)) * PROFILE_DIRS) % PROFILE_DIRS) + PROFILE_DIRS) % PROFILE_DIRS;
        k = Math.floor(t);
        f = t - k;
      }
      for (let band = 0; band < PROFILE_BANDS; band++) {
        const row = band * PROFILE_DIRS;
        const r =
          yaw === null
            ? profile.worst[band]!
            : profile.reach[row + k]! * (1 - f) +
              profile.reach[row + ((k + 1) % PROFILE_DIRS)]! * f;
        const top = band === PROFILE_BANDS - 1 ? profile.top : (band + 1) / PROFILE_BANDS;
        const score = top * leanUp + r * leanBack;
        if (score >= best) {
          best = score;
          rise = top;
          reach = r;
        }
      }
    }
    const anchor = anchorAttr.array as Float32Array;
    const o = index * 4;
    anchor[o] = body.x + leanX * reach * height;
    anchor[o + 1] = body.y + rise * height * POSE_ROOM;
    anchor[o + 2] = body.z + leanZ * reach * height;
  }

  function trackEnemy(enemy: Enemy, frame: BarFrame): void {
    const hp = Math.max(0, enemy.hp);
    let bar = bars.get(enemy.id);
    if (!bar) {
      if (hp >= enemy.maxHp && !enemy.elite) return;
      bar = fresh(enemy.maxHp, enemy.maxHp);
      bars.set(enemy.id, bar);
    }
    if (bar.cap !== enemy.maxHp) {
      bar.cap = bar.total = enemy.maxHp;
      reset(bar, hp);
    } else hit(bar, hp);
    pose(bar, frame.enemies.get(enemy.id));
    bar.hp = hp;
    bar.shield = 0;
    bar.kind = enemy.alpha ? Kind.Alpha : enemy.elite ? Kind.Elite : Kind.Foe;
    // An elite keeps its bar up; underground, a bar would float over an empty spot.
    if (enemy.elite) bar.shown = VISIBLE_FOR;
    if (!targetable(enemy)) bar.shown = 0;
  }

  function trackPlayer(world: World, player: Player, local: number, frame: BarFrame): Bar | null {
    let bar = players.get(player.id);
    const present = !player.departed && (player.alive || canBeRescued(world, player));
    if (!present) {
      players.delete(player.id);
      return null;
    }
    const stats = currentStats(player, activeWeather(world));
    const hp = player.alive ? Math.max(0, player.hp) : 0;
    const shield = player.alive ? Math.max(0, player.shield) : 0;
    if (!bar) {
      bar = fresh(hp + shield, stats.maxHp);
      players.set(player.id, bar);
    }
    bar.total = Math.max(stats.maxHp, hp + shield);
    // Knocked out, the capsule just empties; a lost-HP segment would read as a hit still landing.
    if (!player.alive) reset(bar, 0);
    else if (bar.cap !== stats.maxHp || revived.has(player.id)) reset(bar, hp + shield);
    else hit(bar, hp + shield);
    bar.cap = stats.maxHp;
    pose(bar, frame.players.get(player.id));
    bar.hp = hp;
    bar.shield = shield;
    const self = player.id === local;
    bar.kind = self ? Kind.Self : Kind.Mate;
    bar.label = self ? player.level : -(player.id + 1);
    const share = hp / stats.maxHp;
    bar.tone = share < HP_RED ? 2 : share < HP_YELLOW ? 1 : 0;
    // A downed player's bar is only the empty, faded capsule: statuses and buffs have no target.
    let flags = 0;
    if (player.alive) {
      for (const status of player.statuses) flags |= status.id === "poison" ? POISON : SLOW;
      if (player.assistBuffs.xSpeed) flags |= X_SPEED;
      if (player.assistBuffs.direHit) flags |= DIRE_HIT;
      if (player.assistBuffs.fullHeal) flags |= FULL_HEAL;
      if (player.ult.charge >= 1 && player.ult.elapsed < 0) flags |= ULT_READY;
      // A hit's own i-frames are too short to read; longer grants and the ultimate's guard show.
      if (player.ult.protection > 0 || player.invulnerable > PLAYER_IFRAMES) flags |= GUARDED;
    }
    bar.flags = flags;
    bar.shown = player.alive ? 1 : 0.7;
    return bar;
  }

  function write(index: number, bar: Bar, fade: number): void {
    const o = index * 4;
    const anchor = anchorAttr.array as Float32Array;
    const bar4 = barAttr.array as Float32Array;
    const look = lookAttr.array as Float32Array;
    const info = infoAttr.array as Float32Array;
    const total = Math.max(1e-6, bar.total);
    crest(index, bar.body);
    anchor[o + 3] = bar.body.radius * (bar.kind >= Kind.Self ? 2.6 : 2.1);
    bar4[o] = bar.hp / total;
    bar4[o + 1] = (bar.hp + bar.shield) / total;
    bar4[o + 2] = bar.chip / total;
    bar4[o + 3] = bar.flash;
    look[o] = bar.kind;
    look[o + 1] = fade;
    look[o + 2] = bar.kind >= Kind.Self ? HP_CHUNK / total : 0;
    look[o + 3] = bar.alive ? 0 : 1 - bar.death / DEATH_TIME;
    info[o] = bar.label;
    info[o + 1] = bar.flags;
    info[o + 2] = bar.tone;
    info[o + 3] = bar.kind === Kind.Mate ? -bar.label - 1 : 0;
    const chip = chipAttr.array as Float32Array;
    chip[index * 2] = chipPop(bar.cycle);
    chip[index * 2 + 1] = bar.size;
  }

  return {
    mesh,
    update(world, local, dt, frame) {
      uniforms.uTime.value = world.time;
      frame.camera.getWorldDirection(forward);
      const flat = Math.hypot(forward.x, forward.z);
      if (flat > 1e-4) {
        leanX = forward.x / flat;
        leanZ = forward.z / flat;
        leanUp = flat;
        leanBack = -forward.y;
      }
      revived.clear();
      for (const event of frame.events) if (event.t === "revive") revived.add(event.player);
      seen.clear();
      for (const enemy of world.enemies) {
        if (enemy.boss) continue;
        seen.add(enemy.id);
        trackEnemy(enemy, frame);
      }
      for (const tier of tiers) tier.length = 0;
      for (const [id, bar] of bars) {
        if (!seen.has(id) && bar.alive) {
          bar.alive = false;
          hit(bar, 0);
          bar.hp = 0;
          bar.death = DEATH_TIME;
          bar.shown = DEATH_TIME;
        }
        age(bar, dt);
        if (!bar.alive) bar.death -= dt;
        // A quiet bar stays tracked (just hidden) so its next hit chips from the real HP, not from full.
        if (!bar.alive && bar.death <= 0) {
          bars.delete(id);
          continue;
        }
        const target = Math.max(0, Math.min(1, bar.shown / FADE_OUT));
        bar.opacity = target > bar.opacity ? Math.min(target, bar.opacity + dt / FADE_IN) : target;
        if (bar.opacity > 0 && bar.posed)
          tiers[!bar.alive ? 0 : bar.kind === Kind.Foe ? 1 : 2]!.push(bar);
      }
      // Over capacity, elites keep their bars first, then live enemies; dying bars give way.
      let room = ENEMY_CAPACITY;
      const [dying, foes, elites] = tiers as [Bar[], Bar[], Bar[]];
      const elitesShown = Math.min(elites.length, room);
      room -= elitesShown;
      const foesShown = Math.min(foes.length, room);
      room -= foesShown;
      const dyingShown = Math.min(dying.length, room);
      let count = 0;
      for (let i = 0; i < dyingShown; i++) {
        const bar = dying[i]!;
        write(count++, bar, bar.opacity * (bar.death / DEATH_TIME));
      }
      for (let i = 0; i < foesShown; i++) write(count++, foes[i]!, foes[i]!.opacity);
      for (let i = 0; i < elitesShown; i++) write(count++, elites[i]!, elites[i]!.opacity);
      // Teammates over the crowd, your own bar on top of everything.
      const self = world.players[local];
      for (const player of world.players) {
        const bar = trackPlayer(world, player, local, frame);
        if (!bar) continue;
        age(bar, dt);
        if (player !== self && bar.posed) write(count++, bar, bar.shown * 0.92);
      }
      const own = self && players.get(self.id);
      if (self && own?.posed) {
        const theme = themeColors(formOf(self).types[0]!);
        if (theme.theme !== themeOf) {
          themeOf = theme.theme;
          uniforms.uTheme.value.set(theme.theme);
          uniforms.uThemeLight.value.set(theme.light);
        }
        write(count++, own, own.shown);
      }
      mesh.count = count;
      anchorAttr.needsUpdate = true;
      barAttr.needsUpdate = true;
      lookAttr.needsUpdate = true;
      infoAttr.needsUpdate = true;
      chipAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
