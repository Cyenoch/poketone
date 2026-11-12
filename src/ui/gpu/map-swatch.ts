import { Content } from "@pmndrs/uikit";
import { Color, Mesh, PlaneGeometry, Vector2 } from "three";
import type { StageId } from "../../run/sim/content/stages/index";
import { stageThemes, type Rgb } from "../../run/view/stageThemes";
import { UiShaderMaterial } from "./ui-shader";

/** Terrace bands the swatch paints (a stage's minimap palette is padded with its last band). */
const BANDS = 5;

const rgb = (c: Rgb) => new Color(c[0] / 255, c[1] / 255, c[2] / 255);

/**
 * A map's look in a rounded square (DESIGN.md): its painted-minimap palette
 * (`StageTheme.minimap`) as an imaginary terrain — terrace bands with cliff ink, a pond, the wall
 * beyond the arena. Not the map itself (that needs the generated world); seeded per stage so two
 * maps never share a picture.
 */
export class MapSwatch {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material;
  private readonly size = { value: new Vector2(1, 1) };

  constructor(stage: StageId, radius: number) {
    const { land, water, shore, wall, wallLight } = stageThemes[stage].minimap;
    const bands = Array.from({ length: BANDS }, (_, i) => rgb(land[Math.min(i, land.length - 1)]!));
    let seed = 0;
    for (const ch of stage) seed = (seed * 31 + ch.charCodeAt(0)) % 997;
    this.material = new UiShaderMaterial("lobby-map-swatch", {
      uniforms: {
        swatchSize: this.size,
        corner: { value: radius },
        seed: { value: seed },
        land: { value: bands },
        water: { value: rgb(water) },
        shore: { value: rgb(shore) },
        wall: { value: rgb(wall) },
        wallLight: { value: rgb(wallLight) },
        opacity: { value: 1 },
      },
      vertexShader: `
        varying vec2 swatchUv;
        #include <clipping_planes_pars_vertex>
        void main() {
          swatchUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
          #include <clipping_planes_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        uniform vec2 swatchSize;
        uniform float corner, seed, opacity;
        uniform vec3 land[${BANDS}];
        uniform vec3 water, shore, wall, wallLight;
        varying vec2 swatchUv;
        #include <clipping_planes_pars_fragment>
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + seed * 1.37) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3. - 2. * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float terrain(vec2 q) { return .62 * noise(q * 2.6) + .28 * noise(q * 5.3 + 7.) + .1 * noise(q * 11. + 3.); }
        void main() {
          #include <clipping_planes_fragment>
          vec2 p = vec2(swatchUv.x, 1. - swatchUv.y) * swatchSize;
          vec2 h = swatchSize * .5;
          float aa = .5 * max(fwidth(p.x), fwidth(p.y));
          float d = roundBox(p - h, h, corner);
          if (d > aa) discard;
          vec2 q = p / swatchSize.y;
          // Height rises toward one side, so the bands read as terraces rather than spots.
          float t = clamp(terrain(q) * .85 + .25 * (q.x * .6 + q.y * .4), 0., .999);
          float b = t * ${BANDS}.;
          int band = int(floor(b));
          vec3 col = land[0];
          for (int i = 1; i < ${BANDS}; i++) if (i == band) col = land[i];
          // Cliff ink along the band edges.
          float edge = abs(fract(b) - .5) * 2.;
          float w = fwidth(b) * 1.2;
          col = mix(col, vec3(.078, .184, .314), .35 * smoothstep(1. - w, 1., edge));
          // A pond in the lowest ground, its shore a band around it.
          col = mix(col, shore, smoothstep(.2, .18, t));
          col = mix(col, water, smoothstep(.16, .14, t));
          // The wall beyond the arena: a rim of dark crowns, a few lit.
          float rim = smoothstep(-.11 * swatchSize.y, -.08 * swatchSize.y, d);
          vec3 crowns = mix(wall, wallLight, step(.62, noise(q * 9.)));
          col = mix(col, crowns, rim);
          gl_FragColor = vec4(toLinear(col), opacity * (1. - smoothstep(-aa, aa, d)));
          #include <colorspace_fragment>
        }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  /** Call after layout. */
  update(): void {
    const s = this.content.size.value;
    if (s) this.size.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
