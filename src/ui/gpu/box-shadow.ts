import { Content, abortableEffect } from "@pmndrs/uikit";
import { crispLineGlsl } from "./crisp-line";
import {
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector4,
  type IUniform,
} from "three";

/** One CSS outer shadow: `0 y blur color`. */
export interface ShadowLayer {
  y: number;
  blur: number;
  color: string;
  alpha: number;
}

/** Room drawn around the box; covers the largest shadow used (y + 3 sigma) and outlines. */
const REACH = 24;

/**
 * Paint outside an element's border box, like CSS `box-shadow` and `outline`. Its layout box is
 * the parent's border box and the shader draws beyond it, so it never adds scrollable overflow
 * (UIKit counts every child's extent, absolute ones included) yet is clipped like the element.
 * Add it as a child of the element it decorates; it never paints inside that element.
 */
abstract class OuterPaint<U extends Record<string, IUniform>> {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  protected readonly uniforms: U & {
    paintBox: { value: Vector2 };
    paintRadius: { value: number };
  };

  constructor(
    key: string,
    radius: number,
    uniforms: U,
    paint: { functions: string; body: string },
  ) {
    this.uniforms = {
      ...uniforms,
      paintBox: { value: new Vector2(1, 1) },
      paintRadius: { value: radius },
    };
    this.material.customProgramCacheKey = () => `poketone-outer-${key}`;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader =
        `uniform vec2 paintBox; varying vec2 paintPoint;\n` +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `vec3 transformed=vec3(position.xy*(paintBox+${2 * REACH}.)/paintBox,position.z);
          paintPoint=position.xy*(paintBox+${2 * REACH}.);`,
        );
      shader.fragmentShader =
        `varying vec2 paintPoint; uniform vec2 paintBox; uniform float paintRadius;
        ${crispLineGlsl}
        float paintDistance(vec2 p){vec2 q=abs(p)-(paintBox*.5-vec2(paintRadius));
          return length(max(q,0.))+min(max(q.x,q.y),0.)-paintRadius;}
        ${paint.functions}\n` +
        shader.fragmentShader.replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float self=paintDistance(paintPoint);float aa=.5*fwidth(self);float paintPx=fwidth(paintPoint.y);
          ${paint.body}`,
        );
    };
    this.content = new Content({ positionType: "absolute", keepAspectRatio: false });
    this.content.add(new Mesh(this.geometry, this.material));
    // Clipping planes and render order now, not on UIKit's deferred child-change pass: a window
    // compiled the frame it is built must get the same program it is drawn with.
    this.content.notifyAncestorsChanged();
    // Absolute children are placed in the padding box; the paint belongs to the border box.
    abortableEffect(() => {
      const parent = this.content.parentContainer.value;
      const size = parent?.size.value;
      const border = parent?.borderInset.value;
      if (!size || !border) return;
      const [top, , , left] = border;
      this.content.setProperties({
        positionLeft: -left,
        positionTop: -top,
        width: size[0],
        height: size[1],
      });
      this.uniforms.paintBox.value.set(Math.max(1, size[0]), Math.max(1, size[1]));
    }, this.content.abortSignal);
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** CSS `box-shadow`: two outer layers, the first on top. */
export class BoxShadow extends OuterPaint<{
  shadowY: { value: Vector2 };
  shadowBlur: { value: Vector2 };
  shadowInk0: { value: Vector4 };
  shadowInk1: { value: Vector4 };
}> {
  constructor(radius: number, layers: readonly ShadowLayer[]) {
    super(
      "shadow",
      radius,
      {
        shadowY: { value: new Vector2() },
        shadowBlur: { value: new Vector2() },
        shadowInk0: { value: new Vector4() },
        shadowInk1: { value: new Vector4() },
      },
      {
        functions: `uniform vec2 shadowY; uniform vec2 shadowBlur; uniform vec4 shadowInk0; uniform vec4 shadowInk1;
        float shadowErf(float x){float t=1./(1.+.3275911*abs(x));
          return sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-x*x));}
        float shadowCover(float d,float blur){
          if(blur<=0.){float aa=.5*fwidth(d);return 1.-smoothstep(-aa,aa,d);}
          return .5*(1.-shadowErf(d/(blur*.5*1.41421356)));}`,
        body: `vec2 drop=vec2(shadowBlur.x>0.?shadowY.x:crispLine(shadowY.x,paintPx),shadowBlur.y>0.?shadowY.y:crispLine(shadowY.y,paintPx));
          float a0=shadowInk0.a*shadowCover(paintDistance(paintPoint+vec2(0.,drop.x)),shadowBlur.x);
          float a1=shadowInk1.a*shadowCover(paintDistance(paintPoint+vec2(0.,drop.y)),shadowBlur.y);
          float alpha=a0+a1*(1.-a0);
          vec3 ink=alpha>0.?(shadowInk0.rgb*a0+shadowInk1.rgb*a1*(1.-a0))/alpha:vec3(0.);
          diffuseColor=vec4(ink,alpha*smoothstep(-aa,aa,self)*opacity);`,
      },
    );
    this.set(layers);
  }

  /** Replaces the layers; animate by calling again (uniforms only, no relayout; caller redraws). */
  set(layers: readonly ShadowLayer[]): void {
    const color = new Color();
    for (const [i, key] of (["shadowInk0", "shadowInk1"] as const).entries()) {
      const layer = layers[i];
      this.uniforms[key].value.set(0, 0, 0, 0);
      if (!layer) continue;
      color.set(layer.color);
      this.uniforms[key].value.set(color.r, color.g, color.b, layer.alpha);
      this.uniforms.shadowY.value.setComponent(i, layer.y);
      this.uniforms.shadowBlur.value.setComponent(i, layer.blur);
    }
  }
}

/** CSS `outline: <width> solid <color>; outline-offset: <offset>` following the element's radius. */
/**
 * Room a focus ring needs past its control. A default ring is 3 out and 3 wide; drawn, its offset and
 * width each round to whole device pixels and it has half a pixel of antialiased fringe, and the
 * clipping edge snaps to the grid too: up to two device pixels more, at most 2 units (a grid of at
 * least 1). A container that clips (`overflow` other than visible) keeps this much padding around
 * the controls it holds, and scrolling a focused control into view leaves this much room, so no
 * ring is ever cut. `scripts`' ring probe checks the drawn extents on every screen.
 */
export const RING_ROOM = 8;

export class OutlineRing extends OuterPaint<{
  ringInk: { value: Color };
  ringOffset: { value: number };
  ringWidth: { value: number };
}> {
  constructor(radius: number, color: string, width = 3, offset = 3) {
    super(
      "outline",
      radius,
      {
        ringInk: { value: new Color(color) },
        ringOffset: { value: offset },
        ringWidth: { value: width },
      },
      {
        functions: `uniform vec3 ringInk; uniform float ringOffset; uniform float ringWidth;`,
        body: `float off=crispLine(ringOffset,paintPx),wide=off+crispLine(ringWidth,paintPx);
          float ring=smoothstep(off-aa,off+aa,self)*(1.-smoothstep(wide-aa,wide+aa,self));
          diffuseColor=vec4(ringInk,ring*opacity);`,
      },
    );
    // Read by the ring probe, which checks the drawn ring against every clipping ancestor.
    this.content.userData.ring = { offset, width };
  }
}

/** `.game-button`'s shadow at a plate depth: the hard base plus the soft drop under it. */
export function plateShadow(depth: number, base = "#0d233f", drop = 0.24): ShadowLayer[] {
  return [
    { y: depth, blur: 0, color: base, alpha: depth > 0 ? 1 : 0 },
    { y: depth + 3, blur: 6, color: "#0d233f", alpha: drop },
  ];
}
