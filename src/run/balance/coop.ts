// Fixed-build co-op budget at neutral director pressure, not a team survival forecast:
// no spatial pressure feedback, rescue AI, reactions or XP feedback.
import { buildOutput, fieldAt, SPAWN_SUCCESS, targetFor } from "./model";
import type { SkillProfile } from "./skill";
import { coopScaling, COOP_SCALING } from "../sim/content/params/coop";
import { ELITE } from "../sim/content/params/pacing";
import { zoneClock, zoneFactorsFor } from "../sim/content/params/zones";
import type { Difficulty } from "../sim/content/difficulties";
import { stageDefs, type StageId } from "../sim/content/stages/index";
import { bossHp, liveCap, spawnRate } from "../sim/director";
import type { Player } from "../sim/state/entities";

/** Saturated crowd with everyone grouped, or evenly split; all roster members contribute output. */
export function coopBudget(
  stage: StageId,
  difficulty: Difficulty,
  time: number,
  players: readonly Player[],
  skill: SkillProfile,
  zone = 0,
) {
  if (players.length < 1 || players.length > COOP_SCALING.length)
    throw new Error("联机分析需要 1–4 名玩家。");
  const team = coopScaling(players.length);
  const factors = zoneFactorsFor(stageDefs[stage], zone);
  const clock = zoneClock(stageDefs[stage], zone, time);
  const base = fieldAt(stage, time, difficulty, false, zone);
  const field = { ...base, hp: base.hp * team.hp };
  const cap = liveCap(clock, difficulty) * factors.cap * team.cap;
  const spawns = spawnRate(clock, difficulty, false) * factors.spawns * team.spawns;
  const incoming = spawns * SPAWN_SUCCESS * field.hp;
  const grouped = players.map((player) => buildOutput(player, targetFor(field, cap, skill)));
  const split = players.map((player) =>
    buildOutput(player, targetFor(field, cap / players.length, skill)),
  );
  const guardianHp = bossHp(field.guardian, difficulty) * factors.guardianHp * team.bossHp;
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  // Burn on a shared guardian keeps the strongest application, rather than stacking by caster.
  const guardianDps = (outputs: typeof grouped) =>
    sum(outputs.map((out) => out.single * skill.bossFocus)) +
    Math.max(...outputs.map((out) => out.bossBurn));
  return {
    hp: field.hp,
    eliteHp: field.hp * ELITE.hp,
    guardianHp,
    cap,
    spawns,
    // Supply ceiling per person, before elite/event XP, pickup and personal XP attributes.
    xpSupply: spawns * field.xp * team.xp,
    incoming,
    groupedPressure: sum(grouped.map((out) => out.useful)) / incoming,
    splitPressure: sum(split.map((out) => out.useful)) / incoming,
    guardianTtk: guardianHp / guardianDps(grouped),
  };
}
