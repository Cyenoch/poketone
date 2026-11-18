import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  type Material,
} from "three";
import { ARENA_HALF } from "../../sim/state/world";
import { inject, patchShader } from "../patchShader";
import { BACKDROP_REACH } from "./backdrop";
import { NOISE_GLSL } from "./noise";
import type { WindUniforms } from "./wind";

/**
 * The tower seen from its top floor (docs/MAP-ART.md · 边界外): the floor ends at the outer face of the
 * perimeter wall and the wall drops storey by storey (lilac-grey stone, ledges, deep piers, arched
 * windows) into depth fog and a mist layer. From inside the arena the far wall's face is out of sight,
 * so square bastions stand off it on flying buttresses, their windowed faces turned to the arena. One
 * Lambert draw for the stonework (vertex colour plus a per-surface pattern), one for the mist. Nothing
 * rises more than a few metres above the floor outside the arena, so it never hides the arena.
 */

/** Outer face of the perimeter wall (stage tower: walls centred on ±43.5, 1 m thick). */
const FACE = ARENA_HALF;
const MIST_Y = -44;

/** Pattern drawn on a face (the third surface coordinate; windows add a 0..1 seed). */
const Surface = { stone: 0, slate: 1, window: 2 } as const;
type Surface = (typeof Surface)[keyof typeof Surface];

// The outer wall drops in storeys of STOREY metres, each stepping out a little with a ledge on top,
// so from the floor the eye runs down stacked ledges and deep piers into the depth fog.
const STOREY = 9;
const LEVELS = 7;
const STEP = 0.9;
const faceAt = (level: number) => FACE + level * STEP;
/** Piers every PIER metres, standing DEPTH out from each storey's face. */
const PIER = 11;
const PIER_DEPTH = 2.6;
/** Corner towers: centre and half-size; they fill the corner outside the arena. */
const CORNER = FACE + 3.5;
const CORNER_HALF = 3.5;
/** Bastions standing off the wall on flying buttresses: the only faces the camera sees across the
 * far parapet, so they carry the drop. Centre distance out, half-size, and their tops by position. */
const BASTION = FACE + 9.5;
const BASTION_HALF = 2.8;
const BASTIONS = [
  { x: -33, top: -4 },
  { x: -11, top: -1.5 },
  { x: 11, top: -5 },
  { x: 33, top: -2 },
] as const;
/** Depth fog: the stonework fades to the haze between these heights. */
const FOG_TOP = -3;
const FOG_BOTTOM = -48;

class Builder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  surfaces: number[] = [];

  /** A quad a→b→c→d (counter-clockwise seen from its front), with surface coordinates per corner. */
  quad(
    corners: readonly (readonly [number, number, number])[],
    uv: readonly (readonly [number, number])[],
    color: Color,
    surface: Surface,
    seed = 0,
  ) {
    const [a, b, c] = corners as readonly (readonly number[])[] as [number[], number[], number[]];
    const ux = b[0]! - a[0]!,
      uy = b[1]! - a[1]!,
      uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!,
      vy = c[1]! - a[1]!,
      vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      this.positions.push(...corners[k]!);
      this.normals.push(nx, ny, nz);
      this.colors.push(color.r, color.g, color.b);
      this.surfaces.push(uv[k]![0], uv[k]![1], surface + seed);
    }
  }

  /** An axis-aligned box's outward faces (no bottom). */
  box(min: readonly number[], max: readonly number[], color: Color) {
    const [x0, y0, z0] = min as [number, number, number];
    const [x1, y1, z1] = max as [number, number, number];
    const wall = (
      c: (readonly [number, number, number])[],
      along: number,
      height: number,
      shade: number,
    ) =>
      this.quad(
        c,
        [
          [0, 0],
          [along, 0],
          [along, height],
          [0, height],
        ],
        color.clone().multiplyScalar(shade),
        Surface.stone,
      );
    const h = y1 - y0;
    wall(
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      x1 - x0,
      h,
      1,
    );
    wall(
      [
        [x1, y0, z0],
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
      ],
      x1 - x0,
      h,
      1,
    );
    wall(
      [
        [x1, y0, z1],
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
      ],
      z1 - z0,
      h,
      1,
    );
    wall(
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      z1 - z0,
      h,
      1,
    );
    wall(
      [
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [x0, y1, z0],
      ],
      x1 - x0,
      z1 - z0,
      1.08,
    );
  }

  /** Copies everything built so far three more times, turned a quarter each, round the Y axis. */
  quarterTurns() {
    const count = this.positions.length / 3;
    for (let turn = 1; turn < 4; turn++) {
      const angle = (turn * Math.PI) / 2;
      const cos = Math.round(Math.cos(angle)),
        sin = Math.round(Math.sin(angle));
      for (let i = 0; i < count; i++) {
        const [x, y, z] = this.positions.slice(i * 3, i * 3 + 3) as [number, number, number];
        const [nx, ny, nz] = this.normals.slice(i * 3, i * 3 + 3) as [number, number, number];
        this.positions.push(x * cos + z * sin, y, -x * sin + z * cos);
        this.normals.push(nx * cos + nz * sin, ny, -nx * sin + nz * cos);
        this.colors.push(...this.colors.slice(i * 3, i * 3 + 3));
        this.surfaces.push(...this.surfaces.slice(i * 3, i * 3 + 3));
      }
    }
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute("aSurface", new Float32BufferAttribute(this.surfaces, 3));
    return geometry;
  }
}

