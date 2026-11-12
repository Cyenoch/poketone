import { Text } from "@pmndrs/uikit";
import {
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  Vector2,
} from "three";
import { reactionNames } from "../../run/labels";
import type { ReactionId } from "../../run/sim/content/reactions";
import { cubicBezier } from "./focus-mark";
import type { UiStage } from "./stage";
import { UiShaderMaterial } from "./ui-shader";

type Font = NonNullable<Text["fontSignal"]["value"]>;

/** Swarm hits (a vortex ticking 20 enemies) would bury the arena; numbers are a garnish, not the signal. */
const MAX_ACTIVE = 30;
const MAX_PER_FRAME = 5;
/** Digits of the largest hit that can show at once, per number. */
const MAX_DIGITS = 6;
const MAX_GLYPHS = MAX_ACTIVE * MAX_DIGITS;
/** Room around each glyph quad for the stroke, the 2px drop and the 10px crit glow. */
const PAD = 14;
/** `run-number-pop`'s `cubic-bezier(.34, 1.56, .64, 1)`, applied per keyframe interval as CSS does. */
const popEase = (t: number) => cubicBezier(t, 0.34, 1.56, 0.64, 1);

interface FloatingNumber {
  /** The digits of a hit, or a combat cue (闪避, 蒸汽). */
  text: string;
  x: number;
  z: number;
  life: number;
  max: number;
  driftX: number;
  driftZ: number;
  rise: number;
  /** 0 hit, 1 crit, 2 resisted, 3 combat cue. */
  kind: 0 | 1 | 2 | 3;
  size: number;
  tilt: number;
  pop: number;
}

/**
 * The run's floating combat text (`.run-number`): white numbers on a 1px navy stroke with a 2px
 * navy drop and a soft navy glow; crits gold with an orange glow, a tilt and a longer pop;
 * resisted hits grey and small; ice-blue words mark an evade or reaction at its world position.
 * Size grows with the hit on a log curve. Each number pops from 2.1×
 * (280 / 340ms), arcs up and drifts, and fades over its last 35%. Every glyph of every number is one
 * instance of one quad in a single draw, sampling the UI font's two core pages; the pool is capped.
 */
