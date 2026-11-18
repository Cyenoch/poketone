import { Container, Text, type Component } from "@pmndrs/uikit";
import { BoxShadow } from "./box-shadow";
import { stack } from "./layer";
import { SlantPlate } from "./slant-plate";
import { HARD_SHADOW, RADIUS_INNER, slantOf, ui } from "./tokens";

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
    face: ui.white,
    ink: ui.ink,
    ring: { color: ui.ink, width: 1.5 },
  });
  // ::before is content-box (the global border-box rule matches elements only): 7 + 2 × 1.5.
  const gem = new Container({
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderColor: ui.ink,
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

/**
 * The lead tag (DESIGN.md): 28 tall, 15px text, 11 padding (short screens 24 / 13 / 9), a
 * 3px hard shadow. `parts` run in one line (a muted prefix, then the value); `lead` is an
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
  const base = new BoxShadow(8, [{ y: 3, blur: 0, color: "#000000", alpha: HARD_SHADOW.alpha }]);
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

/**
 * A slanted chip (the type label: crest + name; a balance; a section label): −14° plate, radius 4,
 * upright content, a 3px hard shadow. `lead` is an icon or image before the text; with no text the
 * chip is the icon alone, `pad` (default 11) past the lean on each side.
 */
export function slantTag(
  text: string,
  tone: { face?: string; ink?: string; size?: number; upright?: boolean; pad?: number } = {},
  lead?: Component,
): { tag: Container; dispose(): void } {
  const size = tone.size ?? 14;
  const height = Math.round(size * 1.9);
  const lean = tone.upright ? 0 : slantOf(height) / 2;
  const tag = new Container({
    height,
    // Even padding: the text sits on the parallelogram's centre.
    paddingLeft: (tone.pad ?? 11) + lean,
    paddingRight: (tone.pad ?? 11) + lean,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  });
  const plate = new SlantPlate(
    tag,
    { fill: tone.face ?? ui.ink, upright: tone.upright },
    RADIUS_INNER,
  );
  plate.set({ depth: 3 });
  tag.add(plate.content);
  if (lead) tag.add(stack(lead, 1));
  if (text)
    tag.add(
      stack(
        new Text({
          text,
          fontSize: size,
          fontWeight: 800,
          color: tone.ink ?? ui.white,
          whiteSpace: "pre",
          wordBreak: "keep-all",
        }),
        1,
      ),
    );
  return { tag, dispose: () => plate.dispose() };
}
