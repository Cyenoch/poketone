import { Bone, Matrix4, Quaternion, SkinnedMesh, Vector3, type Object3D } from "three";

/**
 * Where a form's tail lies, for a bone chain the GLB doesn't have: Tripo's biped rigs have no tail bones and skin
 * the tail rigidly to the pelvis or waist (Pikachu's blade to its left arm), so it never moves on its own.
 */
export interface TailSpec {
  /** Bone the chain hangs off; with the spring at rest the tail moves exactly as this bone. */
  parent: string;
  /** Bones the tail is skinned to in the GLB. Only their vertices can join the chain, which keeps legs and shells out. */
  carriers: readonly string[];
  /** Centreline in the GLB's bind space (+X forward, +Y up, +Z right), root first; one bone per segment. */
  points: readonly (readonly [number, number, number])[];
  /** Vertices farther than this from the centreline stay on the body (bind-space units). */
  radius: number;
}

/**
 * Adds the tail chain to a freshly loaded model: bones under `spec.parent` along the centreline, and the tail's
 * vertices reweighted along them (blending into their old weights over the root half of the first segment). Runs
 * once per load, before anything binds to the skeleton; returns the chain, root first.
 */
export function rigTail(root: Object3D, spec: TailSpec, url: string): Bone[] {
  const meshes: SkinnedMesh[] = [];
  root.traverse((node) => {
    if (node instanceof SkinnedMesh) meshes.push(node);
  });
  const [mesh] = meshes;
  if (!mesh || meshes.length !== 1) throw new Error(`${url} 的尾巴需要恰好一个蒙皮网格。`);
  const { skeleton, geometry } = mesh;
  const parentIndex = skeleton.bones.findIndex((bone) => bone.name === spec.parent);
  if (parentIndex < 0) throw new Error(`${url} 没有尾巴的父骨 ${spec.parent}。`);
  const carriers = new Set(
    spec.carriers.map((name) => {
      const index = skeleton.bones.findIndex((bone) => bone.name === name);
      if (index < 0) throw new Error(`${url} 没有尾巴所在的骨 ${name}。`);
      return index;
    }),
  );

  // Bone k sits at points[k] with bind-space axes, so its rest pose reproduces the parent's skinning exactly.
  const points = spec.points.map(([x, y, z]) => new Vector3(x, y, z));
  const first = skeleton.bones.length;
  let parent: Object3D = skeleton.bones[parentIndex]!;
  let parentBind = skeleton.boneInverses[parentIndex]!.clone().invert();
  const chain: Bone[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const bind = new Matrix4().makeTranslation(points[k]!);
    const bone = new Bone();
    bone.name = `Tail${k}`;
    parentBind.invert().multiply(bind).decompose(bone.position, bone.quaternion, bone.scale);
    parent.add(bone);
    skeleton.bones.push(bone);
    skeleton.boneInverses.push(bind.clone().invert());
    chain.push(bone);
    parent = bone;
    parentBind = bind;
  }
  skeleton.init();

  const segments = points.length - 1;
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const rootAxis = points[1]!.clone().sub(points[0]!);
  const p = new Vector3();
  const ab = new Vector3();
  const closest = new Vector3();
  const index = [0, 0, 0, 0];
  const weight = [0, 0, 0, 0];
  for (let i = 0; i < position.count; i++) {
    let dominant = 0;
    for (let slot = 0; slot < 4; slot++) {
      index[slot] = skinIndex.getComponent(i, slot);
      weight[slot] = skinWeight.getComponent(i, slot);
      if (weight[slot]! > weight[dominant]!) dominant = slot;
    }
    if (!carriers.has(index[dominant]!)) continue;
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix);
    if (closest.subVectors(p, points[0]!).dot(rootAxis) < 0) continue;
    let segment = -1;
    let along = 0;
    let nearest = spec.radius;
    for (let k = 0; k < segments; k++) {
      ab.subVectors(points[k + 1]!, points[k]!);
      const t = Math.min(1, Math.max(0, closest.subVectors(p, points[k]!).dot(ab) / ab.lengthSq()));
      const distance = closest.copy(points[k]!).addScaledVector(ab, t).distanceTo(p);
      if (distance < nearest) {
        nearest = distance;
        segment = k;
        along = t;
      }
    }
    if (segment < 0) continue;
    // Each bone owns its segment and shares the halves next to a joint with its neighbour.
    let a = first + segment;
    let b = a;
    let toB = 0;
    if (along < 0.5 && segment > 0) {
      a = first + segment - 1;
      b = first + segment;
      toB = 0.5 + along;
    } else if (along > 0.5 && segment < segments - 1) {
      b = first + segment + 1;
      toB = along - 0.5;
    }
    if (segment === 0 && along < 0.5) {
      // Root: fade from the body's three strongest influences into the first bone.
      const tail = smoothstep(along / 0.5);
      let weakest = 0;
      for (let slot = 1; slot < 4; slot++) if (weight[slot]! < weight[weakest]!) weakest = slot;
      const kept = 1 - weight[weakest]!;
      for (let slot = 0; slot < 4; slot++) weight[slot] = (weight[slot]! / kept) * (1 - tail);
      index[weakest] = a;
      weight[weakest] = tail;
      skinIndex.setXYZW(i, index[0]!, index[1]!, index[2]!, index[3]!);
      skinWeight.setXYZW(i, weight[0]!, weight[1]!, weight[2]!, weight[3]!);
    } else {
      skinIndex.setXYZW(i, a, b, 0, 0);
      skinWeight.setXYZW(i, 1 - toB, toB, 0, 0);
    }
  }
  skinIndex.needsUpdate = true;
  skinWeight.needsUpdate = true;
  return chain;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Root and follower stiffness (rad/s) and damping ratio: under-damped for one small overshoot when settling. */
