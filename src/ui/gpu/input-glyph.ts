import { Container, Text } from "@pmndrs/uikit";
import { bindings, type InputAction, type InputMode, type PadButton } from "../../platform/input";

let mode: InputMode = { kind: "keyboardMouse", pointer: false };
const mounted = new Set<InputGlyph>();
export function setGlyphInputMode(next: InputMode) {
  const same =
    next.kind === mode.kind &&
    (next.kind !== "gamepad" || (mode.kind === "gamepad" && next.family === mode.family));
  mode = next;
  if (!same) for (const glyph of mounted) glyph.paint();
}
export function currentInputMode() {
  return mode;
}

/** A HUD keycap whose art follows physical button positions, including Switch south = B. */
export class InputGlyph extends Container {
  private readonly label = new Text({
    fontSize: 11,
    fontWeight: 800,
    color: "#0d233f",
    whiteSpace: "pre",
  });
  private readonly shape = new Container({ width: 13, height: 13, positionType: "relative" });
  private readonly action: InputAction;
  private readonly keyboard: string;
  constructor(action: InputAction, keyboard: string) {
    super({
      height: 16,
      minWidth: 16,
      paddingX: 4,
      borderRadius: 4,
      backgroundColor: "#d8effb",
      borderWidth: 1,
      borderColor: "#0d233f",
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    });
    this.action = action;
    this.keyboard = keyboard;
    this.add(this.label, this.shape);
    mounted.add(this);
    this.paint();
  }
  paint() {
    for (const child of this.shape.children.slice()) {
      child.removeFromParent();
      (child as Container).dispose();
    }
    const binding = bindings[this.action];
    const button: PadButton | undefined = "pad" in binding ? binding.pad : undefined;
    const face = button && ["south", "east", "west", "north"].indexOf(button);
    const isFace = typeof face === "number" && face >= 0;
    const family = mode.kind === "gamepad" ? mode.family : "generic";
    const pad = mode.kind === "gamepad";
    this.setProperties({ display: mode.kind === "touch" ? "none" : "flex" });
    const geometric = pad && isFace && (family === "playstation" || family === "generic");
    this.label.setProperties({
      display: geometric ? "none" : "flex",
      text: !pad
        ? this.keyboard
        : isFace
          ? (family === "switch" ? ["B", "A", "Y", "X"] : ["A", "B", "X", "Y"])[face]!
          : ((
              {
                lb: "LB",
                rb: "RB",
                menu: "Menu",
                view: "View",
                up: "D",
                down: "D",
                left: "D",
                right: "D",
              } as Partial<Record<PadButton, string>>
            )[button!] ?? this.keyboard),
    });
    this.shape.setProperties({ display: geometric ? "flex" : "none" });
    if (!geometric) return;
    const part = (props: ConstructorParameters<typeof Container>[0]) =>
      this.shape.add(new Container({ positionType: "absolute", ...props }));
    if (family === "generic") {
      for (const [i, [x, y]] of [
        [5, 9],
        [9, 5],
        [1, 5],
        [5, 1],
      ].entries())
        part({
          positionLeft: x,
          positionTop: y,
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: i === face ? "#0d233f" : "#92b8d1",
        });
    } else if (face === 0) {
      for (const angle of [-45, 45])
        part({
          positionLeft: 5,
          positionTop: 0,
          width: 2,
          height: 13,
          backgroundColor: "#0d233f",
          transformRotateZ: angle,
        });
    } else if (face === 3) {
      for (const [x, angle] of [
        [3, -27],
        [8, 27],
      ])
        part({
          positionLeft: x,
          positionTop: 0,
          width: 2,
          height: 12,
          backgroundColor: "#0d233f",
          transformRotateZ: angle,
        });
      part({ positionLeft: 0, positionTop: 11, width: 13, height: 2, backgroundColor: "#0d233f" });
    } else
      part({
        width: 13,
        height: 13,
        borderWidth: 2,
        borderColor: "#0d233f",
        borderRadius: face === 1 ? 7 : 0,
      });
  }
  override dispose() {
    mounted.delete(this);
    super.dispose();
  }
}
