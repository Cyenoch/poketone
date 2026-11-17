import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearSRGBColorSpace,
  NormalBlending,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
  type DirectionalLight,
  type Fog,
  type HemisphereLight,
} from "three";
import { WEATHER } from "../sim/content/params/field-events";
import { weatherDefs } from "../sim/content/weather";
import type { WeatherId, WeatherState } from "../sim/state/field";
import type { StageId } from "../sim/content/stages/index";

interface WeatherLook {
  /** The sky and fog colour it leans to, and how far at full strength. */
  haze: string;
  mix: number;
  sun: number;
  hemi: number;
  sunColor: string;
  /** Fog distance scale at full strength. */
  fog: number;
  /** Particles on a fine pointer (a coarse one draws 60%). */
  count: number;
  color: string;
  alpha: number;
  /** Particle width and length (world units). */
  size: readonly [number, number];
  /** Fall (or rise) speed and sideways drift (world units a second). */
  speed: number;
  drift: readonly [number, number];
}

/** The four weathers' sky and particles: tinted, never dark enough to hide a danger telegraph. */
export const weatherLooks: Record<WeatherId, WeatherLook> = {
  sun: {
    haze: "#ffe3b3",
    mix: 0.35,
    sun: 1.25,
    hemi: 1.08,
    sunColor: "#ffd79a",
    fog: 1,
    count: 160,
    color: "#fff1c4",
    alpha: 0.55,
    size: [0.09, 0.09],
    speed: 0.7,
    drift: [0.3, 0.1],
  },
  rain: {
    haze: "#7f91a6",
    mix: 0.55,
    sun: 0.55,
    hemi: 0.85,
    sunColor: "#c9d8ea",
    fog: 0.85,
    count: 1400,
    color: "#d2e4ff",
    alpha: 0.32,
    size: [0.035, 0.8],
    speed: 18,
    drift: [1.2, 0.4],
  },
  sandstorm: {
    haze: "#d3a66a",
    mix: 0.62,
    sun: 0.7,
    hemi: 0.95,
    sunColor: "#ffd6a0",
    fog: 0.75,
    count: 900,
    color: "#e6c48c",
    alpha: 0.3,
    size: [0.55, 0.05],
    speed: 0,
    drift: [11, 3],
  },
  hail: {
    haze: "#c9dceb",
    mix: 0.5,
    sun: 0.75,
    hemi: 0.95,
    sunColor: "#e4f0ff",
    fog: 0.9,
    count: 500,
    color: "#f4f9ff",
    alpha: 0.8,
    size: [0.09, 0.09],
    speed: 10,
    drift: [0.8, 0.2],
  },
};

/**
 * How far the weather shows at `time`: `sky` tints the sky from the forecast on (a third of the
 * way, the warning only); `fall` is the particles, which wait for the weather to actually start.
 * Both ramp over two seconds at each end.
 */
export function weatherStrength(
  weather: WeatherState | null,
  time: number,
): { sky: number; fall: number } {
  if (!weather || time >= weather.until) return { sky: 0, fall: 0 };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (time < weather.from)
    return {
      sky: 0.35 * clamp((time - (weather.from - WEATHER.forecast)) / WEATHER.forecast),
      fall: 0,
    };
  const out = clamp((weather.until - time) / 2);
  const fall = clamp((time - weather.from) / 2) * out;
  return { sky: Math.min(1, 0.35 + 0.65 * clamp((time - weather.from) / 2)) * out, fall };
}

const BOX = new Vector3(40, 14, 40);

const vertex = (kind: WeatherId) => /* glsl */ `
  uniform float uTime, uStrength; uniform vec3 uCenter; uniform vec2 uDrift, uSize; uniform float uSpeed;
  attribute vec4 aSeed;
  varying vec2 vP; varying float vA;
  void main() {
    vec3 box = vec3(${BOX.x.toFixed(1)}, ${BOX.y.toFixed(1)}, ${BOX.z.toFixed(1)});
    float t = uTime * (.8 + .4 * aSeed.w);
    vec2 flat_ = aSeed.xy * box.xz + uDrift * t;
    vec2 rel = (fract((flat_ - uCenter.xz) / box.xz + .5) - .5) * box.xz;
    vec3 p = vec3(uCenter.x + rel.x, 0., uCenter.z + rel.y);
    ${
      kind === "sandstorm"
        ? "p.y = uCenter.y + .2 + aSeed.z * 3.5 + sin(t * 3. + aSeed.w * 20.) * .25;"
        : kind === "sun"
          ? "p.y = uCenter.y + fract(aSeed.z + uSpeed * t / box.y) * box.y * .6;"
          : "p.y = uCenter.y + box.y - fract(aSeed.z + uSpeed * t / box.y) * box.y;"
    }
    vec4 mv = viewMatrix * vec4(p, 1.);
    mv.xy += position.xy * uSize;
    vP = position.xy * 2.;
    vec2 edge = abs(rel) / (box.xz * .5);
    vA = uStrength * (1. - smoothstep(.7, 1., max(edge.x, edge.y)));
    ${kind === "rain" || kind === "hail" ? "vA *= smoothstep(uCenter.y - .2, uCenter.y + .8, p.y);" : ""}
    gl_Position = projectionMatrix * mv;
  }`;

