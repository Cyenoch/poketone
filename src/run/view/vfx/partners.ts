// Looks for captured partners (sim/partners.ts). They fight on the player's side, so they draw on the
// player layer in their species' colour, never on the danger layer that enemy telegraphs own.

import type { ElementType } from "../../sim/content/elements";
import type { Partner } from "../../sim/state/entities";
import type { PartnerStyle } from "../../sim/state/events";
import { Decal } from "./decals";
import { spray, type Echo, type Fx } from "./fx";
import { rgb, type Rgb } from "./gl";
import { electric, fire, gold, grass, poison, powder, stone, water, white, wind } from "./palette";
import { Ribbon } from "./ribbons";
import { Shape, sprite } from "./sprites";

const typeColor: Record<ElementType, Rgb> = {
  normal: wind.cream,
  fire: fire.orange,
  water: water.mid,
  ice: water.light,
  grass: grass.leaf,
  electric: electric.yellow,
  bug: grass.lime,
  flying: wind.cyan,
  poison: poison.purple,
  rock: stone.light,
  ground: stone.light,
  fighting: rgb("#d0583a"),
  psychic: rgb("#ff5fa0"),
  ghost: rgb("#7d63c4"),
  fairy: powder.pink,
  steel: rgb("#9fb6c6"),
  dragon: rgb("#6b4cff"),
};
const types = Object.keys(typeColor) as ElementType[];

const mote = sprite({
  shape: Shape.cloud,
  life: 0.8,
  grow: 1.6,
  from: gold.white,
  to: gold.yellow,
  accent: gold.deep,
  alpha: 0.6,
  drag: 2.5,
  gravity: -0.4,
});
const spark = sprite({ shape: Shape.spark, life: 0.3, from: white, accent: gold.yellow, add: 1 });

/** The ally ring under each partner: the player's warm yellow, so it reads as on your side. */
export function partnerMarker(
  fx: Fx,
  partner: Partner,
  x: number,
  z: number,
  radius: number,
): void {
  fx.decals
    .put(Decal.telegraph, x, z, radius * 1.35, 0, partner.id * 0.618)
    .tint(gold.yellow, 0.8, white, 0.3)
    .args(1);
}

export function partnerAttack(
  fx: Fx,
  style: PartnerStyle,
  type: ElementType,
  x: number,
  z: number,
  tx: number,
  tz: number,
  reach: number,
): void {
  const color = typeColor[type];
  const y = fx.ground.heightAt(tx, tz) + 0.6;
  switch (style) {
    case "tackle":
      fx.decals.stamp(Decal.ring, tx, tz, 0.9, 0.3, color, 0.9, white, 0.6, 0.25, 0.3);
      spray(fx, spark, tx, y, tz, 4, 4, 2, 0.12);
      break;
    case "shot":
      fx.echoes.add(
        drawShot,
        0.28,
        x,
        fx.ground.heightAt(x, z) + 0.7,
        z,
        types.indexOf(type),
        0,
        0,
        [tx, y, tz],
      );
      fx.decals.stamp(Decal.ring, tx, tz, 0.7, 0.25, color, 0.8, white, 0.5, 0.25, 0.3);
      break;
    case "cloud":
      fx.decals.stamp(Decal.ring, x, z, reach, 0.5, gold.yellow, 0.8, white, 0.5, 0.15, 0.2);
      spray(fx, mote, x, fx.ground.heightAt(x, z) + 0.4, z, 14, reach * 1.6, 0.6, 0.35);
      break;
    case "pulse":
      fx.decals.stamp(Decal.ring, x, z, reach, 0.3, color, 0.9, white, 0.5, 0.15, 0.3);
      spray(fx, spark, x, fx.ground.heightAt(x, z) + 0.4, z, 12, reach * 1.8, 0.5, 0.13);
      break;
  }
}

/** 护主: a streak runs from the partner to its owner and a warm ring closes round the owner. */
export function partnerGuard(
  fx: Fx,
  type: ElementType,
  x: number,
  z: number,
  tx: number,
  tz: number,
): void {
  const radius = 1.2;
  fx.decals.stamp(Decal.ring, tx, tz, radius, 0.6, gold.yellow, 0.95, white, 0.7, 0.2, 0.35);
  fx.echoes.add(drawShot, 0.36, x, fx.ground.heightAt(x, z) + 0.6, z, types.indexOf(type), 0, 0, [
    tx,
    fx.ground.heightAt(tx, tz) + 0.6,
    tz,
  ]);
  spray(fx, spark, tx, fx.ground.heightAt(tx, tz) + 0.6, tz, 8, radius * 2, 2, 0.15);
}

/** A quick streak from the partner to the target that runs out from the source and pulls in behind. */
function drawShot(fx: Fx, echo: Echo, t: number): void {
  const [tx, ty, tz] = echo.points as [number, number, number];
  const color = typeColor[types[echo.a]!];
  const head = Math.min(1, t / 0.35);
  const tail = Math.max(0, (t - 0.35) / 0.65);
  const at = (k: number) => [
    echo.x + (tx - echo.x) * k,
    echo.y + (ty - echo.y) * k,
    echo.z + (tz - echo.z) * k,
  ];
  const [ax, ay, az] = at(tail) as [number, number, number];
  const [bx, by, bz] = at(head) as [number, number, number];
  fx.ribbons.point(ax, ay, az, 0.16, color, 0.9);
  fx.ribbons.point(bx, by, bz, 0.16, color, 0.9);
  fx.ribbons.flush(Ribbon.streak, 1);
}
