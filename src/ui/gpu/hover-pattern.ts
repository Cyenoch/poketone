import { idleTicked } from "./motion";
import { Content } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import type { ColorRepresentation } from "three";
import type { UiMotion } from "./motion";
import { cubicBezier } from "./focus-mark";

const hsl = { h: 0, s: 0, l: 0 };
const probe = new Color();

/**
 * DESIGN.md `fx-hover` ink for a surface, tone on tone: a dark face takes a faint white, the yellow
 * face gold, any other light face a pale blue. Each stays near 1.2:1 against its fill.
 */
function inkFor(surface: ColorRepresentation): { ink: string; alpha: number } {
  probe.set(surface).getHSL(hsl);
  if (hsl.l < 0.45) return { ink: "#ffffff", alpha: 0.16 };
  if (hsl.s > 0.6 && hsl.h > 0.08 && hsl.h < 0.17) return { ink: "#b48129", alpha: 0.34 };
  return { ink: "#2165a4", alpha: 0.18 };
}

/**
 * The original 84×42 half-drop ball pattern, evaluated on the GPU without a texture upload, inked
 * for the surface it lies on (`setSurface` when that surface changes, e.g. a picked tile).
 */
export class HoverPattern {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly uniforms = {
    patternSize: { value: new Vector2(1, 1) },
    patternPhase: { value: 0 },
    patternAlpha: { value: 0 },
    patternInk: { value: new Color() },
    patternTint: { value: 0 },
    patternRadius: { value: 8 },
  };
  private readonly fade = { opacity: 0 };
  private focused = false;
  private elapsed = 0;
  private readonly drift: boolean;
  private readonly motion: UiMotion;
  private readonly invalidate: () => void;

  /**
   * `radius`: the control's corner radius (clamped to half its box: a large one makes a circle).
   * `drift`: false where the lit pattern must hold still (the run HUD adds no motion to the field).
   */
  constructor(
    motion: UiMotion,
    invalidate: () => void,
    surface: ColorRepresentation,
    radius = 8,
    drift = true,
  ) {
    this.uniforms.patternRadius.value = radius;
    this.drift = drift;
    this.motion = motion;
    this.invalidate = invalidate;
    this.setSurface(surface);
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 patternUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\npatternUv=uv;",
      );
      shader.fragmentShader =
        `
        varying vec2 patternUv;
        uniform vec2 patternSize;
        uniform float patternPhase;
        uniform float patternAlpha;
        uniform vec3 patternInk;
        uniform float patternTint;
        uniform float patternRadius;
        float ballStroke(vec2 p,float aa) {
          float r=length(p);
          float rings=min(abs(r-13.),abs(r-4.4))-1.;
          float bar=max(abs(p.y)-1.,max(4.5-abs(p.x),abs(p.x)-13.));
          float d=min(rings,bar);
          return 1.-smoothstep(-aa,aa,d);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 pixel=vec2(patternUv.x,1.-patternUv.y)*patternSize;
        float aa=max(fwidth(pixel.x),fwidth(pixel.y));
        vec2 tile=mod(pixel-patternPhase*vec2(84.,42.),vec2(84.,42.));
        float first=ballStroke(tile-vec2(21.,21.),aa);
        float second=ballStroke(tile-vec2(63.,0.),aa);
        float third=ballStroke(tile-vec2(63.,42.),aa);
        float mask=max(first,max(second,third));
        float radius=min(patternRadius,min(patternSize.x,patternSize.y)*.5);
        vec2 q=abs(pixel-patternSize*.5)-(patternSize*.5-vec2(radius));
        float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-radius;
        float rounded=1.-smoothstep(-fwidth(edge),fwidth(edge),edge);
        diffuseColor=vec4(patternInk,mask*rounded*patternAlpha*patternTint*opacity);
      `,
      );
    };
    this.material.customProgramCacheKey = () => "poketone-hover";
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

  setSurface(surface: ColorRepresentation): void {
    const { ink, alpha } = inkFor(surface);
    if (this.uniforms.patternTint.value === alpha) return;
    this.uniforms.patternInk.value.set(ink);
    this.uniforms.patternTint.value = alpha;
    this.invalidate();
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    this.motion.animate(
      this.fade,
      { opacity: focused ? 1 : 0 },
      220,
      () => {
        this.uniforms.patternAlpha.value = this.fade.opacity;
        this.invalidate();
      },
      (t) => cubicBezier(t, 0, 0, 0.58, 1),
    );
  }

  update(deltaMs: number): void {
    const size = this.content.size.value;
    if (size) this.uniforms.patternSize.value.set(size[0], size[1]);
    const previous = this.uniforms.patternPhase.value;
    // DESIGN.md fx-hover: lit (hovered, focused or selected, by any input) it drifts; unlit it
    // stops where it is.
    if (this.focused && this.drift) this.elapsed = (this.elapsed + deltaMs) % 24000;
    // The drift is 3.5 px/s: shown on the stage's 15Hz idle clock (under 0.25 px a step), so a lit
    // control on an idle screen redraws with the other decorative loops, not every frame.
    if (idleTicked(15) || !this.focused) this.uniforms.patternPhase.value = this.elapsed / 24000;
    this.content.visible =
      this.content.isVisible.value && !this.content.isClipped.value && this.fade.opacity > 0;
    if (previous !== this.uniforms.patternPhase.value && this.content.visible) this.invalidate();
  }

  dispose(): void {
    this.motion.cancel(this.fade);
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
