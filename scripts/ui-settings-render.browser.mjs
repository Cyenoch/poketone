import { WebRenderSurface } from "../src/platform/web/render-surface.ts";
import { installResources } from "../src/platform/resources.ts";
import { webResources } from "../src/platform/web/resources.ts";
installResources(webResources);
// In the Bun dev browser: await (await import('/scripts/ui-settings-render.browser.mjs')).checkSettingsRender()
import { Scene, SRGBColorSpace, WebGLRenderTarget } from "three";
import { SettingsDialog } from "../src/ui/gpu/settings-dialog.ts";
import { uiFonts } from "../src/ui/gpu/fonts.ts";
import { AppRenderer } from "../src/rendering/app-renderer.ts";

function assert(condition, message, context) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(context)}`);
}

function region(node, camera, maxWidth = Infinity) {
  const size = node.size.value,
    matrix = node.globalMatrix.value;
  assert(size && matrix, "Settings render layout unresolved");
  return {
    x: Math.ceil(matrix.elements[12] - size[0] / 2 - camera.left),
    y: Math.ceil(matrix.elements[13] - size[1] / 2 - camera.bottom),
    width: Math.max(1, Math.floor(Math.min(size[0], maxWidth)) - 1),
    height: Math.max(1, Math.floor(size[1]) - 1),
  };
}

function hasPixel(renderer, target, area, matches) {
  const pixels = new Uint8Array(area.width * area.height * 4);
  renderer.readRenderTargetPixels(target, area.x, area.y, area.width, area.height, pixels);
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i + 3] > 0 && matches(pixels[i], pixels[i + 1], pixels[i + 2])) return true;
  return false;
}

export async function checkSettingsRender() {
  // Its own app renderer (no clients, so its loop draws nothing) on a detached canvas.
  const app = new AppRenderer(new WebRenderSurface(document.createElement("canvas")));
  const loaded = uiFonts(new URL("/", location.href), app, (error) => {
    throw error;
  });
  const fonts = loaded.families;
  const renderer = app.renderer;
  renderer.setSize(800, 600, false);
  const target = new WebGLRenderTarget(800, 600, { stencilBuffer: true });
  target.texture.colorSpace = SRGBColorSpace;
  const empty = new Scene();
  const cycles = [];
  try {
    for (let cycle = 0; cycle < 4; cycle++) {
      const dialog = new SettingsDialog(fonts, {
        settings: { sound: true, devMode: false, uiScale: 1 },
        onChange() {},
        onClose() {},
        onSave() {},
      });
      let titleVisible = false,
        closeVisible = false;
      try {
        dialog.resize(800, 600);
        dialog.setCoarsePointer(true);
        dialog.navigate("first");
        // The dialog's pages, decoded and uploaded (the app loop runs the upload).
        if (cycle === 0) await loaded.ready(dialog.stage, true);
        // TextureLoader completes asynchronously even though the atlas has arrived.
        for (let frame = 0; frame < 30; frame++) {
          dialog.stage.update(16);
          dialog.afterLayout(16);
          // Bound per draw: the app loop between frames binds the canvas.
          renderer.setRenderTarget(target);
          renderer.clear(true, true, true);
          dialog.stage.render(renderer);
          titleVisible = hasPixel(
            renderer,
            target,
            region(dialog.title, dialog.stage.camera, 64),
            (r, g, b) => r > 220 && g > 220 && b > 220,
          );
          closeVisible = hasPixel(
            renderer,
            target,
            region(dialog.controls[0].panel, dialog.stage.camera),
            (r, g, b) => r > 180 && g > 120 && b < 150 && g > b * 1.2,
          );
          if (frame >= 5 && titleVisible && closeVisible) break;
          await new Promise(requestAnimationFrame);
        }
        assert(titleVisible, "Header plate must not cover white settings title glyphs", { cycle });
        assert(closeVisible, "Header plate must not cover focused yellow close control", { cycle });
        dialog.close();
        dialog.stage.update(220);
        dialog.afterLayout(220);
        assert(dialog.exitFinished, "Close transition must finish before release", { cycle });
      } finally {
        dialog.dispose();
      }
      renderer.setRenderTarget(target);
      renderer.render(empty, dialog.stage.camera);
      renderer.renderLists.dispose();
      const memory = { ...renderer.info.memory };
      if (cycles.length) {
        const baseline = cycles[0].memory;
        assert(
          memory.geometries <= baseline.geometries && memory.textures <= baseline.textures,
          "Repeated settings open/close must not accumulate GPU resources",
          { cycle, baseline, memory },
        );
      }
      cycles.push({ cycle, titleVisible, closeVisible, memory });
    }
    return cycles;
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
    app.dispose();
  }
}
