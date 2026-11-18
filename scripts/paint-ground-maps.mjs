// Painted ground maps: Magpie sources in assets/textures/source/ → public/art/ground-<name>.jpg (sRGB
// albedo) and ground-<name>-detail.png (linear: RG tangent normal XY, B relief, A grain), each with a
// provenance record. Sources are made tileable by cross-fading a half-offset copy into their borders.
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const size = 512;
/** Detail maps are noise-like and compress poorly; half resolution keeps each near 0.25 MB. */
const detailSize = 256;
/** name → [use, relief strength] */
const maps = {
  "desert-sand": ["walkable desert sand", 0.5],
  "desert-hardpan": ["cracked hardpan patches in the desert", 0.7],
  "desert-cliff": ["side-on sandstone strata on sheer desert banks", 0.9],
  "coast-sand": ["inland beach sand and its grain on the coast", 0.45],
  "glacier-snow": ["walkable glacier snow", 0.45],
  "glacier-ice": ["blue ice patches on the glacier", 0.55],
  "glacier-cliff": ["side-on ice and snow strata on sheer glacier banks", 0.9],
  "volcano-basalt": ["walkable ropy basalt on the volcano", 0.8],
  "volcano-ash": ["ash and cinder patches on the volcano", 0.5],
  "volcano-cliff": ["side-on basalt strata on sheer volcano banks", 1],
  "tower-stone": ["stone under the tower's slab grid and on its banks", 0.6],
};
/** Fraction of each side cross-faded with the half-offset copy. */
const BAND = 0.18;

const smooth = (t) => t * t * (3 - 2 * t);
function tileable(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, w - 1 - x, y, h - 1 - y) / (Math.min(w, h) * BAND);
      const keep = smooth(Math.min(1, edge));
      const o = (((y + h / 2) % h) * w + ((x + w / 2) % w)) * 3;
      const i = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) out[i + c] = src[i + c] * keep + src[o + c] * (1 - keep);
    }
  return out;
}
/** Wrapping box blur of a single channel. */
function blur(src, n, r) {
  const pass = (a, horizontal) => {
    const b = new Float32Array(a.length);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++)
          s += horizontal ? a[y * n + ((x + k + n) % n)] : a[((y + k + n) % n) * n + x];
        b[y * n + x] = s / (2 * r + 1);
      }
    return b;
  };
  return pass(pass(src, true), false);
}
const normalise = (a) => {
  let lo = Infinity,
    hi = -Infinity;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return a.map((v) => (v - lo) / Math.max(hi - lo, 1e-6));
};

for (const [name, [use, relief]] of Object.entries(maps)) {
  const source = `assets/textures/source/ground-${name}.png`;
  // Crop to the final square first: blending the borders of a wider source would leave the cropped
  // edges untreated and seam on the banks.
  const image = sharp(new URL(source, root).pathname);
  const { width, height: tall } = await image.metadata();
  const side = Math.min(width, tall);
  const { data, info } = await image
    .removeAlpha()
    .extract({
      left: Math.floor((width - side) / 2),
      top: Math.floor((tall - side) / 2),
      width: side,
      height: side,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const seamless = tileable(Float32Array.from(data), info.width, info.height);
  const raw = { raw: { width: info.width, height: info.height, channels: 3 } };
  const pixels = Buffer.from(seamless.map((v) => Math.round(v)));
  const albedo = await sharp(pixels, raw)
    .resize(size, size, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
  writeFileSync(
    new URL(`public/art/ground-${name}.jpg`, root),
    await sharp(albedo, { raw: { width: size, height: size, channels: 3 } })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer(),
  );
  // Painted shading is the height: broad relief from blurred luminance, grain from its residue.
  const n = detailSize;
  const small = await sharp(albedo, { raw: { width: size, height: size, channels: 3 } })
    .resize(n, n, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
  const luma = new Float32Array(n * n);
  for (let i = 0; i < luma.length; i++)
    luma[i] = (small[i * 3] * 0.299 + small[i * 3 + 1] * 0.587 + small[i * 3 + 2] * 0.114) / 255;
  const broad = blur(luma, n, 1);
  const base = blur(luma, n, 12);
  const height = normalise(broad.map((v, i) => v - base[i]));
  const grain = normalise(luma.map((v, i) => v - broad[i]));
  const detail = Buffer.alloc(n * n * 4);
  const at = (x, y) => height[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const dx = (at(x - 1, y) - at(x + 1, y)) * relief * 12;
      const dy = (at(x, y - 1) - at(x, y + 1)) * relief * 12;
      const d = Math.hypot(dx, dy, 1);
      detail[i * 4] = Math.round(((dx / d) * 0.5 + 0.5) * 255);
      detail[i * 4 + 1] = Math.round(((dy / d) * 0.5 + 0.5) * 255);
      detail[i * 4 + 2] = Math.round(height[i] * 255);
      detail[i * 4 + 3] = Math.round(grain[i] * 255);
    }
  writeFileSync(
    new URL(`public/art/ground-${name}-detail.png`, root),
    await sharp(detail, { raw: { width: n, height: n, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  for (const [asset, processing] of [
    [
      `ground-${name}.jpg`,
      `half-offset border cross-fade (${BAND * 100}%) for tiling; ${size} px JPEG quality 82; settled in the terrain shader`,
    ],
    [
      `ground-${name}-detail.png`,
      `derived from the albedo luminance at ${detailSize} px: RG tangent normal XY, B relief, A grain; linear data (NoColorSpace)`,
    ],
  ])
    writeFileSync(
      new URL(`public/art/${asset.replace(/\.(jpg|png)$/, ".provenance.json")}`, root),
      JSON.stringify(
        {
          asset,
          generator: "Magpie Image, model ash/gpt-image-2.5-sunburst",
          createdAt: "2026-11-18",
          source: `${source} (${width === tall ? `${width} px` : `${width}×${tall} px, centre-cropped to ${side}`})`,
          prompts: "docs/ART-PROMPTS.md (ground texture template; see 生成记录)",
          processing: `bun scripts/paint-ground-maps.mjs: ${processing}`,
          use,
          rights: "Generated for a noncommercial fan project.",
        },
        null,
        2,
      ) + "\n",
    );
  console.log(name);
}
