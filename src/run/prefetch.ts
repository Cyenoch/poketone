import { createPreparation, type Need, type Preparation } from "../prepare/preparation";
import { getAudio, RUN_SOUNDS, RUN_TRACKS } from "../audio/engine";
import type { StageId } from "./sim/content/stages/index";
import type { StarterId } from "./sim/content/lines/index";
import type { Difficulty } from "./sim/content/difficulties";
import { lineNeeds, runSharedNeeds } from "./view/assets";
import { stageThemes } from "./view/stageThemes";
import { images } from "../prepare/images";

/**
 * The lobby's hold on run resources (readiness design §2, §4, §5.4): the stage's shared set S, the
 * selected line and one recent line, as model-store handles that outlive any run. A run acquires
 * its own handles on top; when it ends these keep S and the line in memory and on the GPU, so the
 * next 出发 refetches, re-parses and re-uploads nothing.
 *
 * Lanes: S and the selected line download in the background; the recent line drops to `keep`
 * (finished work stays, nothing new starts). Selecting the recent line again swaps them back.
 *
 * Nothing starts before `open`, called once the lobby is revealed: until then the first screen's
 * fonts and images have the link to themselves (a pick before that is only remembered).
 */

/** The run's sounds decoded and its music downloaded (a track decodes when played: the first
 *  under the run's start, the next when the rotation turns, from these bytes). */
const runAudio = (): Need[] => [
  { key: "audio:run-sounds", acquire: (lane) => getAudio().acquire(RUN_SOUNDS, lane) },
  {
    key: "audio:run-music",
    acquire: (lane) =>
      getAudio().prefetch(
        [...RUN_TRACKS.map((track) => `music:${track}` as const), "music:boss"],
        lane,
      ),
  },
];

/** The loading screen's painting, decoded into the shared image store (the screen's own Image
 *  draws that Source): first in the hold, as background fetches start in order. */
const loadingArt = (stage: StageId): Need => {
  const url = stageThemes[stage].loadingArt;
  return { key: url, acquire: (lane) => images().acquire(url, "art", lane) };
};

let report: ((message: string) => void) | null = null;
let wanted: { starter: StarterId; stage: StageId } | null = null;

interface LineHold {
  readonly starter: StarterId;
  readonly preparation: Preparation<StarterId>;
}

const shared = new Map<StageId, Preparation<StageId>>();
let current: LineHold | null = null;
let recent: LineHold | null = null;

/** What one 出发 was for; a later 出发 (or a pick) supersedes it. */
export interface Departure {
  readonly starter: StarterId;
  readonly difficulty: Difficulty;
  readonly stage: StageId;
  readonly n: number;
}
let departures = 0;
let departed: Preparation<Departure> | null = null;

const holdLine = (starter: StarterId): LineHold => ({
  starter,
  preparation: watch(
    createPreparation({ revision: starter, lane: "background", needs: lineNeeds(starter) }),
  ),
});

/** Once the lobby is revealed: holds the pick so far, and every later one at once. */
export function open(onError: (message: string) => void): void {
  const opened = report !== null;
  report = onError;
  if (opened) return;
  if (wanted) hold(wanted);
}

/** The lobby's pick (the one it opens on included). */
export function select(pick: { starter: StarterId; stage: StageId }): void {
  // Back in the lobby: the last run's own hold is over (the lobby's holds keep what it needs).
  departed?.cancel();
  departed = null;
  wanted = pick;
  if (report) hold(pick);
}

/** Tells the player when a hold fails; the next pick retries it. */
const watch = <R>(preparation: Preparation<R>) => {
  void preparation.settled.then((outcome) => {
    if (outcome !== "failed") return;
    const cause = preparation.error?.cause;
    report?.(`载入失败：${cause instanceof Error ? cause.message : String(cause)}`);
  });
  return preparation;
};

function hold({ starter, stage }: { starter: StarterId; stage: StageId }): void {
  if (!shared.has(stage)) {
    shared.set(
      stage,
      watch(
        createPreparation({
          revision: stage,
          lane: "background",
          needs: [loadingArt(stage), ...runSharedNeeds(stage), ...runAudio()],
        }),
      ),
    );
  }
  if (current?.starter !== starter) {
    if (recent?.starter === starter) {
      [current, recent] = [recent, current];
    } else {
      recent?.preparation.cancel();
      recent = current;
      current = holdLine(starter);
    }
    current!.preparation.setLane("background");
    recent?.preparation.setLane("keep");
  }
  // A hold that failed (a network blip) tries again on the next pick instead of staying empty.
  shared.get(stage)!.retry();
  current!.preparation.retry();
}

/** What the lobby can show for a line: whether its prefetchable part is in, and the bytes so far. */
export function state(starter: StarterId): {
  settled: boolean;
  bytes: number;
  bytesTotal: number | null;
} | null {
  const hold = [current, recent].find((line) => line?.starter === starter);
  if (!hold) return null;
  const { network } = hold.preparation.progress();
  return {
    settled: hold.preparation.state === "ready",
    bytes: network.bytes,
    bytesTotal: network.bytesTotal,
  };
}

/**
 * 出发 (and 再来一局): from the press on, the run's own hold on the stage's shared set and the line
 * at the critical lane (readiness design §4, step 3), ahead of the curtain and the run screen.
 * Captures the revision; the run's construction takes its own handles on top.
 */
export function depart({
  starter,
  difficulty,
  stage,
}: {
  starter: StarterId;
  difficulty: Difficulty;
  stage: StageId;
}): Preparation<Departure> {
  departed?.cancel();
  departed = createPreparation({
    revision: { starter, difficulty, stage, n: ++departures },
    lane: "critical",
    needs: [...runSharedNeeds(stage), ...lineNeeds(starter), ...runAudio()],
  });
  return departed;
}
