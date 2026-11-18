import { WEATHER_MOVE, weatherMoves, isWeatherMove } from "../sim/content/moves";
import { PLEDGE, PLEDGE_FIELD, isPledgeMove, pledgeCombos } from "../sim/content/pledges";
// Counterfactual loadouts for deepen-builds. Only model players carry this state, including
// structured clones made while comparing cards. No shared content definition is mutated.
import { ABILITY_PARAMS, abilityForSlot, type AbilityId } from "../sim/content/abilities";
import { starters, stageForm, type StarterId } from "../sim/content/lines/index";
import type { Partner, Player } from "../sim/state/entities";
import type { WeatherId } from "../sim/state/field";
import { stageFor } from "../sim/evolution";
import { currentAbility, playerStats, type PlayerStats } from "../sim/stats";
import type { MegaState } from "./mega";
import type { TrainerId } from "../sim/content/trainers";
import { applyTrainer } from "./trainer";
import { itemEligible, itemSlots, newMoveState, offerKey } from "../sim/upgrades";

type Slot = 0 | 1 | "hidden";
export type PledgeStarter = "charmander" | "squirtle" | "bulbasaur";
type CastWeather = "sun" | "rain" | "sandstorm";
export interface DeepBuild {
  slot?: Slot;
  form?: "everstone" | "everstone-eviolite" | "pikachu" | "light-ball" | "thunder-stone";
  tradeDelay?: number;
  weather?: CastWeather;
  weatherRock?: boolean;
  /** Nominal pre-rock duty cycle; defaults to duration / cooldown. */
  weatherUptime?: number;
  /** Candidate HP fraction paid per sunny second by Solar Power. */
  solarCost?: number;
  pledge?: boolean;
  /** A second seat only for the separate fixed-pair estimate. */
  pledgePartner?: PledgeStarter;
}

function weatherMove(line: StarterId) {
  return starters[line].kit.find(isWeatherMove);
}
function pledgeMove(line: StarterId) {
  return starters[line].kit.find(isPledgeMove);
}
export const DEEP_PARAMETERS = ABILITY_PARAMS;

export const DEEP_LIMITS = [
  "实取现行内容表的等级、形态、进化招式资格、进化奇石、雷之石、天气属性与招式修正，按种子抽取升级卡。",
  "解析近似：指定的物品、天气招式、誓约和隐藏特性视为开局获得，按真实栏位占用。未指定留形时不选不变之石；指定普通栏位时不抽特性膏药，第二栏从首次进化生效。指定交换延迟时不抽联系绳，达标后按设定秒数交换。未指定时，通信线为联系绳留一格，击败守卫并结算经验和宝箱后领取符合资格的奖杯保底。不模拟奖杯其他选项。",
  "解析近似：天气从学得招式或入图后按内容表基础冷却定频施放，忽略冷却成长与跨图相位。岩石从下一次施放起生效；按秒估计占用，与野外天气取最后生效者，同秒自施优先。低血与满血按样本平均生命判断。无防守移除前摇的几何收益、精神力防畏缩均未折算为常驻增伤。",
  "解析近似：避雷针以电弹暴露率估算特攻；诅咒之躯按受击估算定身法，计入守卫下一次起手的延迟。神奇鳞片和不屈之心以中毒和减速暴露估算。浮游计入已分类的孢子、毒池与落点（含守卫着陆圈）。草柱减速使用现有敌方缠根；火水草柱共用单柱打击几何，反应连锁收益未另计。",
  "解析近似：两席誓约另算固定施放、独立相位和同区命中期望（默认35%满足正式距离窗口）；单人路线只计本席柱伤和状态，不用组合场估计队伍通关率。",
];

