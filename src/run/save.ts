import { parseSettings, type Settings } from "../settings";
import { parseProgress, type Progress } from "./progress";

/** Export text: base64 of `<format>.<json>.<checksum>` (UTF-8). A checksum, not anti-tamper. */
export const SAVE_FORMAT = 4;
/** The reason shown when an intact (checksummed) save's content is not valid JSON. */
export const SAVE_UNREADABLE = "存档已损坏（内容无法读取）。";

export interface SaveData {
  progress: Progress;
  settings: Settings;
}

/** FNV-1a over the JSON's UTF-16 code units, as 8 hex digits. */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): string {
  const binary = atob(text.replace(/\s+/g, ""));
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(binary, (char) => char.charCodeAt(0)),
  );
}

export function encodeSave(save: SaveData): string {
  const json = JSON.stringify(parseSave(save, SAVE_FORMAT));
  return toBase64(`${SAVE_FORMAT}.${json}.${checksum(json)}`);
}

/** Throws an Error with a player-facing reason when the text is not an intact save. */
export function decodeSave(text: string): SaveData {
  let raw: string;
  try {
    raw = fromBase64(text);
  } catch {
    throw new Error("不是存档文本。");
  }
  const first = raw.indexOf(".");
  const last = raw.lastIndexOf(".");
  if (first < 0 || last <= first) throw new Error("不是存档文本。");
  const version = raw.slice(0, first);
  if (version !== "3" && version !== String(SAVE_FORMAT)) throw new Error("存档版本不受支持。");
  const json = raw.slice(first + 1, last);
  if (checksum(json) !== raw.slice(last + 1)) throw new Error("存档已损坏（校验和不符）。");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (cause) {
    // The parser's message quotes the text, which can hold characters the UI cannot draw: the
    // detail stays in the console, the player reads a fixed reason.
    console.error("存档内容无法解析", cause);
    throw new Error(SAVE_UNREADABLE);
  }
  return parseSave(value, Number(version));
}

function parseSave(value: unknown, format: number): SaveData {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("存档内容无效。");
  if (Object.keys(value).some((key) => key !== "progress" && key !== "settings"))
    throw new Error("存档字段不受支持。");
  const { progress, settings } = value as Partial<SaveData>;
  const expectedProgress = format === 3 ? 4 : 5;
  if (typeof progress !== "object" || progress === null || progress.version !== expectedProgress)
    throw new Error(`存档进度版本不受支持（外层 v${format} 需要进度 v${expectedProgress}）。`);
  return {
    progress: parseProgress(progress),
    settings: format === 3 ? parseSettingsV3(settings) : parseSettings(settings),
  };
}

/** v3 shipped with three settings, then added two preferences without changing the envelope. */
function parseSettingsV3(value: unknown): Settings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("设置无效。");
  const keys = ["sound", "devMode", "uiScale", "pauseOnBlur", "autoOpenCards"];
  if (Object.keys(value).some((key) => !keys.includes(key))) throw new Error("设置不受支持。");
  const {
    sound,
    devMode,
    uiScale,
    pauseOnBlur = true,
    autoOpenCards = true,
  } = value as Partial<Settings>;
  if (
    typeof sound !== "boolean" ||
    typeof devMode !== "boolean" ||
    typeof pauseOnBlur !== "boolean" ||
    typeof autoOpenCards !== "boolean" ||
    typeof uiScale !== "number" ||
    !Number.isFinite(uiScale) ||
    uiScale < 0.8 ||
    uiScale > 1.5
  )
    throw new Error("旧存档设置无效。");
  return { sound, devMode, uiScale, pauseOnBlur, autoOpenCards };
}
