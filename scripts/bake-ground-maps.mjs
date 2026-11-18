// Tileable stylised material maps, authored here; no downloaded or generated-image sources.
// Painted biome grounds are made by scripts/paint-ground-maps.mjs instead.
// RGBA detail: tangent normal XY, relief height B, fine grain A. All channels are linear data.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const out = new URL("../public/textures/ground/", import.meta.url);
mkdirSync(out, { recursive: true });
const size = 256;
const hash = (x, y) => {
  let n = Math.imul(x + 391, 374761393) ^ Math.imul(y + 117, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
function noise(x, y, n) {
  x *= n;
  y *= n;
  const a = Math.floor(x),
    b = Math.floor(y);
  let u = x - a,
    v = y - b;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const h = (i, j) => hash((i + n) % n, (j + n) % n);
  return (
    (h(a, b) * (1 - u) + h(a + 1, b) * u) * (1 - v) +
    (h(a, b + 1) * (1 - u) + h(a + 1, b + 1) * u) * v
  );
}
const materials = {
  grass: { color: [105, 128, 68], contrast: 0.1, relief: 0.3 },
  soil: { color: [149, 122, 87], contrast: 0.14, relief: 0.4 },
  rock: { color: [136, 139, 146], contrast: 0.13, relief: 0.5 },
};
const manifest = {
  generator: "bun scripts/bake-ground-maps.mjs",
  author: "poketone procedural material study",
  license: "Project-authored; no external source assets",
  size,
  packing: "detail RG = tangent normal XY, B = relief, A = grain; NoColorSpace. albedo = sRGB",
  files: [],
};
for (const [kind, m] of Object.entries(materials)) {
  const heights = new Float32Array(size * size),
    grains = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size,
        n = noise(u, v, 4),
        fine = noise(u, v, 32);
      const h = n * 0.65 + noise(u, v, 12) * 0.35;
      heights[y * size + x] = h;
      grains[y * size + x] = fine;
    }
  const albedo = Buffer.alloc(size * size * 4),
    detail = Buffer.alloc(size * size * 4);
  const at = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x,
        k = i * 4,
        h = heights[i];
      for (let c = 0; c < 3; c++)
        albedo[k + c] = Math.round(
          Math.min(255, m.color[c] * (1 + (h - 0.5) * m.contrast * 2 + (grains[i] - 0.5) * 0.035)),
        );
      albedo[k + 3] = 255;
      const dx = (at(x - 1, y) - at(x + 1, y)) * m.relief * 12,
        dy = (at(x, y - 1) - at(x, y + 1)) * m.relief * 12,
        d = Math.hypot(dx, dy, 1);
      detail[k] = Math.round(((dx / d) * 0.5 + 0.5) * 255);
      detail[k + 1] = Math.round(((dy / d) * 0.5 + 0.5) * 255);
      detail[k + 2] = Math.round(h * 255);
      detail[k + 3] = Math.round(grains[i] * 255);
    }
  for (const [suffix, pixels] of [
    ["albedo", albedo],
    ["detail", detail],
  ]) {
    if (kind === "grass" && suffix === "albedo") continue;
    const bytes = await sharp(pixels, { raw: { width: size, height: size, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const file = `${String(kind)}-${String(suffix)}.png`;
    writeFileSync(new URL(file, out), bytes);
    manifest.files.push({
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
writeFileSync(new URL("provenance.json", out), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    files: manifest.files.length,
    bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
  }),
);
