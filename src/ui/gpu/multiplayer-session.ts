import type { AppStorage } from "../../platform/app-storage";
import type { LobbyPick } from "../../lobbyPick";
import type { PlayerSetup } from "../../network/protocol";
import {
  MultiplayerSession,
  parseRejoinTicket,
  type MultiplayerSessionOptions,
} from "../../network/session";
import { MultiplayerRun } from "../../network/run";
import type { GpuAppHost } from "./app-host";
import { GpuMultiplayer } from "./multiplayer";

/** The room owns its connection until it hands it to a run, on either platform. */
export function mountMultiplayer(
  host: GpuAppHost,
  url: string,
  pick: LobbyPick,
  player: PlayerSetup,
  close: () => void,
  start: (run: MultiplayerRun) => void,
  storage: AppStorage,
  connection: Omit<MultiplayerSessionOptions, "rejoin">,
  notify: (message: string) => void,
): () => void {
  let session: MultiplayerSession | undefined;
  let handedOff = false;
  const warning = (error: Error) => {
    console.error(error);
    notify(error.message);
  };
  let ticket: ReturnType<typeof parseRejoinTicket> = null;
  try {
    ticket = parseRejoinTicket(storage.loadRejoin());
  } catch (cause) {
    warning(new Error("重返凭据读取失败", { cause }));
  }
  function cancel() {
    if (session) {
      session.onChange = () => {};
      session.close();
      session = undefined;
    }
  }
  function connect(code: string, rejoin = false) {
    cancel();
    try {
      session = new MultiplayerSession(url, code, player, {
        ...connection,
        rejoin: rejoin && ticket ? ticket : undefined,
      });
    } catch {
      screen.update({
        room: null,
        self: 0,
        mode: "connecting",
        starting: false,
        canStart: false,
        peers: {},
        error: "连接中断",
      });
      return;
    }
    session.onTicket = (value) => storage.saveRejoin(value ? JSON.stringify(value) : null);
    session.onWarning = warning;
    session.onChange = () => screen.update(session!.state);
    session.onStart = (config) => {
      handedOff = true;
      start(new MultiplayerRun(session!, config));
    };
    screen.update(session.state);
  }
  const screen = new GpuMultiplayer(
    host.fonts,
    {
      create: () => connect(""),
      join: connect,
      start: () => session?.start(pick.stage, pick.difficulty),
      close,
      cancel,
      rejoin:
        ticket?.url === url
          ? { code: ticket.code, action: () => connect(ticket.code, true) }
          : undefined,
    },
    pick,
  );
  const unregister = host.registerScreen(screen);
  return () => {
    unregister();
    screen.dispose();
    if (session) {
      session.onChange = () => {};
      if (!handedOff) session.close();
    }
  };
}