/** The +Z side of the outer wall (face, windows, ledges, piers); turned for the rest. */
function buildSide(b: Builder, stone: Color, slate: Color, trim: Color) {
  for (let level = 0; level < LEVELS; level++) {
    const r = faceAt(level);
    const top = -level * STOREY,
      bottom = top - STOREY;
    b.quad(
      [
        [-r, bottom, r],
        [r, bottom, r],
        [r, top, r],
        [-r, top, r],
      ],
      [
        [0, bottom],
        [2 * r, bottom],
        [2 * r, top],
        [0, top],
      ],
      stone,
      Surface.stone,
    );
    // Ledge on the step out from the storey above (the parapet's cornice on the top storey).
    const inner = level === 0 ? r : faceAt(level - 1);
    b.box([-r - 0.4, top - 0.45, inner], [r + 0.4, top, r + 0.4], trim);
    // String course halfway down.
    b.box([-r, bottom + STOREY * 0.42, r], [r, bottom + STOREY * 0.42 + 0.3, r + 0.25], trim);
    // A row of tall arched windows between the piers.
    for (let k = 0; ; k++) {
      const x = (k + 0.5) * (PIER / 2);
      if (x > r - CORNER_HALF * 2 - 1) break;
      for (const side of [-1, 1]) {
        const cx = side * x;
        const seed = ((level * 37 + k * 11 + (side + 1) * 5) % 16) / 16;
        const y0 = bottom + 1.6,
          y1 = top - 2.2;
        b.quad(
          [
            [cx - 0.75, y0, r + 0.04],
            [cx + 0.75, y0, r + 0.04],
            [cx + 0.75, y1, r + 0.04],
            [cx - 0.75, y1, r + 0.04],
          ],
          [
            [1, 0],
            [0, 0],
            [0, 1],
            [1, 1],
          ],
          trim,
          Surface.window,
          seed * 0.9,
        );
        b.box([cx - 0.95, y0 - 0.25, r], [cx + 0.95, y0, r + 0.3], trim);
      }
    }
    // Piers, stepping out with the wall; the top one ends just under the floor in a pinnacle.
    for (let x = 0; x < r - CORNER_HALF * 2; x += PIER) {
      for (const cx of x === 0 ? [0] : [-x, x]) {
        b.box(
          [cx - 0.8, bottom, inner],
          [cx + 0.8, level === 0 ? -1.4 : top, r + PIER_DEPTH],
          stone,
        );
        if (level === 0) {
          b.box([cx - 1, -1.8, inner], [cx + 1, -1.4, r + PIER_DEPTH + 0.2], trim);
          spire(b, cx, r + PIER_DEPTH / 2 + 0.1, 0.9, -1.4, 2, slate);
        }
      }
    }
  }
  for (const { x, top } of BASTIONS) {
    const z = BASTION,
      half = BASTION_HALF;
    tower(b, x, z, half, top, 4.5, stone, slate, trim);
    // Flying buttress back to the pier: a sloped beam over an open arch.
    b.box([x - 0.6, top - 5.2, FACE + PIER_DEPTH], [x + 0.6, top - 3.6, z - half], trim);
  }
  // The corner tower (turned with the rest).
  tower(b, CORNER, CORNER, CORNER_HALF, -4, 4.5, stone, slate, trim);
}

/** A square tower from the bottom of the drop: storey cornices, slit windows, a slate spire. */
function tower(
  b: Builder,
  x: number,
  z: number,
  half: number,
  top: number,
  spireHeight: number,
  stone: Color,
  slate: Color,
  trim: Color,
) {
  const bottom = -LEVELS * STOREY;
  b.box([x - half, bottom, z - half], [x + half, top, z + half], stone);
  b.box([x - half - 0.4, top - 0.6, z - half - 0.4], [x + half + 0.4, top, z + half + 0.4], trim);
  for (let y = top - STOREY; y > bottom; y -= STOREY)
    b.box([x - half - 0.25, y - 0.3, z - half - 0.25], [x + half + 0.25, y, z + half + 0.25], trim);
  spire(b, x, z, half + 0.5, top, spireHeight, slate);
  let level = 0;
  for (let head = top - 1.6; head - 4.5 > bottom; head -= STOREY)
    slits(b, x, z, half, head, trim, level++ + Math.abs(x));
}

