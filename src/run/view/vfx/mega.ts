// Mega evolution (skill-vfx): a shell of light wraps the new form while four rainbow strands spiral
// in, then it shatters into rainbow shards over a burst of the form's own flame. The model swaps at
// the event; the shell hides the swap. The shatter is the key frame: it reports itself so the
// sound starts there, and a ceremony never drawn (map change) or held (pause) stays silent.

import { Decal } from "./decals";
import { rand, spray, type Echo, type Fx } from "./fx";
import { flame as caster, rgb, type Rgb } from "./gl";
import { fire, gold, white } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

/** Seconds of effect time from the event to the shatter. */
const MEGA_SHATTER = 0.3;
const LIFE = 1.1;
const STRANDS: readonly Rgb[] = [rgb("#ff9bd6"), rgb("#ffd45b"), rgb("#9bf5c8"), rgb("#8fd8ff")];
const STRAND_POINTS = 10;

const shellGlow = sprite({ shape: Shape.glow, from: gold.white, accent: white, add: 1 });
const shell = sprite({ shape: Shape.bubble, from: white, accent: rgb("#c9b4ff") });
const star = sprite({
  shape: Shape.star,
  life: 0.3,
  grow: 1.8,
  from: white,
  accent: gold.white,
  add: 1,
});
const shards = STRANDS.map((colour) =>
  sprite({
    shape: Shape.shard,
    life: 0.8,
    grow: 0.4,
    from: colour,
    accent: white,
    gravity: 9,
    drag: 1.2,
    spin: 14,
  }),
);
const motes = STRANDS.map((colour) =>
  sprite({
    shape: Shape.spark,
    life: 0.7,
    grow: 0.3,
    from: white,
    to: colour,
    accent: white,
    add: 1,
    drag: 1.6,
    stretch: 0.05,
  }),
);
const burst = sprite({
  shape: Shape.flame,
  life: 0.5,
  grow: 0.5,
  from: fire.yellow,
  to: fire.red,
  accent: fire.core,
  add: 0.4,
  gravity: -4,
  drag: 2.5,
});

/**
 * `blue` paints the flame burst in Mega Charizard X's blue; the rainbow is never recoloured.
 * `shattered` runs once, on the frame the shell breaks.
 */
export function megaEvolve(
  fx: Fx,
  x: number,
  z: number,
  radius: number,
  height: number,
  blue: boolean,
  shattered: () => void,
): void {
  const draw = (fx: Fx, echo: Echo, t: number) => drawMega(fx, echo, t, shattered);
  fx.echoes.add(draw, LIFE, x, fx.ground.heightAt(x, z), z, radius, height, blue ? 1 : 0);
}

function drawMega(fx: Fx, echo: Echo, t: number, shattered: () => void): void {
  const age = t * echo.life;
  const height = echo.b;
  const mid = echo.y + height * 0.55;
  if (age < MEGA_SHATTER) {
    drawShell(fx, echo, age / MEGA_SHATTER, mid);
    return;
  }
  if (age - fx.dt < MEGA_SHATTER) {
    shatter(fx, echo, mid);
    shattered();
  }
  // The light left behind collapses into the new form instead of fading flat.
  const after = (age - MEGA_SHATTER) / 0.18;
  if (after < 1)
    fx.sprites.draw(shellGlow, echo.x, mid, echo.z, height * 0.9 * (1 - after), 1 - after);
}

function drawShell(fx: Fx, echo: Echo, k: number, mid: number): void {
  const { x, z } = echo;
  const height = echo.b;
  // Visible from the first frame: the local hit-stop holds this pose for a beat.
  fx.sprites.draw(shellGlow, x, mid, z, height * (0.7 + 0.25 * k), 0.55 + 0.35 * k);
  fx.sprites.draw(shell, x, mid, z, height * 0.75, 0.5 + 0.4 * k, 0, 0, 0, echo.seed);
  const wrap = echo.a * (2.6 - 1.4 * k);
  for (let s = 0; s < STRANDS.length; s++) {
    for (let i = 0; i <= STRAND_POINTS; i++) {
      const j = i / STRAND_POINTS;
      const angle = (s * Math.PI) / 2 + k * 5 + j * 2.4;
      const r = wrap * (1 - 0.35 * j);
      fx.ribbons.point(
        x + Math.cos(angle) * r,
        echo.y + j * height * 1.25,
        z + Math.sin(angle) * r,
        0.3 * (1 - 0.4 * j),
        STRANDS[s]!,
        1 - j * 0.4,
      );
    }
    fx.ribbons.flush(Ribbon.glow, 1);
  }
}

function shatter(fx: Fx, echo: Echo, mid: number): void {
  const { x, y, z } = echo;
  const height = echo.b;
  fx.sprites.emit(star, x, mid, z, 0, 0, 0, height * 1.1);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + rand(-0.15, 0.15);
    const s = rand(3.5, 6.5);
    const k = i % STRANDS.length;
    fx.sprites.emit(
      shards[k]!,
      x + Math.cos(a) * echo.a,
      mid + rand(-0.5, 0.5) * height,
      z + Math.sin(a) * echo.a,
      Math.cos(a) * s,
      rand(2, 5),
      Math.sin(a) * s,
      rand(0.22, 0.34),
      y,
    );
    fx.sprites.emit(
      motes[k]!,
      x,
      mid,
      z,
      Math.cos(a) * s * 0.6,
      rand(1, 4),
      Math.sin(a) * s * 0.6,
      0.14,
    );
  }
  fx.decals.stamp(Decal.ring, x, z, echo.a * 4, 0.5, white, 1, gold.yellow, 0.8, 0.25, 0.2);
  fx.decals.stamp(Decal.glow, x, z, echo.a * 3, 0.6, gold.white, 0.8, white, 1);
  const was = caster.blue;
  caster.blue = echo.c > 0;
  spray(fx, burst, x, y + 0.3, z, 24, 5, 3, 0.5);
  caster.blue = was;
}
