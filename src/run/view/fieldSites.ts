import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  type Material,
  type MeshLambertMaterial,
} from "three";
import { SITE } from "../sim/content/params/sites";
import { formOf } from "../sim/evolution";
import { TICK, type World } from "../sim/state/world";
import type { Site, SiteKind } from "../sim/state/field";
import type { RunEvent } from "../sim/state/events";
import type { InstanceSource } from "./assets";
import { shadeUnderClouds } from "./environment/clouds";
import type { WindUniforms } from "./environment/wind";
import { creatureLook, lambertCopy, ownShadowDepth } from "./materials";

/** Prop models of the field sites (`public/models/field-sites`), keyed by model name. */
export type SiteModel =
  | "honey-tree"
  | "item-ball"
  | "fishing"
  | "fossil"
  | "raid-den"
  | "spring"
  | "egg"
  | "gengar-altar";

/** Which prop draws each kind; Snorlax sleeps as its own species model, the glint is light only. */
export const siteModelOf: Record<SiteKind, SiteModel | "snorlax" | null> = {
  "honey-tree": "honey-tree",
  "item-ball": "item-ball",
  snorlax: "snorlax",
  fishing: "fishing",
  fossil: "fossil",
  "raid-den": "raid-den",
  spring: "spring",
  egg: "egg",
  glint: null,
  ghost: "gengar-altar",
  "silph-scope": "item-ball",
};

const GOLD = "#ffd45b",
  AMBER = "#ffb02e",
  RED = "#ff4a3d",
  ICE = "#bff4ff",
  RAID = "#ff4f8b",
  PURPLE = "#9a6bff",
  HEAL = "#7ff0d0",
  SCOPE = "#8fe3ff";

export type SiteEmit =
  | "honey"
  | "sleep"
  | "notes"
  | "ripple"
  | "dust"
  | "heal"
  | "den"
  | "ghost"
  | "scope";
export interface SiteRing {
  radius: number;
  /** Share of the ring lit, clockwise from the far side (0–1). */
  fill: number;
  color: string;
  alpha: number;
  /** Band width as a share of the radius. */
  width: number;
  /** Inner wash under the lit share, for warnings (0–1). */
  wash: number;
}
/** How a site draws at one moment: a pure reading of its shared state, nothing kept. */
export interface SiteLook {
  show: boolean;
  /** Brightness of the prop: 1 usable, lower for dormant or used up. */
  tone: number;
  shake: number;
  /** A trap's red blink (0/1), or the glint's flash (1 → 0). */
  flash: number;
  bob: number;
  beam: number;
  emit: SiteEmit | null;
  /** Particles a second. */
  rate: number;
  rings: SiteRing[];
}

const pulseAt = (elapsed: number, period = 1.6) =>
  0.5 + 0.5 * Math.sin((elapsed / period) * Math.PI * 2);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The visual state of `site` at `time` (world seconds, interpolated), `elapsed` the view clock for
 * idle loops. Dormant sites are dark and inert, spent ones dimmed or gone: neither offers a ring.
 */
