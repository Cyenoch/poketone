import { abortableEffect, type Component } from "@pmndrs/uikit";

/**
 * UIKit resolves `zIndex` and `opacity` by plain inheritance: a value a child names replaces its
 * ancestors' instead of composing with them, unlike CSS stacking contexts and group opacity. A
 * raised ancestor then buries every child that names a small layer, and a fading window leaves
 * every child with its own opacity at full strength. GPU UI code sets both only through here.
 *
 * Each helper writes its one property into its own slot of UIKit's "important" property section
 * (`properties/layer.js`: the section starts at index 0 and outranks a component's own properties;
 * 1000 and 1001 are its first class and default-override slots, which nothing else here uses). So
 * a later `setProperties` cannot undo them, and fading never rewrites the z-order (which would make
 * UIKit rebuild the instanced panels of the whole subtree every frame).
 */
const STACK_SLOT = 1001;
const FADE_SLOT = 1000;

const stackOffsets = new WeakMap<Component, { offset: number }>();

/** Stacks `component` `offset` layers above its parent; calling again replaces the offset. */
export function stack<T extends Component>(component: T, offset: number): T {
  const known = stackOffsets.get(component);
  if (known) {
    known.offset = offset;
    applyStack(component, known.offset);
    return component;
  }
  const entry = { offset };
  stackOffsets.set(component, entry);
  abortableEffect(() => applyStack(component, entry.offset), component.abortSignal);
  return component;
}

function applyStack(component: Component, offset: number): void {
  const base = component.parentContainer.value?.orderInfo.value?.majorIndex ?? 0;
  if (component.properties.peek().zIndex !== base + offset)
    component.properties.set(STACK_SLOT, "zIndex", base + offset);
}

/** The opacity `component` is drawn with, after every ancestor's fade. */
export function inheritedOpacity(component: Component): number {
  const opacity = component.properties.value.opacity;
  return typeof opacity === "number" ? opacity : 1;
}

const ownOpacity = new WeakMap<Component, { own: number }>();

/** Draws `component` at `opacity` of its parent's opacity; call again to animate. */
export function fade<T extends Component>(component: T, opacity: number): T {
  const known = ownOpacity.get(component);
  if (known) {
    known.own = opacity;
    applyFade(component, known.own);
    return component;
  }
  const entry = { own: opacity };
  ownOpacity.set(component, entry);
  abortableEffect(() => applyFade(component, entry.own), component.abortSignal);
  return component;
}

function applyFade(component: Component, own: number): void {
  const parent = component.parentContainer.value;
  const value = (parent ? inheritedOpacity(parent) : 1) * own;
  if (component.properties.peek().opacity !== value)
    component.properties.set(FADE_SLOT, "opacity", value);
}
