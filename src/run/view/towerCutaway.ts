import { Vector3, type Material, type Object3D, type InstancedMesh } from "three";
import type { World } from "../sim/state/world";
import { inject, patchShader } from "./patchShader";

/** Keep the masonry footprint; open the upper stone where it covers nearby fighting ground. */
function patchCutaway(
  material: Material,
  base: number,
  uniforms: ReturnType<typeof cutawayUniforms>,
) {
  const key = `tower-cutaway-${base}`;
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = inject(shader.vertexShader, key, {
      "#include <common>":
        "#include <common>\nvarying vec3 vTowerStone;\nvarying float vTowerBase;",
      "#include <begin_vertex>": `#include <begin_vertex>
        vTowerStone=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;
        vTowerBase=(modelMatrix*instanceMatrix*vec4(0.0,${base.toFixed(1)},0.0,1.0)).y;`,
    });
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>
        uniform vec3 uTowerReveal[32];
        uniform int uTowerRevealCount;
        varying vec3 vTowerStone;
        varying float vTowerBase;
        const float towerBayer[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);`,
      "#include <color_fragment>": `#include <color_fragment>
        vec3 ray=vTowerStone-cameraPosition;
        vec2 behind=cameraPosition.xz+ray.xz*(-cameraPosition.y/ray.y);
        float reveal=0.0;
        for(int i=0;i<32;i++){
          if(i>=uTowerRevealCount)break;
          vec3 target=uTowerReveal[i];
          reveal=max(reveal,1.0-smoothstep(target.z*0.65,target.z,distance(behind,target.xy)));
        }
        float upper=smoothstep(0.5,0.85,vTowerStone.y-vTowerBase);
        ivec2 pixel=ivec2(mod(gl_FragCoord.xy,4.0));
        if((towerBayer[pixel.x+pixel.y*4]+0.5)/16.0>1.0-reveal*upper*0.94)discard;`,
    });
  });
}

function cutawayUniforms() {
  return {
    uTowerReveal: { value: Array.from({ length: 32 }, () => new Vector3()) },
    uTowerRevealCount: { value: 0 },
  };
}

export function createTowerCutaway(root: Object3D, world: World) {
  const uniforms = cutawayUniforms();
  root.traverse((object) => {
    const mesh = object as InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    patchCutaway(
      mesh.material as Material,
      mesh.geometry.getAttribute("aWallExtent") ? -0.5 : 0,
      uniforms,
    );
  });
  return {
    update() {
      let count = 0;
      const add = (x: number, z: number, radius: number) => {
        if (count < 32) uniforms.uTowerReveal.value[count]!.set(x, z, radius);
        count++;
      };
      for (const p of world.players) if (p.alive) add(p.x, p.z, 2.2);
      for (const h of world.hazards) {
        if (h.life <= 0 || (h.delay ?? 0) > 0) continue;
        add(
          h.x + h.dirX * h.length * 0.5,
          h.z + h.dirZ * h.length * 0.5,
          h.radius + h.length * 0.5 + 1,
        );
      }
      for (const e of world.enemies) if (e.hp > 0) add(e.x, e.z, 2.4 * e.scale);
      // In a swarm, open the whole fight rather than drop any creature from the reveal budget.
      if (count > 32) {
        count = world.players.length;
        world.players.forEach((p, i) => uniforms.uTowerReveal.value[i]!.set(p.x, p.z, 22));
      }
      uniforms.uTowerRevealCount.value = count;
    },
  };
}