export function siteLook(site: Site, time: number, elapsed = 0): SiteLook {
  const look: SiteLook = {
    show: true,
    tone: 1,
    shake: 0,
    flash: 0,
    bob: 0,
    beam: 0,
    emit: null,
    rate: 0,
    rings: [],
  };
  const radius = SITE.radius[site.kind];
  const ready = (r = radius + 0.4) =>
    look.rings.push({
      radius: r,
      fill: 1,
      color: GOLD,
      alpha: 0.3 + 0.3 * pulseAt(elapsed),
      width: 0.1,
      wash: 0,
    });
  const left = Math.max(0, site.until - time);
  const waiting = site.data.enemy === null;
  if (site.state === "dormant") {
    look.tone = 0.5;
    look.show = site.kind !== "glint";
    return look;
  }
  if (site.state === "spent") {
    look.tone = 0.42;
    look.show = !["item-ball", "egg", "glint", "silph-scope", "snorlax"].includes(site.kind);
    return look;
  }
  const busy = site.state === "busy";
  switch (site.kind) {
    case "honey-tree":
      if (!busy) {
        ready(radius + 0.7);
        Object.assign(look, { emit: "honey", rate: 0.6 });
      } else if (waiting) {
        // Eight seconds of a tree shaking harder as its visitor comes down.
        const p = clamp01(1 - left / SITE.honeyDelay);
        Object.assign(look, { shake: 0.15 + 0.85 * p * p, emit: "honey", rate: 2 + 10 * p });
        look.rings.push({
          radius: radius + 0.9,
          fill: p,
          color: AMBER,
          alpha: 0.9,
          width: 0.1,
          wash: 0.08,
        });
      }
      break;
    case "item-ball":
      // A trap and a reward look the same until the trap goes off.
      if (!busy) look.bob = 1;
      else {
        const p = clamp01(1 - left / SITE.balls.warning);
        look.flash = Math.sin(elapsed * (18 + 40 * p)) > 0 ? 1 : 0;
        look.shake = 0.3 + 0.7 * p;
        look.rings.push({
          radius: SITE.balls.blastRadius,
          fill: p,
          color: RED,
          alpha: 0.95,
          width: 0.05,
          wash: 0.22,
        });
      }
      break;
    case "snorlax":
      if (!busy) {
        ready(radius + 0.6);
        Object.assign(look, { emit: "sleep", rate: 0.7 });
      } else if (waiting) {
        // The Poké Flute: notes rise and Snorlax stirs before it stands up.
        const p = clamp01(1 - left / SITE.warning);
        Object.assign(look, { shake: 0.5 + 0.5 * p, emit: "notes", rate: 14 });
        look.rings.push({
          radius: radius + 0.7,
          fill: p,
          color: GOLD,
          alpha: 0.95,
          width: 0.1,
          wash: 0.1,
        });
      } else look.show = false;
      break;
    case "fishing":
      if (!busy) {
        ready(1.1);
        Object.assign(look, { emit: "ripple", rate: 0.5 });
      } else if (waiting && site.data.progress < SITE.fishing.channel) {
        const p = clamp01(site.data.progress / SITE.fishing.channel);
        look.rings.push({ radius: 1.2, fill: p, color: ICE, alpha: 0.95, width: 0.12, wash: 0 });
        Object.assign(look, { bob: 0.5, emit: "ripple", rate: 2.5 });
      }
      break;
    case "fossil": {
      const p = clamp01(site.data.progress / SITE.fossilChannel);
      if (!busy) {
        ready(radius + 0.6);
        // Interrupted digging keeps its progress, shown as a dim arc.
        if (p > 0)
          look.rings.push({
            radius: radius + 0.85,
            fill: p,
            color: ICE,
            alpha: 0.45,
            width: 0.1,
            wash: 0,
          });
        Object.assign(look, { emit: "dust", rate: 0.4 });
      } else if (waiting) {
        look.rings.push({
          radius: radius + 0.85,
          fill: p,
          color: ICE,
          alpha: 0.95,
          width: 0.1,
          wash: 0,
        });
        // The rock cracks before the fossil breaks free.
        Object.assign(look, {
          shake: 0.2 + (p > 0.85 ? 0.6 : 0),
          emit: "dust",
          rate: 6 + (p > 0.85 ? 24 : 0),
        });
      }
      break;
    }
    case "raid-den":
      if (!busy) {
        ready(radius + 0.5);
        Object.assign(look, { beam: 0.4 + 0.15 * pulseAt(elapsed, 2.2), emit: "den", rate: 0.8 });
      } else if (waiting) {
        const p = clamp01(1 - left / SITE.warning);
        Object.assign(look, { beam: 0.6 + 0.4 * p, shake: 0.3 * p, emit: "den", rate: 18 });
        look.rings.push({
          radius: radius + 0.6,
          fill: p,
          color: RAID,
          alpha: 0.95,
          width: 0.1,
          wash: 0.15,
        });
      } else {
        // The time limit: the ring drains around the den.
        look.beam = 0.25;
        look.rings.push({
          radius: radius + 1.4,
          fill: clamp01(left / SITE.raid.seconds),
          color: RAID,
          alpha: 0.8,
          width: 0.05,
          wash: 0,
        });
      }
      break;
    case "spring":
      ready(radius + 0.6);
      Object.assign(look, { emit: "heal", rate: 0.9 });
      break;
    case "egg": {
      ready(radius + 0.4);
      const phase = (elapsed + site.id * 0.7) % 3;
      look.shake = phase < 0.6 ? 0.6 * Math.sin((phase / 0.6) * Math.PI) : 0;
      break;
    }
    case "glint": {
      look.show = false;
      const phase = (time + site.id * 0.37) % SITE.glintSeconds;
      look.flash = phase < 0.35 ? 1 - phase / 0.35 : 0;
      break;
    }
    case "ghost":
      if (!busy) {
        ready(radius + 0.7);
        Object.assign(look, { emit: "ghost", rate: 0.8 });
      } else if (waiting) {
        const p = clamp01(1 - left / SITE.warning);
        Object.assign(look, { shake: 0.4 + 0.6 * p, emit: "ghost", rate: 12 });
        look.rings.push({
          radius: radius + 0.8,
          fill: p,
          color: PURPLE,
          alpha: 0.95,
          width: 0.1,
          wash: 0.12,
        });
      }
      break;
    case "silph-scope":
      Object.assign(look, { bob: 1, beam: 0.5, emit: "scope", rate: 1 });
      break;
  }
  return look;
}

