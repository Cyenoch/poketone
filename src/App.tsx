import { useEffect, useState } from "react";
import { WebRenderSurface } from "./platform/web/render-surface";
import type { AppRenderer } from "./rendering/app-renderer";
import { createAppSession, type AppSession, type AppState } from "./app/session";
import { WebUiSurface } from "./platform/web/ui-surface";
import { webAppStorage } from "./platform/web/app-storage";
import { webDirectPeer } from "./platform/web/direct-peer";
import * as stylex from "@stylexjs/stylex";
import { webStyles } from "./platform/web/styles";

/** The browser owns its error page and native text field; the game lives in the shared session. */
export function App({ app }: { app: AppRenderer | Error }) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [view, setView] = useState<AppState | null>(null);
  const [gpuAttempt, setGpuAttempt] = useState(0);
  const [gpuError, setGpuError] = useState<Error | null>(app instanceof Error ? app : null);
  useEffect(() => {
    if (app instanceof Error) return;
    if (!(app.surface instanceof WebRenderSurface)) throw new Error("Web 应用缺少浏览器画布。");
    let disposed = false;
    let current: AppSession | undefined;
    const abort = new AbortController();
    void createAppSession(
      app,
      new WebUiSurface(app.surface.canvas),
      webAppStorage,
      {
        harbor: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/multiplayer`,
        directPeer: webDirectPeer,
        changed: (state) => {
          if (!disposed) setView(state);
        },
        error: (error) => {
          if (!disposed) setGpuError(error);
        },
      },
      abort.signal,
    )
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        current = created;
        if (import.meta.env.DEV)
          Object.defineProperty(window, "__poketoneUi", {
            configurable: true,
            get: () => created.host.inspect(),
          });
        setSession(created);
      })
      .catch((error: unknown) => {
        if (!disposed) setGpuError(error instanceof Error ? error : new Error(String(error)));
      });
    return () => {
      disposed = true;
      abort.abort();
      current?.dispose();
      if (import.meta.env.DEV) Reflect.deleteProperty(window, "__poketoneUi");
    };
  }, [app, gpuAttempt]);

  useEffect(() => {
    if (!import.meta.env.DEV || !session) return;
    Object.assign(window, {
      __poketoneGrant: (stardust = 0, kills = 0) =>
        session.change("记录", (progress) => ({
          ...progress,
          stardust: progress.stardust + stardust,
          kills: progress.kills + kills,
          research: progress.research + kills,
        })),
    });
    return () => {
      Reflect.deleteProperty(window, "__poketoneGrant");
    };
  }, [session]);
  return (
    <main
      {...stylex.props(webStyles.shell)}
      data-screen={view?.screen ?? "lobby"}
      data-transition={view?.transition ?? "idle"}
    >
      {gpuError && (
        // A platform failure page: no GPU, so plain document text (the agreed DOM exception).
        <section role="alert" {...stylex.props(webStyles.error, webStyles.errorOverlay)}>
          <h1 {...stylex.props(webStyles.errorTitle)}>无法显示游戏界面</h1>
          <p {...stylex.props(webStyles.errorText)}>{gpuError.message}</p>
          <button
            {...stylex.props(webStyles.errorButton)}
            type="button"
            onClick={() => {
              // The page's renderer never started: only a new page gets a new context.
              if (app instanceof Error) {
                location.reload();
                return;
              }
              setSession(null);
              setGpuError(null);
              setGpuAttempt((attempt) => attempt + 1);
            }}
          >
            重试
          </button>
        </section>
      )}
    </main>
  );
}
