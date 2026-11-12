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

export function needsFullscreen(): boolean {
  return wanted && document.fullscreenEnabled && !installed() && !document.fullscreenElement;
}

export function onFullscreenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Only the initial touch or the explicit GPU control calls this, never subsequent gameplay. */
export async function restoreFullscreen(): Promise<void> {
  stopFirstGesture?.();
  stopFirstGesture = undefined;
  if (!needsFullscreen() || requesting) return;
  requesting = true;
  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch (error) {
    console.warn("请求全屏失败", error);
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
  try {
    await screen.orientation.lock("landscape");
  } catch (error) {
    console.warn("全屏已开启，但横屏锁定失败", error);
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
