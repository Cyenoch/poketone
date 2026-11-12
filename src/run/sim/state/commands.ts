import type { ItemId } from "../content/items";
import type { MoveId } from "../content/moves";
import type { PlayerId } from "./entities";

/** Everything a peer may send. Serializable on purpose: local input and a network peer go through the same path. */
export type Command =
  | { t: "move"; player: PlayerId; x: number; z: number }
  | { t: "dash"; player: PlayerId }
  | { t: "pick"; player: PlayerId; card: number; index: number }
  | { t: "reroll"; player: PlayerId; card: number }
  | { t: "skip"; player: PlayerId; card: number }
  | { t: "banish"; player: PlayerId; card: number; index: number }
  | { t: "ult"; player: PlayerId }
  | { t: "choices"; player: PlayerId; open: boolean }
  /** Hypno: forget a move or an item for Pokécoins. */
  | {
      t: "forget";
      player: PlayerId;
      dialog: number;
      target: { kind: "move"; id: MoveId } | { kind: "item"; id: ItemId };
    }
  /** Bill's machine: fuse the line's signature pair. */
  | { t: "fuse"; player: PlayerId; dialog: number }
  | { t: "leave"; player: PlayerId; dialog: number }
  /** Opens the station the player stands at (R / the touch prompt). */
  | { t: "interact"; player: PlayerId }
  /** The player's camera turned (Q/E): what their screen shows decides spawns and auto-aim. */
  | { t: "view"; player: PlayerId; yaw: number }
  | { t: "pause"; paused: boolean }
  | { t: "forfeit" };
