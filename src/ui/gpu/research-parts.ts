import { Container, Text } from "@pmndrs/uikit";
import type { CodexBlock } from "../../run/codex";
import type { researchOf } from "../../run/research";
import { createMenuIcon, type MenuIconName } from "./icons";
import { TickGauge } from "./tick-gauge";
import { RADIUS_INNER, ui } from "./tokens";

type Research = ReturnType<typeof researchOf>;
type TaskKind = Research["tasks"][number]["kind"];

export const taskIcons: Record<TaskKind, MenuIconName> = {
  seen: "eye",
  defeated: "defeat",
  shiny: "spark",
};

/** `7.5`, `10`: research points as the content table writes them. */
export const points = (value: number) => String(Number(value.toFixed(1)));

/** The research scale: one tick per point, filled in success green once complete. */
export function researchGauge(
  research: Pick<Research, "points" | "max" | "done">,
  tick = 7,
  height = 16,
) {
  const gauge = new TickGauge(research.max);
  gauge.setSize(tick, height, 3);
  gauge.set(research.points, -1, research.done ? ui.success : ui.ink);
  const box = new Container({ width: gauge.width(), height, flexShrink: 0 });
  box.add(gauge.content);
  return { box, gauge };
}

/**
 * A page's research block: the scale and `points/max`, then one row per record kind: its icon, the
 * player's count, and each of its task tiers' target as a chip (ink when earned) with the points
 * it gives. A kind with no tasks (an elite's 异色) still shows its count.
 */
export function researchTasks(
  research: Extract<CodexBlock, { kind: "research" }>,
  owned: { dispose(): void }[],
): Container[] {
  const head = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    width: "100%",
  });
  const { box, gauge } = researchGauge(research, 9, 20);
  owned.push({ dispose: () => gauge.dispose() });
  head.add(
    box,
    new Text({
      text: `${points(research.points)}/${research.max}`,
      fontSize: 18,
      fontWeight: 900,
      color: research.done ? ui.success : ui.ink,
    }),
  );
  // The scale's box size is set; its shader follows once laid out.
  box.size.subscribe(() => gauge.update());
  const rows = (["seen", "defeated", "shiny"] as const).map((kind) => {
    const tiers = research.tasks.filter((task) => task.kind === kind);
    const row = new Container({
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: 6,
      width: "100%",
    });
    const icon = createMenuIcon(taskIcons[kind]);
    icon.setProperties({ width: 20, height: 20, color: ui.ink });
    row.add(
      icon,
      new Text({
        text: String(research.record[kind]),
        fontSize: 16,
        fontWeight: 900,
        color: ui.ink,
        minWidth: 44,
        wordBreak: "keep-all",
      }),
    );
    for (const task of tiers) {
      const chip = new Container({
        flexDirection: "row",
        alignItems: "baseline",
        gap: 3,
        paddingX: 8,
        height: 28,
        alignContent: "center",
        borderRadius: RADIUS_INNER,
        backgroundColor: task.earned ? ui.ink : ui.mist,
        flexShrink: 0,
      });
      chip.add(
        new Text({
          text: String(task.target),
          fontSize: 14,
          fontWeight: 900,
          lineHeight: 2,
          color: task.earned ? ui.white : ui.ink,
        }),
        new Text({
          text: `+${points(task.points)}`,
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 2.5,
          color: task.earned ? ui.line : ui.muted,
        }),
      );
      row.add(chip);
    }
    return row;
  });
  return [head, ...rows];
}
