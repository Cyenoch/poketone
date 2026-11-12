import { Container, Content } from "@pmndrs/uikit";
import { Color, Mesh, PlaneGeometry } from "three";
import { UiShaderMaterial } from "./ui-shader";

/** Height of the fade at a scroller's edge; a control scrolled into view keeps clear of it. */
export const SCROLL_FADE = 36;

/**
 * A scroller's content dissolving into the window face at an edge it can still scroll past: the
 * cue that a list goes on. Lies over the scroller's top or bottom edge, outside its scrolling
 * content (place it in a non-scrolling box the same size as the scroller), and shows as far as
 * there is content beyond that edge, up to the fade's own height.
 */
export class ScrollFade {
  readonly content: Content;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material: UiShaderMaterial<{
    face: { value: Color };
    strength: { value: number };
    fromTop: { value: number };
    opacity: { value: number };
  }>;
  private readonly edge: "top" | "bottom";

  constructor(edge: "top" | "bottom", face: string) {
    this.edge = edge;
    this.material = new UiShaderMaterial("scroll-fade", {
      uniforms: {
        face: { value: new Color(face) },
        strength: { value: 0 },
        fromTop: { value: edge === "top" ? 1 : 0 },
        // UIKit fades content through the material's own `opacity` uniform.
        opacity: { value: 1 },
      },
      vertexShader: `
        varying float fadeY;
        #include <clipping_planes_pars_vertex>
        void main() {
          fadeY = uv.y;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
          #include <clipping_planes_vertex>
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        uniform vec3 face;
        uniform float strength, fromTop, opacity;
        varying float fadeY;
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          float t = mix(1. - fadeY, fadeY, fromTop);
          gl_FragColor = vec4(face, strength * opacity * t);
        }`,
    });
    this.content = new Content({
      positionType: "absolute",
      positionLeft: 0,
      [edge === "top" ? "positionTop" : "positionBottom"]: 0,
      width: "100%",
      height: SCROLL_FADE,
      keepAspectRatio: false,
      depthTest: false,
    });
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }

  /** Follows `scroller`'s position; true when the fade changed (the caller redraws). */
  update(scroller: Container): boolean {
    const at = scroller.scrollPosition.value[1] ?? 0,
      max = scroller.maxScrollPosition.value[1] ?? 0;
    const beyond = this.edge === "top" ? at : max - at;
    const strength = Math.max(0, Math.min(1, beyond / SCROLL_FADE));
    const uniform = this.material.uniforms.strength;
    if (Math.abs(uniform.value - strength) < 1e-3) return false;
    uniform.value = strength;
    return true;
  }

  dispose(): void {
    this.content.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
