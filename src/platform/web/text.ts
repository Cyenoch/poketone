import * as stylex from "@stylexjs/stylex";
import { webStyles } from "./styles";
import type { TextInput, TextInputEvents, TextServices } from "../text";
import type { TextBuffer } from "../../ui/text-buffer";

function createInput(buffer: TextBuffer, events: TextInputEvents): TextInput {
  const field = document.createElement("textarea");
  field.className = stylex.props(webStyles.saveField).className ?? "";
  field.setAttribute("aria-label", "存档文本");
  field.spellcheck = false;
  const render = () => {
    if (field.value !== buffer.text) field.value = buffer.text;
    field.setSelectionRange(buffer.start, buffer.end, buffer.backward ? "backward" : "forward");
  };
  const change = () =>
    buffer.set(
      field.value,
      field.selectionStart,
      field.selectionEnd,
      field.selectionDirection === "backward",
    );
  const selection = () => {
    if (document.activeElement === field) change();
  };
  document.addEventListener("selectionchange", selection);
  field.addEventListener("input", change);
  field.addEventListener("select", change);
  field.addEventListener("keyup", change);
  field.addEventListener("pointerup", change);
  field.addEventListener("focus", () => events.focus(true));
  field.addEventListener("blur", () => events.focus(false));
  field.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      events.close();
    } else if (event.key === "Tab") {
      event.preventDefault();
      events.leave(event.shiftKey);
    }
  });
  const unsubscribe = buffer.subscribe(render);
  render();
  document.body.append(field);
  return {
    overlay: {
      visible: (visible) => {
        field.style.visibility = visible ? "visible" : "hidden";
      },
      invalid: (invalid) => field.setAttribute("aria-invalid", String(invalid)),
      bounds: (left, top, width, height, fontSize, scale) => {
        Object.assign(field.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
          fontSize: `${fontSize}px`,
          padding: `${10 * scale}px ${12 * scale}px`,
          borderRadius: `${6 * scale}px`,
        });
      },
    },
    focus: () => field.focus(),
    blur: () => field.blur(),
    dispose() {
      unsubscribe();
      document.removeEventListener("selectionchange", selection);
      field.remove();
    },
  };
}

export const webText: TextServices = {
  createInput,
  readClipboard: () => navigator.clipboard.readText(),
  writeClipboard: (text) => navigator.clipboard.writeText(text),
  openFile: () =>
    new Promise((resolve, reject) => {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = ".txt,text/plain";
      picker.addEventListener("cancel", () => resolve(null), { once: true });
      picker.addEventListener(
        "change",
        () => {
          const file = picker.files?.[0];
          if (file) file.text().then(resolve, reject);
          else resolve(null);
        },
        { once: true },
      );
      picker.click();
    }),
  async saveFile(text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "poketone-save.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  },
};
