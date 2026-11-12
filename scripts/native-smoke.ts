import "../src/platform/native/configure";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import sdl from "@kmamal/sdl";
import { Text } from "@pmndrs/uikit";
import { getCaretTransformation } from "@pmndrs/uikit/dist/text/layout/query.js";
import { Vector3 } from "three";
import { GpuSaveDialog } from "../src/ui/gpu/save-dialog";
import { createNativeApp } from "../src/platform/native/main";
import { decodeSave, encodeSave } from "../src/run/save";
import { NativeFileDialogs } from "../src/platform/native/file-dialogs";
import { emptyProgress } from "../src/run/progress";
import { writeSave } from "../src/platform/native/save";
import { playableStages } from "../src/lobbyPick";
import type { UiStage } from "../src/ui/gpu/stage";

declare const NATIVE_ASSETS: string;
const directory = "/tmp/poketone-native-navigation";
await mkdir(directory, { recursive: true });
const savePath = `${directory}/save-${Date.now()}.txt`;
writeSave(savePath, {
  progress: {
    ...emptyProgress(),
    kills: 5000,
    research: 5000,
    stardust: 1000,
    backpack: ["magnet"],
  },
  settings: { sound: true, devMode: false, uiScale: 1 },
});
const game = await createNativeApp(
  new URL(NATIVE_ASSETS),
  savePath,
  "ws://127.0.0.1:8787/multiplayer",
);
const host = game.session!.host;
const errors: number[] = [];
let context = game.app.renderer.getContext();
const clipboard = sdl.clipboard.text;
async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 60_000;
  while (!predicate() && performance.now() < deadline) await delay(20);
  assert(predicate(), label);
}
async function settled() {
  await until(() => !game.session!.state().busy, "scene transition stuck");
  await delay(300);
}
async function capture(name: string) {
  await delay(300);
  const gl = game.app.renderer.getContext();
  const width = gl.drawingBufferWidth,
    height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const error = gl.getError();
  errors.push(error);
  assert.equal(error, 0, name);
  assert(
    pixels.some((value, i) => i % 4 !== 3 && value > 30),
    `${name}: empty frame ${JSON.stringify({ width, height, stats: game.app.stats, available: game.app.available })}`,
  );
  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .flip()
    .png()
    .toFile(`${directory}/${name}.png`);
}
function key(name: string, key: string) {
  const event = {
    scancode: sdl.keyboard.SCANCODE[name as keyof typeof sdl.keyboard.SCANCODE],
    key,
    repeat: 0,
    shift: 0,
    ctrl: 0,
    alt: 0,
    super: 0,
    altgr: 0,
    capslock: 0,
    numlock: 0,
  };
  game.surface.window.emit("keyDown", { ...event, type: "keyDown" });
  game.surface.window.emit("keyUp", { ...event, type: "keyUp" });
}
function locate(stage: UiStage | undefined, label: string) {
  let found: Text | undefined;
  stage?.root.traverse((node) => {
    if (
      !found &&
      node instanceof Text &&
      node.properties.peek().text === label &&
      node.isVisible?.value
    )
      found = node;
  });
  if (!stage || !found) return null;
  const target = found.parentContainer.value ?? found;
  const m = target.globalMatrix.value!.elements;
  return {
    x: (m[12]! - stage.camera.left) * stage.viewport.scale,
    y: (stage.camera.top - m[13]!) * stage.viewport.scale,
  };
}
async function press(stage: () => UiStage | undefined, label: string) {
  game.surface.window.focus();
  await until(() => game.surface.window.focused, "SDL test window has no input focus");
  await until(() => !!locate(stage(), label), `missing control: ${label}`);
  const point = locate(stage(), label)!;
  game.surface.window.emit("mouseMove", { type: "mouseMove", ...point, touch: false });
  await delay(50);
  game.surface.window.emit("mouseButtonDown", {
    type: "mouseButtonDown",
    ...point,
    touch: false,
    button: 1,
  });
  game.surface.window.emit("mouseButtonUp", {
    type: "mouseButtonUp",
    ...point,
    touch: false,
    button: 1,
  });
  await delay(100);
}
const lobby = () => host.inspect().lobby?.stage;
const overlay = () => host.inspect().run?.overlays.stage;
try {
  let revealed = false;
  void host.revealed.then(() => {
    revealed = true;
  });
  await until(() => revealed, "lobby failed to reveal");
  await settled();
  await capture("lobby");
  key("F11", "F11");
  await until(() => game.surface.window.fullscreen, "fullscreen did not enter");
  await delay(700);
  await capture("fullscreen");
  key("F11", "F11");
  await until(() => !game.surface.window.fullscreen, "fullscreen did not exit");
  await delay(700);
  game.surface.window.hide();
  await delay(100);
  const hiddenFrames = game.app.stats.presented;
  await delay(200);
  assert.equal(game.app.stats.presented, hiddenFrames, "hidden windows must stop rendering");
  game.surface.window.show();
  game.surface.window.focus();
  await until(() => game.app.stats.presented > hiddenFrames, "shown window failed to redraw");

  host.inspect().lobby!.focusStart();
  key("TAB", "tab");
  key("RETURN", "return");
  await until(() => !!host.inspect().dialog, "settings failed to open");
  await press(() => host.inspect().dialog?.stage, "存档");
  await until(() => host.inspect().screens.length === 2, "shared save window failed to mount");
  const saveStage = () => host.inspect().screens.at(-1)?.stage;
  await capture("save");
  const save = host.inspect().screens.at(-1)!;
  assert(save instanceof GpuSaveDialog);
  let glyphs: Text | undefined;
  save.stage.root.traverse((node) => {
    if (node instanceof Text && String(node.properties.peek().text) === save.buffer.text)
      glyphs = node;
  });
  assert(glyphs?.textLayout.value);
  const caretPoint = (index: number) => {
    const caret = getCaretTransformation(glyphs!.textLayout.value!, index);
    const world = new Vector3(...caret.position, 0).applyMatrix4(glyphs!.globalTextMatrix.value!);
    return {
      x: (world.x - save.stage.camera.left) * save.stage.viewport.scale,
      y: (save.stage.camera.top - world.y) * save.stage.viewport.scale,
    };
  };
  game.surface.window.emit("mouseButtonDown", { button: 1, ...caretPoint(1) });
  game.surface.window.emit("mouseMove", caretPoint(4));
  assert.deepEqual([save.buffer.start, save.buffer.end], [1, 4]);
  game.surface.window.emit("blur");
  game.surface.window.emit("mouseMove", caretPoint(8));
  assert.deepEqual([save.buffer.start, save.buffer.end], [1, 4], "blur must end text selection");
  await press(saveStage, "复制");
  const imported = decodeSave(sdl.clipboard.text);
  imported.progress.stardust = 1234;
  host.inspect().screens.at(-1)!.focus(1);
  game.surface.window.emit("textInput", { text: encodeSave(imported) });
  await press(saveStage, "导入");
  await until(() => host.inspect().screens.length === 1, "save import failed to close");
  assert.equal(decodeSave(await readFile(savePath, "utf8")).progress.stardust, 1234);

  key("E", "e");
  await delay(200);
  assert.notEqual(game.session!.pick.starter, "charmander", "partner selection must reach the app");
  const selected = game.session!.pick.starter;
  host.inspect().lobby!.focusStart();
  if (playableStages.length > 1) {
    key("UP", "up");
    key("UP", "up");
    key("RIGHT", "right");
    assert.equal(game.session!.pick.stage, playableStages[1], "map sign must update the run pick");
    key("LEFT", "left");
  }
  await press(lobby, "研究所");
  await until(() => game.session!.state().screen === "lab", "lab failed to open");
  await settled();
  await capture("lab");
  await press(() => host.inspect().screens[0]?.stage, "训练");
  assert.equal(
    decodeSave(await readFile(savePath, "utf8")).progress.lab.dmg,
    1,
    "purchase must persist",
  );
  key("ESCAPE", "escape");
  await until(() => game.session!.state().screen === "lobby", "lab back failed");
  await settled();
  assert.equal(game.session!.pick.starter, selected, "lobby must keep the chosen partner");
  await press(lobby, "联机");
  await until(() => host.inspect().screens.length === 2, "multiplayer window failed to mount");
  await capture("multiplayer");
  key("ESCAPE", "escape");
  await until(() => host.inspect().screens.length === 1, "multiplayer close failed");
  await press(lobby, "出发");
  await until(() => game.session!.state().screen === "run", "departure failed");
  await settled();
  await until(
    () => !!host.inspect().run && !host.inspect().run!.overlays.isModal,
    "run failed to load",
  );
  assert.deepEqual(
    decodeSave(await readFile(savePath, "utf8")).progress.backpack,
    [],
    "successful start consumes backpack",
  );
  await capture("run");
  key("P", "p");
  await capture("pause");
  const frozen = game.app.stats.worldDrawn;
  await delay(400);
  assert.equal(game.app.stats.worldDrawn, frozen, "pause must freeze the world");
  await press(overlay, "设置");
  await capture("settings");
  key("ESCAPE", "escape");
  await until(() => !host.inspect().dialog, "settings failed to close");
  await press(overlay, "继续");
  await until(() => game.app.stats.worldDrawn > frozen, "resume must redraw the world");
  const hud = host.inspect().run!.hud;
  const beforeRecovery = game.app.stats.worldDrawn;
  game.surface.recreateContext();
  assert.notEqual(game.app.renderer.getContext(), context, "recovery must replace the actual GL");
  context = game.app.renderer.getContext();
  await until(
    () =>
      game.app.available &&
      game.app.stats.worldDrawn > beforeRecovery &&
      game.app.stats.ui.calls > 0 &&
      !!host.inspect().run?.overlays.isModal,
    "recovery failed",
  );
  assert.equal(host.inspect().run!.hud, hud, "context recovery must retain the running session");
  await capture("restored");
  await press(overlay, "继续");
  await until(() => game.app.stats.worldDrawn > beforeRecovery, "restored world did not redraw");
  game.surface.window.setSize(844, 390);
  await capture("small");
  game.surface.window.setSize(1280, 800);
  await delay(300);
  key("P", "p");
  await press(overlay, "重新开始");
  await settled();
  await until(
    () => !!host.inspect().run && !host.inspect().run!.overlays.isModal,
    "restart failed",
  );
  assert.equal(
    decodeSave(await readFile(savePath, "utf8")).progress.runs,
    1,
    "restart settles once",
  );
  await capture("restarted");
  key("P", "p");
  await press(overlay, "放弃冒险");
  await press(overlay, "返回大厅");
  await until(() => game.session!.state().screen === "lobby", "return to lobby failed");
  await settled();
  assert.equal(
    decodeSave(await readFile(savePath, "utf8")).progress.runs,
    2,
    "lobby return settles once",
  );
  assert.equal(
    game.app.renderer.getContext(),
    context,
    "navigation must retain the native context",
  );
  assert.equal(game.session!.pick.starter, selected, "return must retain selected partner");
  await capture("returned");
  // Exercise a real AppKit sheet and cancellation during disposal, while SDL keeps pumping.
  const handle = game.surface.window.native.handle;
  assert(handle);
  const files = new NativeFileDialogs(handle);
  let ticks = 0;
  const clock = setInterval(() => ticks++, 20);
  try {
    const choice = files.choose(false);
    await delay(250);
    files.dispose();
    assert.equal(await choice, null);
    assert(ticks >= 3, "the file sheet must not block the application's timers");
  } finally {
    clearInterval(clock);
    files.dispose();
  }
  await writeFile(
    `${directory}/report.json`,
    JSON.stringify(
      {
        errors,
        route: game.session!.state().screen,
        pick: game.session!.pick,
        lifecycle: [
          "fullscreen",
          "hide/show",
          "save import",
          "native context replacement",
          "file sheet cancellation",
        ],
        stats: game.app.stats,
      },
      null,
      2,
    ),
  );
} finally {
  sdl.clipboard.setText(clipboard);
  await game.close();
}
console.info(`Native navigation smoke passed: ${directory}`);