export class GpuDamageNumbers {
  private readonly stage: UiStage;
  /** Resolves the font and keeps every combat cue's page held by the HUD; never shown. */
  private readonly probe = new Text({
    text: `0闪避${Object.values(reactionNames).join("")}`,
    fontWeight: 800,
    positionType: "absolute",
    visibility: "hidden",
  });
  private readonly geometry = new InstancedBufferGeometry();
  private readonly anchor = new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS * 2), 2);
  private readonly glyph = new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS * 4), 4);
  private readonly uv = new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS * 4), 4);
  private readonly page = new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS), 1);
  private readonly look = new InstancedBufferAttribute(new Float32Array(MAX_GLYPHS * 4), 4);
  private readonly material: UiShaderMaterial<{
    fontPages: { value: unknown[] };
    distanceRange: { value: number };
    atlasEm: { value: number };
    pageSizes: { value: Vector2[] };
    navy: { value: Color };
  }>;
  private readonly mesh: Mesh;
  private readonly active: FloatingNumber[] = [];
  private readonly pool: FloatingNumber[] = [];
  private spawnedThisFrame = 0;
  private font: Font | undefined;

  constructor(stage: UiStage) {
    this.stage = stage;
    stage.root.add(this.probe);
    const quad = new PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute("position", quad.getAttribute("position"));
    this.geometry.setAttribute("uv", quad.getAttribute("uv"));
    this.geometry.setAttribute("numberAnchor", this.anchor);
    this.geometry.setAttribute("numberGlyph", this.glyph);
    this.geometry.setAttribute("numberUv", this.uv);
    this.geometry.setAttribute("numberPage", this.page);
    this.geometry.setAttribute("numberLook", this.look);
    this.geometry.instanceCount = 0;
    this.material = new UiShaderMaterial("damage-numbers", {
      uniforms: {
        fontPages: { value: [null, null] },
        distanceRange: { value: 4 },
        atlasEm: { value: 48 },
        pageSizes: { value: [new Vector2(1, 1), new Vector2(1, 1)] },
        // sRGB components: the shader mixes in sRGB, as CSS paints, then converts once.
        navy: { value: new Color().setRGB(13 / 255, 35 / 255, 63 / 255) },
      },
      vertexShader: `
        attribute vec2 numberAnchor;
        attribute vec4 numberGlyph; // glyph centre offset (px, at scale 1), glyph size (px)
        attribute vec4 numberUv;    // atlas rect: x, y (top), width, height
        attribute float numberPage;
        attribute vec4 numberLook;  // scale, tilt (rad), opacity, kind (0 hit, 1 crit, 2 weak, 3 cue)
        varying vec2 glyphPx;       // fragment position in glyph px from the glyph's top-left
        varying vec2 glyphSize;
        varying vec4 atlasRect;
        varying float atlasPage;
        varying vec2 look;
        void main() {
          vec2 size = numberGlyph.zw;
          vec2 local = position.xy * (size + vec2(${2 * PAD}.));
          glyphPx = vec2(local.x, -local.y) + size * .5;
          glyphSize = size;
          atlasRect = numberUv;
          atlasPage = numberPage;
          look = numberLook.zw;
          float c = cos(numberLook.y), s = sin(numberLook.y);
          vec2 p = (numberGlyph.xy * vec2(1., -1.) + local) * numberLook.x;
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(numberAnchor + p, 0., 1.);
        }`,
      fragmentShader: `
        uniform sampler2D fontPages[2];
        uniform float distanceRange;
        uniform float atlasEm;
        uniform vec2 pageSizes[2];
        uniform vec3 navy;
        varying vec2 glyphPx;
        varying vec2 glyphSize;
        varying vec4 atlasRect;
        varying float atlasPage;
        varying vec2 look;
        float median(vec3 v) { return max(min(v.r, v.g), min(max(v.r, v.g), v.b)); }
        // Signed distance to the glyph edge in screen px (positive inside) at glyph point q.
        float edge(vec2 q, float pxPerTexel) {
          vec2 t = q / glyphSize;
          // The outermost texel blends with its atlas neighbours; nothing there is glyph.
          vec2 pageSize = atlasPage < .5 ? pageSizes[0] : pageSizes[1];
          vec2 texels = t * atlasRect.zw * pageSize;
          if (any(lessThan(texels, vec2(1.))) || any(greaterThan(texels, atlasRect.zw * pageSize - 1.))) return -1e3;
          // UIKit's page is not flipped: v runs down the atlas like its glyph rects.
          vec2 uv = atlasRect.xy + t * atlasRect.zw;
          // Level 0: a mip level would blend in the neighbouring glyphs of the atlas.
          float m = median(atlasPage < .5 ? textureLod(fontPages[0], uv, 0.).rgb : textureLod(fontPages[1], uv, 0.).rgb);
          // The atlas stores 2 texels either side of the edge (under 1px at 17px); past that it
          // saturates, which is far outside, not on the stroke's ramp.
          if (m < .1) return -1e3;
          return (m - .5) * distanceRange * pxPerTexel;
        }
        float cover(float d, float aa) { return smoothstep(-aa, aa, d); }
        vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
        void main() {
          // Atlas texels per glyph px: the glyph box spans atlasRect.zw of the page.
          vec2 pageSize = atlasPage < .5 ? pageSizes[0] : pageSizes[1];
          float pxPerTexel = glyphSize.x / (atlasRect.z * pageSize.x);
          float aa = .45;
          float kind = look.y;
          float d = edge(glyphPx, pxPerTexel);
          // -webkit-text-stroke 1px, paint-order stroke fill: 0.5px of navy outside the fill.
          float fill = cover(d, aa), stroke = cover(d + .5, aa);
          // text-shadow 0 2px 0 navy-deep, under the text.
          float drop = cover(edge(glyphPx - vec2(0., 2.), pxPerTexel) + .5, aa);
          // The soft glow (4px navy 70%, crits 10px orange 85%). The atlas only knows distances
          // within a px of the edge, so the blur is the stroked glyph's coverage averaged over
          // three rings of taps reaching the blur radius. Stagger the middle ring halfway
          // between the others to keep angular coverage with eight taps per ring.
          float blur = kind == 1. ? 10. : 4.;
          float glow = 0.;
          for (int i = 0; i < 8; i++) {
            float a = float(i) * .7853982;
            vec2 o = vec2(cos(a), sin(a));
            vec2 middle = vec2(cos(a + .3926991), sin(a + .3926991));
            glow += cover(edge(glyphPx + o * blur * .25, pxPerTexel) + .5, aa);
            glow += cover(edge(glyphPx + middle * blur * .55, pxPerTexel) + .5, aa);
            glow += cover(edge(glyphPx + o * blur * .85, pxPerTexel) + .5, aa);
          }
          glow = glow / 24.;
          vec3 glowInk = kind == 1. ? vec3(1., .627, .157) : navy;
          float glowAlpha = (kind == 1. ? .85 : .7) * glow;
          vec3 ink = kind == 1. ? vec3(1., .831, .357) : kind == 2. ? vec3(.827, .859, .890) : kind == 3. ? vec3(.62, .902, 1.) : vec3(1.);
          vec4 col = vec4(glowInk, glowAlpha);
          col = mix(col, vec4(navy, 1.), drop);
          col = mix(col, vec4(navy, 1.), stroke);
          col = mix(col, vec4(ink, 1.), fill);
          col.a *= look.x;
          if (col.a <= 0.002) discard;
          gl_FragColor = vec4(toLinear(col.rgb), col.a);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    // Over the world, under every HUD control (the DOM layer sat below the HUD canvas).
    this.mesh.renderOrder = -10;
    stage.scene.add(this.mesh);
  }

  spawn(x: number, z: number, amount: number, crit: boolean, weak: boolean): void {
    if (amount < 1 || this.active.length >= MAX_ACTIVE) return;
    if (this.spawnedThisFrame >= MAX_PER_FRAME && !crit) return;
    this.spawnedThisFrame++;
    const item = this.pool.pop() ?? ({} as FloatingNumber);
    const angle = Math.random() * Math.PI * 2;
    const kick = crit ? 1.1 : 0.7;
    // Bigger hits read bigger, on a log curve so a 300 doesn't swallow the screen.
    const magnitude = Math.min(1.6, Math.max(0.85, 0.8 + Math.log10(Math.max(1, amount)) * 0.24));
    Object.assign(item, {
      text: String(Math.round(amount)).slice(-MAX_DIGITS),
      x,
      z,
      driftX: Math.cos(angle) * kick,
      driftZ: Math.sin(angle) * kick,
      rise: crit ? 4.2 : 3.2,
      max: crit ? 0.95 : 0.75,
      life: crit ? 0.95 : 0.75,
      kind: crit ? 1 : weak ? 2 : 0,
      // Resisted hits stay small but never below the 14 px readability floor.
      size: crit ? 24 * magnitude : weak ? Math.max(14, 14 * magnitude) : 17 * magnitude,
      tilt: crit ? ((Math.random() - 0.5) * 16 * Math.PI) / 180 : 0,
      pop: 0,
    });
    this.active.push(item);
  }

  /** 闪避 over the player when a hit is evaded: the hit's pop and arc, straight up, ice blue. */
  spawnEvade(x: number, z: number): void {
    this.spawnCue(x, z, "闪避");
  }

  /** Keep the event's location even when its target has moved or died. */
  spawnReaction(x: number, z: number, reaction: ReactionId): void {
    this.spawnCue(x, z, reactionNames[reaction]);
  }

  private spawnCue(x: number, z: number, text: string): void {
    if (this.active.length >= MAX_ACTIVE) return;
    const item = this.pool.pop() ?? ({} as FloatingNumber);
    Object.assign(item, {
      text,
      x,
      z,
      driftX: 0,
      driftZ: 0,
      rise: 3.6,
      max: 0.85,
      life: 0.85,
      kind: 3,
      size: 18,
      tilt: 0,
      pop: 0,
    });
    this.active.push(item);
  }

  /**
   * Moves every number along its arc; `project` maps a world point to CSS px on the run canvas, or
   * null when it is off screen.
   */
  update(dt: number, project: (x: number, y: number, z: number) => [number, number] | null): void {
    this.spawnedThisFrame = 0;
    this.font ??= this.probe.fontSignal.value;
    const font = this.font;
    const v = this.stage.viewport;
    let glyphs = 0;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i]!;
      item.life -= dt;
      item.pop += dt;
      const t = item.max - item.life;
      const point =
        item.life > 0
          ? project(
              item.x + item.driftX * t,
              1.3 + item.rise * t - 4.5 * t * t,
              item.z + item.driftZ * t,
            )
          : null;
      if (!point || point[0] < 0 || point[0] > v.width || point[1] < 0 || point[1] > v.height) {
        this.active.splice(i, 1);
        this.pool.push(item);
        continue;
      }
      if (!font) continue;
      const opacity = Math.min(1, item.life / (item.max * 0.35));
      const scale = popScale(item.pop, item.kind === 1 ? 0.34 : 0.28);
      // The stage is in UI units (CSS px / UI scale); the numbers keep their CSS px size.
      const unit = 1 / v.scale;
      const size = item.size * unit;
      let width = 0;
      for (const char of item.text) width += font.getGlyphInfo(char).xadvance * size;
      let pen = -width / 2;
      const ax = this.stage.camera.left + point[0] * unit,
        ay = this.stage.camera.top - point[1] * unit;
      for (const char of item.text) {
        const info = font.getGlyphInfo(char);
        // Digits/闪避 use chrome page 0; reaction names also use core content page 1.
        if (info.page !== 0 && info.page !== 1)
          throw new Error(`伤害数字的字形 "${char}" 不在字体第 0、1 页（第 ${info.page} 页）`);
        const w = info.width * size,
          h = info.height * size;
        // Glyph box relative to the number's centre: the line box is 1em tall, centred.
        const cx = pen + (info.xoffset + info.width / 2) * size,
          cy = (info.yoffset + info.height / 2 - 0.5) * size;
        this.anchor.setXY(glyphs, ax, ay);
        this.glyph.setXYZW(glyphs, cx, cy, w, h);
        this.uv.setXYZW(glyphs, info.uvX!, info.uvY!, info.uvWidth!, info.uvHeight!);
        this.page.setX(glyphs, info.page);
        this.look.setXYZW(glyphs, scale, item.tilt, opacity, item.kind);
        pen += info.xadvance * size;
        glyphs++;
      }
    }
    if (font) {
      const uniforms = this.material.uniforms;
      uniforms.distanceRange.value = font.distanceRange;
      for (let page = 0; page < 2; page++) {
        uniforms.fontPages.value[page] = font.pages[page];
        const [pageWidth, pageHeight] = font.pageSizes[page]!;
        uniforms.pageSizes.value[page]!.set(pageWidth, pageHeight);
      }
    }
    if (glyphs === 0 && this.geometry.instanceCount === 0) return;
    this.geometry.instanceCount = glyphs;
    for (const attribute of [this.anchor, this.glyph, this.uv, this.page, this.look]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, glyphs * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    this.stage.invalidate();
  }

  /** A new scene must not inherit feedback from the previous zone. */
  clear(): void {
    this.pool.push(...this.active);
    this.active.length = 0;
    this.spawnedThisFrame = 0;
    this.geometry.instanceCount = 0;
    this.stage.invalidate();
  }

  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.probe.removeFromParent();
    this.probe.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** `run-number-pop`: 2.1× to 0.86× at 45%, then to 1×, each leg on the pop curve. */
function popScale(age: number, duration: number): number {
  const t = Math.min(1, age / duration);
  return t < 0.45
    ? 2.1 + (0.86 - 2.1) * popEase(t / 0.45)
    : 0.86 + (1 - 0.86) * popEase((t - 0.45) / 0.55);
}
