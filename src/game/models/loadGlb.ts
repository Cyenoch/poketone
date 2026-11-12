import {
  AnimationClip,
  BufferGeometry,
  InstancedMesh,
  Material,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EmbeddedTextures } from "./embedded-textures";

export interface LoadedModel {
  root: Object3D;
  animations: AnimationClip[];
  /** Frees the GPU copies only (see `rendering/releaseUploads.ts`); the model stays usable and re-uploads. */
  releaseUploads(): void;
  dispose(): void;
}

const unsupportedExtensions: Record<string, true> = {
  KHR_draco_mesh_compression: true,
  EXT_meshopt_compression: true,
  KHR_meshopt_compression: true,
  KHR_texture_basisu: true,
};

function validateReferences(json: Record<string, unknown>): void {
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    const extensions = json[key];
    if (
      Array.isArray(extensions) &&
      extensions.some(
        (extension: unknown) =>
          typeof extension === "string" && Object.hasOwn(unsupportedExtensions, extension),
      )
    ) {
      throw new Error("暂不支持 Draco、Meshopt 或 KTX2 压缩；请导出未压缩的 GLB。");
    }
  }
  for (const key of ["buffers", "images"]) {
    const entries = json[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error(`GLB ${key} 数据无效。`);
    for (const [index, entry] of (entries as unknown[]).entries()) {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`GLB ${key} 数据无效。`);
      }
      if ("uri" in entry && (typeof entry.uri !== "string" || !/^data:/i.test(entry.uri))) {
        throw new Error("仅支持自包含 GLB；请将所有纹理和缓冲区嵌入文件。");
      }
      if (key === "buffers" && index > 0 && !("uri" in entry)) {
        throw new Error("GLB 的额外缓冲区必须使用嵌入的 data URI。");
      }
      if (
        key === "images" &&
        (("mimeType" in entry && entry.mimeType === "image/ktx2") ||
          ("uri" in entry &&
            typeof entry.uri === "string" &&
            /^data:image\/ktx2[;,]/i.test(entry.uri)))
      ) {
        throw new Error("暂不支持 KTX2 压缩纹理；请导出 PNG 或 JPEG 纹理。");
      }
    }
  }
}

function validateGlb(data: ArrayBuffer): void {
  if (data.byteLength < 20) throw new Error("GLB 文件头不完整。");
  const view = new DataView(data);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("请选择有效的 glTF 2.0 二进制 GLB 文件。");
  }
  if (view.getUint32(8, true) !== data.byteLength) {
    throw new Error("GLB 文件长度与文件头不一致。");
  }

  let offset = 12;
  let json: unknown;
  let hasJson = false;
  let hasBinary = false;
  while (offset < data.byteLength) {
    if (offset + 8 > data.byteLength) throw new Error("GLB 数据块头不完整。");
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (length % 4 !== 0 || end > data.byteLength) {
      throw new Error("GLB 数据块长度无效。");
    }
    if (offset === 12 && type !== 0x4e4f534a) {
      throw new Error("GLB 的第一个数据块必须是 JSON。");
    }
    if (type === 0x4e4f534a) {
      if (hasJson) throw new Error("GLB 只能包含一个 JSON 数据块。");
      hasJson = true;
      try {
        json = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data, start, length)),
        );
      } catch (cause) {
        throw new Error("GLB JSON 数据无效。", { cause });
      }
    } else if (type === 0x004e4942) {
      if (hasBinary) throw new Error("GLB 只能包含一个二进制数据块。");
      hasBinary = true;
    }
    offset = end;
  }
  if (!hasJson || json === null || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("GLB 缺少有效的 JSON 对象。");
  }
  validateReferences(json as Record<string, unknown>);
}

class ModelResources {
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly textures = new Set<Texture>();
  private readonly skeletons = new Set<Skeleton>();
  private readonly instances = new Set<InstancedMesh>();
  private disposed = false;

  collect(value: unknown): void {
    if (Array.isArray(value)) {
      for (const entry of value) this.collect(entry);
    } else if (value instanceof Object3D) {
      value.traverse((object) => {
        if ("geometry" in object) this.collect(object.geometry);
        if ("material" in object) this.collect(object.material);
        if (object instanceof SkinnedMesh) this.collect(object.skeleton);
        if (object instanceof InstancedMesh) this.instances.add(object);
      });
    } else if (value instanceof BufferGeometry && !this.geometries.has(value)) {
      this.geometries.add(value);
    } else if (value instanceof Material && !this.materials.has(value)) {
      this.materials.add(value);
      for (const property of Object.values(value)) {
        if (property instanceof Texture) this.collect(property);
      }
    } else if (value instanceof Texture && !this.textures.has(value)) {
      this.textures.add(value);
    } else if (value instanceof Skeleton && !this.skeletons.has(value)) {
      this.skeletons.add(value);
    }
  }

  releaseUploads(): void {
    for (const instance of this.instances) instance.dispose();
    for (const skeleton of this.skeletons) skeleton.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseUploads();
  }
}

export async function loadGlb(file: File): Promise<LoadedModel> {
  if (!/\.glb$/i.test(file.name)) throw new Error("请选择 .glb 文件。");
  const data = await file.arrayBuffer();
  // Validate before GLTFLoader can resolve any buffer or image URI. Blob URLs
  // created internally for embedded images remain local and need no URL rewrite.
  // The name and size received tell a truncated download from other content.
  try {
    validateGlb(data);
  } catch (cause) {
    throw new Error(`${file.name}（${data.byteLength} 字节）：${(cause as Error).message}`, {
      cause,
    });
  }

  const resources = new ModelResources();
  let images: EmbeddedTextures | undefined;
  const loader = new GLTFLoader().register((parser) => (images = new EmbeddedTextures(parser)));
  const gltf = await loader.parseAsync(data, "").catch(async (cause: unknown) => {
    await images?.dispose();
    throw cause;
  });
  resources.collect(gltf.scenes);
  const root = gltf.scene ?? gltf.scenes[0];
  if (!root) {
    resources.dispose();
    await images?.dispose();
    throw new Error("GLB 未包含可预览的场景。");
  }
  return {
    root,
    animations: gltf.animations,
    releaseUploads: () => resources.releaseUploads(),
    dispose() {
      resources.dispose();
      void images?.dispose();
    },
  };
}
