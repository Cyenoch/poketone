/** Scheduling and audio facilities the browser and desktop actually provide. */
export interface Runtime {
  nextFrame(): Promise<void>;
  createAudioContext(): AudioContext;
  createAudioDecoder(): OfflineAudioContext;
  activateAudio(activate: () => boolean): void;
}

let installed: Runtime;
export function installRuntime(runtime: Runtime): void {
  installed = runtime;
}
export function runtime(): Runtime {
  if (!installed) throw new Error("Runtime services have not been installed by the host.");
  return installed;
}
