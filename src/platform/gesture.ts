/** A handler returns true once it has what it needed from a gesture; it then stops being called. */
type GestureHandler = (event: Event) => boolean;

// Browsers grant what needs a user gesture (audio, fullscreen) only inside these events; for touch
// that is touchend, not pointerdown.
const GESTURES = ["pointerdown", "keydown", "touchend"] as const;
const handlers = new Set<GestureHandler>();

function dispatch(event: Event): void {
  for (const handler of handlers) if (handler(event)) handlers.delete(handler);
  if (handlers.size === 0) for (const type of GESTURES) window.removeEventListener(type, dispatch);
}

/** One set of window listeners for everything that waits on the player's first gestures. */
export function onUserGesture(handler: GestureHandler): () => void {
  if (handlers.size === 0) for (const type of GESTURES) window.addEventListener(type, dispatch);
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0)
      for (const type of GESTURES) window.removeEventListener(type, dispatch);
  };
}
