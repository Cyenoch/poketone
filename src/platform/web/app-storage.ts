import { loadProgress, saveProgress, PROGRESS_STORAGE_KEY } from "../../run/progress";
import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY } from "../../settings";
import { loadPick, savePick } from "../../lobbyPick";
import type { AppStorage } from "../app-storage";

export const webAppStorage: AppStorage = {
  load: () => ({ progress: loadProgress(), settings: loadSettings(), pick: loadPick() }),
  save(save) {
    const entries = [
      [PROGRESS_STORAGE_KEY, JSON.stringify(save.progress)],
      [SETTINGS_STORAGE_KEY, JSON.stringify(save.settings)],
    ] as const;
    const previous = entries.map(([key]) => localStorage.getItem(key));
    let written = 0;
    try {
      for (const [key, value] of entries) {
        localStorage.setItem(key, value);
        written++;
      }
    } catch (error) {
      const errors = [error];
      for (let i = written - 1; i >= 0; i--) {
        try {
          const value = previous[i]!;
          if (value === null) localStorage.removeItem(entries[i]![0]);
          else localStorage.setItem(entries[i]![0], value);
        } catch (rollback) {
          errors.push(rollback);
        }
      }
      if (errors.length > 1) throw new AggregateError(errors, "存档写入及恢复失败。");
      throw error;
    }
  },
  saveProgress,
  saveSettings,
  savePick,
  loadRejoin: () => localStorage.getItem("poketone.rejoin"),
  saveRejoin(ticket) {
    if (ticket === null) localStorage.removeItem("poketone.rejoin");
    else localStorage.setItem("poketone.rejoin", ticket);
  },
};
