import { Container, Text, type Component } from "@pmndrs/uikit";
import { BoxShadow } from "./box-shadow";
import { Color } from "three";
import type { ElementType } from "../../run/sim/content/elements";
import { typeNames } from "../../run/labels";
import { typeColors } from "./run-choice-surface";
import { stack } from "./layer";

/**
 * ui/tag.css `.game-tag`: badge 11px in 16, chip 12px in 21. The ring is `box-shadow: inset`, so it
 * takes no layout space: the border it becomes is taken out of the horizontal padding.
 */
export function gameTag(
  text: string,
  tone: {
    size?: "badge" | "chip";
    face: string;
    ink: string;
    ring?: { color: string; width: number };
    pill?: boolean;
  },
): Container {
  const badge = tone.size === "badge";
  const ring = tone.ring?.width ?? 0;
  const tag = new Container({
    height: badge ? 16 : 21,
    minWidth: badge ? 16 : 21,
    paddingX: (badge ? 4 : 7) - ring,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    flexShrink: 0,
    borderRadius: tone.pill ? 999 : 4,
    backgroundColor: tone.face,
    borderWidth: ring,
    borderColor: tone.ring?.color,
  });
  tag.add(
    stack(
      new Text({
        text,
        fontSize: badge ? 11 : 12,
        fontWeight: 800,
        color: tone.ink,
        whiteSpace: "pre",
        // UIKit's no-wrap wrapper: a tag is one line and its chip measures all of it.
        wordBreak: "keep-all",
      }),
      1,
    ),
  );
  return tag;
}

/** A card tier's tag (upgrade and item cards, the lab archive): a light chip, the tier's colour as
 *  a gem before its name. */
export function rarityTag(name: string, color: string): Container {
  const tag = gameTag(name, {
    face: "#ffffff",
    ink: "#0d233f",
    ring: { color: "#142f50", width: 1.5 },
  });
  // ::before is content-box (the global border-box rule matches elements only): 7 + 2 × 1.5.
  const gem = new Container({
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderColor: "#142f50",
    backgroundColor: color,
    transformRotateZ: 45,
    flexShrink: 0,
  });
  // Gem before the label: keep the label node and move it after the gem.
  const label = tag.children[0]!;
  label.removeFromParent();
  tag.add(gem, label);
  return tag;
}

/** `Tag tone="type"`: soft face, 2px type ring, the type hue darkened toward navy (45%). */
export function typeTag(type: ElementType): Container {
  const tone = typeColors[type];
  const ink = `#${new Color("#0d233f").lerp(new Color(tone.type), 0.45).getHexString()}`;
  return gameTag(typeNames[type], {
    face: tone.soft,
    ink,
    ring: { color: tone.type, width: 2 },
    pill: true,
  });
}

/**
 * The lead tag (DESIGN.md): 28 tall, 15px text, 11 padding (short screens 24 / 13 / 9), a
 * 3px navy-deep hard base. `parts` run in one line (a muted prefix, then the value); `lead` is an
 * icon before them. The ring is inset, as `gameTag`'s.
 */
export function leadTag(
  compact: boolean,
  tone: { face: string; ring?: { color: string; width: number } },
  parts: { text: string; color: string; size?: number }[],
  lead?: Component,
): { tag: Container; dispose(): void } {
  const ring = tone.ring?.width ?? 0;
  const tag = new Container({
    height: compact ? 24 : 28,
    paddingX: (compact ? 9 : 11) - ring,
    flexDirection: "row",
    alignItems: "center",
    gap: compact ? 4 : 6,
    flexShrink: 0,
    borderRadius: 8,
    backgroundColor: tone.face,
    borderWidth: ring,
    borderColor: tone.ring?.color,
  });
  const base = new BoxShadow(8, [{ y: 3, blur: 0, color: "#0d233f", alpha: 1 }]);
  tag.add(base.content);
  if (lead) tag.add(stack(lead, 1));
  for (const part of parts)
    tag.add(
      stack(
        new Text({
          text: part.text,
          fontSize: part.size ?? (compact ? 13 : 15),
          fontWeight: 800,
          color: part.color,
          whiteSpace: "pre",
          wordBreak: "keep-all",
        }),
        1,
      ),
    );
  return { tag, dispose: () => base.dispose() };
}
