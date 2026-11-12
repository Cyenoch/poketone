import {
  AnimationMixer,
  GreaterDepth,
  LoopRepeat,
  MeshBasicMaterial,
  Matrix4,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Group,
  type Material,
} from "three";
import { formModels, type PlayerModel } from "./assets";
import { shadeUnderClouds } from "./environment/clouds";
import type { WindUniforms } from "./environment/wind";
import { creatureLook, lambertCopy, ownShadowDepth } from "./materials";
import { createTailSpring, type TailSpring } from "./tail";

/** One form's model mounted under the avatar: its looks, x-ray silhouette and clips. */
export interface PlayerRig {
  mixer: AnimationMixer;
  run: AnimationAction;
  idle: AnimationAction;
  /** Ground speed of the run clip at timeScale 1. */
  clipSpeed: number;
  /** Gait cycles in one loop of the run clip. */
  runCycles: number;
  /** Rise that puts each clip's lowest point on the ground (`FormModel.lift`); blend by the clips' weights. */
  lift: { run: number; idle: number };
  /** Tail secondary motion, posed after the mixer; null without a tail chain. */
  tail: TailSpring | null;
  /** Lowest foot/toe surface in avatar space after mixing; excludes shells and procedural tails. */
  footFloor(): number;
  /** Takes the model off the avatar and frees what the rig made (the caller owns the model). */
  unmount(): void;
}

function pickClip(names: string[], wanted: string[]): string | undefined {
  return names.find((name) => wanted.some((w) => name.toLowerCase().includes(w)));
}

export function mountRig(avatar: Group, player: PlayerModel, wind: WindUniforms): PlayerRig {
  const made: Material[] = [];
  // X-ray silhouette: drawn only where terrain or props hide the player.
  const silhouette = new MeshBasicMaterial({
    color: "#ffd45b",
    transparent: true,
    opacity: 0.55,
    depthFunc: GreaterDepth,
    depthWrite: false,
  });
  silhouette.stencilWrite = true;
  silhouette.stencilRef = 1;
  silhouette.stencilFunc = NotEqualStencilFunc;
  made.push(silhouette);
  const skinned: SkinnedMesh[] = [];
  player.holder.traverse((node) => {
    if (node instanceof SkinnedMesh) skinned.push(node);
  });
  const ghosts: SkinnedMesh[] = [];
  // Put back on unmount: the model is the run's, and the next zone's view mounts it again.
  const originals = skinned.map((mesh) => [mesh.material, mesh.customDepthMaterial] as const);
  for (const mesh of skinned) {
    const looks = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((source) => {
      const material = creatureLook(lambertCopy(source));
      shadeUnderClouds(material, wind);
      // The visible body marks the stencil, so the silhouette never shows the player's own far limbs.
      material.stencilWrite = true;
      material.stencilRef = 1;
      material.stencilZPass = ReplaceStencilOp;
      made.push(material);
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? looks : looks[0]!;
    made.push(ownShadowDepth(mesh));
    const ghost = new SkinnedMesh(mesh.geometry, silhouette);
    ghost.bind(mesh.skeleton, mesh.bindMatrix);
    ghost.frustumCulled = false;
    ghost.renderOrder = 5;
    mesh.parent?.add(ghost);
    ghosts.push(ghost);
  }
  avatar.add(player.holder);
  player.holder.updateWorldMatrix(true, true);
  const point = new Vector3();
  const local = new Matrix4();
  const transform = new Matrix4();
  const feet = skinned.map((mesh) => {
    const indices: number[] = [];
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    for (let i = 0; i < skinIndex!.count; i++) {
      let slot = 0;
      for (let j = 1; j < 4; j++)
        if (skinWeight!.getComponent(i, j) > skinWeight!.getComponent(i, slot)) slot = j;
      const bone = mesh.skeleton.bones[skinIndex!.getComponent(i, slot)]!;
      if (/Foot|Toe/.test(bone.name)) indices.push(i);
    }
    return { mesh, indices };
  });

  const mixer = new AnimationMixer(player.model.root);
  const clips = player.model.animations;
  const names = clips.map((clip) => clip.name);
  const action = (wanted: string): AnimationAction => {
    const clip = clips.find((c) => c.name === pickClip(names, [wanted]));
    if (!clip)
      throw new Error(
        `${formModels[player.form].url} 缺少 ${wanted} 动画（有：${names.join("、")}）。`,
      );
    return mixer.clipAction(clip).setLoop(LoopRepeat, Infinity);
  };
  const { runClipSpeed: clipSpeed, runCycles, lift } = formModels[player.form];
  const run = action("run");
  const idle = action("idle");
  run.play();
  idle.play();
  const tail = player.tail.length === 0 ? null : createTailSpring(player.tail);
  return {
    mixer,
    run,
    idle,
    clipSpeed,
    runCycles,
    lift,
    tail,
    footFloor() {
      avatar.updateWorldMatrix(true, false);
      player.holder.updateMatrixWorld(true);
      const inverse = local.copy(avatar.matrixWorld).invert();
      let floor = Infinity;
      for (const { mesh, indices } of feet) {
        transform.multiplyMatrices(inverse, mesh.matrixWorld);
        for (const index of indices) {
          mesh.getVertexPosition(index, point).applyMatrix4(transform);
          floor = Math.min(floor, point.y);
        }
      }
      return floor;
    },
    unmount() {
      mixer.stopAllAction();
      mixer.uncacheRoot(player.model.root);
      tail?.dispose();
      for (const ghost of ghosts) ghost.removeFromParent();
      avatar.remove(player.holder);
      skinned.forEach((mesh, i) => {
        [mesh.material, mesh.customDepthMaterial] = originals[i]!;
      });
      for (const material of made) material.dispose();
    },
  };
}
