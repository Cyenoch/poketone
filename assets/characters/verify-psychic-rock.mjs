// CPU acceptance of the actual exported files, loader, tail preparation and player rig lifecycle.
// bun assets/characters/verify-psychic-rock.mjs [directory containing the six GLBs]
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Box3, Group, SkinnedMesh, Vector3 } from "three";
import { installResources } from "../../src/platform/resources.ts";
import { nativeResources } from "../../src/platform/native/resources.ts";
import { loadGlb } from "../../src/game/models/loadGlb.ts";
import { canonicalModel, formModels, instantiate } from "../../src/run/view/assets.ts";
import { formDefs } from "../../src/run/sim/content/lines/index.ts";
import { mountRig } from "../../src/run/view/playerRig.ts";
import { createWindUniforms } from "../../src/run/view/environment/wind.ts";
import { stageThemes } from "../../src/run/view/stageThemes.ts";

const publicRoot = new URL("../../public/", import.meta.url);
installResources(nativeResources(publicRoot));
const directory = process.argv[2] ?? fileURLToPath(new URL("models/", publicRoot));
const reports = [];
for (const form of ["abra", "kadabra", "alakazam", "geodude", "graveler", "golem"]) {
  const spec = formModels[form];
  assert.equal(spec.url, `/models/${form}.glb`);
  const bytes = await Bun.file(resolve(directory, `${form}.glb`)).arrayBuffer();
  const loaded = await loadGlb(new File([bytes], `${form}.glb`));
  assert.deepEqual(loaded.animations.map((c) => c.name).sort(), ["idle", "run"]);
  const canonical = canonicalModel(spec.url, loaded);
  const instance = instantiate(canonical);
  const meshes = [];
  instance.root.traverse((o) => {
    if (o instanceof SkinnedMesh) meshes.push(o);
  });
  assert.equal(meshes.length, 1, `${form}: exactly one skinned mesh`);
  const mesh = meshes[0];
  assert(!Array.isArray(mesh.material), `${form}: single base-colour material`);
  assert.equal(mesh.material.map.image.width, 1024);
  assert.equal(mesh.material.map.image.height, 1024);
  instance.root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(instance.root, true);
  const scale = formDefs[form].height / box.getSize(new Vector3()).y;
  const holder = new Group();
  holder.scale.setScalar(scale);
  holder.position.y = -box.min.y * scale;
  holder.add(instance.root);
  const player = { form, holder, model: instance, tail: instance.tail };
  const tailRest = () => instance.tail.map((b) => b.quaternion.toArray());
  const rest = tailRest();
  let minFoot = Infinity;
  let maxIdleFoot = -Infinity;
  let maxMotion = 0;
  let firstRun;
  const point = new Vector3();
  for (let mount = 0; mount < 2; mount++) {
    const avatar = new Group();
    const rig = mountRig(avatar, player, createWindUniforms(stageThemes.forest.clouds));
    for (const weight of [0, 0.25, 0.5, 0.75, 1]) {
      rig.idle.setEffectiveWeight(1 - weight);
      rig.run.setEffectiveWeight(weight);
      for (let frame = 0; frame < 144; frame++) {
        rig.mixer.setTime(frame / 60);
        rig.tail?.update(1 / 60, 0.02, 4, weight, frame / 48);
        const foot = rig.footFloor();
        if (form === "geodude")
          assert.equal(foot, Infinity, "hovering form has no false foot bones");
        else {
          assert(Number.isFinite(foot), `${form}: finite mixed skinned sole`);
          minFoot = Math.min(minFoot, foot);
          if (weight === 0) maxIdleFoot = Math.max(maxIdleFoot, Math.abs(foot));
        }
        if (weight === 1 && frame === 0) firstRun = mesh.getVertexPosition(0, point).clone();
        if (weight === 1) {
          maxMotion = Math.max(maxMotion, mesh.getVertexPosition(0, point).distanceTo(firstRun));
        }
      }
    }
    const floor = rig.footFloor();
    avatar.position.set(12, -7, 4);
    avatar.rotation.y = 1.2;
    avatar.scale.set(0.5, 3, 2);
    const moved = rig.footFloor();
    assert(
      floor === Infinity || Math.abs(floor - moved) < 1e-5,
      `${form}: contact invariant under avatar transforms`,
    );
    rig.unmount();
    assert.deepEqual(tailRest(), rest, `${form}: tail rest restored on unmount`);
    assert.equal(holder.parent, null);
  }
  assert(maxMotion > 0.005, `${form}: run changes actual skinned geometry`);
  if (form !== "geodude")
    assert(maxIdleFoot < 0.002, `${form}: idle sole stays planted (${maxIdleFoot})`);
  reports.push({
    form,
    bytes: bytes.byteLength,
    triangles: mesh.geometry.index.count / 3,
    bones: mesh.skeleton.bones.length,
    clips: loaded.animations.map((c) => [c.name, c.duration]),
    maxIdleFoot,
    minMixedFoot: minFoot,
    maxMotion,
    tailBones: instance.tail.length,
  });
  instance.dispose();
  loaded.dispose();
}
console.log(
  JSON.stringify(
    {
      scope:
        "CPU loader, native image decode, mixed skin contact and remount; no GPU or game acceptance",
      reports,
    },
    null,
    2,
  ),
);
