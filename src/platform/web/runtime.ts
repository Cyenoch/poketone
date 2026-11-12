import { onUserGesture } from "../gesture";
import type { Runtime } from "../runtime";

export const webRuntime: Runtime = {
  nextFrame: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  createAudioContext: () => new AudioContext(),
  createAudioDecoder: () => new OfflineAudioContext(2, 1, 44100),
  activateAudio: onUserGesture,
};
