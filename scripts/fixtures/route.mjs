import assert from "node:assert/strict";
import { clearZone } from "../../src/run/sim/currentZone.ts";
import { applyCommand } from "../../src/run/sim/world.ts";

// Fixed histories for isolated map fixtures. Live transitions keep the route they actually played.
const prefixes = {
  forest: ["forest"],
  desert: ["forest", "desert"],
  coast: ["forest", "coast"],
  glacier: ["forest", "desert", "glacier"],
  volcano: ["forest", "coast", "volcano"],
  tower: ["forest", "desert", "glacier", "tower"],
};

export function routeTo(stage) {
  assert.ok(Object.hasOwn(prefixes, stage), `No fixture route to ${stage}`);
  return [...prefixes[stage]];
}

export function selectTestExit(world, to) {
  const player = world.players.find((p) => p.alive && !p.departed);
  assert.ok(player, "selecting an exit requires a living player");
  if (world.zone.phase === "active") clearZone(world, player.x, player.z);
  assert.equal(world.zone.phase, "cleared");
  const index = world.zone.exits.findIndex((exit) => exit.to === to);
  assert.notEqual(index, -1, `${world.stage} has no exit to ${to}`);
  const { x, z } = world.zone.exits[index];
  Object.assign(player, { x, z, px: x, pz: z });
  applyCommand(world, { t: "interact", player: player.id });
  assert.equal(world.zone.leaving, index, `exit to ${to} was not selected`);
  return index;
}
