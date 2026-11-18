// Load this batch through the real native decoder and GLB parser, then exercise skin and tail blends.
// bun assets/field-sites/verify-models.mjs (CPU resource/skin check, not a device or GPU acceptance test).
import assert from "node:assert/strict";
import { AnimationMixer, Vector3 } from "three";
import { nativeResources } from "../../src/platform/native/resources.ts";
import { installResources } from "../../src/platform/resources.ts";
import { loadGlb } from "../../src/game/models/loadGlb.ts";
import { rigTail } from "../../src/run/view/tail.ts";

installResources(nativeResources(new URL("../../public/", import.meta.url)));
const catalog = await Bun.file(new URL("../field-models.provenance.json", import.meta.url)).json();
for (const [name, entry] of Object.entries(catalog.models)) {
  if (!entry.output) continue;
  const file = Bun.file(new URL(`../../${entry.output}`, import.meta.url));
  const model = await loadGlb(new File([await file.arrayBuffer()], `${name}.glb`));
  const meshes = [];
  model.root.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  assert.equal(meshes.length, 1, name);
  const mesh = meshes[0];
  assert(!Array.isArray(mesh.material), name);
  assert(mesh.material.map?.image.data?.length > 0 || mesh.geometry.getAttribute("color"), name);
  if (entry.formModel) {
    assert(mesh.isSkinnedMesh, name);
    assert.deepEqual(model.animations.map((clip) => clip.name).sort(), ["idle", "run"]);
    model.root.updateMatrixWorld(true);
    const position = mesh.geometry.getAttribute("position");
    const point = new Vector3();
    const surface = () => {
      model.root.updateMatrixWorld(true);
      mesh.skeleton.update();
      const values = [];
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i);
        mesh.applyBoneTransform(i, point);
        assert(point.toArray().every(Number.isFinite), `${name}: nonfinite skinned vertex`);
        values.push(point.clone());
      }
      return values;
    };
    const before = surface();
    const tail = rigTail(model.root, entry.formModel.tail, entry.output);
    const tailIndices = new Set(tail.map((bone) => mesh.skeleton.bones.indexOf(bone)));
    const skinIndex = mesh.geometry.getAttribute("skinIndex");
    const skinWeight = mesh.geometry.getAttribute("skinWeight");
    let tailVertices = 0;
    for (let i = 0; i < position.count; i++) {
      if (
        [0, 1, 2, 3].some(
          (slot) =>
            tailIndices.has(skinIndex.getComponent(i, slot)) &&
            skinWeight.getComponent(i, slot) > 0.01,
        )
      )
        tailVertices++;
    }
    assert(tailVertices > 20, `${name}: tail centreline did not capture the tail`);
    const after = surface();
    assert(
      before.every((v, i) => v.distanceTo(after[i]) < 1e-5),
      `${name}: tail changed rest surface`,
    );
    const mixer = new AnimationMixer(model.root);
    const idle = mixer.clipAction(model.animations.find((clip) => clip.name === "idle")).play();
    const run = mixer.clipAction(model.animations.find((clip) => clip.name === "run")).play();
    let maxRadius = 0;
    for (const blend of [0, 0.5, 1]) {
      idle.setEffectiveWeight(1 - blend);
      run.setEffectiveWeight(blend);
      for (let frame = 0; frame < 60; frame++) {
        mixer.update(1 / 30);
        tail[0].rotation.y = Math.sin(frame / 10) * 0.25;
        for (const v of surface()) maxRadius = Math.max(maxRadius, v.length());
      }
    }
    assert(maxRadius < 3, `${name}: skin exploded beyond source scale`);
    mixer.stopAllAction();
    mixer.uncacheRoot(model.root);
    console.log(
      "SKIN",
      name,
      "tail segments",
      tail.length,
      "tail vertices",
      tailVertices,
      "max radius",
      maxRadius.toFixed(4),
    );
  } else {
    assert(!mesh.isSkinnedMesh, name);
    assert.equal(model.animations.length, 0, name);
    console.log("STATIC", name);
  }
  model.releaseUploads();
  model.dispose();
}
