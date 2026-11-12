import { padFamily } from "../input";
import type { GamepadSource, PadButton, PadSnapshot } from "../input";
const positions: Partial<Record<number, PadButton>> = {
  0: "south",
  1: "east",
  2: "west",
  3: "north",
  4: "lb",
  5: "rb",
  8: "view",
  9: "menu",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};
/** Browser indices are reusable slots; every connection gets a fresh token. */
export class WebGamepads implements GamepadSource {
  private serial = 0;
  private readonly devices = new Map<number, { id: string; token: string }>();
  constructor() {
    window.addEventListener("gamepadconnected", this.connected);
    window.addEventListener("gamepaddisconnected", this.disconnected);
  }
  private connected = (event: GamepadEvent) => {
    this.add(event.gamepad);
  };
  private disconnected = (event: GamepadEvent) => {
    this.devices.delete(event.gamepad.index);
  };
  private add(pad: Gamepad) {
    const device = { id: pad.id, token: `web:${++this.serial}` };
    this.devices.set(pad.index, device);
    return device;
  }
  sample(): PadSnapshot[] {
    const result: PadSnapshot[] = [],
      seen = new Set<number>();
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad?.connected) continue;
      seen.add(pad.index);
      let device = this.devices.get(pad.index);
      if (!device || device.id !== pad.id) device = this.add(pad);
      const buttons = new Set<PadButton>();
      for (const [index, position] of Object.entries(positions))
        if (position && pad.buttons[Number(index)]?.pressed) buttons.add(position);
      result.push({
        token: device.token,
        name: pad.id,
        family: padFamily(pad.id),
        mapped: pad.mapping === "standard",
        axes: [pad.axes[0] ?? 0, pad.axes[1] ?? 0, pad.axes[2] ?? 0, pad.axes[3] ?? 0],
        buttons,
      });
    }
    for (const index of this.devices.keys()) if (!seen.has(index)) this.devices.delete(index);
    return result;
  }
  dispose() {
    window.removeEventListener("gamepadconnected", this.connected);
    window.removeEventListener("gamepaddisconnected", this.disconnected);
    this.devices.clear();
  }
}
