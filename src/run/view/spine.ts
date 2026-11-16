import { Quaternion, Vector3, type Object3D } from "three";
import type { TailSpring } from "./tail";

/**
 * Most a body bone bends from its parent (rad): a full stop-and-turn curls the body into a loose U, never a knot.
 */
const MAX_BEND = 0.45;
/** Ground speed (u/s) the body creeps at while standing, so a curl left by turning in place slowly lies straight. */
const CREEP = 0.35;

const UP = new Vector3(0, 1, 0);
const up = new Vector3();
const bend = new Quaternion();
const frame = new Quaternion();
const unframe = new Quaternion();
const point = new Vector3();

/**
 * Lets a long body follow its own path when turning instead of swinging round as one stick: each body segment
 * behind the avatar's origin takes the heading the avatar had when it passed that spot. Poses after the mixer,
 * on top of the clip; every bone in `names` must be keyed in each clip, so the mixer rewrites it every frame.
 * `names` run front to back along one chain; the avatar faces +Z.
 */
export function createSpineFollow(
  avatar: Object3D,
  root: Object3D,
  names: readonly string[],
): TailSpring {
  const bones = names.map((name) => {
    const bone = root.getObjectByName(name);
    if (!bone) throw new Error(`${root.name || "模型"} 没有身体骨 ${name}。`);
    return bone;
  });
  // Distance behind the origin, in avatar units, of each segment's middle; measured once on the rest pose.
  avatar.updateWorldMatrix(true, true);
  const joints = bones.map((bone) => -avatar.worldToLocal(bone.getWorldPosition(point)).z);
  const behind = joints.map((d, k) => {
    const next = joints[k + 1] ?? d + (d - (joints[k - 1] ?? d));
    return (d + next) / 2;
  });
  const reach = Math.max(...behind);
  // Heading (unwrapped yaw, rad) against distance travelled: the path the origin left behind.
  const travel: number[] = [0];
  const heading: number[] = [0];
  let walked = 0;
  let yaw = 0;

  function headingAt(at: number): number {
    for (let i = travel.length - 1; i > 0; i--) {
      if (travel[i - 1]! <= at) {
        const t = (at - travel[i - 1]!) / (travel[i]! - travel[i - 1]!);
        return heading[i - 1]! + (heading[i]! - heading[i - 1]!) * t;
      }
    }
    return heading[0]!;
  }

  return {
    dispose() {},
    update(dt, turn, speed) {
      if (dt <= 0) return;
      yaw += turn;
      walked += Math.max(speed, CREEP) * dt;
      travel.push(walked);
      heading.push(yaw);
      while (travel.length > 2 && travel[1]! < walked - reach) {
        travel.shift();
        heading.shift();
      }
      // Each bone turns about the avatar's up axis, expressed in its parent's frame after the mixer. The frame is
      // composed from local rotations: the avatar's dash stretch would skew one read off a world matrix.
      frame.identity();
      for (let node = bones[0]!.parent; node && node !== avatar; node = node.parent)
        frame.premultiply(node.quaternion);
      let previous = 0;
      for (let k = 0; k < bones.length; k++) {
        const bone = bones[k]!;
        const offset = behind[k]! > 0 ? headingAt(walked - behind[k]!) - yaw : 0;
        const angle = Math.min(MAX_BEND, Math.max(-MAX_BEND, offset - previous));
        previous += angle;
        up.copy(UP).applyQuaternion(unframe.copy(frame).invert());
        bone.quaternion.premultiply(bend.setFromAxisAngle(up, angle));
        frame.multiply(bone.quaternion);
      }
    },
  };
}
