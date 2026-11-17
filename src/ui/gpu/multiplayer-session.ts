import type { AppStorage } from "../../platform/app-storage";
import type { LobbyPick } from "../../lobbyPick";
import {
  MultiplayerSession,
  parseRejoinTicket,
  type MultiplayerSessionOptions,
} from "../../network/session";
import { MultiplayerRun } from "../../network/run";
import { labBonuses } from "../../run/lab";
import type { Progress } from "../../run/progress";
import type { GpuAppHost } from "./app-host";
import { GpuMultiplayer } from "./multiplayer";

export interface MultiplayerPage {
  /** Leaves the page for the lobby. */
  close: () => void;
  settings: () => void;
  copy: (code: string) => void;
  /** The player's own trainer, partner or (as the host, or before a room) difficulty changed. */
  pick: (next: LobbyPick) => void;
  start: (run: MultiplayerRun) => void;
}

/** The room page owns its connection until it hands it to a run, on either platform. */
export function mountMultiplayer(
  host: GpuAppHost,
  url: string,
  progress: Progress,
  initial: LobbyPick,
  page: MultiplayerPage,
  storage: AppStorage,
  connection: Omit<MultiplayerSessionOptions, "rejoin" | "mission">,
  notify: (message: string) => void,
): () => void {
  let session: MultiplayerSession | undefined;
  let handedOff = false;
  let pick = initial;
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
      session = new MultiplayerSession(
        url,
        code,
        {
          starter: pick.starter,
          trainer: pick.trainer,
          shiny: progress.looks.worn.includes(pick.starter),
          lab: labBonuses(progress.lab),
          archive: progress.archive,
          backpack: progress.backpack,
        },
        {
          ...connection,
          mission: { stage: pick.stage, difficulty: pick.difficulty },
          rejoin: rejoin && ticket ? ticket : undefined,
        },
      );
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
      page.start(new MultiplayerRun(session!, config));
    };
    screen.update(session.state);
  }
  const screen = new GpuMultiplayer(
    host.fonts,
    {
      create: () => connect(""),
      join: connect,
      start: () => session?.start(),
      close: page.close,
      cancel,
      settings: page.settings,
      copy: page.copy,
      pick(next) {
        const previous = pick;
        pick = next;
        page.pick(next);
        if (next.starter !== previous.starter || next.trainer !== previous.trainer)
          session?.setup(next.starter, next.trainer, progress.looks.worn.includes(next.starter));
        if (next.difficulty !== previous.difficulty)
          session?.mission({ stage: next.stage, difficulty: next.difficulty });
      },
      rejoin:
        ticket?.url === url
          ? { code: ticket.code, action: () => connect(ticket.code, true) }
          : undefined,
    },
    progress,
    initial,
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
