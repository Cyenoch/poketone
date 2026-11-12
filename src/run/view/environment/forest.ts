import {
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  type MeshLambertMaterial,
  type Material,
} from "three";
import type { World } from "../../sim/state/world";
import { zoneDef } from "../../sim/currentZone";
import { heightAt } from "../../sim/terrain";
import { inject, patchShader } from "../patchShader";
import { latticeHash } from "./noise";
import type { WindUniforms } from "./wind";

export function forestGround(material: Material): void {
  patchShader(material, "forest-pond-bank", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "forest-pond-bank", {
      "float width = MUD_BANK *": "float width = MUD_BANK * 0.6 *",
    });
  });
}

/** Only the cap emits: stem and undersides keep their normal moonlit shading. */
export function forestMushroom(material: MeshLambertMaterial, world: World): void {
  if (zoneDef(world).atmosphere !== "night") return;
  patchShader(material, "forest-mushroom-cap", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "forest-mushroom-cap", {
      "#include <emissivemap_fragment>": `#include <emissivemap_fragment>
        float cap = smoothstep(0.68,0.83,vSceneryHeight);
        totalEmissiveRadiance += vec3(0.25,0.20,0.065) * cap;`,
    });
  });
}

/** Broken seams follow the six standing stones, never drawing a danger-shaped ground ring. */
export function forestStone(material: MeshLambertMaterial): void {
  patchShader(material, "forest-stone-seams", (shader) => {
    shader.vertexShader = inject(shader.vertexShader, "forest-stone-seams", {
      "#include <common>": "#include <common>\nvarying vec3 vStone;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvStone=position;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "forest-stone-seams", {
      "#include <common>": "#include <common>\nvarying vec3 vStone;",
      "#include <emissivemap_fragment>": `#include <emissivemap_fragment>
        float angle=atan(vStone.z,vStone.x);
        float seam=abs(sin(angle*3.0 + sin(vStone.y*11.0)*0.018));
        float fissure=(1.0-smoothstep(0.012,0.035,seam))*smoothstep(1.8,2.5,length(vStone.xz));
        fissure*=smoothstep(0.25,0.5,vStone.y)*(1.0-smoothstep(1.3,1.8,vStone.y));
        totalEmissiveRadiance*=fissure;`,
    });
  });
}

/** Sparse, world-rooted fireflies/spores in tree shade; no particle simulation or render target. */
export function forestMotes(world: World, wind: WindUniforms) {
  const night = zoneDef(world).atmosphere === "night";
  const positions: number[] = [];
  for (const [i, tree] of world.map.obstacles.entries()) {
    if (tree.kind !== "tree" && tree.kind !== "pine") continue;
    for (let k = 0; k < 3; k++) {
      const angle = latticeHash(world.seed, i, k) * Math.PI * 2;
      const reach = tree.radius + 0.6 + latticeHash(world.seed, k, i) * 1.6;
      const x = tree.x + Math.cos(angle) * reach,
        z = tree.z + Math.sin(angle) * reach;
      positions.push(x, heightAt(world.map.terrain, x, z) + 0.35, z);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new ShaderMaterial({
    uniforms: { uTime: wind.uWindTime },
    transparent: true,
    depthWrite: false,
    vertexShader: `uniform float uTime;
      varying float vFade;
      void main(){
        float seed=fract(sin(dot(position.xz,vec2(12.9898,78.233)))*43758.5453);
        float cycle=fract(seed+uTime*${night ? "0.075" : "0.11"});
        vec3 p=position;
        p.y+=cycle*${night ? "1.1" : "0.45"};
        p.xz+=vec2(sin(seed*32.0+uTime*.4),cos(seed*27.0+uTime*.3))*.22;
        vec4 mv=modelViewMatrix*vec4(p,1.0);
        vFade=sin(cycle*3.14159)*smoothstep(4.5,8.0,length(position.xz-cameraPosition.xz))*(1.0-smoothstep(26.0,38.0,-mv.z));
        gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(38.0/-mv.z,1.0,3.0);
      }`,
    fragmentShader: `varying float vFade;
      void main(){
        float d=length(gl_PointCoord-.5)*2.0;
        gl_FragColor=vec4(${night ? "0.82,0.91,0.55" : "0.95,0.88,0.4"},(1.0-smoothstep(.2,1.0,d))*vFade*.65);
      }`,
  });
  const mesh = new Points(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = zoneDef(world).atmosphere !== "afternoon";
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
