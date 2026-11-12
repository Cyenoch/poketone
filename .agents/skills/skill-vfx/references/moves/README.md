# Move reference notes

One file per move id. Write one **before** designing an effect for a move that isn't original to
poketone.

## How to gather

1. **What the move is**: the in-game description (52poke 神奇宝贝百科 or Bulbapedia move page),
   type, what it does in the main games.
2. **How it is shown**: the move animation GIF on the wiki page (`AniMoveNNN.gif`), the anime
   ("In the anime" section), official artwork. Look, then write 2–4 **signature traits** — the
   things a player would name ("a 大 of flame", "spins in its shell", "zig-zag bolts").
3. **Reference game**: how the reference game draws the move — shapes, relative sizes and
   lifetimes. Summarise in words. Don't copy code.
4. **Our sim**: archetype and numbers (`src/run/sim/content/moves.ts`), how the area/projectile is built
   (`src/run/sim/attacks.ts`).
5. **Keep / avoid**: which traits survive our readability rules, which conflict (colour clashes
   with enemy danger or XP candy, sizes over budget).

Rules: links and short descriptions only — **never** download or commit copyrighted images,
GIFs or video. Mark traits you verified on a source as *[52poke]* / *[Bulbapedia]*; mark ones from
general familiarity with the games/anime as *[familiar — check the GIF]*.

Notes written 2026-11-04. The fetch tool could read 52poke text but not its GIFs, and Bulbapedia
refused it, so *[familiar]* traits still need a human glance at the linked animation.
