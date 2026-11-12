import {
  DataTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RedFormat,
  Vector3,
  type BufferGeometry,
  type Material,
  type MeshLambertMaterial,
} from "three";
import type { World } from "../../sim/state/world";
import type { Terrain } from "../../sim/terrain";
import { heightAt } from "../../sim/terrain";
import { fxMaterial } from "../vfx/gl";
import { latticeHash, NOISE_GLSL } from "./noise";
import type { WindUniforms } from "./wind";
import { inject, patchShader } from "../patchShader";

/** Contact shade follows the final wall grid, including rotated tombs and pillars. */
export function towerStonework(root: Mesh<BufferGeometry, Material>, terrain: Terrain) {
  const { kinds, samples, resolution } = terrain.walls!;
  const contact = new Uint8Array(kinds.length);
  const reach = Math.ceil(resolution * 0.85);
  for (let z = 0; z < samples; z++)
    for (let x = 0; x < samples; x++) {
      if (!kinds[z * samples + x]) continue;
      for (let dz = -reach; dz <= reach; dz++)
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx,
            nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= samples || nz >= samples) continue;
          const distance =
            Math.hypot(Math.max(0, Math.abs(dx) - 0.5), Math.max(0, Math.abs(dz) - 0.5)) /
            resolution;
          const shade = Math.round(Math.max(0, 1 - distance / 0.85) ** 2 * 255);
          const at = nz * samples + nx;
          contact[at] = Math.max(contact[at]!, shade);
        }
    }
  const texture = new DataTexture(contact, samples, samples, RedFormat);
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  // Keep it visible to the existing context-restoration resource walker.
  const material = Object.assign(root.material, { towerContact: texture });
  patchShader(material, "tower-contact", (shader) => {
    shader.uniforms.uTowerContact = { value: texture };
    shader.fragmentShader = inject(shader.fragmentShader, "tower-contact", {
      "#include <common>": "#include <common>\nuniform sampler2D uTowerContact;",
      "#include <color_fragment>": `#include <color_fragment>
        float contact=texture2D(uTowerContact,terrainUv(vTerrainWorld.xz)).r;
        diffuseColor.rgb*=mix(vec3(1.0),vec3(0.56,0.53,0.62),contact);`,
    });
  });
  root.traverse((object) => {
    if (!(object instanceof InstancedMesh) || !object.geometry.getAttribute("aWallExtent")) return;
    patchShader(object.material as Material, "tower-stonewear", (shader) => {
      shader.fragmentShader = inject(shader.fragmentShader, "tower-stonewear", {
        "#include <common>": `#include <common>\n${NOISE_GLSL}`,
        "#include <normal_fragment_begin>": `
          vec2 stoneUv=vec2(face.x>face.z?vMasonry.z:vMasonry.x,vMasonry.y);
          float stoneWeather=envNoise(stoneUv*vec2(0.65,1.3));
          float stoneSeed=envHash(floor(uv/vec2(0.92,0.42)));
          diffuseColor.rgb*=mix(vec3(0.89,0.90,0.96),vec3(1.11,1.065,1.02),stoneSeed);
          diffuseColor.rgb*=mix(0.91,1.05,stoneWeather);
          float stoneBevel=(1.0-smoothstep(0.026,0.065,edge.y))*(1.0-seam);
          diffuseColor.rgb*=1.0+stoneBevel*mix(0.12,-0.1,step(0.5,tile.y))*(1.0-cap);
          float foot=1.0-smoothstep(0.22,0.28,vWallY);
          float footLip=1.0-smoothstep(0.018,0.045,abs(vWallY-0.27));
          float footJoint=1.0-smoothstep(0.012,0.026,abs(vWallY-0.31));
          diffuseColor.rgb*=1.0-foot*0.12+footLip*0.24-footJoint*0.2;
          float damp=(1.0-smoothstep(0.15,0.85,vWallY))*smoothstep(0.35,0.75,stoneWeather);
          diffuseColor.rgb*=mix(vec3(1.0),vec3(0.78,0.79,0.83),damp);
          #include <normal_fragment_begin>`,
      });
    });
  });
  return { dispose: () => texture.dispose() };
}

export function towerCandleMaterial(material: MeshLambertMaterial): void {
  patchShader(material, "tower-candle-flame", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "tower-candle-flame", {
      "#include <emissivemap_fragment>": `#include <emissivemap_fragment>
            totalEmissiveRadiance += vec3(1.0,0.52,0.16) * step(0.88,vSceneryHeight) * vSceneryLit * 0.8;`,
    });
  });
}

