/** Per-browser preferences. Storage can be unavailable (private mode); defaults then apply for the session. */
export interface Settings {
  sound: boolean;
  devMode: boolean;
  uiScale: number;
  /** Solo: the run pauses when the window loses focus. */
  pauseOnBlur: boolean;
  /** Solo: a level-up opens its card choice at once; off, it waits for the interact key. */
  autoOpenCards: boolean;
}

export const SETTINGS_STORAGE_KEY = "poketone.settings.v3";
export const defaultSettings: Settings = {
  sound: true,
  devMode: false,
  uiScale: 1,
  pauseOnBlur: true,
  autoOpenCards: true,
};
export const uiScaleRange = { min: 0.8, max: 1.5, step: 0.1 };

function validUiScale(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= uiScaleRange.min &&
    value <= uiScaleRange.max
  );
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw === null) return { ...defaultSettings };
    return parseSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Stored settings rejected; original data kept; using session defaults.", error);
    return { ...defaultSettings };
  }
}

/** Stored and imported settings accept only the current preferences; ones added later may be absent. */
export function parseSettings(value: unknown): Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("设置无效。");
  if (Object.keys(value).some((key) => !Object.hasOwn(defaultSettings, key)))
    throw new Error("设置不受支持。");
  const {
    sound,
    devMode,
    uiScale,
    pauseOnBlur = defaultSettings.pauseOnBlur,
    autoOpenCards = defaultSettings.autoOpenCards,
  } = value as Partial<Settings>;
  if (
    typeof sound !== "boolean" ||
    typeof devMode !== "boolean" ||
    typeof pauseOnBlur !== "boolean" ||
    typeof autoOpenCards !== "boolean"
  )
    throw new Error("设置无效。");
  if (!validUiScale(uiScale)) throw new Error("界面缩放无效。");
  return { sound, devMode, uiScale, pauseOnBlur, autoOpenCards };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are a convenience; an unwritable store keeps them for this session only.
  }
}
