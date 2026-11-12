import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Material,
  type MeshLambertMaterial,
} from "three";
import type { World } from "../../sim/state/world";
import { sampleDepth } from "../../sim/surface";
import { heightAt } from "../../sim/terrain";
import { inject, patchShader } from "../patchShader";
import type { GroundPools } from "./dressing";
import { bakeLavaCrust } from "./lava";
import { latticeHash } from "./noise";
import { WIND_GLSL, type WindUniforms } from "./wind";

/** The altar's baked copper inset is a decorative pool, never a damage surface. */
export function animateVolcanoAltar(material: MeshLambertMaterial, wind: WindUniforms) {
  const crust = bakeLavaCrust();
  Object.assign(material, { lavaCrust: crust });
  material.addEventListener("dispose", () => crust.dispose());
  patchShader(material, "volcano-altar", (shader) => {
    shader.uniforms.uAltarCrust = { value: crust };
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = inject(shader.vertexShader, "volcano-altar", {
      "#include <common>": "#include <common>\nvarying vec3 vAltar;",
      "#include <begin_vertex>": "#include <begin_vertex>\nvAltar=position;",
    });
    shader.fragmentShader = inject(shader.fragmentShader, "volcano-altar", {
      "#include <common>": `#include <common>\nvarying vec3 vAltar;\nuniform sampler2D uAltarCrust;\n${WIND_GLSL}`,
      "#include <color_fragment>": `#include <color_fragment>
        if (vColor.r > vColor.g * 1.7 && vColor.r > vColor.b * 1.7) {
          vec2 p = vAltar.xz;
          vec4 cell = texture2D(uAltarCrust, p * 0.25 - vec2(0.0, uWindTime * 0.018));
          float plate = smoothstep(0.2, 0.25, cell.r);
          vec3 molten = mix(vec3(0.65,0.09,0.002), vec3(0.9,0.42,0.025), cell.b);
          diffuseColor.rgb = vec3(0.0);
          totalEmissiveRadiance = mix(molten,vec3(0.035,0.022,0.026),plate) * 0.7;
        }`,
    });
  });
}

