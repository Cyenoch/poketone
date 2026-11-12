import {
  BufferGeometry,
  Float32BufferAttribute,
  GLSL3,
  Mesh,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

/**
 * The world's own render target (single-canvas assessment S2). The world draws into it only when
 * its picture changed; every presented frame copies it to the canvas and draws the UI over it, so
 * a paused world costs one textured triangle, not a scene and shadow render.
 *
 * The target holds **display-encoded** colour: world materials grade and encode their own output
 * (`run/view/grade.ts`), because three gives ordinary targets no tone mapping and linear output.
 * So it is RGBA8 with `NoColorSpace` (no hardware sRGB conversion) and the copy passes values
 * through unchanged. Do not "fix" it to linear.
 */

/** MSAA samples, as the old antialiased world canvas had. */
const SAMPLES = 4;

const COPY_VERTEX = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;
const COPY_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D map;
in vec2 vUv;
out vec4 color;
void main() {
  color = vec4( texture( map, vUv ).rgb, 1.0 );
}`;

export class WorldPass {
  readonly #target = new WebGLRenderTarget(1, 1, {
    samples: SAMPLES,
    format: RGBAFormat,
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    depthBuffer: true,
    stencilBuffer: true,
  });
  readonly #geometry = new BufferGeometry();
  readonly #material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: COPY_VERTEX,
    fragmentShader: COPY_FRAGMENT,
    uniforms: { map: { value: this.#target.texture } },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  readonly #scene = new Scene();
  readonly #camera = new OrthographicCamera();
  /** The target holds no current picture (new size, restore, a new world). */
  #stale = true;

  constructor() {
    this.#geometry.setAttribute(
      "position",
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    const triangle = new Mesh(this.#geometry, this.#material);
    triangle.frustumCulled = false;
    this.#scene.add(triangle);
  }

  get stale(): boolean {
    return this.#stale;
  }

  invalidate(): void {
    this.#stale = true;
  }

  /** Sizes the target for `canvas`'s CSS box at `ratio` world pixels per CSS pixel; a new size
   *  empties it (three re-allocates), so only accepted resolution changes and resizes reach here. */
  fit(size: { width: number; height: number }, ratio: number): void {
    const width = Math.max(1, Math.round(size.width * ratio));
    const height = Math.max(1, Math.round(size.height * ratio));
    if (width === this.#target.width && height === this.#target.height) return;
    this.#target.setSize(width, height);
    this.#stale = true;
  }

  /** Runs `draw` with the world target bound and the world pass state; restores the canvas after. */
  inTarget<T>(renderer: WebGLRenderer, draw: () => T): T {
    renderer.setRenderTarget(this.#target);
    renderer.localClippingEnabled = false;
    renderer.setTransparentSort(null);
    try {
      return draw();
    } finally {
      renderer.setRenderTarget(null);
      // The world clears with its haze; the canvas keeps the app's transparent clear.
      renderer.setClearColor(0x000000, 0);
    }
  }

  /** Draws the world into the target; `draw` clears it with its own background. */
  render(renderer: WebGLRenderer, draw: (renderer: WebGLRenderer) => void): void {
    this.inTarget(renderer, () => draw(renderer));
    this.#stale = false;
  }

  /** Copies the world picture to the bound canvas (no blending, no conversion). */
  copy(renderer: WebGLRenderer): void {
    renderer.render(this.#scene, this.#camera);
  }

  /** Context lost: the GPU copies go; the next frames re-allocate and redraw. */
  release(): void {
    this.#target.dispose();
    this.#geometry.dispose();
    this.#material.dispose();
    this.#stale = true;
  }

  dispose(): void {
    this.release();
  }
}