const ROOT_STIFFNESS = 11;
const FOLLOW_STIFFNESS = 16;
const DAMPING = 0.55;
/** Share of the body's turn the tail keeps in world space before the spring pulls it round (lags to the inside). */
const TURN_INERTIA = 0.35;
/**
 * Outward swing per unit of sideways acceleration (rad per u/s², speed × yaw rate): a full-speed turn at the
 * avatar's usual 4–5 rad/s settles the root about 0.3 rad outside the turn once the lag has passed.
 */
const SWING_OUT = 0.028;
/** Side-to-side sway per gait cycle and the lift while running (rad, at full run weight). */
const SWAY = 0.1;
const RUN_LIFT = 0.12;
/** Per-bone limits on the swing away from the body (rad), so it never reads as rubber. */
const MAX_YAW = 0.4;
const MAX_PITCH = 0.25;
const MAX_DT = 0.05;
const SUBSTEP = 1 / 120;

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(0, 0, 1);
const yawTurn = new Quaternion();
const pitchTurn = new Quaternion();

export interface TailSpring {
  /**
   * Poses the chain after the mixer: `turn` is this frame's change in body yaw (rad, + = left), `speed` the ground
   * speed (u/s), `run` the run clip's weight, `cycle` the gait phase in cycles (any real; the fraction is used).
   */
  update(dt: number, turn: number, speed: number, run: number, cycle: number): void;
  /** Restores the chain's rest pose when its rig unmounts, before another spring can capture it. */
  dispose(): void;
}

/** Secondary motion for a chain made by `rigTail`, captured at rest and restored on disposal. */
export function createTailSpring(bones: readonly Bone[]): TailSpring {
  const rest = bones.map((bone) => bone.quaternion.clone());
  const n = bones.length;
  // Angles are each bone's absolute deflection in the body frame; a bone's own rotation is the difference to its parent's.
  const yaw = new Float64Array(n);
  const yawRate = new Float64Array(n);
  const pitch = new Float64Array(n);
  const pitchRate = new Float64Array(n);

  function step(h: number, swayTarget: number, liftTarget: number): void {
    for (let k = 0; k < n; k++) {
      const stiffness = k === 0 ? ROOT_STIFFNESS : FOLLOW_STIFFNESS;
      const yawGoal = k === 0 ? swayTarget : yaw[k - 1]!;
      const pitchGoal = k === 0 ? liftTarget : pitch[k - 1]!;
      yawRate[k]! +=
        (stiffness * stiffness * (yawGoal - yaw[k]!) - 2 * DAMPING * stiffness * yawRate[k]!) * h;
      pitchRate[k]! +=
        (stiffness * stiffness * (pitchGoal - pitch[k]!) -
          2 * DAMPING * stiffness * pitchRate[k]!) *
        h;
      yaw[k] = yaw[k]! + yawRate[k]! * h;
      pitch[k] = pitch[k]! + pitchRate[k]! * h;
      // At a limit the bone stops there instead of keeping its speed against the clamp.
      if (Math.abs(yaw[k]!) > MAX_YAW) {
        yaw[k] = clamp(yaw[k]!, MAX_YAW);
        yawRate[k] = 0;
      }
      if (Math.abs(pitch[k]!) > MAX_PITCH) {
        pitch[k] = clamp(pitch[k]!, MAX_PITCH);
        pitchRate[k] = 0;
      }
    }
  }

  return {
    dispose() {
      for (let k = 0; k < n; k++) bones[k]!.quaternion.copy(rest[k]!);
    },
    update(dt, turn, speed, run, cycle) {
      if (dt <= 0) return;
      // + yaw swings a tail that points back (−X) to the right (+Z): outward on a left turn.
      const swingOut = SWING_OUT * speed * (turn / dt);
      const swayTarget = clamp(swingOut + SWAY * run * Math.sin(cycle * Math.PI * 2), MAX_YAW);
      // Lifting a tail that points back (−X) is a negative turn about +Z.
      const liftTarget = -RUN_LIFT * run;
      const span = Math.min(dt, MAX_DT);
      const steps = Math.ceil(span / SUBSTEP);
      // The turn's inertia is spread over the substeps, so a sharp turn reads the same at any frame rate.
      const kick = (turn * TURN_INERTIA) / steps;
      for (let s = 0; s < steps; s++) {
        for (let k = 0; k < n; k++) yaw[k] = clamp(yaw[k]! - kick, MAX_YAW);
        step(span / steps, swayTarget, liftTarget);
      }
      for (let k = 0; k < n; k++) {
        yawTurn.setFromAxisAngle(UP, yaw[k]! - (k === 0 ? 0 : yaw[k - 1]!));
        pitchTurn.setFromAxisAngle(RIGHT, pitch[k]! - (k === 0 ? 0 : pitch[k - 1]!));
        bones[k]!.quaternion.copy(rest[k]!).multiply(yawTurn).multiply(pitchTurn);
      }
    },
  };
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}
