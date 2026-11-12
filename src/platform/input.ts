/** Physical positions, shared by the Web standard mapping and SDL GameController. */
export type PadButton =
  | "south"
  | "east"
  | "west"
  | "north"
  | "lb"
  | "rb"
  | "view"
  | "menu"
  | "up"
  | "down"
  | "left"
  | "right";
export type PadFamily = "xbox" | "playstation" | "switch" | "generic";
export function padFamily(name: string): PadFamily {
  if (/dualsense|dualshock|playstation|ps[345]|054c/i.test(name)) return "playstation";
  if (/nintendo|switch|joy.?con|057e/i.test(name)) return "switch";
  if (/xbox|xinput|045e/i.test(name)) return "xbox";
  return "generic";
}
export type InputMode =
  | { kind: "keyboardMouse"; pointer: boolean }
  | { kind: "touch" }
  | { kind: "gamepad"; token: string; family: PadFamily };
export type InputContext = "gameplay" | "choice" | "navigation" | "blocked";
export const bindings = {
  moveLeft: { context: "gameplay", keys: ["KeyA", "ArrowLeft"] },
  moveRight: { context: "gameplay", keys: ["KeyD", "ArrowRight"] },
  moveUp: { context: "gameplay", keys: ["KeyW", "ArrowUp"] },
  moveDown: { context: "gameplay", keys: ["KeyS", "ArrowDown"] },
  turnLeft: { context: "gameplay", keys: ["KeyQ"] },
  turnRight: { context: "gameplay", keys: ["KeyE"] },
  dash: { context: "gameplay", keys: ["Space", "ShiftLeft", "ShiftRight"], pad: "south" },
  ult: { context: "gameplay", keys: ["KeyF"], pad: "north" },
  interact: { context: "gameplay", keys: ["KeyR"], pad: "west" },
  pause: { context: "gameplay", keys: ["Escape", "KeyP"], pad: "menu" },
  back: { context: "gameplay", keys: [], pad: "east" },
  stats: { context: "gameplay", keys: ["KeyC"], pad: "lb" },
  map: { context: "gameplay", keys: ["KeyM"], pad: "view" },
  previous: { context: "navigation", keys: [] },
  next: { context: "navigation", keys: ["Tab"] },
  first: { context: "navigation", keys: ["Home"] },
  last: { context: "navigation", keys: ["End"] },
  previousPage: { context: "navigation", keys: ["PageUp"], pad: "lb" },
  nextPage: { context: "navigation", keys: ["PageDown"], pad: "rb" },
  confirm: { context: "navigation", keys: ["Enter", "NumpadEnter", "Space"], pad: "south" },
  choiceConfirm: { context: "choice", keys: [], pad: "rb" },
  cancel: { context: "navigation", keys: ["Escape"], pad: "east" },
  resume: { context: "navigation", keys: ["KeyP"], pad: "menu" },
  up: { context: "navigation", keys: ["ArrowUp"], pad: "up" },
  down: { context: "navigation", keys: ["ArrowDown"], pad: "down" },
  left: { context: "navigation", keys: ["ArrowLeft"], pad: "left" },
  right: { context: "navigation", keys: ["ArrowRight"], pad: "right" },
} as const;
export type InputAction = keyof typeof bindings;
export type NavigationAction = {
  [K in InputAction]: (typeof bindings)[K]["context"] extends "navigation" ? K : never;
}[InputAction];
export type NavigationDirection = "up" | "down" | "left" | "right";
export function isNavigationDirection(action: NavigationAction): action is NavigationDirection {
  return action === "up" || action === "down" || action === "left" || action === "right";
}
export function isNavigationAction(action: InputAction): action is NavigationAction {
  return bindings[action].context === "navigation";
}
/** Physical keyboard navigation shares the same actions as the controller. Text stays separate. */
export function navigationAction(code: string, shift: boolean): NavigationAction | undefined {
  if (code === "Tab") return shift ? "previous" : "next";
  for (const [action, binding] of entries)
    if (isNavigationAction(action) && binding.keys.includes(code)) return action;
}
export type GameplayAction = "dash" | "ult" | "interact" | "pause" | "back" | "stats" | "map";
export const stickTuning = { moveDead: 0.18, moveCurve: 1, turnDead: 0.22, turnCurve: 1.4 };
export function radialStick(x: number, y: number): [number, number] {
  const r = Math.hypot(x, y);
  if (r <= stickTuning.moveDead) return [0, 0];
  const length =
    Math.min((r - stickTuning.moveDead) / (1 - stickTuning.moveDead), 1) ** stickTuning.moveCurve;
  return [(x / r) * length, (y / r) * length];
}
function turnStick(x: number) {
  const amount = Math.max(
    0,
    Math.min(1, (Math.abs(x) - stickTuning.turnDead) / (1 - stickTuning.turnDead)),
  );
  return Math.sign(x) * amount ** stickTuning.turnCurve;
}
export interface PadSnapshot {
  token: string;
  name: string;
  mapped: boolean;
  axes: readonly [number, number, number, number];
  family: PadFamily;
  buttons: ReadonlySet<PadButton>;
  /** SDL preserves a complete press/release between application frames. */
  pressed?: ReadonlySet<PadButton>;
}
export interface GamepadSource {
  sample(): readonly PadSnapshot[];
  dispose(): void;
}
type AxisSource = "keyboard" | "touch" | "gamepad";
const entries = Object.entries(bindings) as [
  InputAction,
  { context: string; keys: readonly string[]; pad?: PadButton },
][];