/** Thin steam rooted in the actual vent light-pool positions, plus sparse wind-borne ash. */
export function createVolcanoAir(world: World, pools: GroundPools, wind: WindUniforms) {
  const roots: number[] = [];
  const phases: number[] = [];
  for (let i = 0; i < pools.uSceneryPoolCount.value; i++) {
    const p = pools.uSceneryPools.value[i]!;
    for (let j = 0; j < 4; j++) {
      roots.push(p.x, heightAt(world.map.terrain, p.x, p.y) + 0.4, p.y, 1);
      phases.push(j / 4 + latticeHash(world.seed, i, 1));
    }
  }
  for (let i = 0; i < 180; i++) {
    const x = (latticeHash(world.seed, i, 8) - 0.5) * 108;
    const z = (latticeHash(world.seed, i, 9) - 0.5) * 108;
    roots.push(x, heightAt(world.map.terrain, x, z) + 0.4, z, 0);
    phases.push(latticeHash(world.seed, i, 10));
  }
  const lava = world.map.terrain.surface!.lava;
  const level = world.map.terrain.surface!.liquids.find((p) => p.kind === "lava")!.level;
  for (let z = -48; z < 48; z += 2.5)
    for (let x = -48; x < 48; x += 2.5) {
      const jitter = latticeHash(world.seed, Math.round(x * 2), Math.round(z * 2));
      const px = x + jitter,
        pz = z + jitter * 0.6;
      if (sampleDepth(lava, px, pz) < 0.35) continue;
      roots.push(px, level + 0.08, pz, 2);
      phases.push(jitter);
    }
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  for (const [name, attr] of Object.entries(quad.attributes)) geometry.setAttribute(name, attr);
  geometry.setAttribute("aVolcanoRoot", new InstancedBufferAttribute(new Float32Array(roots), 4));
  geometry.setAttribute("aPhase", new InstancedBufferAttribute(new Float32Array(phases), 1));
  geometry.instanceCount = phases.length;
  const night = world.zone.index === 2;
  const ember = world.zone.index > 0;
  const material = new MeshBasicMaterial({ transparent: true, depthWrite: false });
  patchShader(material, `volcano-air-${world.zone.index}`, (shader) => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = inject(shader.vertexShader, "volcano-air", {
      "#include <common>": `#include <common>\n${WIND_GLSL}
        attribute vec4 aVolcanoRoot;
        attribute float aPhase;
        varying vec2 vAirUv;
        varying float vAirFade;
        varying float vSteam;
        varying float vHot;`,
      "#include <project_vertex>": `
        vAirUv = uv;
        vSteam = 1.0 - step(0.5, abs(aVolcanoRoot.w - 1.0));
        vHot = step(1.5, aVolcanoRoot.w);
        float age = fract(uWindTime * mix(0.055, 0.19, vSteam) + aPhase);
        vAirFade = smoothstep(0.0, 0.16, age) * (1.0 - smoothstep(0.55, 1.0, age));
        vec3 root = aVolcanoRoot.xyz;
        root.y += age * mix(3.5, 1.65, vSteam);
        vAirFade *= mix(1.0, 0.8, vHot);
        root.xz += uWindDir * age * age * mix(2.4, 0.65, vSteam);
        root.xz += vec2(sin(aPhase * 32.0 + age * 6.0), cos(aPhase * 24.0 + age * 5.0)) * age * 0.12;
        float size = mix(0.035, 0.16 + age * 0.5, vSteam) + vHot * 0.045;
        vec4 mvPosition = modelViewMatrix * vec4(root, 1.0);
        mvPosition.xy += position.xy * vec2(size, size * mix(0.8, 1.5, vSteam));
        gl_Position = projectionMatrix * mvPosition;`,
    });
    shader.fragmentShader = inject(shader.fragmentShader, "volcano-air", {
      "#include <common>": `#include <common>\n${WIND_GLSL}
        varying vec2 vAirUv;
        varying float vAirFade;
        varying float vSteam;
        varying float vHot;`,
      "#include <color_fragment>": `#include <color_fragment>
        vec2 p = vAirUv * 2.0 - 1.0;
        float edge = 1.0 - smoothstep(0.25, 1.0, dot(p,p));
        float wisp = mix(1.0, 0.55 + 0.45 * envNoise(vAirUv * 5.0 - vec2(0.0, uWindTime * 0.2)), vSteam);
        diffuseColor.rgb = mix(${ember ? "vec3(0.8,0.25,0.025)" : "vec3(0.32,0.3,0.29)"}, ${night ? "vec3(0.22,0.2,0.24)" : "vec3(0.45,0.43,0.42)"}, vSteam);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.5, 0.045), vHot);
        diffuseColor.a = edge * wisp * vAirFade * mix(0.6, 0.2, vSteam);`,
    });
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "volcano-air";
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.4;
  return {
    mesh,
    dispose() {
      geometry.dispose();
      quad.dispose();
      material.dispose();
    },
  };
}

/** Wind-stretched ash deposits break up the regular cooled ropes without moving any bank. */
export function volcanoGround(material: Material) {
  patchShader(material, "volcano-ash", (shader) => {
    shader.fragmentShader = inject(shader.fragmentShader, "volcano-ash", {
      "vec3 grassMean = meanColor(uGrassMap);": `
        vec2 ropeUv = (p + vec2(envNoise(p * 0.14), envNoise(p * 0.14 + 13.0)) * 1.8) / GRASS_TILE;
        vec3 grassMean = meanColor(uGrassMap);`,
      "sampleUntiled(uGrassMap, p / GRASS_TILE, dwx.xz / GRASS_TILE, dwy.xz / GRASS_TILE)":
        "sampleUntiled(uGrassMap, ropeUv, dFdx(ropeUv), dFdy(ropeUv))",
      "vec3 albedo = groundAlbedo(layers, grass, meadow, meadowMean);": `
        float ashDrift = envNoise(vec2(p.x * 0.11 + p.y * 0.045, p.y * 0.24));
        layers.r *= smoothstep(0.18, 0.72, ashDrift);
        vec3 albedo = groundAlbedo(layers, grass, meadow, meadowMean);`,
    });
  });
}
