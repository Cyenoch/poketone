import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import recipes from "../assets/shiny-forms/texture-recipes.json";
import { formDefs } from "../src/run/sim/content/lines/index.ts";
import { shinyPalettes, shinyTextureUrl, shinyUniforms } from "../src/run/view/shiny.ts";

const root = resolve(import.meta.dir, "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fract = (value) => value - Math.floor(value);
const clamp = (value) => Math.max(0, Math.min(1, value));
const mix = (from, to, weight) => from + (to - from) * weight;
function smooth(low, high, value) {
  const weight = clamp((value - low) / (high - low));
  return weight * weight * (3 - 2 * weight);
}

function contains(points, x, y) {
  let inside = false;
  for (let index = 0; index < points.length; index++) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
  }
  return inside;
}

export async function shinyPortrait(form, source) {
  const palette = shinyPalettes[form];
  const recipe = recipes.forms[form];
  const portraitOnly = recipes.portraitOnly[form];
  const keep = portraitOnly?.keepPortrait ?? recipe?.keepPortrait;
  const main = shinyUniforms(form);
  const water = recipe?.shellPortrait && {
    shell: shinyUniforms(form, { swaps: [palette.swaps[0], palette.swaps.at(-1)] }),
    body: shinyUniforms(form, {
      swaps: [palette.swaps[0], ...(recipe.bellySwap ? [recipe.bellySwap] : [])],
    }),
  };
  const {
    data,
    info: { width, height, channels },
  } = await sharp(source)
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if ((keep || water) && (width !== 320 || height !== 320))
    throw new Error(`${form} 头像与 320px 遮罩不匹配。`);
  for (let offset = 0; offset < data.length; offset += channels) {
    if (data[offset + 3] === 0) continue;
    const red = data[offset] / 255;
    const green = data[offset + 1] / 255;
    const blue = data[offset + 2] / 255;
    const gbMax = Math.max(green, blue);
    const value = Math.max(red, gbMax);
    const delta = value - Math.min(red, green, blue);
    const sector = red >= gbMax ? (green >= blue ? 0 : -1) : green >= blue ? -1 / 3 : 2 / 3;
    const hue = Math.abs(
      sector + (Math.min(red, gbMax) - Math.min(green, blue)) / (6 * delta + 1e-5),
    );
    const sat = delta / (value + 1e-5);
    const pixel = offset / channels;
    const x = (pixel % width) + 0.5;
    const y = Math.floor(pixel / width) + 0.5;
    if (keep && contains(keep, x, y) && (!portraitOnly || hue * 360 < 55 || hue * 360 > 325))
      continue;
    const { swaps, grey } = water
      ? contains(recipe.shellPortrait, x, y)
        ? water.shell
        : water.body
      : main;
    const chroma = smooth(0.12, 0.25, sat);
    let shiftedHue = hue;
    let shiftedSat = sat;
    for (const swap of swaps) {
      if (swap.z <= 0) continue;
      const distance = Math.abs(fract(hue - swap.x + 0.5) - 0.5);
      const weight = chroma * (1 - smooth(swap.z * 0.6, swap.z, distance));
      shiftedHue = mix(shiftedHue, fract(swap.y + hue - swap.x), weight);
      shiftedSat = mix(shiftedSat, clamp(sat * swap.w), weight);
    }
    const greyness = (1 - chroma) * grey.w;
    shiftedHue = mix(shiftedHue, grey.x, greyness);
    shiftedSat = mix(shiftedSat, Math.max(shiftedSat, grey.y), greyness);
    let brightness = value * mix(1, grey.z, greyness);
    if (recipe?.skinValue)
      brightness *= mix(
        1,
        recipe.skinValue,
        smooth(0.3, 0.6, sat) * (1 - smooth(30, 43, hue * 360)),
      );
    for (const [channel, phase] of [1, 2 / 3, 1 / 3].entries()) {
      const component = clamp(Math.abs(fract(shiftedHue + phase) * 6 - 3) - 1);
      data[offset + channel] = Math.round(255 * clamp(brightness * mix(1, component, shiftedSat)));
    }
  }
  return sharp(data, { raw: { width, height, channels } }).webp({ lossless: true }).toBuffer();
}

async function generate(destination, bakeRoot) {
  const hashes = {};
  const record = async (path, bytes, inputs) => {
    const output = resolve(destination, "public", `.${path}`);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes);
    hashes[path] = { ...inputs, sha256: sha256(bytes) };
  };
  const verified =
    bakeRoot && JSON.parse(await readFile(resolve(bakeRoot, "verification.json"), "utf8"));
  for (const form of Object.keys(formDefs)) {
    const source = `public/art/portraits/${form}.webp`;
    const bytes = await readFile(resolve(root, source));
    const sourceSha256 = sha256(bytes);
    let portrait;
    if (recipes.forms[form]?.bakedPortrait) {
      if (!bakeRoot) throw new Error(`${form} 的分区头像需要提供烘焙输出目录。`);
      portrait = await readFile(resolve(bakeRoot, `candidates/${form}-portrait.webp`));
      if (
        verified[form]?.portraitSourceSha256 !== sourceSha256 ||
        verified[form]?.portraitSha256 !== sha256(portrait)
      )
        throw new Error(`${form} 的普通头像或烘焙头像与 verification.json 不匹配。`);
    } else portrait = await shinyPortrait(form, bytes);
    await record(`/art/portraits/${form}-shiny.webp`, portrait, {
      source,
      sourceSha256,
      palette: shinyPalettes[form],
    });
    const path = shinyTextureUrl(form);
    if (!path || !bakeRoot) continue;
    const model = `public/models/${form}.glb`;
    const modelSha = sha256(await readFile(resolve(root, model)));
    const candidate = `candidates/${form}-baseColor.png`;
    const baked = await readFile(resolve(bakeRoot, candidate));
    if (
      modelSha !== verified[form]?.modelSha256 ||
      sha256(baked) !== verified[form]?.candidateSha256
    )
      throw new Error(`${form} 的 GLB 或烘焙贴图与 verification.json 不匹配。`);
    await record(path, baked, { source: model, sourceSha256: modelSha, candidate });
  }
  const sources = {};
  for (const path of [
    "scripts/shiny-portraits.mjs",
    "src/run/view/shiny.ts",
    ...["palettes", "provenance", "texture-recipes"].map(
      (name) => `assets/shiny-forms/${name}.json`,
    ),
  ])
    sources[path] = sha256(await readFile(resolve(root, path)));
  await writeFile(
    resolve(destination, "shiny-assets.provenance.json"),
    `${JSON.stringify({ sources, outputs: hashes }, null, 2)}\n`,
  );
  console.log(`${Object.keys(hashes).length} assets → ${resolve(destination)}`);
}

if (import.meta.main) {
  const [, , destination, bakeRoot] = process.argv;
  if (!destination)
    throw new Error("bun scripts/shiny-portraits.mjs <output-root> [verified-bake-root]");
  await generate(destination, bakeRoot);
}
