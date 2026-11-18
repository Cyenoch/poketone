import {
  DataTexture,
  Euler,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
  type Material,
} from "three";
import type { World } from "../../sim/state/world";
import type { Terrain } from "../../sim/terrain";
import { heightAt } from "../../sim/terrain";
import { fxMaterial } from "../vfx/gl";
import { latticeHash, NOISE_GLSL } from "./noise";
import type { WindUniforms } from "./wind";
import { inject, patchShader } from "../patchShader";
import { glslVec } from "../stageThemes";
import { duskStone } from "../walls";

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
          float stoneSeed=envHash(floor(uv/vec2(1.2,0.55)));
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

const WINDOW_POOLS = 10;

/**
 * Light falling through high windows: a few arched panes with a mullion cross brighten the floor
 * (in the terrain draw, so the stone stays lit stone), each under a faint slanted shaft toward the sun.
 * Pools sit on open floor away from walls. View-only.
 */
export function towerWindowLight(
  root: Mesh<BufferGeometry, Material>,
  world: Readonly<World>,
  sunOffset: readonly [number, number, number],
  color: readonly [number, number, number],
) {
  const { kinds, samples, resolution, origin } = world.map.terrain.walls!;
  const open = (x: number, z: number) => {
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const cx = Math.floor((x + dx * 0.9 - origin) * resolution),
          cz = Math.floor((z + dz * 0.9 - origin) * resolution);
        if (cx < 0 || cz < 0 || cx >= samples || cz >= samples || kinds[cz * samples + cx])
          return false;
      }
    return true;
  };
  const pools: Vector4[] = [];
  for (let i = 0; i < 120 && pools.length < WINDOW_POOLS; i++) {
    const x = (latticeHash(world.seed, i, 41) - 0.5) * 64,
      z = (latticeHash(world.seed, i, 42) - 0.5) * 64;
    if (!open(x, z)) continue;
    if (pools.some((p) => Math.hypot(p.x - x, p.y - z) < 10)) continue;
    pools.push(new Vector4(x, z, 1.5 + latticeHash(world.seed, i, 43) * 0.6, 0));
  }
  // Light travels away from the sun: panes stretch along its ground track.
  const along = new Vector2(-sunOffset[0], -sunOffset[2]).normalize();
  const material = root.material;
  const count = pools.length;
  // Layout and light live in uniforms over a fixed-size array, so one program fits every tower zone.
  const uniforms = {
    uWindowPools: {
      value: Array.from({ length: WINDOW_POOLS }, (_, i) => pools[i] ?? new Vector4()),
    },
    uWindowCount: { value: count },
    uWindowAlong: { value: along },
    uWindowTint: { value: new Vector3(...color).lerp(new Vector3(1, 0.8, 0.52), 0.55) },
  };
  if (count)
    patchShader(material, "tower-window-light", (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = inject(shader.fragmentShader, "tower-window-light", {
        "#include <common>": `#include <common>
uniform vec4 uWindowPools[${WINDOW_POOLS}];
uniform int uWindowCount;
uniform vec2 uWindowAlong;
uniform vec3 uWindowTint;`,
        "#include <color_fragment>": `#include <color_fragment>
        {
          vec2 along=uWindowAlong;
          float lit=0.0, halo=0.0;
          for(int i=0;i<${WINDOW_POOLS};i++){
            if(i>=uWindowCount) break;
            vec4 pane=uWindowPools[i];
            vec2 d=vTerrainWorld.xz-pane.xy;
            // Pane space: u along the light (stretched by the low sun), v across.
            vec2 q=vec2(dot(d,along)/(pane.z*1.7),dot(d,vec2(-along.y,along.x))/pane.z);
            float arch=q.x<0.25?abs(q.y):length(vec2((q.x-0.25)*1.4,q.y));
            float body=(1.0-smoothstep(0.42,0.5,arch))*(1.0-smoothstep(0.62,0.7,-q.x));
            float mullion=(1.0-smoothstep(0.025,0.045,abs(q.y)))+(1.0-smoothstep(0.025,0.045,abs(q.x+0.12)));
            lit=max(lit,body*(1.0-clamp(mullion,0.0,1.0)*0.85));
            halo=max(halo,1.0-smoothstep(0.0,1.3,length(q*vec2(0.8,1.0))));
          }
          diffuseColor.rgb*=1.0+uWindowTint*(lit*0.85+halo*halo*0.2);
        }`,
      });
    });

  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  for (const [name, attribute] of Object.entries(plane.attributes))
    geometry.setAttribute(name, attribute);
  const roots = pools.flatMap((p) => [p.x, heightAt(world.map.terrain, p.x, p.y) + 0.02, p.y, p.z]);
  geometry.setAttribute("aPane", new InstancedBufferAttribute(new Float32Array(roots), 4));
  geometry.instanceCount = count;
  const sun = new Vector3(...sunOffset).normalize();
  const shaftMaterial = fxMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aPane;
      varying vec2 vUv;
      void main(){
        vUv=uv;
        vec3 sun=vec3(${sun.x.toFixed(4)},${sun.y.toFixed(4)},${sun.z.toFixed(4)});
        vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
        right.y=0.0; right=normalize(right);
        vec3 p=aPane.xyz+sun*uv.y*13.0+right*position.x*aPane.w*1.3*(1.0+uv.y*0.4);
        gl_Position=projectionMatrix*viewMatrix*vec4(p,1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      varying vec2 vUv;
      void main(){
        float side=pow(max(0.0,1.0-abs(vUv.x*2.0-1.0)),1.5);
        float ends=smoothstep(0.0,0.1,vUv.y)*(1.0-smoothstep(0.3,1.0,vUv.y));
        float dust=0.75+0.25*envNoise(vUv*vec2(6.0,14.0));
        float a=side*ends*dust*0.07;
        gl_FragColor=vec4(mix(${glslVec(color)},vec3(1.0,0.8,0.52),0.55)*a,a);
      }`,
  });
  const shafts = new Mesh(geometry, shaftMaterial);
  shafts.name = "tower-window-shafts";
  shafts.frustumCulled = false;
  shafts.visible = count > 0;
  shafts.renderOrder = 0.75;
  return {
    mesh: shafts,
    dispose() {
      geometry.dispose();
      shaftMaterial.dispose();
    },
  };
}

/**
 * Fallen masonry at the foot of the walls: a few squat chunks per exposed wall face, one instanced
 * draw. Small and hugging the walls, so it dresses the hall without reading as an obstacle.
 */
export function towerRubble(world: Readonly<World>) {
  const { kinds, samples, resolution, origin } = world.map.terrain.walls!;
  const matrices: Matrix4[] = [];
  const m = new Matrix4(),
    q = new Quaternion(),
    s = new Vector3(),
    euler = new Euler();
  for (let z = 1; z < samples - 1; z++)
    for (let x = 1; x < samples - 1; x++) {
      const at = z * samples + x;
      if (!kinds[at]) continue;
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (kinds[at + dz * samples + dx]) continue;
        const h = latticeHash(world.seed, at * 4 + dx + 2 * dz, 61);
        if (h > 0.3) continue;
        const pieces = 1 + Math.floor(latticeHash(world.seed, at, 62 + dx) * 3);
        for (let k = 0; k < pieces; k++) {
          const r = (n: number) => latticeHash(world.seed, at * 8 + k, n + dz * 3 + dx);
          const px =
            origin + (x + 0.5 + dx * (0.7 + r(63) * 0.6)) / resolution + (r(64) - 0.5) * 0.5;
          const pz =
            origin + (z + 0.5 + dz * (0.7 + r(65) * 0.6)) / resolution + (r(66) - 0.5) * 0.5;
          const size = 0.12 + r(67) * r(67) * 0.32;
          s.set(size * (1 + r(68) * 0.6), size * (0.55 + r(69) * 0.3), size * (1 + r(70) * 0.5));
          q.setFromEuler(euler.set(r(71) * 0.5, r(72) * Math.PI * 2, r(73) * 0.5));
          m.compose(new Vector3(px, heightAt(world.map.terrain, px, pz) + s.y * 0.35, pz), q, s);
          matrices.push(m.clone());
        }
      }
    }
  const geometry = new IcosahedronGeometry(1, 0);
  const material = new MeshLambertMaterial({ color: 0x9a8a90, flatShading: true });
  duskStone(material);
  const mesh = new InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.count = matrices.length;
  mesh.visible = matrices.length > 0;
  mesh.receiveShadow = true;
  mesh.name = "tower-rubble";
  return {
    mesh,
    dispose() {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
