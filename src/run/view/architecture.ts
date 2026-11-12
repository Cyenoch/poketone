import { glslVec, type ArchitectureLook } from "./stageThemes";
import type { GroundPools } from "./environment/dressing";
import { MAX_GROUND_POOLS } from "./environment/dressing";
import type { MeshLambertMaterial } from "three";
import { inject, patchShader } from "./patchShader";

/** Tower-only slabs: shallow bevels, worn stone faces and occasional memorial inlays. */
export const slabGlsl = (look: ArchitectureLook) => /* glsl */ `
  vec2 slabUv = vTerrainWorld.xz / ${look.slab.toFixed(3)};
  slabUv.x += mod(floor(slabUv.y),2.0)*0.5;
  vec2 slabCell=floor(slabUv), slabLocal=fract(slabUv);
  vec2 slabEdge=min(slabLocal,1.0-slabLocal)*${look.slab.toFixed(3)};
  float wear=envNoise(vTerrainWorld.xz*19.0)*0.014;
  float mortar=1.0-smoothstep(${(look.joint * 0.5).toFixed(4)},${(look.joint * 0.5 + 0.018).toFixed(4)},min(slabEdge.x,slabEdge.y)-wear);
  float slabSeed=envHash(slabCell);
  float slabTone=mix(0.82,1.13,slabSeed);
  float patina=envNoise(vTerrainWorld.xz*0.27);
  vec3 stoneTint=mix(vec3(0.97,0.98,1.02),vec3(1.05,1.015,0.96),step(0.83,slabSeed));
  diffuseColor.rgb *= stoneTint*slabTone*mix(0.93,1.04,patina);
  float bevelWidth=0.065+slabSeed*0.025;
  vec2 bevel=1.0-smoothstep(vec2(${look.joint.toFixed(4)}),vec2(bevelWidth),slabEdge);
  vec2 bevelSide=mix(vec2(1.0),vec2(-1.0),step(vec2(0.5),slabLocal));
  float bevelLight=dot(bevel*bevelSide,vec2(0.12,0.16));
  diffuseColor.rgb *= (1.0+bevelLight*(1.0-mortar))*mix(1.0,0.62,mortar);
  float fracture=abs(slabLocal.x-0.35-slabSeed*0.3-sin(slabLocal.y*5.0+slabSeed*9.0)*0.1);
  float crack=(1.0-smoothstep(0.002,0.008,fracture))*step(0.93,envHash(slabCell+9.0));
  crack*=1.0-smoothstep(0.2,0.8,slabLocal.y);
  diffuseColor.rgb *= 1.0-crack*0.22;
  vec2 seal=abs(slabLocal-0.5);
  float sealDistance=abs(seal.x+seal.y-0.19);
  float sealAA=max(fwidth(sealDistance),0.003);
  float engraving=(1.0-smoothstep(0.006,0.006+sealAA,sealDistance))
    *step(0.975,envHash(slabCell+31.0));
  diffuseColor.rgb *= 1.0-engraving*0.19;
`;

export function lightGroundPools(material: MeshLambertMaterial, pools: GroundPools) {
  if (!pools.uSceneryPoolCount.value) return;
  const key = "scenery-ground-pools";
  patchShader(material, key, (shader) => {
    Object.assign(shader.uniforms, pools);
    shader.fragmentShader = inject(shader.fragmentShader, key, {
      "#include <common>": `#include <common>\nuniform vec4 uSceneryPools[${MAX_GROUND_POOLS}];\nuniform int uSceneryPoolCount;`,
      "#include <emissivemap_fragment>": `#include <emissivemap_fragment>
        for(int i=0;i<${MAX_GROUND_POOLS};i++){
          if(i>=uSceneryPoolCount)break;
          vec4 pool=uSceneryPools[i];
          float glow=1.0-smoothstep(0.0,pool.z,length(vTerrainWorld.xz-pool.xy));
          totalEmissiveRadiance+=${glslVec([1, 0.63, 0.27])}*glow*glow*pool.w;
        }`,
    });
  });
}