export function validateDeepBuild(line: StarterId, b: DeepBuild) {
  if (
    !b ||
    typeof b !== "object" ||
    Array.isArray(b) ||
    Object.keys(b).some(
      (k) =>
        ![
          "slot",
          "form",
          "tradeDelay",
          "weather",
          "weatherRock",
          "weatherUptime",
          "solarCost",
          "pledge",
          "pledgePartner",
        ].includes(k),
    )
  )
    throw new RangeError("未知的构筑参数");
  const firstForm = stageForm(line, 0);
  if (
    (b.slot !== undefined && ![0, 1, "hidden"].includes(b.slot)) ||
    (b.slot === "hidden" && firstForm.abilities.hidden === undefined) ||
    (b.slot === 1 && firstForm.abilities.normal.length < 2)
  )
    throw new RangeError(line + " 没有这个特性栏位");
  if (
    (b.form !== undefined &&
      !["everstone", "everstone-eviolite", "pikachu", "light-ball", "thunder-stone"].includes(
        b.form,
      )) ||
    ((b.form === "pikachu" || b.form === "light-ball" || b.form === "thunder-stone") &&
      line !== "pikachu")
  )
    throw new RangeError(line + " 不能使用该留形或进化路线");
  if (
    b.tradeDelay !== undefined &&
    (!starters[line].stages.some((s) => s.kind === "evolve" && s.needs === "trade") ||
      !Number.isSafeInteger(b.tradeDelay) ||
      b.tradeDelay < 0)
  )
    throw new RangeError("通信延迟需为通信线的非负整秒");
  if (
    (b.weather !== undefined && b.weather !== weatherMoves[weatherMove(line)!]?.weather) ||
    (b.weatherRock !== undefined && typeof b.weatherRock !== "boolean") ||
    (b.weatherUptime !== undefined &&
      (!Number.isFinite(b.weatherUptime) || b.weatherUptime < 0 || b.weatherUptime > 1)) ||
    (!b.weather && (b.weatherRock || b.weatherUptime !== undefined))
  )
    throw new RangeError(line + " 的天气配置无效");
  if (
    b.solarCost !== undefined &&
    (line !== "charmander" ||
      b.slot !== "hidden" ||
      !Number.isFinite(b.solarCost) ||
      b.solarCost < 0 ||
      b.solarCost > 1)
  )
    throw new RangeError("太阳之力每秒消耗须为最大 HP 的 0–1");
  if (
    (b.pledge !== undefined && typeof b.pledge !== "boolean") ||
    (b.pledge && !pledgeMove(line)) ||
    (b.pledgePartner !== undefined &&
      (!b.pledge || !Object.hasOwn(starters, b.pledgePartner) || !pledgeMove(b.pledgePartner)))
  )
    throw new RangeError("誓约需要对应的初始伙伴");
}

export function projectedAbility(line: StarterId, stage: number, slot: Slot = 0): AbilityId {
  return abilityForSlot(stageForm(line, stage).abilities, stage === 0 && slot === 1 ? 0 : slot);
}

interface Projection {
  build: DeepBuild;
  time: number;
  eligibleAt?: number;
  stageAt: number[];
  electricRate: number;
  poison: number;
  slow: number;
  hurtRate: number;
}
export type BuildPlayer = Player & {
  projection?: Projection;
  megaProjection?: MegaState;
  trainerProjection?: TrainerId;
};

export function equipDeepBuild(player: BuildPlayer, build: DeepBuild) {
  validateDeepBuild(player.starter, build);
  const state: Projection = {
    build,
    time: 0,
    stageAt: [0],
    electricRate: 0,
    poison: 0,
    slow: 0,
    hurtRate: 0,
  };
  player.projection = state;
  if (build.weather) player.moves.push(newMoveState(weatherMove(player.starter)!));
  if (build.pledge) player.moves.push(newMoveState(pledgeMove(player.starter)!));
  if (build.form?.startsWith("everstone")) player.items.push({ id: "everstone", level: 1 });
  else player.banished.push(offerKey.item("everstone"));
  if (build.form === "light-ball") player.items.push({ id: "light-ball", level: 1 });
  if (build.form === "everstone-eviolite") player.items.push({ id: "eviolite", level: 1 });
  if (build.form === "thunder-stone") player.items.push({ id: "thunder-stone", level: 1 });
  if (build.form === "light-ball" || build.form === "pikachu")
    player.banished.push(offerKey.item("thunder-stone"));
  if (build.slot !== undefined) player.banished.push(offerKey.item("ability-patch"));
  if (build.tradeDelay !== undefined) player.banished.push(offerKey.item("linking-cord"));
  if (build.weather) {
    const rock = weatherMoves[weatherMove(player.starter)!].rock;
    if (build.weatherRock) player.items.push({ id: rock, level: 1 });
    else if (build.weatherRock === false) player.banished.push(offerKey.item(rock));
  }
  if (build.slot === "hidden") player.abilitySlot = "hidden";
  player.hp = playerStats(player).maxHp;
}

