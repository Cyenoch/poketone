import { Box3, DynamicDrawUsage, InstancedBufferAttribute, Vector3, type Frustum } from "three";

/** Packing reaches this far past the frustum, so a shaking camera never makes chunks ping-pong. */
const MARGIN = 1.5;

/**
 * Static ground instances (one vec4 each, y = root height) bucketed into square chunks. The chunks in
 * view and within reach are packed to the front of a single attribute: one draw call per layer. It is
 * repacked (with a margin) only when a visible chunk is missing, so camera shake or a chunk flickering
 * at the frustum edge never re-uploads every frame.
 */
export interface ChunkedInstances {
  attribute: InstancedBufferAttribute;
  /** Packs the visible chunks; returns how many instances to draw. */
  update(frustum: Frustum, eye: Vector3, reach: number): number;
}

/** `half`: the field spans −half…half on X and Z. `top`: how far an instance can reach above its root. */
export function chunkInstances(
  values: Float32Array,
  half: number,
  top: number,
  chunkSize: number,
): ChunkedInstances {
  const side = Math.ceil((half * 2) / chunkSize);
  const cell = (v: number) => Math.min(side - 1, Math.max(0, Math.floor((v + half) / chunkSize)));
  const total = values.length / 4;
  const chunkOf = new Int32Array(total);
  const counts = new Int32Array(side * side);
  for (let i = 0; i < total; i++) {
    const chunk = cell(values[i * 4]!) + cell(values[i * 4 + 2]!) * side;
    chunkOf[i] = chunk;
    counts[chunk]!++;
  }
  const starts = new Int32Array(side * side);
  for (let c = 1; c < starts.length; c++) starts[c] = starts[c - 1]! + counts[c - 1]!;
  const sorted = new Float32Array(values.length);
  const cursor = starts.slice();
  const boxes = Array.from({ length: side * side }, (_, c) => {
    const x = (c % side) * chunkSize - half;
    const z = Math.floor(c / side) * chunkSize - half;
    return new Box3(
      new Vector3(x, Infinity, z),
      new Vector3(x + chunkSize, -Infinity, z + chunkSize),
    );
  });
  for (let i = 0; i < total; i++) {
    const chunk = chunkOf[i]!;
    sorted.set(values.subarray(i * 4, i * 4 + 4), cursor[chunk]! * 4);
    cursor[chunk]!++;
    const box = boxes[chunk]!;
    const y = values[i * 4 + 1]!;
    box.min.y = Math.min(box.min.y, y);
    box.max.y = Math.max(box.max.y, y + top);
  }

  const grown = boxes.map((box) => box.clone().expandByScalar(MARGIN));
  // Distance always uses the true box: past `reach` plants have shrunk to nothing anyway.
  const inView = (c: number, frustumBox: Box3, frustum: Frustum, eye: Vector3, reach: number) =>
    boxes[c]!.distanceToPoint(eye) < reach && frustum.intersectsBox(frustumBox);

  const attribute = new InstancedBufferAttribute(new Float32Array(values.length), 4);
  attribute.setUsage(DynamicDrawUsage);
  const packed = attribute.array as Float32Array;
  const packedChunks = new Set<number>();
  let drawn = 0;
  return {
    attribute,
    update(frustum, eye, reach) {
      let missing = false;
      for (let c = 0; c < boxes.length && !missing; c++) {
        missing =
          counts[c]! > 0 && !packedChunks.has(c) && inView(c, boxes[c]!, frustum, eye, reach);
      }
      if (!missing) return drawn;
      packedChunks.clear();
      drawn = 0;
      for (let c = 0; c < boxes.length; c++) {
        if (counts[c] === 0 || !inView(c, grown[c]!, frustum, eye, reach + MARGIN)) continue;
        packedChunks.add(c);
        packed.set(sorted.subarray(starts[c]! * 4, (starts[c]! + counts[c]!) * 4), drawn * 4);
        drawn += counts[c]!;
      }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, drawn * 4);
      attribute.needsUpdate = true;
      return drawn;
    },
  };
}
