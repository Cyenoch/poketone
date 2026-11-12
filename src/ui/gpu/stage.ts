import { Component, Container, reversePainterSortStable } from "@pmndrs/uikit";
import { setLayoutGrid } from "@pmndrs/uikit/dist/flex/yoga.js";
import { NoToneMapping, OrthographicCamera, Scene, type WebGLRenderer } from "three";
import { releaseUploads } from "../../rendering/releaseUploads";
import { UiMotion } from "./motion";
import { uiViewport, type UiInsets } from "./viewport";

/** Framebuffer pixels per CSS pixel of the renderer every stage draws with (set by its host). */
let framebufferRatio = 1;
export function setUiPixelRatio(ratio: number): void {
  framebufferRatio = ratio;
}

/** Screen-space UI owns no window globals; the browser or desktop host supplies viewport size. */
export class UiStage {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  readonly root: Container;
  readonly motion = new UiMotion();
  viewport = uiViewport(1, 1, 1);
  private dirty = true;
  private layoutGrid = 0;

  constructor() {
    this.camera.position.z = 10;
    this.root = new Container(
      {
        pixelSize: 1,
        width: 1,
        height: 1,
        fontFamily: "Poketone UI",
        fontWeight: 500,
        color: "#142f50",
      },
      undefined,
      {
        renderContext: {
          requestFrame: () => {
            this.dirty = true;
          },
        },
      },
    );
    this.scene.add(this.root);
  }

  resize(hostWidth: number, hostHeight: number, scale = 1, safeArea?: UiInsets): void {
    this.viewport = uiViewport(hostWidth, hostHeight, scale, safeArea);
    const { width, height } = this.viewport;
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = height / 2;
    this.camera.bottom = -height / 2;
    this.camera.updateProjectionMatrix();
    this.root.setProperties({ width, height });
    this.dirty = true;
  }

  /** Device pixels per layout unit: every laid-out edge lands on a multiple of its inverse. */
  get pixelGrid(): number {
    return this.viewport.scale * framebufferRatio;
  }

  invalidate(): void {
    this.dirty = true;
  }

  update(deltaMs: number): boolean {
    const pending = this.dirty;
    this.dirty = false;
    const animated = this.motion.update(deltaMs);
    // Layout snaps every edge to this stage's device pixels (scale × DPR), as a browser snaps its
    // paint; the grid is shared by all stages (patches/@pmndrs__uikit), so each sets its own first.
    const grid = this.pixelGrid;
    if (grid !== this.layoutGrid) {
      // Moving to another monitor can change the grid without changing any layout property.
      this.root.requestLayout();
      this.layoutGrid = grid;
    }
    this.crispBorders(grid);
    setLayoutGrid(grid);
    this.root.update(deltaMs);
    return pending || animated || this.dirty;
  }

  /**
   * Rounds every border width authored on this stage to whole device pixels (at least one) before
   * layout: snapped edges alone would draw a 2-unit border at 0.8 × 2 DPR 3 pixels on one side and
   * 4 on the other. UIKit keeps the authored values separate from these rounded widths.
   */
  private crispBorders(grid: number): void {
    this.root.traverse((object) => {
      if (object instanceof Component) object.setBorderWidthGrid(grid);
    });
  }

  /** World pass restores its own default sorting; UI never changes world materials or exposure. */
  render(renderer: WebGLRenderer): void {
    this.withUiState(renderer, () => {
      renderer.clearDepth();
      renderer.render(this.scene, this.camera);
    });
  }

  /**
   * Starts compiling every program the next render needs, under the render's own state so the
   * program keys match. Resolves once they can be used without stalling a frame.
   */
  compileAsync(renderer: WebGLRenderer): Promise<unknown> {
    return this.withUiState(renderer, () => renderer.compileAsync(this.scene, this.camera));
  }

  private withUiState<T>(renderer: WebGLRenderer, draw: () => T): T {
    const toneMapping = renderer.toneMapping;
    const clipping = renderer.localClippingEnabled;
    const autoClear = renderer.autoClear;
    renderer.toneMapping = NoToneMapping;
    renderer.localClippingEnabled = true;
    renderer.autoClear = false;
    renderer.setTransparentSort(reversePainterSortStable);
    try {
      return draw();
    } finally {
      renderer.toneMapping = toneMapping;
      renderer.localClippingEnabled = clipping;
      renderer.autoClear = autoClear;
      renderer.setTransparentSort(null);
    }
  }

  /** Font pages are not this stage's: the font registry releases and restores them (fonts.ts). */
  releaseUploads(): void {
    releaseUploads(this.scene);
  }

  dispose(): void {
    this.motion.dispose();
    const components: { dispose(): void }[] = [];
    this.root.traverse((object) => {
      if (object instanceof Component) components.push(object);
    });
    for (const component of components.reverse()) component.dispose();
    this.scene.clear();
  }
}
