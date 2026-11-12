import {
  BufferGeometry,
  LightShadow,
  Material,
  ShaderMaterial,
  SkinnedMesh,
  Texture,
  type Object3D,
} from "three";

/**
 * Frees the GPU copies of everything `root`'s tree has uploaded, through three's own `dispose()`, keeping every CPU
 * object. Call it from `webglcontextlost`: on a lost context the deletes are no-ops and the dispose listeners left by
 * the lost context's managers go away, so three re-uploads cleanly after the restore and later disposes don't delete
 * dead handles on the new context (docs/LESSONS.md). Never detaches nodes or closes images.
 *
 * It only sees the tree: off-tree resources and textures held only in `onBeforeCompile` closures are invisible here,
 * so their owners release them (`releaseUploads()` on RunView, RunAssets, LoadedModel).
 */
export function releaseUploads(root: Object3D): void {
  const released = new Set<{ dispose(): void }>();
  /**
   * three keys instance buffers on the public `isInstancedMesh` flag, not the class (UI kit panels and
   * glyphs set it on their own meshes), and frees them on the object's `dispose` event. Their
   * `dispose()` methods also drop CPU state (three's nulls `morphTexture`, the UI kit's unhooks its
   * matrix updates), so only the event is sent.
   */
  const releaseInstances = (object: InstancedObject) => {
    object.dispatchEvent({ type: "dispose" });
    if (object.morphTexture) release(object.morphTexture);
  };
  const release = (resource: { dispose(): void }) => {
    if (released.has(resource)) return;
    released.add(resource);
    resource.dispose();
  };
  const releaseMaterial = (material: Material) => {
    if (released.has(material)) return;
    release(material);
    for (const value of Object.values(material)) if (value instanceof Texture) release(value);
    if (material instanceof ShaderMaterial) {
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof Texture) release(uniform.value);
      }
    }
  };
  root.traverse((object) => {
    if ("geometry" in object && object.geometry instanceof BufferGeometry) release(object.geometry);
    if ("material" in object) {
      const { material } = object;
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (entry instanceof Material) releaseMaterial(entry);
      }
    }
    if (isInstanced(object)) releaseInstances(object);
    if (object instanceof SkinnedMesh) release(object.skeleton);
    if ("shadow" in object && object.shadow instanceof LightShadow) release(object.shadow);
  });
}

interface InstancedObject {
  isInstancedMesh: true;
  morphTexture?: Texture | null;
  dispatchEvent(event: { type: "dispose" }): void;
}

function isInstanced(object: Object3D): object is Object3D & InstancedObject {
  return "isInstancedMesh" in object && object.isInstancedMesh === true;
}