/** Heights of each prop in world units (assets/field-models.provenance.json, scripted props in metres). */
export const siteModelHeight: Record<SiteModel, number> = {
  "honey-tree": 2.8,
  "item-ball": 0.42,
  fishing: 1.9,
  fossil: 0.62,
  "raid-den": 1.17,
  spring: 0.86,
  egg: 0.6,
  "gengar-altar": 1.3,
};

const hashYaw = (id: number) => (id * 2.39996) % (Math.PI * 2);

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  age: number;
  life: number;
  size: number;
  color: Color;
}
interface Pulse {
  x: number;
  z: number;
  age: number;
  life: number;
  from: number;
  to: number;
  color: Color;
  alpha: number;
}
interface Prop {
  root: Group;
  mesh: Mesh;
  material: MeshLambertMaterial;
  base: Color;
  depth: Material | null;
  kind: SiteKind;
  state: Site["state"];
  emitted: number;
  flash: number;
  scale: number;
}

const RING_CAP = 64,
  SPARK_CAP = 256,
  BEAM_CAP = 8;

const ringVertex = /* glsl */ `
  attribute vec4 aColor; attribute vec4 aRing;
  varying vec4 vColor; varying vec4 vRing; varying vec2 vP;
  void main() {
    vColor = aColor; vRing = aRing; vP = vec2(position.x, -position.z);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.);
  }`;
const ringFragment = /* glsl */ `
  varying vec4 vColor; varying vec4 vRing; varying vec2 vP;
  void main() {
    float r = length(vP); float aa = fwidth(r) * 1.2;
    float band = smoothstep(1. - vRing.y - aa, 1. - vRing.y + aa, r) * (1. - smoothstep(1. - aa, 1. + aa, r));
    float angle = fract(atan(vP.x, vP.y) / 6.2831853 + 1.);
    float lit = 1. - smoothstep(vRing.x - .004, vRing.x + .004, angle);
    float a = band * mix(.28, 1., lit) + vRing.z * lit * (1. - smoothstep(1. - vRing.y - aa, 1. - vRing.y, r));
    a *= vColor.a;
    if (a <= .002) discard;
    gl_FragColor = vec4(vColor.rgb, a);
  }`;
