// In the Bun dev browser: await (await import('/scripts/ui-toast.browser.mjs')).checkToast()
import { GpuToast } from "../src/ui/gpu/toast.ts";
import { loadUiFonts } from "../src/ui/gpu/fonts.ts";

function assert(condition, message, context) {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(context)}`);
}

function bounds(node) {
  const size = node.size.value,
    matrix = node.globalMatrix.value;
  assert(size && matrix, "Toast layout must resolve");
  return {
    left: matrix.elements[12] - size[0] / 2,
    right: matrix.elements[12] + size[0] / 2,
    top: matrix.elements[13] + size[1] / 2,
    bottom: matrix.elements[13] - size[1] / 2,
  };
}

function inside(a, b) {
  return (
    a.left >= b.left - 0.1 &&
    a.right <= b.right + 0.1 &&
    a.top <= b.top + 0.1 &&
    a.bottom >= b.bottom - 0.1
  );
}

function advance(toast, milliseconds) {
  toast.stage.update(milliseconds);
  toast.afterLayout(milliseconds);
}

async function settle(toast) {
  // Font/Yoga/entrance work advances without consuming notification lifetime.
  toast.stage.update(250);
  toast.afterLayout(0);
  for (let i = 0; i < 6; i++) {
    toast.stage.update(16);
    toast.afterLayout(0);
    await new Promise(requestAnimationFrame);
  }
}

export async function checkToast() {
  const fonts = await loadUiFonts(new URL("/", location.href));
  const results = [];
  let dismissals = 0;
  const toast = new GpuToast(fonts, () => dismissals++);
  toast.resize(1000, 700, 1);
  try {
    toast.setMessage("设置已保存");
    await settle(toast);
    advance(toast, 2999);
    assert(dismissals === 0, "Default notification must remain before three seconds");
    advance(toast, 1);
    advance(toast, 3000);
    assert(dismissals === 1, "Default timeout must dismiss exactly once", dismissals);

    toast.setMessage("声音已开启");
    advance(toast, 1000);
    toast.setHovered(1);
    advance(toast, 10000);
    toast.setHovered(null);
    toast.focus(0);
    advance(toast, 10000);
    assert(dismissals === 1, "Hover and close focus must pause notification timeout");
    toast.focus(null);
    advance(toast, 1999);
    assert(dismissals === 1, "Unhover/unfocus must resume the remaining lifetime");
    advance(toast, 1);
    assert(dismissals === 2, "Resumed notification must dismiss after its remaining lifetime");

    toast.setMessage("界面缩放已更新");
    advance(toast, 2999);
    toast.setMessage("声音已关闭");
    advance(toast, 2999);
    assert(dismissals === 2, "Replacement message must receive a fresh lifetime");
    advance(toast, 1);
    assert(dismissals === 3, "Replacement must eventually dismiss");
    toast.setMessage("开发者模式已开启", 0);
    advance(toast, 100000);
    assert(dismissals === 3, "Duration zero must require explicit dismissal");
    results.push({
      behavior: "default lifetime, hover/focus pause, replacement and persistent message",
      passed: true,
    });

    {
      toast.setMessage("设置已保存", 0);
      await settle(toast);
      const text = toast.messageText.properties.value.text;
      const close = bounds(toast.close),
        camera = toast.stage.camera;
      const x = (close.left + close.right) / 2 - camera.left;
      const y = camera.top - (close.top + close.bottom) / 2;
      toast.setMessage(null);
      assert(
        toast.hit(x, y) === -1 && !toast.navigate("confirm"),
        "Exiting notification must immediately stop accepting input",
      );
      assert(
        toast.messageText.properties.value.text === text,
        "Exit transition must retain the outgoing message glyphs",
      );
      const duration = 220;
      advance(toast, duration - 1);
      assert(
        toast.ribbon.properties.value.display !== "none",
        "Outgoing ribbon must remain until exit completes",
      );
      advance(toast, 1);
      assert(
        toast.ribbon.properties.value.display === "none",
        "Outgoing ribbon must hide at exit completion",
      );
      results.push({
        behavior: "outgoing message retention and exit timing",
        passed: true,
      });
    }

    toast.setMessage("设置已保存", 0);
    await settle(toast);
    toast.setMessage(null);
    advance(toast, 70);
    toast.setMessage("声音已开启", 0);
    advance(toast, 300);
    assert(
      toast.ribbon.properties.value.display !== "none" &&
        toast.messageText.properties.value.text === "声音已开启" &&
        toast.fade.opacity === 1,
      "Replacement during exit must survive the old exit deadline",
    );
    results.push({ behavior: "replacement interrupts stale exit", passed: true });

    const longMessage = "设置已保存，界面缩放已更新。声音已开启，声音已关闭。开发者模式已开启。";
    for (const [width, height, scale, safeArea] of [
      [1000, 700, 1, { top: 0, right: 0, bottom: 0, left: 0 }],
      [667, 375, 1.5, { top: 0, right: 44, bottom: 21, left: 44 }],
    ]) {
      toast.setMessage(null);

      toast.resize(width, height, scale, safeArea);
      toast.setMessage(longMessage, 0);
      await settle(toast);
      const camera = toast.stage.camera,
        ribbon = bounds(toast.ribbon),
        close = bounds(toast.close);
      const safe = {
        left: camera.left + safeArea.left / scale,
        right: camera.right - safeArea.right / scale,
        top: camera.top - safeArea.top / scale,
        bottom: camera.bottom + safeArea.bottom / scale,
      };
      const context = { width, height, scale, ribbon, close, safe };
      assert(
        inside(ribbon, safe) && inside(close, safe),
        "Long notification and close must fit safe viewport",
        context,
      );
      assert(
        (close.right - close.left) * scale >= 44 - 0.1 &&
          (close.top - close.bottom) * scale >= 44 - 0.1,
        "Toast close must preserve a 44px host target",
        context,
      );
      assert(
        toast.hit(
          ((close.left + close.right) / 2 - camera.left) * scale,
          (camera.top - (close.top + close.bottom) / 2) * scale,
        ) === 0,
        "Long notification close must remain clickable",
        context,
      );
      if (scale > 1)
        assert(
          toast.messageText.size.value[1] > toast.messageText.properties.value.fontSize * 1.5,
          "Long Chinese notification must wrap on small screens",
          context,
        );
      const beforeClose = dismissals;
      toast.activate(0);
      toast.activate(0);
      assert(
        dismissals === beforeClose + 1,
        "Close must dismiss a persistent long notification exactly once",
      );
      results.push({
        behavior: "long Chinese layout and accessible close",
        width,
        height,
        scale,
        passed: true,
      });
    }
    return results;
  } finally {
    toast.dispose();
  }
}
