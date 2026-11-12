import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RenderBoundary } from "./RenderBoundary";
import { AppRenderer } from "./rendering/app-renderer";
import { WebRenderSurface } from "./platform/web/render-surface";
import { requestLandscapeOnFirstTap } from "./platform/landscape";
import "./styles.css";
import { installResources } from "./platform/resources";
import { webResources } from "./platform/web/resources";
import { installRuntime } from "./platform/runtime";
import { webRuntime } from "./platform/web/runtime";

installResources(webResources);
installRuntime(webRuntime);

const root = document.getElementById("root");

if (!root) {
  throw new Error("缺少 React 挂载节点 #root");
}

requestLandscapeOnFirstTap();

// The one canvas, context and loop live for the page, outside React's effect replays.
const canvas = document.createElement("canvas");
canvas.className = "app-canvas";
document.body.append(canvas);
let app: AppRenderer | Error;
try {
  app = new AppRenderer(new WebRenderSurface(canvas));
  if (import.meta.env.DEV) Object.assign(window, { __poketoneRender: app.debugProbe() });
} catch (error) {
  canvas.remove();
  app = new Error(`无法启动 WebGL 2：${error instanceof Error ? error.message : String(error)}`, {
    cause: error,
  });
}

createRoot(root).render(
  <StrictMode>
    <RenderBoundary>
      <App app={app} />
    </RenderBoundary>
  </StrictMode>,
);