const sparkVertex = /* glsl */ `
  attribute vec4 aColor; varying vec4 vColor; varying vec2 vP;
  void main() {
    vColor = aColor; vP = position.xy * 2.;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
    mv.xy += position.xy * length(instanceMatrix[0].xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const sparkFragment = /* glsl */ `
  varying vec4 vColor; varying vec2 vP;
  void main() {
    float r = length(vP);
    float star = max(0., 1. - abs(vP.x * vP.y) * 14. - r * .9);
    float core = exp(-r * r * 9.);
    float a = clamp(star + core, 0., 1.) * vColor.a;
    if (a <= .002) discard;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }`;
const beamVertex = /* glsl */ `
  attribute vec4 aColor; varying vec4 vColor; varying float vY;
  void main() {
    vColor = aColor; vY = uv.y;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.);
  }`;
const beamFragment = /* glsl */ `
  varying vec4 vColor; varying float vY;
  void main() {
    float a = pow(1. - vY, 1.6) * vColor.a;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }`;

export interface FieldSites {
  readonly root: Group;
  frame(world: World, alpha: number, elapsed: number, dt: number): void;
  handle(event: RunEvent, world: World): void;
  /** A star burst (shiny entrances, reveals, hatching). */
  burst(x: number, y: number, z: number, color: string, count: number, speed: number): void;
  /** One lingering twinkle (a shiny's sparkle). */
  twinkle(x: number, y: number, z: number, color: string, size: number): void;
  dispose(): void;
}

/** The field sites drawn from the shared world: props, readable state rings and their light. */
export function createFieldSites(
  sources: Partial<Record<SiteModel | "snorlax", InstanceSource>>,
  ground: (x: number, z: number) => number,
  wind: WindUniforms,
): FieldSites {
  const root = new Group();
  const dummy = new Object3D();
  const color = new Color();
  const props = new Map<number, Prop>();
  const carried = new Map<number, Prop>();

  const ringGeometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const ringColor = new InstancedBufferAttribute(new Float32Array(RING_CAP * 4), 4).setUsage(
    DynamicDrawUsage,
  );
  const ringData = new InstancedBufferAttribute(new Float32Array(RING_CAP * 4), 4).setUsage(
    DynamicDrawUsage,
  );
  ringGeometry.setAttribute("aColor", ringColor);
  ringGeometry.setAttribute("aRing", ringData);
  const ringMaterial = new ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const rings = new InstancedMesh(ringGeometry, ringMaterial, RING_CAP);
  rings.instanceMatrix.setUsage(DynamicDrawUsage);
  rings.frustumCulled = false;
  rings.count = 0;

  const sparkGeometry = new PlaneGeometry(1, 1);
  const sparkColor = new InstancedBufferAttribute(new Float32Array(SPARK_CAP * 4), 4).setUsage(
    DynamicDrawUsage,
  );
  sparkGeometry.setAttribute("aColor", sparkColor);
  const sparkMaterial = new ShaderMaterial({
    vertexShader: sparkVertex,
    fragmentShader: sparkFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const sparkMesh = new InstancedMesh(sparkGeometry, sparkMaterial, SPARK_CAP);
  sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  sparkMesh.frustumCulled = false;
  sparkMesh.count = 0;

  const beamGeometry = new CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  const beamColor = new InstancedBufferAttribute(new Float32Array(BEAM_CAP * 4), 4).setUsage(
    DynamicDrawUsage,
  );
  beamGeometry.setAttribute("aColor", beamColor);
  const beamMaterial = new ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const beams = new InstancedMesh(beamGeometry, beamMaterial, BEAM_CAP);
  beams.instanceMatrix.setUsage(DynamicDrawUsage);
  beams.frustumCulled = false;
  beams.count = 0;
  root.add(rings, sparkMesh, beams);

  const sparks: Spark[] = [];
  const pulses: Pulse[] = [];
  const glints = new Map<number, number>();
  let scope = false;

  function spark(spec: Omit<Spark, "age" | "color"> & { color: string }): void {
    if (sparks.length >= SPARK_CAP) sparks.shift();
    sparks.push({ ...spec, age: 0, color: new Color(spec.color) });
  }
  function pulse(
    x: number,
    z: number,
    from: number,
    to: number,
    hex: string,
    life = 0.7,
    alpha = 0.9,
  ): void {
    if (pulses.length >= 16) pulses.shift();
    pulses.push({ x, z, from, to, age: 0, life, color: new Color(hex), alpha });
  }
  function burst(x: number, y: number, z: number, hex: string, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const up = 0.4 + Math.random() * 0.8;
      spark({
        x,
        y,
        z,
        vx: Math.cos(a) * speed,
        vy: up * speed,
        vz: Math.sin(a) * speed,
        gravity: 1.5,
        life: 0.6 + Math.random() * 0.4,
        size: 0.22 + Math.random() * 0.12,
        color: hex,
      });
    }
  }
  function twinkle(x: number, y: number, z: number, hex: string, size: number): void {
    spark({ x, y, z, vx: 0, vy: 0.2, vz: 0, gravity: 0, life: 0.5, size, color: hex });
  }

  function emit(kind: SiteEmit, site: Site, height: number): void {
    const r = SITE.radius[site.kind];
    const jitter = (s: number) => (Math.random() - 0.5) * s;
    const base = ground(site.x, site.z);
    switch (kind) {
      case "honey":
        return spark({
          x: site.x + jitter(r * 2.4),
          y: base + height * (0.55 + Math.random() * 0.3),
          z: site.z + jitter(r * 2.4),
          vx: 0,
          vy: -0.9,
          vz: 0,
          gravity: 0.6,
          life: 1.4,
          size: 0.13,
          color: AMBER,
        });
      case "sleep":
        return spark({
          x: site.x + jitter(0.4),
          y: base + 0.9,
          z: site.z + jitter(0.4),
          vx: 0.15,
          vy: 0.45,
          vz: 0,
          gravity: 0,
          life: 2,
          size: 0.2,
          color: "#cfe6ff",
        });
      case "notes":
        return spark({
          x: site.x + jitter(1.2),
          y: base + 0.6,
          z: site.z + jitter(1.2),
          vx: jitter(0.6),
          vy: 1.8,
          vz: jitter(0.6),
          gravity: 0,
          life: 0.9,
          size: 0.24,
          color: GOLD,
        });
      case "ripple":
        return pulse(site.x + jitter(0.6), site.z + jitter(0.6), 0.2, 0.9, ICE, 1.3, 0.55);
      case "dust":
        return spark({
          x: site.x + jitter(r * 2),
          y: base + 0.1,
          z: site.z + jitter(r * 2),
          vx: jitter(1),
          vy: 1.6 + Math.random(),
          vz: jitter(1),
          gravity: 4.5,
          life: 0.7,
          size: 0.1,
          color: "#e2c08c",
        });
      case "heal":
        return spark({
          x: site.x + jitter(r * 2),
          y: base + 0.3,
          z: site.z + jitter(r * 2),
          vx: 0,
          vy: 0.8,
          vz: 0,
          gravity: 0,
          life: 1.5,
          size: 0.17,
          color: HEAL,
        });
      case "den":
        return spark({
          x: site.x + jitter(r * 1.4),
          y: base + 0.3,
          z: site.z + jitter(r * 1.4),
          vx: 0,
          vy: 2.4,
          vz: 0,
          gravity: 0,
          life: 1.1,
          size: 0.15,
          color: RAID,
        });
      case "ghost":
        return spark({
          x: site.x + jitter(1),
          y: base + 0.4,
          z: site.z + jitter(1),
          vx: jitter(0.3),
          vy: 0.6,
          vz: jitter(0.3),
          gravity: 0,
          life: 1.6,
          size: 0.2,
          color: PURPLE,
        });
      case "scope":
        return spark({
          x: site.x + jitter(0.6),
          y: base + 0.3 + Math.random() * 0.6,
          z: site.z + jitter(0.6),
          vx: 0,
          vy: 0.3,
          vz: 0,
          gravity: 0,
          life: 0.8,
          size: 0.16,
          color: SCOPE,
        });
    }
  }

  function makeProp(kind: SiteKind, model: SiteModel | "snorlax", seed: number): Prop | null {
    const source = sources[model];
    if (!source) return null;
    const material = lambertCopy(source.material);
    if (model === "snorlax") creatureLook(material);
    shadeUnderClouds(material, wind);
    const mesh = new Mesh(source.geometry, material);
    const group = new Group();
    let scale = 1;
    if (model === "snorlax") {
      // Asleep on its back: the unit-height model laid along its length, belly up.
      const box =
        source.geometry.boundingBox ??
        (source.geometry.computeBoundingBox(), source.geometry.boundingBox!);
      scale = SITE.radius.snorlax * 2.3;
      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.setScalar(scale);
      mesh.position.set(0, -box.min.z * scale, 0.5 * scale);
    } else if (kind === "silph-scope") {
      scale = 0.85;
      material.color.setRGB(0.55, 0.85, 1.25);
    }
    group.rotation.y = hashYaw(seed);
    group.add(mesh);
    const casts =
      model === "honey-tree" ||
      model === "raid-den" ||
      model === "fishing" ||
      model === "gengar-altar" ||
      model === "snorlax";
    mesh.castShadow = casts;
    mesh.receiveShadow = true;
    root.add(group);
    return {
      root: group,
      mesh,
      material,
      base: material.color.clone(),
      depth: casts ? ownShadowDepth(mesh) : null,
      kind,
      state: "ready",
      emitted: 0,
      flash: 0,
      scale,
    };
  }

  function dropProp(prop: Prop): void {
    prop.root.removeFromParent();
    prop.material.dispose();
    prop.depth?.dispose();
  }

  function frame(world: World, alpha: number, elapsed: number, dt: number): void {
    const time = world.time - (1 - alpha) * TICK;
    let ringCount = 0,
      beamCount = 0;
    const ring = (x: number, z: number, spec: SiteRing) => {
      if (ringCount >= RING_CAP) return;
      dummy.position.set(x, ground(x, z) + 0.06, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(spec.radius);
      dummy.updateMatrix();
      rings.setMatrixAt(ringCount, dummy.matrix);
      color.set(spec.color);
      ringColor.setXYZW(ringCount, color.r, color.g, color.b, spec.alpha);
      ringData.setXYZW(ringCount, spec.fill, spec.width, spec.wash, 0);
      ringCount++;
    };
    const seen = new Set<number>();
    for (const site of world.sites) {
      seen.add(site.id);
      const look = siteLook(site, time, elapsed);
      const model = siteModelOf[site.kind];
      let prop = props.get(site.id);
      if (!prop && model) {
        const made = makeProp(site.kind, model, site.id);
        if (made) props.set(site.id, (prop = made));
      }
      const base = ground(site.x, site.z);
      if (prop) {
        prop.root.visible = look.show;
        prop.root.position.set(
          site.x,
          base + look.bob * (0.06 + 0.06 * Math.sin(elapsed * 3 + site.id)),
          site.z,
        );
        const shake = look.shake;
        prop.root.rotation.z = Math.sin(elapsed * 29 + site.id) * 0.07 * shake;
        prop.root.rotation.x = Math.cos(elapsed * 23 + site.id) * 0.05 * shake;
        const swell = 1 + (site.kind === "item-ball" ? 0.25 * shake : 0);
        if (site.kind === "snorlax")
          prop.mesh.scale.set(
            prop.scale,
            prop.scale,
            prop.scale * (1 + 0.04 * Math.sin(elapsed * 1.6)),
          );
        else prop.root.scale.setScalar(swell * prop.scale);
        prop.material.color.copy(prop.base).multiplyScalar(look.tone);
        prop.material.emissive.setRGB(look.flash * 0.9, look.flash * 0.08, look.flash * 0.04);
        // A trap that went off leaves sparks; a used spring or a dug fossil shows its end too.
        if (prop.state === "busy" && site.state === "spent" && site.kind === "item-ball") {
          burst(site.x, base + 0.3, site.z, "#ff8a3d", 18, 3.2);
          pulse(site.x, site.z, 0.4, SITE.balls.blastRadius, RED, 0.45);
        }
        prop.state = site.state;
      }
      if (look.show || site.kind === "glint") {
        for (const spec of look.rings) ring(site.x, site.z, spec);
        if (look.beam > 0 && beamCount < BEAM_CAP) {
          const r = site.kind === "raid-den" ? 1.1 : 0.25;
          dummy.position.set(site.x, base, site.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(r, site.kind === "raid-den" ? 7 : 3, r);
          dummy.updateMatrix();
          beams.setMatrixAt(beamCount, dummy.matrix);
          color.set(site.kind === "raid-den" ? RAID : SCOPE);
          beamColor.setXYZW(beamCount, color.r, color.g, color.b, 0.55 * look.beam);
          beamCount++;
        }
        if (look.emit && dt > 0) {
          const entry = prop ?? { emitted: 0 };
          entry.emitted += look.rate * dt;
          const height = model && model !== "snorlax" ? siteModelHeight[model] : 1;
          while (entry.emitted >= 1) {
            entry.emitted -= 1;
            emit(look.emit, site, height);
          }
        }
      }
      // The glint: one short flash every two seconds, then nothing.
      if (site.kind === "glint") {
        const cycle = Math.floor((time + site.id * 0.37) / SITE.glintSeconds);
        const was = glints.get(site.id);
        if (site.state === "ready" && (was === undefined ? look.flash > 0 : cycle !== was)) {
          burst(site.x, base + 0.15, site.z, "#fffbe0", 7, 1.1);
          twinkle(site.x, base + 0.2, site.z, "#ffffff", 0.7);
        }
        glints.set(site.id, cycle);
      }
    }
    for (const [id, prop] of props)
      if (!seen.has(id)) {
        dropProp(prop);
        props.delete(id);
      }
    // The Silph Scope: every unidentified ghost shows its true form at once.
    if (world.silphScope && !scope)
      for (const site of world.sites)
        if (site.kind === "ghost") {
          const enemy = world.enemies.find((entry) => entry.id === site.data.enemy);
          const x = enemy?.x ?? site.x,
            z = enemy?.z ?? site.z;
          burst(x, ground(x, z) + 1, z, SCOPE, 22, 2.6);
          pulse(x, z, 0.5, 3, SCOPE, 0.6);
        }
    scope = world.silphScope;
    frameEggs(world, alpha, elapsed);
    for (const p of pulses) {
      p.age += dt;
      const t = Math.min(1, p.age / p.life);
      ring(p.x, p.z, {
        radius: p.from + (p.to - p.from) * (1 - (1 - t) ** 2),
        fill: 1,
        color: `#${p.color.getHexString()}`,
        alpha: p.alpha * (1 - t),
        width: 0.08,
        wash: 0,
      });
    }
    for (let i = pulses.length - 1; i >= 0; i--)
      if (pulses[i]!.age >= pulses[i]!.life) pulses.splice(i, 1);
    rings.count = ringCount;
    rings.instanceMatrix.needsUpdate = ringColor.needsUpdate = ringData.needsUpdate = true;
    beams.count = beamCount;
    beams.instanceMatrix.needsUpdate = beamColor.needsUpdate = true;
    let count = 0;
    for (const s of sparks) {
      s.age += dt;
      s.vy -= s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const t = s.age / s.life;
      if (t >= 1) continue;
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(s.size * (t < 0.15 ? t / 0.15 : 1));
      dummy.updateMatrix();
      sparkMesh.setMatrixAt(count, dummy.matrix);
      sparkColor.setXYZW(count, s.color.r, s.color.g, s.color.b, 1 - t * t);
      count++;
    }
    for (let i = sparks.length - 1; i >= 0; i--)
      if (sparks[i]!.age >= sparks[i]!.life) sparks.splice(i, 1);
    sparkMesh.count = count;
    sparkMesh.instanceMatrix.needsUpdate = sparkColor.needsUpdate = true;
  }

  /** An egg rides on its carrier's back and wobbles harder as it nears hatching. */
  function frameEggs(world: World, alpha: number, elapsed: number): void {
    for (const player of world.players) {
      let prop = carried.get(player.id);
      const egg = player.egg && player.alive && !player.departed ? player.egg : null;
      if (!egg) {
        if (prop) prop.root.visible = false;
        continue;
      }
      if (!prop) {
        const made = makeProp("egg", "egg", player.id);
        if (!made) continue;
        made.scale = 0.75;
        carried.set(player.id, (prop = made));
      }
      const form = formOf(player);
      const x = player.px + (player.x - player.px) * alpha,
        z = player.pz + (player.z - player.pz) * alpha;
      const near = Math.min(1, egg.distance / SITE.eggDistance);
      prop.root.visible = true;
      prop.root.position.set(
        x - player.faceX * form.radius * 0.85,
        ground(x, z) + form.height * 0.35,
        z - player.faceZ * form.radius * 0.85,
      );
      prop.root.rotation.y = Math.atan2(player.faceX, player.faceZ);
      const wobble = (0.04 + 0.22 * near * near) * Math.sin(elapsed * (5 + 12 * near));
      prop.root.rotation.z = wobble;
      prop.root.scale.setScalar(prop.scale);
    }
  }

  return {
    root,
    frame,
    handle(event, world) {
      if (event.t !== "site") return;
      const y = ground(event.x, event.z);
      const site = world.sites.find((entry) => entry.id === event.site);
      switch (event.phase) {
        case "wake":
          burst(event.x, y + 0.6, event.z, GOLD, 16, 2.2);
          pulse(event.x, event.z, 0.4, 2.4, GOLD);
          break;
        case "start":
          pulse(event.x, event.z, 0.3, 1.6, GOLD, 0.5, 0.7);
          if (event.kind === "egg") burst(event.x, y + 0.5, event.z, "#ffd2e6", 8, 1.4);
          break;
        case "reveal":
          if (event.kind === "fossil") burst(event.x, y + 0.5, event.z, "#cbb68b", 14, 2);
          else if (event.kind === "fishing") burst(event.x, y + 0.3, event.z, "#a9e6ff", 10, 1.5);
          break;
        case "complete":
          if (event.kind === "spring") {
            burst(event.x, y + 0.5, event.z, HEAL, 26, 2.4);
            pulse(event.x, event.z, 0.5, 3.2, HEAL, 0.8);
          } else if (event.kind === "egg" && !site) {
            // Hatching (the event names a fresh id, no site).
            burst(event.x, y + 0.8, event.z, "#ffd2e6", 22, 2.6);
            pulse(event.x, event.z, 0.3, 2, "#ffd2e6", 0.6);
          } else if (event.kind === "item-ball" && !site?.data.trap)
            burst(event.x, y + 0.3, event.z, GOLD, 10, 1.6);
          else if (event.kind === "glint" || event.kind === "silph-scope")
            burst(event.x, y + 0.4, event.z, event.kind === "glint" ? "#fffbe0" : SCOPE, 14, 1.8);
          break;
        case "cancel":
          break;
      }
    },
    burst,
    twinkle,
    dispose() {
      for (const prop of props.values()) dropProp(prop);
      for (const prop of carried.values()) dropProp(prop);
      props.clear();
      carried.clear();
      ringGeometry.dispose();
      ringMaterial.dispose();
      rings.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      sparkMesh.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
      beams.dispose();
      root.removeFromParent();
    },
  };
}
