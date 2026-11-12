import {
  Box3,
  BoxGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
  Vector3,
  type BufferGeometry,
} from "three";
import type { Terrain } from "../sim/terrain";
import type { RunAssets } from "./assets";
import { lambertCopy } from "./materials";
import { inject, patchShader } from "./patchShader";
import { glslVec, type ArchitectureLook } from "./stageThemes";

/** Read final collision cells. Connected pillar/tomb components become one fitted model each. */
export function createGridWalls(
  terrain: Terrain,
  look: ArchitectureLook,
  assets: RunAssets["scenery"],
) {
  const group = new Group();
  const owned: { mesh: InstancedMesh; geometry: BufferGeometry; material: MeshLambertMaterial }[] =
    [];
  const walls = terrain.walls!;
  const { origin, resolution, samples, heights, kinds } = walls,
    cell = 1 / resolution;
  const dummy = new Object3D();
  const runs: {
    x: number;
    z: number;
    width: number;
    depth: number;
    height: number;
    floor: number;
  }[] = [];
  for (let gz = 0; gz < samples; gz++)
    for (let gx = 0; gx < samples; gx++) {
      const at = gz * samples + gx;
      if (kinds[at] !== 1) continue;
      const height = heights[at]!,
        floor = terrain.heights[at]!,
        start = gx;
      while (
        gx + 1 < samples &&
        kinds[at + gx - start + 1] === 1 &&
        heights[at + gx - start + 1] === height &&
        terrain.heights[at + gx - start + 1] === floor
      )
        gx++;
      runs.push({
        x: origin + (start + gx) * 0.5 * cell,
        z: origin + gz * cell,
        width: (gx - start + 1) * cell,
        depth: cell,
        height,
        floor,
      });
    }
  const geometry = new BoxGeometry(1, 1, 1);
  const extents = new Float32Array(runs.length * 2);
  const material = new MeshLambertMaterial({ color: look.wall });
  const key = `tower-masonry-${JSON.stringify(look)}`;
  patchShader(material, key, (shader) => {
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>":
        "#include <common>\nattribute vec2 aWallExtent;\nvarying vec3 vMasonry;\nvarying float vWallY;\nvarying float vWallHeight;",
      "#include <begin_vertex>": `#include <begin_vertex>
        vMasonry=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;
        vWallY=vMasonry.y-aWallExtent.x;vWallHeight=aWallExtent.y;`,
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>":
        "#include <common>\nvarying vec3 vMasonry;\nvarying float vWallY;\nvarying float vWallHeight;",
      "#include <color_fragment>": `#include <color_fragment>
        vec3 face=abs(normalize(cross(dFdx(vMasonry),dFdy(vMasonry))));
        vec2 uv=vec2(face.x>face.z?vMasonry.z:vMasonry.x,vMasonry.y);
        float row=floor(uv.y/0.42);uv.x+=mod(row,2.0)*0.46;
        vec2 tile=fract(uv/vec2(0.92,0.42));
        vec2 edge=min(tile,1.0-tile)*vec2(0.92,0.42);
        float seam=1.0-smoothstep(0.012,0.03,min(edge.x,edge.y));
        float tone=0.92+0.12*fract(sin(dot(floor(uv/vec2(0.92,0.42)),vec2(17.1,53.7)))*43758.5453);
        diffuseColor.rgb*=tone*mix(1.0,0.5,seam);
        diffuseColor.rgb*=mix(0.6,1.0,smoothstep(0.0,0.45,vWallY));
        float cap=max(step(vWallHeight-0.15,vWallY),step(0.8,face.y));
        diffuseColor.rgb=mix(diffuseColor.rgb,${glslVec(new Color(look.cap).toArray())},cap*0.8);`,
    });
  });
  const mesh = new InstancedMesh(geometry, material, runs.length);
  runs.forEach((r, i) => {
    dummy.position.set(r.x, r.floor + r.height / 2, r.z);
    dummy.scale.set(r.width, r.height, r.depth);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    extents.set([r.floor, r.height], i * 2);
  });
  geometry.setAttribute("aWallExtent", new InstancedBufferAttribute(extents, 2));
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  owned.push({ mesh, geometry, material });
  const seen = new Uint8Array(kinds.length);
  const components: { kind: number; box: Box3; variant: number }[] = [];
  for (let at = 0; at < kinds.length; at++) {
    const kind = kinds[at]!;
    if (kind < 2 || seen[at]) continue;
    const pending = [at];
    seen[at] = 1;
    const box = new Box3();
    while (pending.length) {
      const n = pending.pop()!,
        x = n % samples,
        z = Math.floor(n / samples),
        floor = terrain.heights[n]!;
      box.expandByPoint(
        new Vector3(origin + x * cell - cell / 2, floor, origin + z * cell - cell / 2),
      );
      box.expandByPoint(
        new Vector3(
          origin + x * cell + cell / 2,
          floor + heights[n]!,
          origin + z * cell + cell / 2,
        ),
      );
      for (const next of [
        x > 0 ? n - 1 : -1,
        x + 1 < samples ? n + 1 : -1,
        z > 0 ? n - samples : -1,
        z + 1 < samples ? n + samples : -1,
      ])
        if (next >= 0 && !seen[next] && kinds[next] === kind) {
          seen[next] = 1;
          pending.push(next);
        }
    }
    components.push({ kind, box, variant: components.length % 3 });
  }
  for (const [slot, name] of [
    "tower-column",
    "tower-tomb-1",
    "tower-tomb-2",
    "tower-tomb-3",
  ].entries()) {
    const placed = components.filter((c) =>
      slot === 0 ? c.kind === 2 : c.kind === 3 && c.variant === slot - 1,
    );
    const source = assets[`/models/props/${name}.glb`]!;
    const geo = source.geometry.clone(),
      mat = lambertCopy(source.material);
    mat.flatShading = true;
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new Vector3());
    const inst = new InstancedMesh(geo, mat, placed.length);
    placed.forEach(({ box }, i) => {
      const scale = box.getSize(new Vector3());
      box.getCenter(dummy.position);
      dummy.position.y = box.min.y;
      dummy.scale.set(scale.x / size.x, scale.y / size.y, scale.z / size.z);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.castShadow = inst.receiveShadow = true;
    group.add(inst);
    owned.push({ mesh: inst, geometry: geo, material: mat });
  }
  return {
    group,
    dispose() {
      for (const { mesh, geometry, material } of owned) {
        mesh.dispose();
        geometry.dispose();
        material.dispose();
      }
    },
  };
}
