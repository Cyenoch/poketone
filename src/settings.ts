/** Per-browser preferences. Storage can be unavailable (private mode); defaults then apply for the session. */
export interface Settings {
  sound: boolean;
  devMode: boolean;
  uiScale: number;
}

export const SETTINGS_STORAGE_KEY = "poketone.settings.v3";
const defaults: Settings = { sound: true, devMode: false, uiScale: 1 };
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
    if (raw === null) return { ...defaults };
    return parseSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Stored settings rejected; original data kept; using session defaults.", error);
    return { ...defaults };
  }
}

/** Stored and imported settings accept only the current three preferences. */
export function parseSettings(value: unknown): Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("设置无效。");
  if (Object.keys(value).some((key) => !Object.hasOwn(defaults, key)))
    throw new Error("设置不受支持。");
  const { sound, devMode, uiScale } = value as Partial<Settings>;
  if (typeof sound !== "boolean" || typeof devMode !== "boolean") throw new Error("设置无效。");
  if (!validUiScale(uiScale)) throw new Error("界面缩放无效。");
  return { sound, devMode, uiScale };
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Preferences are a convenience; an unwritable store keeps them for this session only.
  }
}
