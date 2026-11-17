// Load static field models through the real native decoder and GLB parser.
// bun assets/field-sites/verify-models.mjs (CPU resource/skin check, not a device or GPU acceptance test).
import assert from "node:assert/strict";
import { nativeResources } from "../../src/platform/native/resources.ts";
import { installResources } from "../../src/platform/resources.ts";
import { loadGlb } from "../../src/game/models/loadGlb.ts";

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
  assert(!mesh.isSkinnedMesh, name);
  assert.equal(model.animations.length, 0, name);
  console.log("STATIC", name);
  model.releaseUploads();
  model.dispose();
}