/** A four-sided slate cap on a square base. */
function spire(
  b: Builder,
  x: number,
  z: number,
  eave: number,
  base: number,
  height: number,
  slate: Color,
) {
  const apex = [x, base + height, z] as const;
  const corners = [
    [x + eave, base, z + eave],
    [x - eave, base, z + eave],
    [x - eave, base, z - eave],
    [x + eave, base, z - eave],
  ] as const;
  const slant = Math.hypot(eave, height);
  for (let k = 0; k < 4; k++)
    b.quad(
      [corners[(k + 1) % 4]!, corners[k]!, apex, apex],
      [
        [0, 0],
        [eave * 2, 0],
        [eave, slant],
        [eave, slant],
      ],
      slate,
      Surface.slate,
    );
}

/** A tall arched slit in each side of a square tower, its head at `head`. */
function slits(
  b: Builder,
  x: number,
  z: number,
  half: number,
  head: number,
  trim: Color,
  seed: number,
) {
  for (const [dx, dz, nx, nz] of [
    [0, half + 0.04, 1, 0],
    [half + 0.04, 0, 0, -1],
    [0, -half - 0.04, -1, 0],
    [-half - 0.04, 0, 0, 1],
  ] as const) {
    const cx = x + dx,
      cz = z + dz,
      w = 0.55;
    b.quad(
      [
        [cx - nx * w, head - 4.5, cz - nz * w],
        [cx + nx * w, head - 4.5, cz + nz * w],
        [cx + nx * w, head, cz + nz * w],
        [cx - nx * w, head, cz - nz * w],
      ],
      [
        [1, 0],
        [0, 0],
        [0, 1],
        [1, 1],
      ],
      trim,
      Surface.window,
      ((seed * 7 + Math.abs(dx * 2 + dz)) % 9) / 10,
    );
  }
}

const STONE_GLSL = /* glsl */ `
float towerHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
/** Coursed ashlar: 0.55 m courses, 1.2 m stones half-bond, dark mortar, a little colour per stone. */
vec3 towerStone(vec2 uv) {
  float row = floor(uv.y / 0.55);
  float x = uv.x + mod(row, 2.0) * 0.6;
  float col = floor(x / 1.2);
  vec2 f = vec2(fract(x / 1.2) * 1.2, fract(uv.y / 0.55) * 0.55);
  float mortar = min(min(f.x, 1.2 - f.x), min(f.y, 0.55 - f.y));
  float jitter = towerHash(vec2(col, row));
  float tone = 0.86 + 0.2 * jitter + (envNoise(uv * 0.35) - 0.5) * 0.18;
  return vec3(tone * mix(0.55, 1.0, smoothstep(0.02, 0.06, mortar)));
}
/** Slate shingles: courses down the slope, each tile lighter at its lower lip. */
vec3 towerSlate(vec2 uv) {
  float row = floor(uv.y / 0.42);
  float x = uv.x + mod(row, 2.0) * 0.3;
  float f = fract(uv.y / 0.42);
  float gap = smoothstep(0.0, 0.05, min(fract(x / 0.6), 1.0 - fract(x / 0.6)));
  float tone = 0.72 + 0.4 * (1.0 - f) + 0.16 * towerHash(vec2(floor(x / 0.6), row));
  return vec3(tone * mix(0.45, 1.0, gap) * mix(0.55, 1.0, smoothstep(0.0, 0.12, f)));
}
`;

