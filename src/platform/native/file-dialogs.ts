/// <reference types="bun" />
import { CString, dlopen, JSCallback, ptr, type Pointer } from "bun:ffi";
import { fileURLToPath, pathToFileURL } from "node:url";

declare const NATIVE_PLATFORM_LIBRARY: string;

function loadLibrary() {
  return dlopen(fileURLToPath(new URL(NATIVE_PLATFORM_LIBRARY, pathToFileURL(process.execPath))), {
    poketone_choose_file: { args: ["ptr", "bool", "function"], returns: "ptr" },
    poketone_cancel_file: { args: ["ptr"], returns: "void" },
    poketone_release_file: { args: ["ptr"], returns: "void" },
  });
}

/** AppKit sheets complete on SDL's main-thread event pump, without blocking network heartbeats. */
export class NativeFileDialogs {
  private library?: ReturnType<typeof loadLibrary>;
  private pending?: Pointer | bigint;
  private disposed = false;
  private readonly viewHandle: Buffer;

  constructor(viewHandle: Buffer) {
    this.viewHandle = viewHandle;
  }

  choose(save: boolean): Promise<string | null> {
    if (this.disposed) throw new Error("File dialogs have been disposed.");
    if (this.pending) throw new Error("A file dialog is already open.");
    const library = (this.library ??= loadLibrary());
    return new Promise((resolve, reject) => {
      const callback = new JSCallback(
        (path: Pointer | bigint | null) => {
          const selected = path === null ? null : String(new CString(path));
          // Leave AppKit's native completion stack before releasing its block or unloading code.
          setImmediate(() => {
            callback.close();
            library.symbols.poketone_release_file(this.pending!);
            this.pending = undefined;
            if (this.disposed) {
              library.close();
              this.library = undefined;
            }
            resolve(selected);
          });
        },
        { args: ["ptr"], returns: "void" },
      );
      this.pending =
        library.symbols.poketone_choose_file(ptr(this.viewHandle), save, callback.ptr) ?? undefined;
      if (!this.pending) {
        callback.close();
        reject(new Error("Could not open the native file picker."));
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending) this.library!.symbols.poketone_cancel_file(this.pending);
    else {
      this.library?.close();
      this.library = undefined;
    }
  }
}
