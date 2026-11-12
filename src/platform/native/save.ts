import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { decodeSave, encodeSave, SAVE_FORMAT, type SaveData } from "../../run/save";
import { emptyProgress } from "../../run/progress";

/** Schema versions are independent of app releases; legacy files stay untouched. */
export function nativeSavePath(directory: string): string {
  const path = join(directory, `save.v${SAVE_FORMAT}.txt`);
  try {
    statSync(path);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const previousPath = join(directory, "save.txt");
  try {
    statSync(previousPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw error;
  }
  throw new Error(`旧存档路径不受支持（${previousPath}），已保留原文件。`);
}

/** The desktop file is exactly a Web export. A bad file stops loading and is never replaced. */
export function readSave(path: string): SaveData {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      progress: emptyProgress(),
      settings: { sound: true, devMode: false, uiScale: 1 },
    };
  }
  return decodeSave(text);
}

/** A complete, flushed file replaces the old one atomically on the same filesystem. */
export function writeSave(path: string, save: SaveData): void {
  writeTextFile(path, encodeSave(save));
}

/** Shared by save persistence and the platform file export. */
export function writeTextFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flush: true });
  renameSync(temporary, path);
}