/** One application input state; only the host chooses its context and consumes its actions. */
export class ActionInput {
  onActivity: (mode: InputMode) => void = () => {};
  onUnsupported: (name: string) => void = () => {};
  activeToken: string | null = null;
  private readonly keys = new Set<string>();
  private readonly blockedKeys = new Set<string>();
  private readonly previous = new Map<string, ReadonlySet<PadButton>>();
  private readonly unsupported = new Set<string>();
  private pending: InputAction[] = [];
  private neutral = true;
  private moveOwner: AxisSource = "keyboard";
  private turnOwner: AxisSource = "keyboard";
  private touchMove: [number, number] = [0, 0];
  private touchTurn = 0;
  private padMove: [number, number] = [0, 0];
  private padTurn = 0;
  private padScroll = 0;
  private moveActivity: [number, number] = [0, 0];
  private turnActivity = 0;
  private scrollActivity = 0;
  private direction: InputAction | null = null;
  private repeatAt = 0;
  readonly source: GamepadSource;
  constructor(source: GamepadSource) {
    this.source = source;
  }
  observeKey(code: string, repeat: boolean) {
    if (this.blockedKeys.has(code) && repeat) return false;
    // A key released outside the window has no keyUp here; a fresh down proves release.
    this.blockedKeys.delete(code);
    this.keys.add(code);
    return true;
  }
  keyDown(code: string, repeat: boolean): boolean {
    const matches = entries.filter(
      ([, binding]) => binding.context === "gameplay" && binding.keys.includes(code),
    );
    if (!matches.length) return false;
    if (this.blockedKeys.has(code)) return true;
    this.keys.add(code);
    for (const [action] of matches) {
      if (action.startsWith("move")) {
        if (!repeat) this.moveOwner = "keyboard";
      } else if (action.startsWith("turn")) {
        if (!repeat) this.turnOwner = "keyboard";
      } else if (!repeat) this.pending.push(action);
    }
    return true;
  }
  keyUp(code: string) {
    this.keys.delete(code);
    this.blockedKeys.delete(code);
  }
  move(x: number, y: number) {
    if (x || y) this.moveOwner = "touch";
    this.touchMove = [x, y];
  }
  turn(value: number) {
    if (value) this.turnOwner = "touch";
    this.touchTurn = value;
  }
  press(action: GameplayAction) {
    this.pending.push(action);
  }
  cancel() {
    for (const key of this.keys) this.blockedKeys.add(key);
    this.keys.clear();
    this.pending = [];
    this.touchMove = this.padMove = [0, 0];
    this.touchTurn = this.padTurn = this.padScroll = 0;
    this.moveActivity = [0, 0];
    this.turnActivity = this.scrollActivity = 0;
    this.neutral = true;
    this.direction = null;
  }
  sample(now: number, context: InputContext) {
    const gameplay = context === "gameplay" || context === "choice";
    const pads = this.source.sample();
    let disconnected = false;
    if (this.activeToken && !pads.some((pad) => pad.token === this.activeToken)) {
      this.activeToken = null;
      this.cancel();
      disconnected = true;
    }
    const actions = this.pending.splice(0);
    for (const pad of pads) {
      if (!pad.mapped) {
        if (!this.unsupported.has(pad.token)) {
          this.unsupported.add(pad.token);
          this.onUnsupported(pad.name);
        }
        continue;
      }
      const last = this.previous.get(pad.token) ?? new Set<PadButton>();
      const pressed = new Set([...pad.buttons].filter((button) => !last.has(button)));
      for (const button of pad.pressed ?? []) pressed.add(button);
      this.previous.set(pad.token, new Set(pad.buttons));
      if (!this.activeToken && pressed.size && context !== "blocked") {
        this.activeToken = pad.token;
        this.cancel();
        actions.length = 0;
        this.onActivity({ kind: "gamepad", token: pad.token, family: pad.family });
        continue;
      }
      if (this.activeToken !== pad.token) continue;
      const move = radialStick(pad.axes[0], pad.axes[1]),
        turn = turnStick(pad.axes[2]),
        scroll = turnStick(pad.axes[3]);
      if (this.neutral || context === "blocked") {
        this.neutral =
          context === "blocked" || !!(pad.buttons.size || move[0] || move[1] || turn || scroll);
        continue;
      }
      const moved =
        Math.hypot(move[0] - this.moveActivity[0], move[1] - this.moveActivity[1]) > 0.03 ||
        (this.moveActivity[0] === 0 &&
          this.moveActivity[1] === 0 &&
          (move[0] !== 0 || move[1] !== 0));
      const turned =
        Math.abs(turn - this.turnActivity) > 0.03 || (this.turnActivity === 0 && turn !== 0);
      const scrolled = Math.abs(scroll - this.scrollActivity) > 0.03;
      if (scrolled) this.scrollActivity = scroll;
      if (moved) this.moveActivity = move;
      if (turned) this.turnActivity = turn;
      if (
        (moved && (move[0] || move[1])) ||
        (turned && turn) ||
        (scrolled && scroll) ||
        pressed.size
      )
        this.onActivity({ kind: "gamepad", token: pad.token, family: pad.family });
      if (this.neutral) {
        actions.length = 0;
        continue;
      }
      if (moved && (move[0] || move[1])) this.moveOwner = "gamepad";
      if (turned && turn) this.turnOwner = "gamepad";
      this.padMove = move;
      this.padTurn = turn;
      this.padScroll = scroll;
      for (const [action, binding] of entries)
        if (
          (binding.context === context ||
            (context === "choice" && binding.context === "gameplay")) &&
          binding.pad &&
          pressed.has(binding.pad) &&
          !["up", "down", "left", "right"].includes(action)
        )
          actions.push(action);
      if (context === "navigation" || context === "choice") {
        const dpad = (["up", "down", "left", "right"] as const).find(
          (key) => pad.buttons.has(key) || pressed.has(key),
        );
        const magnitude = Math.max(Math.abs(pad.axes[0]), Math.abs(pad.axes[1]));
        const threshold = this.direction ? 0.35 : 0.55;
        const direction =
          dpad ??
          (context === "navigation" && magnitude >= threshold
            ? Math.abs(pad.axes[0]) > Math.abs(pad.axes[1])
              ? pad.axes[0] < 0
                ? "left"
                : "right"
              : pad.axes[1] < 0
                ? "up"
                : "down"
            : null);
        if (direction !== this.direction) {
          this.direction = direction;
          this.repeatAt = now + 300;
          if (direction) actions.push(direction);
        } else if (direction && now >= this.repeatAt) {
          actions.push(direction);
          this.repeatAt = now + 110;
        }
      }
    }
    for (const token of this.previous.keys())
      if (!pads.some((pad) => pad.token === token)) this.previous.delete(token);
    for (const token of this.unsupported)
      if (!pads.some((pad) => pad.token === token)) this.unsupported.delete(token);
    const held = (action: InputAction) =>
      entries.find(([name]) => name === action)![1].keys.some((code) => this.keys.has(code))
        ? 1
        : 0;
    let move: [number, number] =
      this.moveOwner === "gamepad"
        ? this.padMove
        : this.moveOwner === "touch"
          ? this.touchMove
          : [held("moveRight") - held("moveLeft"), held("moveDown") - held("moveUp")];
    const length = Math.hypot(...move);
    if (length > 1) move = [move[0] / length, move[1] / length];
    const turn =
      this.turnOwner === "gamepad"
        ? this.padTurn
        : this.turnOwner === "touch"
          ? this.touchTurn
          : held("turnRight") - held("turnLeft");
    return {
      actions: context === "blocked" ? [] : actions,
      move: gameplay ? move : ([0, 0] as [number, number]),
      turn: gameplay ? turn : 0,
      scroll: context === "navigation" ? this.padScroll : 0,
      navigationTurn: context === "navigation" ? this.padTurn : 0,
      disconnected,
    };
  }
  dispose() {
    this.cancel();
    this.source.dispose();
  }
}
