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
  float slabTone=mix(0.78,1.12,slabSeed);
  float patina=envNoise(vTerrainWorld.xz*0.27);
  float slabHue=envHash(slabCell+17.0);
  vec3 stoneTint=slabHue<0.4?vec3(1.1,1.0,0.84):slabHue<0.7?vec3(0.95,0.96,1.0):slabHue<0.88?vec3(0.94,1.02,0.88):vec3(1.14,0.95,0.86);
  diffuseColor.rgb *= stoneTint*slabTone*mix(0.86,1.06,patina);
  // Grime gathers toward the slab joints and in broad damp drifts; moss creeps out of the joints there.
  float edgeDist=min(slabEdge.x,slabEdge.y);
  float damp=smoothstep(0.42,0.72,envNoise(vTerrainWorld.xz*0.11+3.7));
  float grime=(1.0-smoothstep(0.0,0.32,edgeDist))*(0.25+0.5*damp);
  diffuseColor.rgb *= 1.0-grime*0.35;
  float mossNoise=envNoise(vTerrainWorld.xz*1.7);
  float moss=(1.0-smoothstep(0.0,0.06+0.22*damp*mossNoise,edgeDist-wear))*smoothstep(0.35,0.75,damp+mossNoise*0.3);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.12,0.17,0.07)*(0.8+0.5*mossNoise),moss*0.85);
  // A few slabs are sunken, darker and chipped.
  float sunken=step(0.955,envHash(slabCell+57.0));
  diffuseColor.rgb *= 1.0-sunken*0.28;
  float bevelWidth=0.065+slabSeed*0.025;
  vec2 bevel=1.0-smoothstep(vec2(${look.joint.toFixed(4)}),vec2(bevelWidth),slabEdge);
  vec2 bevelSide=mix(vec2(1.0),vec2(-1.0),step(vec2(0.5),slabLocal));
  float bevelLight=dot(bevel*bevelSide,vec2(0.12,0.16));
  diffuseColor.rgb *= (1.0+bevelLight*(1.0-mortar))*mix(1.0,0.62,mortar);
  float fracture=abs(slabLocal.x-0.35-slabSeed*0.3-sin(slabLocal.y*5.0+slabSeed*9.0)*0.1);
  float crack=(1.0-smoothstep(0.003,0.011,fracture))*step(0.8,envHash(slabCell+9.0));
  crack*=1.0-smoothstep(0.2,0.8,slabLocal.y);
  diffuseColor.rgb *= 1.0-crack*0.45;
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