export function advanceDeepForm(player: BuildPlayer) {
  const state = player.projection!;
  const steps = starters[player.starter].stages;
  const natural = stageFor(player);
  const confirmed = stageFor(player, "trade");
  const gate = steps[confirmed]!;
  if (gate.kind === "evolve" && gate.needs === "trade") state.eligibleAt ??= state.time;
  const delay = state.build.tradeDelay;
  const eligible =
    delay !== undefined && state.eligibleAt !== undefined && state.time - state.eligibleAt >= delay
      ? confirmed
      : natural;
  while (player.stage < eligible) {
    const next = player.stage + 1;
    const previous = playerStats(player).maxHp;
    const stage = steps[next]!;
    if (stage.kind === "evolve" && stage.needs === "trade")
      player.items = player.items.filter((item) => item.id !== "linking-cord");
    player.stage = next;
    state.stageAt[next] = state.time;
    if (next === 1 && stage.kind === "evolve" && state.build.slot === 1) player.abilitySlot = 1;
    const maxHp = playerStats(player).maxHp;
    player.hp = Math.min(maxHp, player.hp + Math.max(0, maxHp - previous));
  }
}

export function trophyLinkingCord(player: BuildPlayer, partners: readonly Partner[]) {
  return (
    player.projection?.build.tradeDelay === undefined &&
    stageFor(player, "trade") > stageFor(player) &&
    itemEligible(player, "linking-cord", partners, true)
  );
}

/** Solo samples play toward evolution instead of filling the only slot left for the cord. */
export function reservesCordSlot(player: BuildPlayer) {
  return (
    player.projection?.build.tradeDelay === undefined &&
    player.items.length === itemSlots(player) - 1 &&
    !player.items.some((item) => item.id === "linking-cord" || item.id === "everstone") &&
    starters[player.starter].stages.some(
      (stage, index) => index > player.stage && stage.kind === "evolve" && stage.needs === "trade",
    )
  );
}

export function deepStats(player: BuildPlayer, weather: WeatherId | null): PlayerStats {
  const s = playerStats(player, weather),
    p = player.projection;
  if (player.trainerProjection) applyTrainer(s, player.trainerProjection);
  if (!p) return s;
  switch (currentAbility(player)) {
    case "lightning-rod":
      s.hit.special =
        (s.hit.special ?? 1) *
        (1 +
          DEEP_PARAMETERS.lightningRod.specialBonus *
            (1 - Math.exp(-p.electricRate * DEEP_PARAMETERS.lightningRod.seconds)));
      break;
    case "marvel-scale":
      s.armor += DEEP_PARAMETERS.marvelScaleArmor * p.poison;
      break;
    case "steadfast":
      s.speed *= 1 + DEEP_PARAMETERS.steadfastSpeed * p.slow;
      break;
  }
  return s;
}

export function castWindow(
  build: DeepBuild,
  time: number,
  rockAt = build.weatherRock ? 0 : Infinity,
  learnedAt = 0,
) {
  if (!build.weather || build.weatherUptime === 0 || time < learnedAt) return null;
  const interval = WEATHER_MOVE.cooldown;
  const from = learnedAt + Math.floor((time - learnedAt) / interval) * interval;
  return {
    id: build.weather,
    from,
    until:
      from +
      (build.weatherUptime === undefined ? WEATHER_MOVE.seconds : interval * build.weatherUptime) *
        (rockAt <= from ? WEATHER_MOVE.rockDuration : 1),
  };
}

/** Fixed two-seat marginal; both pillars land normally. At most one pair per slower cast. */
export function pledgePair(seats: readonly PledgeStarter[], withinRadius = 0.35) {
  if (seats.length !== 2 || seats[0] === seats[1]) return null;
  if (!Number.isFinite(withinRadius) || withinRadius < 0 || withinRadius > 1)
    throw new RangeError("同区命中概率须在 0–1");
  const { cooldown, window } = PLEDGE;
  const perSecond = (Math.min(1, (2 * window) / cooldown) * withinRadius) / cooldown;
  const ids = seats.map(pledgeMove);
  const combo = pledgeCombos.find((c) => c.pair.every((id) => ids.includes(id)))!;
  const result = { "sea-of-fire": "火海", rainbow: "彩虹", swamp: "湿地" }[combo.result];
  const field = PLEDGE_FIELD;
  const duration = result === "彩虹" ? field.rainbowSeconds : field.groundSeconds;
  // Independent encounter opportunities, one per cast cycle, refresh instead of stacking.
  const chance = perSecond * cooldown;
  const uptime =
    1 -
    (1 - chance) ** Math.floor(duration / cooldown) *
      (1 - chance * ((duration % cooldown) / cooldown));
  return {
    seats,
    result,
    withinRadius,
    perSecond,
    duration,
    uptime,
    burnDpsPerTarget: result === "火海" ? field.fireDps * uptime : 0,
    statusChanceFactor: result === "彩虹" ? 1 + (field.rainbowChance - 1) * uptime : 1,
    enemySpeedFactor: result === "湿地" ? 1 - field.swampSlow * uptime : 1,
  };
}
