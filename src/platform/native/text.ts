import sdl, { type Events } from "@kmamal/sdl";
import { readFileSync } from "node:fs";
import type { TextBuffer } from "../../ui/text-buffer";
import type { TextInput, TextInputEvents, TextServices } from "../text";
import { NativeFileDialogs } from "./file-dialogs";
import { writeTextFile } from "./save";

type Editor = { buffer: TextBuffer; events: TextInputEvents };

/** SDL delivers committed text; editing keys and clipboard commands modify the same GPU buffer. */
export class NativeTextServices implements TextServices {
  private active?: Editor;
  private readonly files: NativeFileDialogs;

  constructor(handle: Buffer) {
    this.files = new NativeFileDialogs(handle);
  }

  createInput(buffer: TextBuffer, events: TextInputEvents): TextInput {
    const editor = { buffer, events };
    return {
      focus: () => {
        if (this.active === editor) return;
        this.blur();
        this.active = editor;
        events.focus(true);
      },
      blur: () => {
        if (this.active === editor) this.blur();
      },
      dispose: () => {
        if (this.active === editor) this.blur();
      },
    };
  }

  blur(): void {
    const previous = this.active;
    this.active = undefined;
    previous?.events.focus(false);
  }

  textInput(text: string): void {
    this.active?.buffer.replace(text);
  }

  keyDown(event: Events.Window.KeyDown, key: string): boolean {
    const editor = this.active;
    if (!editor) return false;
    const { buffer, events } = editor;
    const command = !!(event.ctrl || event.super);
    const shift = !!event.shift;
    if (key === "Escape") events.close();
    else if (key === "Tab") events.leave(shift);
    else if (command && key.toLowerCase() === "a") buffer.select(0, buffer.text.length);
    else if (command && ["c", "x", "v"].includes(key.toLowerCase())) {
      this.clipboard(editor, key.toLowerCase());
    } else if (key === "Home" || (event.super && key === "ArrowLeft")) buffer.edge(false, shift);
    else if (key === "End" || (event.super && key === "ArrowRight")) buffer.edge(true, shift);
    else if (key === "ArrowLeft") buffer.move(-1, shift);
    else if (key === "ArrowRight") buffer.move(1, shift);
    else if (key === "ArrowUp") buffer.edge(false, shift);
    else if (key === "ArrowDown") buffer.edge(true, shift);
    else if (key === "Enter") buffer.replace("\n");
    else if (key === "Backspace") buffer.delete(true);
    else if (key === "Delete") buffer.delete(false);
    // Printable keys arrive once through SDL textInput, never through keyDown.
    return true;
  }

  private clipboard(editor: Editor, key: string): void {
    const { buffer, events } = editor;
    try {
      if (key === "v") {
        buffer.replace(this.readClipboard());
      } else {
        this.writeClipboard(buffer.text.slice(buffer.start, buffer.end));
        if (key === "x") buffer.replace("");
      }
    } catch (cause) {
      if (this.active === editor)
        events.error(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  readClipboard(): string {
    return sdl.clipboard.text;
  }
  writeClipboard(text: string): void {
    sdl.clipboard.setText(text);
  }
  async openFile(): Promise<string | null> {
    const path = await this.files.choose(false);
    return path === null ? null : readFileSync(path, "utf8");
  }
  async saveFile(text: string): Promise<boolean> {
    const path = await this.files.choose(true);
    if (path === null) return false;
    writeTextFile(path, text);
    return true;
  }
  dispose(): void {
    this.blur();
    this.files.dispose();
  }
}
