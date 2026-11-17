import {
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  PlaneGeometry,
  type Object3D,
  type Texture,
  Vector3,
} from "three";
import { formOf } from "../../sim/evolution";
import { sampleDepth } from "../../sim/surface";
import type { World } from "../../sim/state/world";
import { formModels } from "../assets";
import { glslVec, type FootprintLook } from "../stageThemes";
import { SURFACE_GLSL, TERRAIN_GLSL, type TerrainUniforms } from "../terrain";
import { fxMaterial } from "../vfx/gl";
import { GroundChannel, type GroundLayers } from "./ground";
import { SURF_GLSL } from "./sea";
import { WIND_GLSL, type WindUniforms } from "./wind";

/** Ground length of one drag-groove piece: about ten to a slither wavelength; longer ones read as a zigzag. */
const SEGMENT = 0.14;
/**
 * Four players dragging at once on the longest-lived theme (glacier, 9 s): the drag bone covers at most about
 * 8 u/s (a trained Dragonair's walk, dashes and the slither's sway), 8 × 9 / SEGMENT ≈ 515 pieces each, plus
 * room for prints. Past that the oldest pieces simply give way early.
 */
const CAPACITY = 2560;
/** Longest piece one frame may lay (8 u/s at 10 fps); a longer step is a jump, not a slither. */
const MAX_PIECE = 1;
const STRIDE = 9;
const PRINT = 0;
const GROOVE = 1;

/** Steepest mitre (end shift per unit across): sharper turns leave a small notch instead of a spike. */
const MAX_MITRE = 0.8;

/** `along / across`, held within ±`limit`; a full reversal has no mean side (0 / 0) and stays square. */
const mitreShift = (along: number, across: number, limit: number) =>
  Math.abs(across) < 1e-6 ? 0 : Math.max(-limit, Math.min(limit, along / across));

/**
 * Fixed ring of small ground stamps: no stamp objects, no per-frame compaction or allocations. Each form's
 * `FormModel.trail` picks paw prints, a continuous groove, or nothing. Groove pieces share mitred ends, so
 * the line has no seams where it bends.
 */
