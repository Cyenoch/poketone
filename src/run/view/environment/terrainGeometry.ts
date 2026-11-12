import { BufferGeometry, Float32BufferAttribute } from "three";
import { heightAt, type Terrain } from "../../sim/terrain";

/** Refine only steep cells. Monotone cubic interpolation rounds the sampled crevasse outline;
 * flat cells keep the original vertices, and refinement boundaries stay linear so they cannot crack. */
export function terrainGeometry(terrain: Terrain): BufferGeometry {
  const { samples: n, resolution, origin, heights } = terrain;
  const cells = n - 1;
  const steep = new Uint8Array(cells * cells);
  const h = (x: number, z: number) =>
    heights[Math.max(0, Math.min(n - 1, z)) * n + Math.max(0, Math.min(n - 1, x))]!;
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      const v = [h(x, z), h(x + 1, z), h(x, z + 1), h(x + 1, z + 1)];
      steep[z * cells + x] = Math.max(...v) - Math.min(...v) > 0.55 ? 1 : 0;
    }
  const refined = steep.slice();
  for (let z = 1; z < cells - 1; z++)
    for (let x = 1; x < cells - 1; x++)
      if (steep[z * cells + x])
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) refined[(z + dz) * cells + x + dx] = 1;
  const has = (x: number, z: number) =>
    x >= 0 && z >= 0 && x < cells && z < cells && refined[z * cells + x] === 1;
  const cubic = (a: number, b: number, c: number, d: number, t: number) => {
    const slope = (u: number, v: number) =>
      u * v <= 0 ? 0 : Math.sign(u) * Math.min(Math.abs(u), Math.abs(v));
    const m0 = slope(b - a, c - b),
      m1 = slope(c - b, d - c),
      t2 = t * t,
      t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * b + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * c + (t3 - t2) * m1
    );
  };
  const smoothHeight = (x: number, z: number, u: number, v: number) => {
    const row = (j: number) => cubic(h(x - 1, j), h(x, j), h(x + 1, j), h(x + 2, j), u);
    return cubic(row(z - 1), row(z), row(z + 1), row(z + 2), v);
  };
  const positions: number[] = [],
    indices: number[] = [];
  const vertices = new Map<number, number>();
  const vertex = (gx: number, gz: number, y: number) => {
    const key = gz * (n * 2) + gx;
    const existing = vertices.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    vertices.set(key, index);
    positions.push(origin + gx / (resolution * 2), y, origin + gz / (resolution * 2));
    return index;
  };
  for (let z = 0; z < cells; z++)
    for (let x = 0; x < cells; x++) {
      const steps = has(x, z) ? 2 : 1;
      const grid: number[][] = [];
      for (let j = 0; j <= steps; j++) {
        const row: number[] = [];
        grid.push(row);
        for (let i = 0; i <= steps; i++) {
          const u = i / steps,
            v = j / steps;
          const edge =
            (i === 0 && !has(x - 1, z)) ||
            (i === steps && !has(x + 1, z)) ||
            (j === 0 && !has(x, z - 1)) ||
            (j === steps && !has(x, z + 1));
          const linear = heightAt(
            terrain,
            origin + (x + u) / resolution,
            origin + (z + v) / resolution,
          );
          const y = steps === 2 && !edge ? smoothHeight(x, z, u, v) : linear;
          row.push(vertex((x + u) * 2, (z + v) * 2, y));
        }
      }
      for (let j = 0; j < steps; j++)
        for (let i = 0; i < steps; i++) {
          const a = grid[j]![i]!,
            b = grid[j]![i + 1]!,
            c = grid[j + 1]![i]!,
            d = grid[j + 1]![i + 1]!;
          indices.push(a, c, b, b, c, d);
        }
    }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
