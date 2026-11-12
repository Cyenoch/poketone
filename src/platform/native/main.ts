import "./configure";
import { AudioContext, OfflineAudioContext } from "node-web-audio-api";
import { getAudio } from "../../audio/engine";
import { AppRenderer } from "../../rendering/app-renderer";
import { createAppSession, type AppSession } from "../../app/session";
import { installResources } from "../resources";
import { installRuntime } from "../runtime";
import { nativeResources } from "./resources";
import { NativeRenderSurface } from "./render-surface";
import { NativeUiSurface } from "./ui-surface";
import { nativeAppStorage } from "./app-storage";
import { nativeDirectPeer, cleanupNativeDirectPeers } from "./direct-peer";

export async function createNativeApp(base: URL, savePath: string, harbor: string) {
  const storage = nativeAppStorage(savePath);
  installResources(nativeResources(base));
  const surface = new NativeRenderSurface(fail);
  installRuntime({
    nextFrame: surface.nextFrame,
    createAudioContext: () => new AudioContext(),
    createAudioDecoder: () => new OfflineAudioContext(2, 1, 44100),
    activateAudio: (activate) => {
      activate();
    },
  });
  const app = new AppRenderer(surface);
  const abort = new AbortController();
  let session: AppSession | undefined;
  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    abort.abort();
    session?.dispose();
    cleanupNativeDirectPeers();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await getAudio().dispose();
    app.dispose();
  }
  const stop = () => {
    void close();
  };
  function fail(error: Error): void {
    console.error(error);
    process.exitCode = 1;
    stop();
  }
  surface.window.on("beforeClose", (event) => {
    event.prevent();
    stop();
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    session = await createAppSession(
      app,
      new NativeUiSurface(surface, base),
      storage,
      {
        harbor,
        directPeer: nativeDirectPeer,
        error: fail,
      },
      abort.signal,
    );
    if (closed) session.dispose();
  } catch (error) {
    await close();
    throw error;
  }
  return { app, surface, session, close };
}
