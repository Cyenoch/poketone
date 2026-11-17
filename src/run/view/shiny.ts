import { Vector4, type Material } from "three";
import type { EnemyId } from "../sim/content/enemies";
import { inject, patchShader } from "./patchShader";

/**
 * One hue swap on a species' texture: chromatic texels within `width`° of `from` turn to `to`
 * (degrees), their saturation scaled by `sat`. Greys never match a swap.
 */
type Swap = readonly [from: number, to: number, width?: number, sat?: number];
/** Colours the desaturated parts (`hue`° at `amount` saturation, `value` brightness scale). */
interface Grey {
  hue: number;
  amount: number;
  value?: number;
}
export interface ShinyPalette {
  swaps: readonly Swap[];
  grey?: Grey;
}

const p = (...swaps: Swap[]): ShinyPalette => ({ swaps });
const g = (hue: number, amount: number, value = 1, ...swaps: Swap[]): ShinyPalette => ({
  swaps,
  grey: { hue, amount, value },
});

/**
 * Each species' shiny colouring after the main series (gold Magikarp, red Gyarados, blue Voltorb…),
 * as hue swaps on its own model texture: no new models (design §4).
 */
export const shinyPalettes: Record<EnemyId, ShinyPalette> = {
  caterpie: p([110, 55]),
  weedle: p([35, 75]),
  rattata: p([275, 60]),
  pidgey: p([30, 48, 40, 1.2]),
  oddish: p([225, 160]),
  scyther: p([120, 80]),
  spearow: p([25, 45]),
  zubat: p([215, 110], [280, 330]),
  ekans: p([275, 90]),
  paras: p([30, 5, 40, 1.2]),
  geodude: g(42, 0.42),
  venonat: p([280, 215]),
  metapod: p([120, 35]),
  kakuna: p([55, 110]),
  "nidoran-f": p([210, 300]),
  "nidoran-m": p([285, 220]),
  voltorb: p([0, 225]),
  vulpix: p([20, 48]),
  growlithe: p([25, 50]),
  butterfree: p([255, 325]),
  beedrill: p([55, 95]),
  raticate: p([35, 5, 40, 1.2]),
  pidgeotto: p([28, 48]),
  gloom: p([220, 30]),
  arbok: p([280, 50]),
  parasect: p([15, 55]),
  venomoth: p([275, 215]),
  fearow: p([30, 70]),
  vileplume: p([0, 40], [220, 290]),
  graveler: g(42, 0.42),
  electrode: p([0, 225]),
  golem: g(30, 0.3, 1, [110, 25]),
  nidorina: p([210, 320]),
  poliwag: p([225, 195, 40, 0.9]),
  diglett: p([25, 215]),
  mankey: p([35, 90]),
  sandshrew: p([50, 110]),
  psyduck: p([55, 200]),
  nidorino: p([285, 225]),
  magnemite: g(45, 0.45),
  poliwhirl: p([225, 180]),
  exeggcute: p([340, 55]),
  primeape: p([35, 85]),
  pinsir: p([30, 255]),
  gastly: p([280, 330]),
  koffing: p([285, 195]),
  clefairy: p([340, 355, 40, 1.25]),
  tangela: p([220, 130]),
  haunter: p([275, 320]),
  weezing: p([285, 180]),
  exeggutor: p([115, 45]),
  nidoking: p([285, 225]),
  doduo: p([30, 95]),
  meowth: p([45, 25, 40, 1.3]),
  ponyta: p([25, 220]),
  cubone: p([35, 80]),
  tauros: p([30, 70]),
  sandslash: p([45, 10]),
  machop: g(40, 0.42, 1, [210, 40]),
  hitmonlee: p([30, 90]),
  rhyhorn: g(350, 0.25),
  dodrio: p([30, 95]),
  onix: g(48, 0.55),
  marowak: p([35, 100]),
  rapidash: p([25, 220]),
  kabutops: p([30, 95]),
  omastar: p([210, 280]),
  rhydon: g(350, 0.2, 1.12),
  aerodactyl: g(285, 0.35),
  krabby: p([10, 110]),
  tentacool: p([215, 285]),
  omanyte: p([210, 280]),
  kabuto: p([30, 95]),
  golduck: p([220, 185]),
  kingler: p([10, 110]),
  seadra: p([210, 280]),
  chansey: p([340, 90]),
  magneton: g(45, 0.45),
  lickitung: p([340, 50]),
  seaking: p([20, 45]),
  poliwrath: p([225, 130]),
  gyarados: p([215, 0, 50, 1.1]),
  staryu: p([35, 215]),
  jolteon: p([55, 85]),
  electabuzz: p([55, 35, 40, 1.2]),
  dragonair: p([210, 320]),
  starmie: p([275, 220]),
  grimer: p([285, 115]),
  jigglypuff: p([340, 325, 40, 1.15]),
  kadabra: p([50, 15]),
  wigglytuff: p([340, 320]),
  jynx: p([0, 300]),
  seel: g(40, 0.25),
  shellder: p([285, 30]),
  slowpoke: p([340, 290]),
  vaporeon: p([205, 275]),
  dratini: p([215, 320]),
  snorlax: p([190, 225]),
  dugtrio: p([25, 215]),
  ninetales: p([45, 200, 40, 0.6]),
  hitmonchan: p([30, 85], [0, 220]),
  flareon: p([20, 45]),
  "haunter-guardian": p([275, 320]),
  muk: p([285, 115]),
  "mr-mime": p([220, 140]),
  golbat: p([215, 110], [280, 330]),
  alakazam: p([50, 15]),
  "marowak-ghost": p([35, 100]),
  gengar: p([280, 240, 40, 0.6]),
  dewgong: g(40, 0.2),
  cloyster: p([280, 220]),
  lapras: p([210, 275]),
  magmar: p([15, 335]),
  arcanine: p([25, 48]),
  dragonite: p([30, 100]),
  heracross: p([215, 320]),
  munchlax: p([195, 230]),
  magikarp: p([10, 48, 45, 1.15]),
};

