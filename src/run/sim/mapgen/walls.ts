import type { Terrain } from "../terrain";
import type { Layout } from "./layout";

export const WALL_KIND = { wall: 1, pillar: 2, tombstone: 3 } as const;

/** Static wall cells, centred on terrain/nav samples; each occupies a full half-metre square. */
export interface GridWalls {
  template: string;
  origin: number;
  resolution: number;
  samples: number;
  /** Height above the floor; zero means no wall. */
  heights: Float32Array;
  kinds: Uint8Array;
}

/** Resolve authored rectangles to the one occupancy used by movement, cover and the view. */
export function buildWalls(terrain: Terrain, floor: NonNullable<Layout["floor"]>): GridWalls {
  const { origin, resolution, samples } = terrain;
  const heights = new Float32Array(samples * samples);
  const kinds = new Uint8Array(heights.length);
  for (const block of floor.blocks) {
    const [x, z] = block.at;
    const [width, depth] = block.size;
    const minX = Math.ceil((x - width / 2 - origin) * resolution);
    const maxX = Math.floor((x + width / 2 - origin) * resolution);
    const minZ = Math.ceil((z - depth / 2 - origin) * resolution);
    const maxZ = Math.floor((z + depth / 2 - origin) * resolution);
    for (let gz = minZ; gz <= maxZ; gz++) {
      for (let gx = minX; gx <= maxX; gx++) {
        const cell = gz * samples + gx;
        if (block.height <= heights[cell]!) continue;
        heights[cell] = block.height;
        kinds[cell] = WALL_KIND[block.kind];
      }
    }
  }
  return { template: floor.id, origin, resolution, samples, heights, kinds };
}
