import type { SessionState } from "../../network/session";
import type { RoomErrorCode } from "../../network/protocol";
import type { StarterId } from "../../run/sim/content/lines";

const errors: Record<RoomErrorCode, string> = {
  "no-room": "房间不存在",
  full: "房间已满",
  started: "已出发",
  version: "版本不同",
};

export interface SeatView {
  label: string;
  starter: StarterId | null;
  self: boolean;
  chip: string;
  pending: boolean;
}

/** Link readiness is shared transport state, never a player-controlled ready toggle. */
export function seatView(state: SessionState) {
  const count = state.room?.players.length ?? 0;
  const joined = count >= 2 && count <= 4;
  const ready = joined && state.room!.ready.length === count && state.mode !== "connecting";
  const error = (state.errorCode ? errors[state.errorCode] : undefined) ?? state.error;
  const seats: SeatView[] = [0, 1, 2, 3].map((slot) => ({
    label: `P${slot + 1}`,
    starter: state.room?.players[slot]?.starter ?? null,
    self: state.self === slot && slot < count,
    chip:
      slot === 0
        ? "房主"
        : slot >= count
          ? "等待加入"
          : state.room!.ready.includes(slot)
            ? "就绪"
            : "已加入",
    pending: slot === 0 ? !state.room : slot < count && !state.room!.ready.includes(slot),
  }));
  return {
    seats,
    count,
    link: ready ? "ready" : joined ? "connecting" : "waiting",
    start: {
      enabled: state.canStart && !error,
      pending: state.starting || (joined && !ready) || state.self !== 0,
    },
    error,
  };
}
