import { Image, type Component, type Container } from "@pmndrs/uikit";
import type { ElementType } from "../../run/sim/content/elements";
import { typeNames } from "../../run/labels";
import { slantTag } from "./tag";
import { SLANT, slantOf } from "./tokens";

/**
 * Every type's one icon and one tag (DESIGN.md「属性图标」). Each type has a crest in
 * `public/art/icons/crests/<type>.webp`; no surface draws a type any other way.
 */
export const crestSrc = (type: ElementType): string => `/art/icons/crests/${type}.webp`;

/** The type's crest at `size` px square. */
export function typeIcon(type: ElementType, size: number): Component {
  return new Image({ src: crestSrc(type), width: size, height: size, flexShrink: 0 });
}

/** The crest inside a tag of text `size`: a little above the cap height, as in running text. */
export const tagIconSize = (size: number): number => Math.round(size * 1.25);

/** A tag's height for text `size` (slantTag: 1.9 × the text). */
const tagHeight = (size: number): number => Math.round(size * 1.9);

/** A crest-only tag's room past the lean: the crest's corners stay inside the slanted edges. */
const crestPad = (size: number): number => (SLANT * tagIconSize(size)) / 2;

/** The width of a crest-only {@link typeTag} of text `size`. */
export const crestTagWidth = (size: number): number =>
  tagIconSize(size) + 2 * crestPad(size) + slantOf(tagHeight(size));

/** The gap that sets slanted tags of text `size` 2px apart along their parallel edges. */
export const typeTagGap = (size: number): number => 2 - slantOf(tagHeight(size));

/**
 * The type tag: an ink slanted chip, the crest, then the name in white. `named: false` keeps only
 * the crest (a tight row). Surfaces differ only in `size`; an inactive one mutes through `tone`.
 */
export function typeTag(
  type: ElementType,
  size = 14,
  named = true,
  tone: { face?: string; ink?: string } = {},
): { tag: Container; dispose(): void } {
  return slantTag(
    named ? typeNames[type] : "",
    { ...tone, size, pad: named ? undefined : crestPad(size) },
    typeIcon(type, tagIconSize(size)),
  );
}