/** One offering beside each tomb/column, read from the final rotated collision grid. */
export function towerOfferings(terrain: Terrain, seed: number): [number, number][] {
  const { kinds, samples, resolution, origin } = terrain.walls!;
  const sites: { x: number; z: number; rank: number }[] = [];
  for (let z = 1; z < samples; z++)
    for (let x = 1; x < samples; x++) {
      const at = z * samples + x,
        kind = kinds[at]!;
      if (kind < 2 || kinds[at - 1] === kind || kinds[at - samples] === kind) continue;
      sites.push({
        x: origin + x / resolution - 0.85,
        z: origin + z / resolution - 0.85,
        rank: (kind === 3 ? 0 : 1) + latticeHash(seed, x, z),
      });
    }
  return sites.sort((a, b) => a.rank - b.rank).map(({ x, z }) => [x, z]);
}

/** Thin floor wisps and a few memorial flames; always behind combat decals. */
export function createTowerAtmosphere(world: World, wind: WindUniforms) {
  const floor = world.zone.index;
  const ghost = floor === 5;
  const mist = floor === 2 || floor === 3;
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  for (const [name, attribute] of Object.entries(plane.attributes))
    geometry.setAttribute(name, attribute);
  const roots: number[] = [];
  if (mist)
    for (let x = -35; x <= 35; x += 10)
      for (let z = -35; z <= 35; z += 10)
        roots.push(x, heightAt(world.map.terrain, x, z) + 0.1, z, latticeHash(world.seed, x, z));
  if (ghost)
    for (const [i, [x, z]] of towerOfferings(world.map.terrain, world.seed).slice(0, 8).entries())
      roots.push(x, heightAt(world.map.terrain, x, z) + 0.7, z, i / 8);
  geometry.setAttribute("aRoot", new InstancedBufferAttribute(new Float32Array(roots), 4));
  geometry.instanceCount = roots.length / 4;
  const material = fxMaterial({
    uniforms: { uTowerTime: wind.uWindTime },
    vertexShader: /* glsl */ `
      attribute vec4 aRoot;
      uniform float uTowerTime;
      varying vec2 vUv;
      varying float vPhase;
      void main(){
        vUv=uv; vPhase=aRoot.w;
        vec3 p=aRoot.xyz;
        ${
          ghost
            ? `
          vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
          p+=right*position.x*0.32;
          p.y+=position.y*0.65+sin(uTowerTime*0.7+aRoot.w*6.28)*0.09;
        `
            : `
          p.xz+=vec2(position.x,-position.y)*vec2(12.0,7.5);
          p.x+=sin(uTowerTime*0.12+aRoot.w*6.28)*0.9;
        `
        }
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uTowerTime;
      varying vec2 vUv;
      varying float vPhase;
      void main(){
        vec2 q=vUv*2.0-1.0;
        float edge=pow(max(0.0,1.0-dot(q,q)),2.0);
        ${
          ghost
            ? `
          float a=edge*(0.3+0.05*sin(uTowerTime*1.7+vPhase*9.0));
          gl_FragColor=vec4(vec3(0.61,0.57,0.74)*a,a*0.5);
        `
            : `
          float noise=envNoise(vUv*vec2(4.0,2.0)+vec2(uTowerTime*0.035,vPhase*19.0));
          float a=edge*smoothstep(0.25,0.75,noise)*${floor === 2 ? "0.115" : "0.065"};
          gl_FragColor=vec4(vec3(0.72,0.70,0.79)*a,a);
        `
        }
      }`,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = ghost ? "tower-memorial-flames" : "tower-floor-mist";
  mesh.frustumCulled = false;
  mesh.visible = roots.length > 0;
  mesh.renderOrder = 0.7;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Darkness belongs to the floor alone, leaving creatures, pickups and warnings at full value. */
export function towerVigil(material: Material, world: Readonly<World>) {
  const uniforms = {
    uVigilPlayers: { value: world.players.map(() => new Vector3()) },
  };
  patchShader(material, "tower-vigil", (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = inject(shader.fragmentShader, "tower-vigil", {
      "#include <common>": `#include <common>\nuniform vec3 uVigilPlayers[${world.players.length}];`,
      "#include <opaque_fragment>": `
        float vigil = 0.0;
        for (int i=0; i<${world.players.length}; i++) {
          vigil=max(vigil, 1.0-smoothstep(14.0,19.0,distance(vTerrainWorld.xz,uVigilPlayers[i].xz)));
        }
        outgoingLight *= mix(vec3(0.25,0.22,0.35),vec3(1.0),vigil);
        #include <opaque_fragment>`,
    });
  });
  return () =>
    world.players.forEach((player, index) => {
      uniforms.uVigilPlayers.value[index]!.set(player.x, 0, player.z);
    });
}
