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
import { NOISE_GLSL } from "./environment/noise";
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
      "#include <common>": `#include <common>\nvarying vec3 vMasonry;\nvarying float vWallY;\nvarying float vWallHeight;\n${NOISE_GLSL}`,
      "#include <color_fragment>": `#include <color_fragment>
        // Same coursed ashlar as the tower exterior (0.55 m courses, 1.2 m stones, half bond),
        // so the parapet and the hall walls read as one building with the drop below.
        vec3 face=abs(normalize(cross(dFdx(vMasonry),dFdy(vMasonry))));
        vec2 uv=vec2(face.x>face.z?vMasonry.z:vMasonry.x,vWallY);
        float row=floor(uv.y/0.55);uv.x+=mod(row,2.0)*0.6;
        vec2 block=floor(uv/vec2(1.2,0.55));
        vec2 tile=fract(uv/vec2(1.2,0.55));
        vec2 edge=min(tile,1.0-tile)*vec2(1.2,0.55);
        // Worn arrises: the joint line wanders and opens where the stone has chipped.
        float chip=envNoise(uv*7.0)*0.025*smoothstep(0.45,0.8,envNoise(uv*1.3+block*0.37));
        float seam=1.0-smoothstep(0.014,0.034,min(edge.x,edge.y)-chip);
        float blockSeed=envHash(block);
        float tone=0.82+0.24*blockSeed+(envNoise(uv*0.35)-0.5)*0.16;
        vec3 hue=blockSeed<0.3?vec3(1.04,0.98,0.95):blockSeed<0.6?vec3(0.96,0.97,1.02):vec3(1.0);
        diffuseColor.rgb*=hue*tone*mix(1.0,0.5,seam);
        // Damp creeps up from the floor, with a little moss in the lowest joints.
        float wallDamp=(1.0-smoothstep(0.0,0.9,vWallY))*(0.5+0.5*envNoise(uv*vec2(0.8,0.3)));
        diffuseColor.rgb*=1.0-wallDamp*0.3;
        float moss=seam*wallDamp*smoothstep(0.45,0.7,envNoise(uv*2.3));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.16,0.19,0.11),moss*0.7);
        diffuseColor.rgb*=mix(0.62,1.0,smoothstep(0.0,0.45,vWallY));
        // Coping: a lighter capstone course with its own joints, a drip shadow beneath its lip.
        float copeY=vWallY-(vWallHeight-0.22);
        float cap=max(step(0.0,copeY),step(0.8,face.y));
        // Side faces joint along the course; the top joints every 0.7 m along both axes.
        vec2 copeUv=face.y>0.8?vMasonry.xz/0.7:vec2(uv.x/0.7,0.5);
        vec2 copeCell=fract(copeUv);
        float capJoint=1.0-smoothstep(0.01,0.03,min(min(copeCell.x,1.0-copeCell.x),face.y>0.8?min(copeCell.y,1.0-copeCell.y):1.0)*0.7);
        float drip=(1.0-smoothstep(0.0,0.07,-copeY))*step(copeY,0.0)*(1.0-step(0.8,face.y));
        vec3 coping=${glslVec(new Color(look.cap).toArray())}*(0.84+0.26*envHash(floor(copeUv)))
          *(0.9+0.2*envNoise(vMasonry.xz*1.7+vMasonry.y))*mix(1.0,0.6,capJoint);
        diffuseColor.rgb=mix(diffuseColor.rgb,coping,cap);
        diffuseColor.rgb*=1.0-drip*0.45;`,
      // Weathered stone holds less of the night's blue than the floor: the exterior's dusky lilac-grey.
      "#include <fog_fragment>": `gl_FragColor.rgb=mix(vec3(dot(gl_FragColor.rgb,vec3(0.3,0.59,0.11))),gl_FragColor.rgb,0.55);
        #include <fog_fragment>`,
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
    duskStone(mat);
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new Vector3());
    const inst = new InstancedMesh(geo, mat, placed.length);
    placed.forEach(({ box }, i) => {
      const scale = box.getSize(new Vector3());
      box.getCenter(dummy.position);
      dummy.position.y = box.min.y;
      // Lay the model's long side along the component's long side instead of squashing it across.
      const turn = size.x >= size.z !== scale.x >= scale.z;
      dummy.rotation.y = turn ? Math.PI / 2 : 0;
      dummy.scale.set(
        (turn ? scale.z : scale.x) / size.x,
        scale.y / size.y,
        (turn ? scale.x : scale.z) / size.z,
      );
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

/** The tombs and columns share the walls' dusky lilac-grey: same desaturation after lighting. */
export function duskStone(material: MeshLambertMaterial) {
  patchShader(material, "tower-dusk-stone", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "tower-dusk-stone", {
      "#include <fog_fragment>": `gl_FragColor.rgb=mix(vec3(dot(gl_FragColor.rgb,vec3(0.3,0.59,0.11))),gl_FragColor.rgb,0.55);
        #include <fog_fragment>`,
    });
  });
}
