import type { TextBuffer } from "../ui/text-buffer";

export interface TextInputEvents {
  focus(focused: boolean): void;
  leave(backward: boolean): void;
  close(): void;
  error(error: Error): void;
}

/** A platform may draw a real text control over the GPU text well (Web/IME). */
export interface TextOverlay {
  visible(visible: boolean): void;
  invalid(invalid: boolean): void;
  bounds(
    left: number,
    top: number,
    width: number,
    height: number,
    fontSize: number,
    scale: number,
  ): void;
}

export interface TextInput {
  readonly overlay?: TextOverlay;
  focus(): void;
  blur(): void;
  dispose(): void;
}

export interface TextServices {
  createInput(buffer: TextBuffer, events: TextInputEvents): TextInput;
  readClipboard(): string | Promise<string>;
  writeClipboard(text: string): void | Promise<void>;
  openFile(): Promise<string | null>;
  saveFile(text: string): Promise<boolean>;
}
