// In the Bun dev browser: await (await import('/scripts/ui-audio.browser.mjs')).checkAudioAcquire()
// Named audio acquires (readiness design §4): a sound is decoded while held and freed at zero
// holders; one fetch per file however many hold it; the player holds only the wanted track.
import { createAudio } from "../src/audio/engine.ts";

const state = () => window.__poketoneAudio();

export async function checkAudioAcquire() {
  const fetched = [];
  const original = window.fetch;
  window.fetch = (input, init) => {
    fetched.push(input instanceof Request ? input.url : String(input));
    return original(input, init);
  };
  try {
    const audio = createAudio();
    const steps = {};
    const a = audio.acquire(["ui-move", "hit"]);
    const b = audio.acquire(["ui-move"]);
    await Promise.all([a.result, b.result]);
    steps.held = state().effects;
    // `ui-move` has several takes: each file once, however many hold the sound.
    const takes = fetched.filter((url) => url.includes("ui-move"));
    steps.uiMoveFetchedTwice = takes.length - new Set(takes).size;
    a.release();
    steps.afterFirstRelease = state().effects;
    b.release();
    steps.afterSecondRelease = state().effects;
    audio.music.play("menu");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    steps.menuHeld = state().tracks;
    audio.music.play("run");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    steps.runHeld = state().tracks;
    audio.music.play(null);
    steps.noneHeld = state().tracks;
    const ok =
      steps.held === 2 &&
      steps.uiMoveFetchedTwice === 0 &&
      steps.afterFirstRelease === 1 &&
      steps.afterSecondRelease === 0 &&
      steps.menuHeld.join() === "menu" &&
      steps.runHeld.length === 1 &&
      /^run-\d$/.test(steps.runHeld[0]) &&
      steps.noneHeld.length === 0;
    if (!ok) throw new Error(`audio acquire: ${JSON.stringify(steps)}`);
    return steps;
  } finally {
    window.fetch = original;
  }
}
