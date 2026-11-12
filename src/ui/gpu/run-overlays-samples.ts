import { createPlayer } from "../../run/sim/world";
import { statBreakdown } from "../../run/sim/stats";
import { fusionStatus } from "../../run/sim/fusion";
import { starters, type StarterId } from "../../run/sim/content/lines/index";
import type { ElementType } from "../../run/sim/content/elements";
import type { Choice } from "../../run/sim/state/entities";
import { items, type ItemId } from "../../run/sim/content/items";
import type { RunOverlayState } from "./run-overlays";

/**
 * One state per window look a run can open, so the host can build each once, unseen, on the
 * loading screen and compile its programs there: every card kind and rarity, both stations, both
 * results with a backpack, and the pause and stats windows in each type the line evolves through.
 */
export function runWindowSamples(starter: StarterId): NonNullable<RunOverlayState>[] {
  const line = starters[starter];
  const player = createPlayer(0, starter, 0);
  const move = player.moves[0]!.id;
  const themes = [
    ...new Set(
      line.stages.flatMap((stage) => (stage.kind === "evolve" ? [stage.form.types[0]!] : [])),
    ),
  ] as ElementType[];
  const form = line.stages[0].form;
  const theme = themes[0]!;
  const upgrade = (rarity: 0 | 1 | 2 | 3): Choice => ({
    kind: "upgrade",
    move,
    rarity,
    rolls: [{ stat: "dmg", value: 0.1 }],
  });
  const deals: Choice[][] = [
    [upgrade(0), upgrade(1), upgrade(2), upgrade(3)],
    [{ kind: "move", move }, { kind: "item", item: "leftovers" }, { kind: "tm-case" }],
    [{ kind: "train", stat: "dmg" }],
    // An item card's look follows its rarity: one of each tier.
    ([0, 1, 2, 3] as const).map((rarity) => ({
      kind: "item" as const,
      item: (Object.keys(items) as ItemId[]).find((id) => items[id].rarity === rarity)!,
    })),
  ];
  const result = (outcome: "victory" | "defeat") => ({
    kind: "result" as const,
    theme,
    result: {
      outcome,
      starter,
      difficulty: 0 as const,
      time: 60,
      level: 2,
      kills: 1,
      stardust: 1,
      moves: [{ id: move, level: 1, damage: 1 }],
      items: ["leftovers" as const],
    },
    note: null,
    backpackSize: 1,
  });
  return [
    ...themes.map((type) => ({
      kind: "pause" as const,
      theme: type,
      form: form.name,
      meta: ["普通", "0:00"],
      quitting: false,
      shared: false,
    })),
    {
      kind: "stats",
      theme,
      starter,
      form: form.id,
      level: 1,
      build: {
        sheet: statBreakdown(player),
        time: 60,
        kills: 1,
        stardust: 1,
        moves: [{ id: move, level: 1, damage: 1, cd: 1 }],
        items: [{ id: "leftovers", level: 1 }],
      },
    },
    {
      kind: "station",
      theme,
      view: {
        id: 0,
        kind: "hypno",
        stardust: 1,
        moves: [{ id: move, level: 1, refund: 1 }],
        items: [{ id: "leftovers", level: 1, refund: 1 }],
      },
    },
    { kind: "station", theme, view: { id: 1, kind: "bill", ...fusionStatus(player) } },
    ...deals.map((options, id) => ({
      kind: "choice" as const,
      theme,
      pending: { id, source: id === 1 ? ("chest" as const) : ("level" as const), options },
      dealKey: `sample:${id}`,
      level: 2,
      rerolls: 1,
      skips: 1,
      banishes: 1,
      banishing: false,
    })),
    result("victory"),
    result("defeat"),
  ];
}