function stoneMaterial(): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true });
  const key = "tower-exterior";
  patchShader(material, key, (shader) => {
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>":
        "#include <common>\nattribute vec3 aSurface;\nvarying vec3 vSurface;\nvarying float vTowerY;",
      "#include <begin_vertex>":
        "#include <begin_vertex>\nvSurface = aSurface;\nvTowerY = (modelMatrix * vec4(position, 1.0)).y;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\nvarying vec3 vSurface;\nvarying float vTowerY;\n${NOISE_GLSL}\n${STONE_GLSL}\nfloat towerGlow;\nvec3 towerGlowColor;`,
      "#include <color_fragment>": `#include <color_fragment>
        towerGlow = 0.0;
        towerGlowColor = vec3(0.0);
        if (vSurface.z < 0.5) {
          diffuseColor.rgb *= towerStone(vSurface.xy);
        } else if (vSurface.z < 1.5) {
          diffuseColor.rgb *= towerSlate(vSurface.xy);
        } else {
          // Arched window: rounded head, deep stone frame, mullion and transom; lit warm or ghostly.
          vec2 w = vSurface.xy;
          float seed = fract(vSurface.z - 2.0);
          vec2 c = vec2(abs(w.x - 0.5) * 2.0, w.y);
          float arch = c.y < 0.72 ? c.x : length(vec2(c.x, (c.y - 0.72) / 0.28));
          if (arch > 1.0) discard;
          float frame = smoothstep(0.78, 0.84, arch);
          float bars = max(1.0 - smoothstep(0.03, 0.07, abs(w.x - 0.5)), 1.0 - smoothstep(0.02, 0.05, abs(w.y - 0.55)));
          vec3 light = seed < 0.38 ? vec3(1.0, 0.68, 0.34) : seed < 0.62 ? vec3(0.7, 0.62, 0.95) : vec3(0.0);
          float pane = (1.0 - frame) * (1.0 - bars);
          towerGlow = pane * (0.6 + 0.4 * w.y);
          towerGlowColor = light;
          diffuseColor.rgb = mix(vec3(0.05, 0.04, 0.07), diffuseColor.rgb * 0.7, max(frame, bars));
        }`,
      "#include <emissivemap_fragment>": `#include <emissivemap_fragment>
        totalEmissiveRadiance += towerGlowColor * towerGlow * 1.6;`,
      // Depth fog toward the scene haze: the drop reads as tens of metres, not as a dark pit.
      "#include <fog_fragment>": `#ifdef USE_FOG
        // Weathered stone holds less of the night's blue than the floor does: dusky lilac-grey.
        gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11))), gl_FragColor.rgb, mix(0.55, 1.0, towerGlow));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, pow(1.0 - smoothstep(${FOG_BOTTOM.toFixed(1)}, ${FOG_TOP.toFixed(1)}, vTowerY), 0.75));
        #endif
        #include <fog_fragment>`,
    });
  });
  return material;
}

/** A sheet of mist far below, drifting with the wind and thinning at its holes. */
function mistMaterial(wind: WindUniforms, color: Color): MeshBasicMaterial {
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const key = "tower-mist";
  patchShader(material, key, (shader) => {
    shader.uniforms.uWindTime = wind.uWindTime;
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>": "#include <common>\nvarying vec2 vMist;",
      "#include <begin_vertex>":
        "#include <begin_vertex>\nvMist = (modelMatrix * vec4(position, 1.0)).xz;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\nuniform float uWindTime;\nvarying vec2 vMist;\n${NOISE_GLSL}`,
      "#include <color_fragment>": `#include <color_fragment>
        vec2 m = vMist * 0.04 + vec2(uWindTime * 0.006, uWindTime * 0.002);
        float cloud = envNoise(m) * 0.6 + envNoise(m * 2.7 + 4.0) * 0.4;
        diffuseColor.a = smoothstep(0.25, 0.75, cloud) * 0.85;
        diffuseColor.rgb *= 0.9 + 0.2 * cloud;`,
    });
  });
  return material;
}

export function createTowerExterior(terrain: Material, wind: WindUniforms, haze: Color) {
  // The floor ends at the perimeter wall's outer face: past it is the drop.
  patchShader(terrain, "tower-exterior-floor", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "tower-exterior-floor", {
      "#include <clipping_planes_fragment>": `#include <clipping_planes_fragment>
        if (max(abs(vTerrainWorld.x), abs(vTerrainWorld.z)) > ${FACE.toFixed(2)}) discard;`,
    });
  });
  // Dusky lilac-grey stone and slate (Lavender Town's tower), not saturated violet.
  const stone = new Color(0xa08a90);
  const slate = new Color(0x5e5064);
  const trim = new Color(0x7c6d74);
  const builder = new Builder();
  buildSide(builder, stone, slate, trim);
  builder.quarterTurns();
  const tower = new Mesh(builder.geometry(), stoneMaterial());
  const mist = new Mesh(
    new PlaneGeometry(BACKDROP_REACH * 2, BACKDROP_REACH * 2).rotateX(-Math.PI / 2),
    mistMaterial(wind, haze.clone().lerp(new Color(0xffffff), 0.15)),
  );
  mist.position.y = MIST_Y;
  mist.renderOrder = -2;
  return {
    meshes: [tower, mist],
    dispose() {
      tower.geometry.dispose();
      tower.material.dispose();
      mist.geometry.dispose();
      mist.material.dispose();
    },
  };
}
