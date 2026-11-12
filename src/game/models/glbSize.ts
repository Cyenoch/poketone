import type { UnitSize } from "../../prepare/idle";

/**
 * The idle-lane cost proxy of a GLB (readiness design §8), read without parsing its buffers or
 * decoding its images: vertices from the JSON chunk's POSITION accessors, texels from the embedded
 * images' headers (PNG, JPEG, WebP). File bytes are not a proxy: a small file can carry a large
 * texture. An image whose size cannot be read counts as unbounded, so it is never admitted.
 */
export async function glbUnitSize(blob: Blob): Promise<UnitSize> {
  const bytes = new DataView(await blob.arrayBuffer());
  const jsonLength = bytes.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes.buffer, 20, jsonLength)),
  ) as GltfJson;
  let vertices = 0;
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      const position = primitive.attributes.POSITION;
      vertices += position === undefined ? 0 : (json.accessors?.[position]?.count ?? 0);
    }
  const binStart = 20 + jsonLength + 8;
  let texturePixels = 0;
  for (const image of json.images ?? []) {
    const view = image.bufferView === undefined ? undefined : json.bufferViews?.[image.bufferView];
    const size = view ? imageSize(bytes, binStart + (view.byteOffset ?? 0)) : null;
    texturePixels += size ? size[0] * size[1] : Number.POSITIVE_INFINITY;
  }
  return { vertices, texturePixels };
}

interface GltfJson {
  meshes?: { primitives: { attributes: { POSITION?: number } }[] }[];
  accessors?: { count: number }[];
  images?: { bufferView?: number }[];
  bufferViews?: { byteOffset?: number }[];
}

function imageSize(data: DataView, at: number): [number, number] | null {
  const byte = (i: number) => data.getUint8(at + i);
  const tag = (i: number) => String.fromCharCode(byte(i), byte(i + 1), byte(i + 2), byte(i + 3));
  if (byte(0) === 0x89 && tag(1).startsWith("PNG")) {
    return [data.getUint32(at + 16), data.getUint32(at + 20)];
  }
  if (tag(0) === "RIFF" && tag(8) === "WEBP") {
    const chunk = tag(12);
    if (chunk === "VP8 ")
      return [data.getUint16(at + 26, true) & 0x3fff, data.getUint16(at + 28, true) & 0x3fff];
    if (chunk === "VP8L") {
      const bits = data.getUint32(at + 21, true);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (chunk === "VP8X") {
      const width = 1 + (byte(24) | (byte(25) << 8) | (byte(26) << 16));
      const height = 1 + (byte(27) | (byte(28) << 8) | (byte(29) << 16));
      return [width, height];
    }
    return null;
  }
  if (byte(0) === 0xff && byte(1) === 0xd8) {
    let i = 2;
    while (at + i + 9 < data.byteLength && byte(i) === 0xff) {
      const marker = byte(i + 1);
      // Start of frame (baseline, extended, progressive) carries height then width.
      if (marker >= 0xc0 && marker <= 0xc2)
        return [data.getUint16(at + i + 7), data.getUint16(at + i + 5)];
      i += 2 + data.getUint16(at + i + 2);
    }
  }
  return null;
}