export function createFootprints(
  world: World,
  terrain: TerrainUniforms,
  layers: GroundLayers,
  surfaceTexture: Texture,
  wind: WindUniforms,
  look: FootprintLook,
) {
  const surface = world.map.terrain.surface!;
  const sea = surface.liquids.some((liquid) => liquid.kind === "water");
  const data = new Float32Array(CAPACITY * STRIDE);
  const buffer = new InstancedInterleavedBuffer(data, STRIDE).setUsage(DynamicDrawUsage);
  const plane = new PlaneGeometry(1, 1, 2, 2);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.setAttribute("iPrint", new InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute("iSize", new InterleavedBufferAttribute(buffer, 3, 4));
  geometry.setAttribute("iMitre", new InterleavedBufferAttribute(buffer, 2, 7));
  geometry.instanceCount = 0;
  const material = fxMaterial({
    uniforms: { ...terrain, ...wind, uSurfaceDepth: { value: surfaceTexture } },
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      ${TERRAIN_GLSL}
      attribute vec4 iPrint; // x, z, yaw, birth
      attribute vec3 iSize; // across, along, kind
      attribute vec2 iMitre; // back and front end shift along per unit across
      varying vec2 vPrintUv;
      varying vec2 vPrintWorld;
      varying float vBirth;
      varying float vKind;
      void main() {
        vec2 q = (uv - 0.5) * iSize.xy;
        q.y += q.x * mix(iMitre.x, iMitre.y, uv.y);
        vec2 f = vec2(sin(iPrint.z), cos(iPrint.z));
        vec2 p = iPrint.xy + vec2(-f.y, f.x) * q.x + f * q.y;
        vPrintUv = uv * 2.0 - 1.0;
        vPrintWorld = p;
        vBirth = iPrint.w;
        vKind = iSize.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(p.x, terrainHeight(p) + 0.018, p.y, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${TERRAIN_GLSL}
      ${SURFACE_GLSL}
      ${WIND_GLSL}
      ${sea ? SURF_GLSL : ""}
      varying vec2 vPrintUv;
      varying vec2 vPrintWorld;
      varying float vBirth;
      varying float vKind;
      void main() {
        float age = uWindTime - vBirth;
        float fade = 1.0 - smoothstep(${(look.lifetime * 0.35).toFixed(3)}, ${look.lifetime.toFixed(3)}, age);
        if (fade <= 0.0) discard;
        float wet = 0.0;
        ${
          sea
            ? /* glsl */ `
        float depth = surfaceDepth(vPrintWorld).r;
        if (depth > 0.0) discard;
        float shore = seaShore(vPrintWorld, depth);
        if (shore < 2.0) {
          float phase = envNoise(vPrintWorld * 0.055) * 0.75 + envNoise(vPrintWorld * 0.15 + 3.3) * 0.18;
          float now = uWindTime / SURF_PERIOD + phase;
          float born = vBirth / SURF_PERIOD + phase;
          float cycle = floor(now);
          float front = surfFront(fract(now), surfRunup(vPrintWorld, cycle));
          front = max(front, surfFront(fract(born), surfRunup(vPrintWorld, floor(born))));
          // Include every intervening crest: a washed print never reappears on the draw-back.
          for (int i = 0; i < 3; i++) {
            float c = cycle - float(i);
            if (c + SURF_RISE >= born && c + SURF_RISE <= now)
              front = max(front, surfRunup(vPrintWorld, c));
          }
          fade *= smoothstep(front, front + 0.12, shore);
          wet = seaSurf(vPrintWorld, shore).wet;
        }`
            : ""
        }
        vec2 q = vPrintUv;
        float d;
        float shade;
        if (vKind < 0.5) {
          // A heel pad and three toes: readable as a small paw, oriented once when it lands.
          float pad = length((q - vec2(0.0, -0.2)) / vec2(0.58, 0.65)) - 1.0;
          float toes = min(length((q - vec2(-0.42, 0.48)) / vec2(0.24, 0.3)),
            min(length((q - vec2(0.0, 0.65)) / vec2(0.24, 0.3)),
                length((q - vec2(0.42, 0.48)) / vec2(0.24, 0.3)))) - 1.0;
          d = min(pad, toes);
          shade = 0.75 + 0.25 * smoothstep(-0.7, 0.6, q.y);
        } else {
          // A groove piece: uniform along its length so abutting pieces read as one line, deepest in the middle.
          d = abs(q.x) / 0.55 - 1.0;
          shade = 0.75 + 0.25 * smoothstep(-1.0, 0.0, d);
        }
        float edge = max(fwidth(d), mix(${look.softness.toFixed(3)}, 0.025, wet));
        float inside = 1.0 - smoothstep(-edge, edge, d);
        float lip = (1.0 - smoothstep(0.04, 0.22 + edge, d)) * (1.0 - inside);
        float alpha = (inside + lip * 0.28) * fade * ${look.strength.toFixed(3)} * mix(1.0, 1.25, wet);
        vec3 color = mix(${glslVec(look.ink)} * shade, ${glslVec(look.rim)}, lip);
        gl_FragColor = vec4(color * alpha, alpha);
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "footprints";
  mesh.frustumCulled = false;
  mesh.renderOrder = -0.5;
  mesh.visible = false;
  const walkers = world.players.map((p) => ({
    x: p.x,
    z: p.z,
    travel: 0,
    side: 1,
    // Where the drag bone's groove last ended; NaN until the next piece can start.
    dragX: Number.NaN,
    dragZ: 0,
    // The groove piece that ends there (ring slot, birth, yaw) for the next piece to mitre onto; -1 for none.
    piece: -1,
    pieceBirth: 0,
    pieceYaw: 0,
  }));
  const bone = new Vector3();
  let cursor = 0;
  let latest = -Infinity;
  // Ring slots written this frame: only they are uploaded.
  let dirtyLo = CAPACITY;
  let dirtyHi = -1;
  const touch = (slot: number) => {
    dirtyLo = Math.min(dirtyLo, slot);
    dirtyHi = Math.max(dirtyHi, slot);
  };

  const soft = (x: number, z: number) =>
    sampleDepth(surface.water, x, z) <= 0 &&
    sampleDepth(surface.lava, x, z) <= 0 &&
    layers.sample(GroundChannel.earth, x, z) <= 0.4;

  // Mitre of the joint between a piece heading `a` and the next heading `b`: the shift along each piece's own
  // forward per unit across (`side` = (−cos, sin) as in the shader), so both ends trace one line. Within
  // `limit` a piece's two mitred ends never cross.
  let mitreBack = 0;
  let mitreFront = 0;
  function mitre(a: number, b: number, limit: number) {
    const fax = Math.sin(a),
      faz = Math.cos(a),
      fbx = Math.sin(b),
      fbz = Math.cos(b);
    const mx = -faz - fbz,
      mz = fax + fbx;
    mitreBack = mitreShift(mx * fax + mz * faz, -mx * faz + mz * fax, limit);
    mitreFront = mitreShift(mx * fbx + mz * fbz, -mx * fbz + mz * fbx, limit);
  }

  function stamp(x: number, z: number, yaw: number, across: number, along: number, kind: number) {
    const offset = cursor * STRIDE;
    data[offset] = x;
    data[offset + 1] = z;
    data[offset + 2] = yaw;
    data[offset + 3] = wind.uWindTime.value;
    data[offset + 4] = across;
    data[offset + 5] = along;
    data[offset + 6] = kind;
    data[offset + 7] = 0;
    data[offset + 8] = 0;
    latest = wind.uWindTime.value;
    touch(cursor);
    cursor = (cursor + 1) % CAPACITY;
    geometry.instanceCount = Math.min(CAPACITY, geometry.instanceCount + 1);
  }

  return {
    mesh,
    /** `dragBone(i)` is player i's `PlayerRig.drag`, posed for this frame. */
    update(alpha: number, dragBone: (player: number) => Object3D | null) {
      for (let i = 0; i < world.players.length; i++) {
        const p = world.players[i]!;
        const last = walkers[i]!;
        const x = p.px + (p.x - p.px) * alpha;
        const z = p.pz + (p.z - p.pz) * alpha;
        const dx = x - last.x,
          dz = z - last.z;
        const distance = Math.hypot(dx, dz);
        last.x = x;
        last.z = z;
        const form = formOf(p);
        const { trail } = formModels[form.id];
        if (!p.alive || distance > 2 || trail === "none") {
          last.travel = 0;
          last.dragX = Number.NaN;
          last.piece = -1;
          continue;
        }
        const size = Math.max(0.25, Math.min(0.48, form.radius * 0.8));
        if (trail === "prints") {
          last.travel += distance;
          if (distance < 0.001 || last.travel < size * 1.8) continue;
          last.travel %= size * 1.8;
          const px = x + (dz / distance) * size * 0.5 * last.side;
          const pz = z - (dx / distance) * size * 0.5 * last.side;
          last.side *= -1;
          if (soft(px, pz)) stamp(px, pz, Math.atan2(dx, dz), size, size * 1.35, PRINT);
          continue;
        }
        // Standing still the body sways in place: hold the groove's end until it moves on.
        if (distance < 0.001) continue;
        dragBone(i)!.getWorldPosition(bone);
        const sx = bone.x - last.dragX,
          sz = bone.z - last.dragZ;
        const length = Math.hypot(sx, sz);
        if (length < SEGMENT) continue;
        const mx = last.dragX + sx * 0.5,
          mz = last.dragZ + sz * 0.5;
        last.dragX = bone.x;
        last.dragZ = bone.z;
        // A fresh start (NaN) or a jump only moves the groove's end; no piece bridges the gap.
        if (!(length < MAX_PIECE && soft(mx, mz))) {
          last.piece = -1;
          continue;
        }
        const yaw = Math.atan2(sx, sz);
        const slot = cursor;
        stamp(mx, mz, yaw, size, length, GROOVE);
        // The shared end lies along the two pieces' mean side; a ring slot already reused starts afresh.
        if (last.piece >= 0 && data[last.piece * STRIDE + 3] === last.pieceBirth) {
          const shorter = Math.min(length, data[last.piece * STRIDE + 5]!);
          mitre(last.pieceYaw, yaw, Math.min(MAX_MITRE, shorter / size));
          data[last.piece * STRIDE + 8] = mitreBack;
          touch(last.piece);
          data[slot * STRIDE + 7] = mitreFront;
        }
        last.piece = slot;
        last.pieceBirth = data[slot * STRIDE + 3]!;
        last.pieceYaw = yaw;
      }
      if (dirtyHi >= 0) {
        buffer.clearUpdateRanges();
        buffer.addUpdateRange(dirtyLo * STRIDE, (dirtyHi - dirtyLo + 1) * STRIDE);
        buffer.needsUpdate = true;
        dirtyLo = CAPACITY;
        dirtyHi = -1;
      }
      mesh.visible = wind.uWindTime.value - latest < look.lifetime;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
