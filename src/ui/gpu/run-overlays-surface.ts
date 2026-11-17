import { abortableEffect, Container, Content } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import { inheritedOpacity } from "./layer";
import { HARD_SHADOW, RADIUS, srgb, ui } from "./tokens";
import { UiShaderMaterial } from "./ui-shader";
import type { ElementType } from "../../run/sim/content/elements";
import { themeEdge, themeGrain } from "./run-theme";

/** The existing run-theme.css band's grain and bottom silhouettes, evaluated in logical pixels. */
export class RunHeaderSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly size = { value: new Vector2(1, 1) };
  constructor(theme: ElementType, top: string, bottom: string, edge: boolean) {
    const grain = themeGrain(theme),
      kind = grain.kind;
    this.material.customProgramCacheKey = () => `poketone-run-header-${kind}-${edge}`;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        bandSize: this.size,
        bandTop: { value: new Color(top) },
        bandBottom: { value: new Color(bottom) },
        bandGrain: { value: new Color(grain.color) },
      });
      shader.vertexShader = "varying vec2 bandUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nbandUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 bandUv; uniform vec2 bandSize; uniform vec3 bandTop; uniform vec3 bandBottom; uniform vec3 bandGrain;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(bandUv.x,1.-bandUv.y)*bandSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        vec3 ink=mix(bandTop,bandBottom,clamp(p.y/bandSize.y,0.,1.));
        float grain=0.;
        {${grain.glsl}}
        ink=mix(ink,bandGrain,grain);
        float depth=bandSize.y-2.-p.y;
        float edge=0.;
        ${themeEdge(theme, "p.x", "depth")}
        ink=mix(ink,vec3(1.),edge*step(0.,depth)*step(depth,8.)*${edge ? ".3" : "0."});
        ink=mix(ink,vec3(.004025,.016807,.049707),step(bandSize.y-2.,p.y)*${edge ? "1." : "0."});
        float radius=p.y<bandSize.y*.5?6.:3.;
        vec2 corner=abs(p-bandSize*.5)-(bandSize*.5-vec2(radius));
        float edgeDistance=length(max(corner,0.))+min(max(corner.x,corner.y),0.)-radius;
        diffuseColor=vec4(ink,opacity*(1.-smoothstep(-aa,aa,edgeDistance)));
      `,
      );
    };
    this.content = new Content({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      keepAspectRatio: false,
      depthTest: false,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
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

/** Existing raised plate sheen, bevel and pressure shading, evaluated at the actual control size. */
export class RunButtonSurface {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly size = { value: new Vector2(1, 1) };
  private readonly pressure = { value: 0 };
  constructor() {
    this.material.customProgramCacheKey = () => "run-button-plate";
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { buttonSize: this.size, buttonPressure: this.pressure });
      shader.vertexShader = "varying vec2 buttonUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nbuttonUv=uv;",
      );
      shader.fragmentShader =
        "varying vec2 buttonUv; uniform vec2 buttonSize; uniform float buttonPressure;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(buttonUv.x,1.-buttonUv.y)*buttonSize;
        float aa=.5*max(fwidth(p.x),fwidth(p.y));
        float radius=6.; vec2 q=abs(p-buttonSize*.5)-(buttonSize*.5-vec2(radius));
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
        float top=max(.48*(1.-clamp(p.y/(buttonSize.y*.52),0.,1.)),(1.-step(2.,p.y))*.62);
        float bottom=step(buttonSize.y-2.,p.y)*.12;
        float pressed=(1.-step(3.,p.y))*.18;
        vec3 ink=vec3(1.); float alpha=top;
        if(bottom>0.) {ink=sRGBTransferEOTF(vec4(.051,.137,.247,1.)).rgb;alpha=bottom;}
        if(buttonPressure>.5) {ink=sRGBTransferEOTF(vec4(.051,.137,.247,1.)).rgb;alpha=pressed;}
        diffuseColor=vec4(ink,alpha*opacity*(1.-smoothstep(-aa,aa,d)));
      `,
      );
    };
    this.content = new Content({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: "100%",
      height: "100%",
      keepAspectRatio: false,
      depthTest: false,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  setPressed(pressed: boolean): void {
    this.pressure.value = pressed ? 1 : 0;
  }
  update(): void {
    const s = this.content.size.value;
    if (s) this.size.value.set(s[0], s[1]);
  }
  dispose(): void {
    this.content.removeFromParent();
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Room around an upright plate's box for its hard shadow and focus ring. */
const PLATE_REACH = 12;

const plateUniforms = (style: { fill: string; border: string; borderWidth?: number }) => ({
  boxSize: { value: new Vector2(1, 1) },
  opacity: { value: 1 },
  fillInk: { value: srgb(style.fill) },
  borderInk: { value: srgb(style.border) },
  borderWidth: { value: style.borderWidth ?? 2 },
  depth: { value: HARD_SHADOW.offset as number },
  focusRing: { value: 0 },
});

/**
 * An upright face (2026-11 redesign: everything but the accents stays upright): radius 6, an inner
 * border, the hard shadow offset right and down and the keyboard focus ring 3px outside the edge.
 */
export class UprightPlate {
  /** The host's own box: the reach is drawn by the vertex shader, never laid out (a laid-out
   *  reach would count toward a scrolling ancestor's extent and make it scroll). */
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
  private readonly material: UiShaderMaterial<ReturnType<typeof plateUniforms>>;
  private readonly host: Container;
  private size = "";

  constructor(host: Container, style: { fill: string; border: string; borderWidth?: number }) {
    this.host = host;
    this.material = new UiShaderMaterial("run-upright", {
      uniforms: plateUniforms(style),
      vertexShader: /* glsl */ `
      varying vec2 boxPoint;
      uniform vec2 boxSize;
      #include <clipping_planes_pars_vertex>
      void main() {
        vec2 grow = (boxSize + vec2(${2 * PLATE_REACH}.)) / boxSize;
        boxPoint = vec2(uv.x, 1. - uv.y) * (boxSize + vec2(${2 * PLATE_REACH}.)) - vec2(${PLATE_REACH}.);
        vec4 mvPosition = modelViewMatrix * vec4(position.xy * grow, position.z, 1.);
        #include <clipping_planes_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }`,
      fragmentShader: /* glsl */ `
      uniform vec2 boxSize;
      uniform float opacity;
      uniform vec3 fillInk;
      uniform vec3 borderInk;
      uniform float borderWidth;
      uniform float depth;
      uniform float focusRing;
      varying vec2 boxPoint;
      #include <clipping_planes_pars_fragment>
      vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + .055) / 1.055, vec3(2.4)), step(.04045, c)); }
      float roundBox(vec2 p, vec2 h, float r) { vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
      void over(inout vec4 acc, vec3 ink, float a) { acc = vec4(ink * a + acc.rgb * (1. - a), a + acc.a * (1. - a)); }
      void main() {
        #include <clipping_planes_fragment>
        vec2 p = boxPoint;
        float aa = .5 * max(fwidth(p.x), fwidth(p.y));
        vec2 half_ = boxSize * .5;
        float d = roundBox(p - half_, half_, ${RADIUS}.);
        vec4 acc = vec4(0.);
        if (depth > 0.) {
          float shade = roundBox(p - half_ - vec2(depth), half_, ${RADIUS}.);
          over(acc, vec3(0.), ${HARD_SHADOW.alpha} * (1. - smoothstep(-aa, aa, shade)));
        }
        vec3 col = fillInk;
        if (borderWidth > 0.) col = mix(col, borderInk, smoothstep(-borderWidth - aa, -borderWidth + aa, d));
        over(acc, col, 1. - smoothstep(-aa, aa, d));
        float ring = abs(d - 4.5) - 1.5;
        over(acc, ${vec(ui.ink)}, focusRing * (1. - smoothstep(-aa, aa, ring)));
        if (acc.a <= 0.) discard;
        gl_FragColor = vec4(toLinear(acc.rgb / acc.a), acc.a * opacity);
        #include <colorspace_fragment>
      }`,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
    abortableEffect(() => this.update(), this.content.abortSignal);
  }

  set(state: { fill?: string; border?: string; depth?: number; focus?: number }): void {
    const u = this.material.uniforms;
    if (state.fill !== undefined) srgb(state.fill, u.fillInk.value);
    if (state.border !== undefined) srgb(state.border, u.borderInk.value);
    if (state.depth !== undefined) u.depth.value = state.depth;
    if (state.focus !== undefined) u.focusRing.value = state.focus;
  }

  update(): void {
    this.material.uniforms.opacity.value = inheritedOpacity(this.content);
    const s = this.host.size.value;
    if (!s) return;
    const key = `${s[0]},${s[1]}`;
    if (key === this.size) return;
    this.size = key;
    this.material.uniforms.boxSize.value.set(s[0], s[1]);
  }

  dispose(): void {
    this.content.removeFromParent();
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** A run window's face: paper, a 2px ink rim and the hard shadow. */
export class WindowSurface extends UprightPlate {
  constructor(host: Container) {
    super(host, { fill: ui.paper, border: ui.ink });
  }
}

function vec(hex: string): string {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
}
