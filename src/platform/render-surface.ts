import type { WebGLRenderer } from "three";

export interface Display {
  width: number;
  height: number;
  pixelRatio: number;
  coarsePointer: boolean;
}

export interface SurfaceEvents {
  /** True when a picture was drawn and needs presenting. */
  frame: () => boolean;
  lost: () => void;
  restored: () => void;
  input: () => void;
  resume: () => void;
}

/** Window/context and scheduling belong to the host; passes and GPU resources belong to the app. */
export interface RenderSurface {
  readonly renderer: WebGLRenderer;
  readonly display: Display;
  start(events: SurfaceEvents): () => void;
  dispose(): void;
}
