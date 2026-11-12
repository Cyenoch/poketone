/**
 * When and from where to start a sample so that its hit lands `keyMs` after now (the effect's key
 * frame). A hit later than the key frame skips the sample's lead-in; an earlier one waits.
 */
export function soundStart(hitMs: number, keyMs: number): { delay: number; offset: number } {
  const lead = hitMs - keyMs;
  return lead >= 0 ? { delay: 0, offset: lead / 1000 } : { delay: -lead / 1000, offset: 0 };
}

/** Seconds until the next beat of a loop that is `position` seconds in, so tracks switch on the beat. */
export function untilNextBeat(position: number, beat: number): number {
  const into = position % beat;
  return into === 0 ? 0 : beat - into;
}
