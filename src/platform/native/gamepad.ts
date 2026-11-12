import { padFamily } from "../input";
import sdl, { type Sdl, type Events } from "@kmamal/sdl";
import type { EventEmitter } from "node:events";
import type { GamepadSource, PadButton, PadSnapshot } from "../input";
const positions: Partial<Record<Sdl.Controller.Button, PadButton>> = {
  a: "south",
  b: "east",
  x: "west",
  y: "north",
  leftShoulder: "lb",
  rightShoulder: "rb",
  back: "view",
  start: "menu",
  dpadUp: "up",
  dpadDown: "down",
  dpadLeft: "left",
  dpadRight: "right",
};
export class NativeGamepads implements GamepadSource {
  private serial = 0;
  private readonly devices = new Map<
    number,
    { controller: Sdl.Controller.ControllerInstance; token: string; pressed: Set<PadButton> }
  >();
  constructor() {
    sdl.controller.on("deviceAdd", this.added);
    sdl.controller.on("deviceRemove", this.removed);
    for (const device of sdl.controller.devices) this.open(device);
  }
  private added = (event: Events.ControllerDevice.Add) => this.open(event.device);
  private removed = (event: Events.ControllerDevice.Remove) => this.remove(event.device.id);
  private open(device: Sdl.Controller.Device) {
    if (this.devices.has(device.id)) return;
    const controller = sdl.controller.openDevice(device);
    const entry = {
      controller,
      token: `sdl:${device.id}:${++this.serial}`,
      pressed: new Set<PadButton>(),
    };
    this.devices.set(device.id, entry);
    controller.on("buttonDown", ({ button }) => {
      const position = positions[button];
      if (position) entry.pressed.add(position);
    });
    controller.on("remap", () => {
      entry.token = `sdl:${device.id}:${++this.serial}`;
      entry.pressed.clear();
    });
    controller.on("close", () => {
      this.devices.delete(device.id);
    });
  }
  private remove(id: number) {
    const entry = this.devices.get(id);
    if (entry && !entry.controller.closed) entry.controller.close();
    this.devices.delete(id);
  }
  sample(): PadSnapshot[] {
    // Polling before iteration lets hot-plug/close events update the instance collection first.
    void sdl.controller.devices;
    const snapshots: PadSnapshot[] = [];
    for (const entry of this.devices.values()) {
      const { controller } = entry,
        axes = controller.axes,
        state = controller.buttons;
      if (controller.closed) continue;
      const buttons = new Set<PadButton>();
      for (const [button, position] of Object.entries(positions))
        if (state[button as Sdl.Controller.Button]) buttons.add(position);
      snapshots.push({
        token: entry.token,
        name: controller.device.name,
        family: padFamily(controller.device.type + " " + controller.device.name),
        mapped: true,
        axes: [axes.leftStickX, axes.leftStickY, axes.rightStickX, axes.rightStickY],
        buttons,
        pressed: new Set(entry.pressed),
      });
      entry.pressed.clear();
    }
    return snapshots;
  }
  dispose() {
    const events = sdl.controller as typeof sdl.controller & Pick<EventEmitter, "removeListener">;
    events.removeListener("deviceAdd", this.added);
    events.removeListener("deviceRemove", this.removed);
    for (const id of this.devices.keys()) this.remove(id);
  }
}
