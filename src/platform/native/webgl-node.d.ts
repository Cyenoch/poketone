declare module "webgl-node" {
  /** webgl-node 1.6.2 exposes a renderer surface and a GLES-backed WebGL2 context. */
  export function createWebGL2Context(
    width: number,
    height: number,
    options: { antialias: boolean; canvas: false },
  ): {
    canvas: null;
    gl: Omit<WebGL2RenderingContext, "canvas"> & { readonly canvas: null };
    attachWindow(handle: Buffer): boolean;
    setSwapInterval(interval: number): void;
    resize(width: number, height: number): void;
    swapBuffers(): boolean;
    destroy(): void;
  };
}
