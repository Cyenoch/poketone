import { ruleIds, totalDanger } from "../../run/sim/content/rules";
import type { BadgeId } from "../../run/sim/content/badges";
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
    // 禁止携带道具: a held item's draw pays out 星星沙子 instead.
    [{ kind: "stardust" }],
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
      // The victory sample carries every rule and a badge, so their text and art warm too.
      danger: outcome === "victory" ? totalDanger(ruleIds) : 0,
      // The defeat sample is a tower run's, so its floor line warms too.
      ...(outcome === "defeat" ? { floor: 1 } : {}),
      outcome,
      starter,
      difficulty: 0 as const,
      time: 60,
      zones: 1,
      level: 2,
      kills: 1,
      dex: {},
      stardust: 1,
      moves: [{ id: move, level: 1, damage: 1 }],
      items: ["leftovers" as const],
    },
    note: null,
    badges: outcome === "victory" ? (["boulder"] as BadgeId[]) : [],
    // The victory sample crosses a bond level, so its title and grant warm too.
    bond:
      outcome === "victory"
        ? { before: 25, after: 35, look: false }
        : { before: 0, after: 4, look: false },
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
      abilitySlot: player.abilitySlot,
      theme,
      starter,
      form: form.id,
      shiny: false,
      rules: ruleIds,
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
      evolution: 1,
      rerolls: 1,
      skips: 1,
      banishes: 1,
      banishing: false,
    })),
    // The route's special offers: a guardian's trophy and Gengar's deal (its free 放弃 action).
    ...(["trophy", "deal"] as const).map((kind, i) => ({
      kind: "choice" as const,
      theme,
      pending: {
        id: deals.length + i,
        source: "chest" as const,
        options: deals[0]!,
        offer: kind === "trophy" ? { kind } : { kind, site: 0 },
      },
      dealKey: `sample:${kind}`,
      level: 2,
      evolution: 1,
      rerolls: 1,
      skips: 1,
      banishes: 1,
      banishing: false,
    })),
    result("victory"),
    result("defeat"),
  ];
}
