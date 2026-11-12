import type { LobbyPick } from "../lobbyPick";
import type { Progress, ProgressLoad } from "../run/progress";
import type { SaveData } from "../run/save";
import type { Settings } from "../settings";

/** Persistence is platform-owned; a failed progress write must not commit application state. */
export interface AppStorage {
  load(): { progress: ProgressLoad; settings: Settings; pick: Partial<LobbyPick> };
  save(save: SaveData): void;
  saveProgress(progress: Progress): void;
  saveSettings(settings: Settings): void;
  savePick(pick: LobbyPick): void;
  loadRejoin(): string | null;
  saveRejoin(ticket: string | null): void;
}
