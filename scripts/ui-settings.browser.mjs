// Run in the existing Bun dev browser: await (await import('/scripts/ui-settings.browser.mjs')).checkSettingsDialog()
import { SettingsDialog } from "../src/ui/gpu/settings-dialog.ts";
import { loadUiFonts } from "../src/ui/gpu/fonts.ts";
import { MenuInput } from "../src/ui/gpu/menu-input.ts";

function assert(condition, message, context) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(context)}`);
}

function bounds(node) {
  const size = node.size.value,
    matrix = node.globalMatrix.value;
  assert(size && matrix, "Settings layout unresolved");
  return {
    left: matrix.elements[12] - size[0] / 2,
    right: matrix.elements[12] + size[0] / 2,
    top: matrix.elements[13] + size[1] / 2,
    bottom: matrix.elements[13] - size[1] / 2,
  };
}

function inside(inner, outer) {
  return (
    inner.left >= outer.left - 0.1 &&
    inner.right <= outer.right + 0.1 &&
    inner.top <= outer.top + 0.1 &&
    inner.bottom >= outer.bottom - 0.1
  );
}

async function settle(dialog) {
  // Finish entrance/switch motion, then allow actual font/Yoga layout to propagate.
  dialog.stage.update(250);
  dialog.afterLayout(250);
  for (let i = 0; i < 6; i++) {
    dialog.stage.update(16);
    dialog.afterLayout(16);
    await new Promise(requestAnimationFrame);
  }
}

export async function checkSettingsDialog() {
  const fonts = await loadUiFonts(new URL("/", location.href));
  const results = [];
  function create() {
    const changes = [];
    let closes = 0,
      saves = 0;
    const initial = { sound: true, devMode: false, uiScale: 1 };
    const dialog = new SettingsDialog(fonts, {
      settings: initial,
      onChange: (settings) => changes.push(settings),
      onClose: () => closes++,
      onSave: () => saves++,
    });
    dialog.resize(1280, 800);
    return {
      dialog,
      initial,
      changes,
      get closes() {
        return closes;
      },
      get saves() {
        return saves;
      },
    };
  }

  const normal = create();
  try {
    const { dialog, changes, initial } = normal;
    await settle(dialog);
    dialog.navigate("first");
    dialog.navigate("previous");
    dialog.navigate("confirm");
    assert(normal.saves === 1 && normal.closes === 0, "Shift-Tab must wrap to save", {
      saves: normal.saves,
      closes: normal.closes,
    });
    dialog.navigate("next");
    dialog.navigate("confirm");
    dialog.navigate("cancel");
    assert(normal.closes === 2, "Tab must wrap to close and Escape must close", normal.closes);
    dialog.navigate("first");
    dialog.navigate("down");
    dialog.navigate("left");
    assert(changes.at(-1)?.sound === false, "Left disables focused sound switch", changes);
    dialog.navigate("down");
    dialog.navigate("confirm");
    assert(
      JSON.stringify(changes.at(-1)) ===
        JSON.stringify({ ...initial, sound: false, devMode: true }),
      "Callbacks must carry all current preferences",
      changes,
    );
    assert(
      initial.sound && !initial.devMode && initial.uiScale === 1,
      "Dialog must not mutate caller preferences",
      initial,
    );
    const snapshot = { ...changes[0] };
    dialog.activate(5);
    assert(
      JSON.stringify(changes[0]) === JSON.stringify(snapshot),
      "Later changes mutate callback snapshot",
      changes,
    );
    for (let i = 0; i < 20; i++) dialog.activate(5);
    assert(changes.at(-1).uiScale === 1.5, "Scale increase must reach maximum", changes.at(-1));
    const atMax = changes.length;
    dialog.activate(5);
    assert(changes.length === atMax, "Disabled increase must not submit", changes.at(-1));
    for (let i = 0; i < 20; i++) dialog.activate(3);
    assert(changes.at(-1).uiScale === 0.8, "Scale decrease must reach minimum", changes.at(-1));
    const atMin = changes.length;
    dialog.activate(3);
    assert(changes.length === atMin, "Disabled decrease must not submit", changes.at(-1));
    dialog.activate(4);
    assert(
      changes.at(-1).uiScale === 1 && dialog.stage.viewport.scale === 1,
      "Reset must restore preference and viewport",
      changes.at(-1),
    );
    results.push({
      behavior: "callbacks, keyboard wrap, close, scale bounds and reset",
      passed: true,
    });
  } finally {
    normal.dialog.dispose();
  }

  const exit = create();
  let exitDisposed = false;
  try {
    const { dialog } = exit;
    const advance = (ms) => {
      dialog.stage.update(ms);
      dialog.afterLayout(ms);
    };
    advance(40);
    const beforeClose = { ...dialog.transform, ...dialog.fade };
    assert(
      beforeClose.opacity > 0 && beforeClose.opacity < 1,
      "Exit interruption must start during a visible entrance",
      beforeClose,
    );
    dialog.close();
    assert(
      JSON.stringify({ ...dialog.transform, ...dialog.fade }) === JSON.stringify(beforeClose),
      "Closing during entrance must continue from the current visible state",
      beforeClose,
    );
    const beforeInput = {
      selected: dialog.selected,
      scroll: [...dialog.body.scrollPosition.value],
    };
    dialog.focus(2);
    dialog.activate(2);
    dialog.activate(5);
    dialog.scroll(100);
    for (const action of ["confirm", "confirm", "right", "next", "cancel"]) dialog.navigate(action);
    assert(
      exit.changes.length === 0 &&
        exit.closes === 0 &&
        exit.saves === 0 &&
        dialog.selected === beforeInput.selected &&
        JSON.stringify(dialog.body.scrollPosition.value) === JSON.stringify(beforeInput.scroll),
      "Closing modal must retain input ownership without submitting or moving focus",
      beforeInput,
    );
    advance(70);
    assert(
      dialog.fade.opacity > 0 && dialog.fade.opacity < beforeClose.opacity && !dialog.exitFinished,
      "Exit must fade from interrupted opacity while retaining modal",
      dialog.fade,
    );
    advance(70);
    assert(
      dialog.fade.opacity === 0 && !dialog.exitFinished,
      "Invisible modal must remain owned after 140ms until its exit completes",
      dialog.fade,
    );
    advance(79);
    assert(!dialog.exitFinished, "Modal must remain retained before 220ms");
    advance(1);
    assert(dialog.exitFinished, "Modal must release after its 220ms exit");
    dialog.dispose();
    exitDisposed = true;
    assert(!dialog.stage.motion.update(1000), "Disposed modal must leave no running motion");
    results.push({
      behavior: "interrupted exit, input ownership and delayed release",
      passed: true,
    });
  } finally {
    if (!exitDisposed) exit.dialog.dispose();
  }

  const layout = create();
  try {
    const { dialog } = layout;
    for (const [width, height, scale] of [
      [1280, 800, 1],
      [1280, 800, 1.5],
      [844, 390, 1],
      [844, 390, 1.5],
      [667, 375, 1],
      [667, 375, 1.5],
      [568, 320, 1.5],
      [667, 375, 0.8],
    ]) {
      dialog.activate(4);
      for (let i = 0; i < Math.round(Math.abs(scale - 1) * 10); i++)
        dialog.activate(scale > 1 ? 5 : 3);
      const safeArea =
        width < 1000
          ? { top: 0, right: 44, bottom: 21, left: 44 }
          : { top: 0, right: 0, bottom: 0, left: 0 };
      dialog.resize(width, height, safeArea);
      await settle(dialog);
      const camera = dialog.stage.camera;
      const safeBounds = {
        left: camera.left + safeArea.left / scale,
        right: camera.right - safeArea.right / scale,
        top: camera.top - safeArea.top / scale,
        bottom: camera.bottom + safeArea.bottom / scale,
      };
      assert(inside(bounds(dialog.panel), safeBounds), "Settings panel must respect safe area", {
        width,
        height,
        scale,
        panel: bounds(dialog.panel),
        safeBounds,
      });
      for (let index = 0; index < dialog.controls.length; index++) {
        if (!dialog.controls[index].enabled()) continue;
        dialog.focus(index);
        await settle(dialog);
        const control = bounds(dialog.controls[index].panel);
        const camera = dialog.stage.camera;
        const host = {
          left: camera.left,
          right: camera.right,
          top: camera.top,
          bottom: camera.bottom,
        };
        const x = ((control.left + control.right) / 2 - camera.left) * scale;
        const y = (camera.top - (control.top + control.bottom) / 2) * scale;
        const context = {
          width,
          height,
          scale,
          index,
          control,
          body: bounds(dialog.body),
          hit: dialog.hit(x, y),
        };
        assert(inside(control, host), "Focused settings control must remain in viewport", context);
        assert(inside(control, safeBounds), "Settings control must respect safe area", context);
        assert(
          index === 0 || inside(control, bounds(dialog.body)),
          "Focused settings control must be fully inside scroll body",
          context,
        );
        assert(context.hit === index, "Focused settings control center must be clickable", context);
        assert(
          (control.right - control.left) * scale >= 44 - 0.1 &&
            (control.top - control.bottom) * scale >= 44 - 0.1,
          "Settings control must keep 44px host touch target",
          context,
        );
      }
      dialog.navigate("first");
      await settle(dialog);
      const close = bounds(dialog.controls[0].panel);
      assert(
        inside(close, {
          left: dialog.stage.camera.left,
          right: dialog.stage.camera.right,
          top: dialog.stage.camera.top,
          bottom: dialog.stage.camera.bottom,
        }),
        "Close must remain reachable",
        { width, height, scale },
      );
      const pressInput = new MenuInput(dialog);
      const closeX = ((close.left + close.right) / 2 - camera.left) * scale;
      const closeY = (camera.top - (close.top + close.bottom) / 2) * scale;
      const beforePress = {
        changes: layout.changes.length,
        closes: layout.closes,
        saves: layout.saves,
      };
      assert(pressInput.down(7, closeX, closeY), "Close control must acquire pressed gesture", {
        width,
        height,
        scale,
      });
      dialog.stage.update(100);
      dialog.afterLayout(100);
      assert(
        dialog.hit(closeX, closeY) === 0,
        "Pressed feedback must preserve the close control's hit target",
        { width, height, scale },
      );
      pressInput.cancel(7);
      pressInput.up(7, closeX, closeY);
      assert(
        layout.changes.length === beforePress.changes &&
          layout.closes === beforePress.closes &&
          layout.saves === beforePress.saves,
        "Cancelled pressed close must not submit",
        { width, height, scale },
      );
      if (dialog.body.maxScrollPosition.value[1] > 0) {
        dialog.scroll(-100000);
        await settle(dialog);
        const body = bounds(dialog.body);
        // The body padding is empty space, and must still own a scrolling finger.
        const x = (body.left + 2 - camera.left) * scale;
        const y = (camera.top - (body.top + body.bottom) / 2) * scale;
        assert(
          dialog.hit(x, y) > dialog.controls.length,
          "Body padding must be a non-command gesture target",
          { width, height, scale, x, y },
        );
        const changes = layout.changes.length,
          closes = layout.closes,
          saves = layout.saves;
        const input = new MenuInput(dialog);
        assert(input.down(1, x, y), "Dragging from body padding must acquire gesture", {
          width,
          height,
          scale,
        });
        const beforeScroll = dialog.body.scrollPosition.value[1];
        input.move(1, x, y - 60, false);
        input.up(1, x, y - 60);
        await settle(dialog);
        assert(
          dialog.body.scrollPosition.value[1] > beforeScroll,
          "Body-padding drag must scroll settings",
          { width, height, scale, beforeScroll, afterScroll: dialog.body.scrollPosition.value[1] },
        );
        input.down(2, x, y);
        input.up(2, x, y);
        assert(
          layout.changes.length === changes && layout.closes === closes && layout.saves === saves,
          "Body-padding drag/tap must not activate settings or close",
          { width, height, scale },
        );
      }
      dialog.activate(4);
      await settle(dialog);
      assert(
        dialog.stage.viewport.scale === 1 &&
          JSON.stringify(dialog.stage.viewport.safeArea) === JSON.stringify(safeArea),
        "Scale reset must preserve host safe area",
        { width, height, scale, viewport: dialog.stage.viewport },
      );
      const resetCamera = dialog.stage.camera;
      assert(
        inside(bounds(dialog.panel), {
          left: resetCamera.left + safeArea.left,
          right: resetCamera.right - safeArea.right,
          top: resetCamera.top - safeArea.top,
          bottom: resetCamera.bottom + safeArea.bottom,
        }),
        "Reset panel must remain inside safe area",
        { width, height },
      );
      results.push({
        width,
        height,
        scale,
        safeArea,
        behavior: "safe controls, body drag and scale reset",
        passed: true,
      });
    }
  } finally {
    layout.dialog.dispose();
  }
  return results;
}
