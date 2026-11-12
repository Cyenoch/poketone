import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { parsePick } from "../../lobbyPick";
import type { AppStorage } from "../app-storage";
import { readSave, writeSave } from "./save";

export function nativeAppStorage(path: string): AppStorage {
  let save = readSave(path);
  const pickPath = `${path}.pick.json`;
  return {
    load() {
      let pick = {};
      try {
        pick = parsePick(JSON.parse(readFileSync(pickPath, "utf8")));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          if (!(error instanceof SyntaxError) && typeof code !== "string") throw error;
          console.warn(
            `Cannot read lobby preference (${pickPath}); using default selection.`,
            error,
          );
        }
      }
      return {
        progress: { status: "ready", progress: save.progress },
        settings: save.settings,
        pick,
      };
    },
    save(next) {
      writeSave(path, next);
      save = next;
    },
    saveProgress(progress) {
      const next = { ...save, progress };
      writeSave(path, next);
      save = next;
    },
    saveSettings(settings) {
      const next = { ...save, settings };
      writeSave(path, next);
      save = next;
    },
    loadRejoin() {
      try {
        return readFileSync(`${path}.rejoin.json`, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    saveRejoin(ticket) {
      if (ticket === null) rmSync(`${path}.rejoin.json`, { force: true });
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(`${path}.rejoin.json`, ticket, { encoding: "utf8", mode: 0o600 });
      }
    },
    savePick(pick) {
      // The choice is a preference outside the portable save, as on Web.
      mkdirSync(dirname(pickPath), { recursive: true });
      writeFileSync(pickPath, JSON.stringify(pick), { encoding: "utf8", mode: 0o600 });
    },
  };
}