const fragment = (kind: WeatherId) => /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha;
  varying vec2 vP; varying float vA;
  void main() {
    ${
      kind === "rain"
        ? "float a = (1. - abs(vP.x)) * (1. - smoothstep(.2, 1., abs(vP.y)));"
        : kind === "sandstorm"
          ? "float a = (1. - smoothstep(.3, 1., abs(vP.x))) * (1. - abs(vP.y));"
          : "float a = 1. - smoothstep(.4, 1., length(vP));"
    }
    a *= vA * uAlpha;
    if (a <= .003) discard;
    gl_FragColor = vec4(uColor${kind === "sun" ? " * a" : ""}, a);
  }`;

export interface WeatherView {
  frame(weather: WeatherState | null, time: number, centre: Vector3, dt: number): void;
  /** Shows the particles for the load's warm draw, so their program compiles under the cover. */
  warm(on: boolean): void;
  dispose(): void;
}

/**
 * The stage's one possible weather, on the run's own fog, sky clear and lights. A stage without
 * weather makes nothing. Particles draw before other transparent effects, so telegraphs stay on top.
 */
export function createWeather(
  stage: StageId,
  base: {
    fog: Fog;
    background: Color;
    hemi: HemisphereLight;
    sun: DirectionalLight;
    add(mesh: InstancedMesh): void;
  },
  coarse: boolean,
): WeatherView | null {
  const id = (Object.keys(weatherDefs) as WeatherId[]).find((key) =>
    weatherDefs[key].stages.includes(stage),
  );
  if (!id) return null;
  const look = weatherLooks[id];
  const fogColor = base.fog.color.clone();
  const fogNear = base.fog.near,
    fogFar = base.fog.far;
  const hemiIntensity = base.hemi.intensity,
    sunIntensity = base.sun.intensity;
  const sunColor = base.sun.color.clone();
  const haze = new Color(look.haze),
    warm = new Color(look.sunColor);
  const display = { r: 0, g: 0, b: 0 };

  const count = Math.round(look.count * (coarse ? 0.6 : 1));
  const geometry = new PlaneGeometry(1, 1);
  const seeds = new Float32Array(count * 4);
  // A fixed pattern: the view needs no randomness that a replay could notice.
  for (let i = 0; i < count; i++) {
    const h = (n: number) => {
      const x = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    seeds.set([h(1), h(2), h(3), h(4)], i * 4);
  }
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(seeds, 4));
  const uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uCenter: { value: new Vector3() },
    uDrift: { value: new Vector2(...look.drift) },
    uSize: { value: new Vector2(...look.size) },
    uSpeed: { value: look.speed },
    uColor: { value: new Color(look.color) },
    uAlpha: { value: look.alpha },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: vertex(id),
    fragmentShader: fragment(id),
    transparent: true,
    depthWrite: false,
    blending: id === "sun" ? AdditiveBlending : NormalBlending,
  });
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.visible = false;
  base.add(mesh);
  let clock = 0;
  let last = -1;
  let warming = false;
  let falling = false;

  return {
    frame(weather, time, centre, dt) {
      const { sky, fall } = weatherStrength(weather?.id === id ? weather : null, time);
      clock += dt;
      if (sky !== last) {
        last = sky;
        const k = sky * look.mix;
        base.fog.color.copy(fogColor).lerp(haze, k);
        base.fog.near = fogNear * (1 + (look.fog - 1) * sky);
        base.fog.far = fogFar * (1 + (look.fog - 1) * sky);
        base.fog.color.getRGB(display, SRGBColorSpace);
        base.background.setRGB(display.r, display.g, display.b, LinearSRGBColorSpace);
        base.hemi.intensity = hemiIntensity * (1 + (look.hemi - 1) * sky);
        base.sun.intensity = sunIntensity * (1 + (look.sun - 1) * sky);
        base.sun.color.copy(sunColor).lerp(warm, sky * 0.6);
      }
      falling = fall > 0;
      mesh.visible = falling || warming;
      uniforms.uStrength.value = fall;
      uniforms.uTime.value = clock;
      uniforms.uCenter.value.copy(centre);
    },
    warm(on) {
      warming = on;
      mesh.visible = falling || warming;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
