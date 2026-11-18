import { onUserGesture } from "./gesture";

const HINT_KEY = "poketone.installHint.v1";

/** Launched from the home screen: the manifest's display (and, where honoured, orientation) applies. */
function installed(): boolean {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const listeners = new Set<() => void>();
let wanted = false;
let requesting = false;
let stopFirstGesture: (() => void) | undefined;

/** The page may still ask to go fullscreen, whatever the pointer. */
export function canEnterFullscreen(): boolean {
  return document.fullscreenEnabled && !installed() && !document.fullscreenElement;
}

/** A touch page that is not fullscreen yet: what the first tap and the coarse toggles restore. */
export function needsFullscreen(): boolean {
  return wanted && canEnterFullscreen();
}

export function onFullscreenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Only the initial touch or the explicit GPU control calls this, never subsequent gameplay. */
export async function restoreFullscreen(): Promise<void> {
  stopFirstGesture?.();
  stopFirstGesture = undefined;
  if (needsFullscreen() && !requesting) await requestFullscreen();
}

/**
 * The portrait notice's key, offered to any pointer. False only when the browser refused (or the
 * page can no longer ask); a lock the device lacks still leaves the page fullscreen to rotate.
 */
export async function enterLandscape(): Promise<boolean> {
  stopFirstGesture?.();
  stopFirstGesture = undefined;
  if (requesting || document.fullscreenElement) return true;
  if (!canEnterFullscreen() || !(await requestFullscreen())) return false;
  // A touch page already locks from fullscreenchange.
  if (!wanted) await lockLandscape();
  return true;
}

async function requestFullscreen(): Promise<boolean> {
  requesting = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    return true;
  } catch (error) {
    console.warn("请求全屏失败", error);
    return false;
  } finally {
    requesting = false;
  }
}

/** The visible control exits as well as enters; exiting never rearms the first gesture. */
export async function toggleFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return restoreFullscreen();
  try {
    await document.exitFullscreen();
  } catch (error) {
    console.warn("退出全屏失败", error);
  }
}

async function lockLandscape(): Promise<void> {
  if (!screen.orientation?.lock) {
    console.info("设备不支持横屏锁定");
    return;
  }
  try {
    await screen.orientation.lock("landscape");
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotSupportedError")
      console.info("设备不支持横屏锁定", error);
    else console.warn("全屏已开启，但横屏锁定失败", error);
  }
}

/** One page-lifetime owner, installed from main before the UI mounts. */
export function requestLandscapeOnFirstTap(): void {
  wanted = matchMedia("(pointer: coarse)").matches && !installed();
  document.addEventListener("fullscreenchange", () => {
    stopFirstGesture?.();
    stopFirstGesture = undefined;
    for (const listener of listeners) listener();
    if (wanted && document.fullscreenElement) void lockLandscape();
  });
  document.addEventListener("fullscreenerror", () => {
    for (const listener of listeners) listener();
  });
  if (!needsFullscreen()) return;
  stopFirstGesture = onUserGesture((event) => {
    // Only touchend carries the activation fullscreen needs on a touch screen.
    if (event.type !== "touchend") return false;
    void restoreFullscreen();
    return true;
  });
}

/**
 * iPhone Safari has no Fullscreen API or orientation lock. Added to the home screen it opens without
 * browser bars, though still not locked to landscape: the portrait notice stays the rotate prompt.
 * True once per browser, the first time it is asked there; storage that can't remember the answer
 * keeps it false, so the hint never shows on every visit.
 */
export function claimInstallHint(): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios || document.fullscreenEnabled || installed()) return false;
  try {
    if (localStorage.getItem(HINT_KEY) !== null) return false;
    localStorage.setItem(HINT_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
