import { HARDEN } from "../content/params/enemy-skills";
// Metapod's and Kakuna's harden: after the wind-up, direct hits deal less for a while.

import { telegraph } from "./telegraph";

export const harden = telegraph({
  range: HARDEN.range,
  windup: HARDEN.windup,
  tell: "normal",
  partner: { style: "tackle" },
  release(_world, enemy) {
    enemy.hardened = HARDEN.duration;
  },
});