/** Packs a palette into the shader's three swaps and grey tint (hues 0–1). */
export function shinyUniforms(id: EnemyId): { swaps: Vector4[]; grey: Vector4 } {
  const palette = shinyPalettes[id];
  if (!palette) throw new Error(`${id} 没有异色配色。`);
  const swaps = [0, 1, 2].map((i) => {
    const swap = palette.swaps[i];
    // A zero width matches nothing.
    return swap
      ? new Vector4(swap[0] / 360, swap[1] / 360, (swap[2] ?? 40) / 360, swap[3] ?? 1)
      : new Vector4(0, 0, 0, 1);
  });
  const grey = palette.grey;
  return {
    swaps,
    grey: grey
      ? new Vector4(grey.hue / 360, grey.amount, grey.value ?? 1, 1)
      : new Vector4(0, 0, 1, 0),
  };
}

/**
 * Recolours the texture before instance tints (hit flash, statuses) multiply it. One program for
 * every species: the palette is per-material uniforms.
 */
export function shinyLook(material: Material, id: EnemyId): void {
  const { swaps, grey } = shinyUniforms(id);
  patchShader(material, "shiny-palette", (shader) => {
    shader.uniforms.shinySwaps = { value: swaps };
    shader.uniforms.shinyGrey = { value: grey };
    shader.fragmentShader = inject(
      "uniform vec4 shinySwaps[3];\nuniform vec4 shinyGrey;\n" + shader.fragmentShader,
      "shiny-palette",
      {
        "#include <color_fragment>": /* glsl */ `
        {
          vec3 s = sRGBTransferOETF(vec4(diffuseColor.rgb, 1.)).rgb;
          vec4 K = vec4(0., -1. / 3., 2. / 3., -1.);
          vec4 q4 = mix(vec4(s.bg, K.wz), vec4(s.gb, K.xy), step(s.b, s.g));
          vec4 r4 = mix(vec4(q4.xyw, s.r), vec4(s.r, q4.yzx), step(q4.x, s.r));
          float dd = r4.x - min(r4.w, r4.y);
          vec3 hsv = vec3(abs(r4.z + (r4.w - r4.y) / (6. * dd + 1e-5)), dd / (r4.x + 1e-5), r4.x);
          float chroma = smoothstep(.12, .25, hsv.y);
          vec3 shifted = hsv;
          for (int i = 0; i < 3; i++) {
            vec4 swap = shinySwaps[i];
            float off = abs(fract(hsv.x - swap.x + .5) - .5);
            float w = chroma * (1. - smoothstep(swap.z * .6, swap.z, off)) * step(.0001, swap.z);
            float target = fract(swap.y + (hsv.x - swap.x));
            shifted.x = mix(shifted.x, target, w);
            shifted.y = mix(shifted.y, clamp(hsv.y * swap.w, 0., 1.), w);
          }
          float greyness = (1. - chroma) * shinyGrey.w;
          shifted.x = mix(shifted.x, shinyGrey.x, greyness);
          shifted.y = mix(shifted.y, max(shifted.y, shinyGrey.y), greyness);
          shifted.z *= mix(1., shinyGrey.z, greyness);
          vec3 rgb = shifted.z * mix(vec3(1.), clamp(abs(fract(shifted.x + vec3(1., 2. / 3., 1. / 3.)) * 6. - 3.) - 1., 0., 1.), shifted.y);
          diffuseColor.rgb = sRGBTransferEOTF(vec4(rgb, 1.)).rgb;
        }
        #include <color_fragment>`,
      },
    );
  });
}
