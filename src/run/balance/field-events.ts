// Analytical spatial assumptions live here; gameplay values always come from the shared tables.
import { enemies, type EnemyId } from "../sim/content/enemies";
import { FIELD_EVENTS, SHINY, WEATHER } from "../sim/content/params/field-events";
import { SITE } from "../sim/content/params/sites";
import { BERRY, LOOT, STARDUST } from "../sim/content/params/economy";
import { ELITE } from "../sim/content/params/pacing";
import { MIN_UPGRADE_RARITY } from "../sim/content/params/cards";
import { stageDefs, type StageId } from "../sim/content/stages/index";
import { weatherDefs } from "../sim/content/weather";
import { sites } from "../sim/content/sites";
import type { ElementType } from "../sim/content/elements";
import type { ItemId } from "../sim/content/items";
import type { Player, Rarity } from "../sim/state/entities";
import type { FieldEventId, ScheduledBeat, SiteKind, WeatherId } from "../sim/state/field";
import type { World } from "../sim/state/world";
import { scheduleField } from "../sim/field-events";
import { chance, next, pick, range, type Rng } from "../sim/rng";
import type { SkillProfile } from "./skill";

export const FIELD_MODEL_ASSUMPTIONS = {
  reach: { novice: 0.3, average: 0.55, expert: 0.8 },
  finish: { novice: 0.65, average: 0.85, expert: 0.98 },
  hitRate: { novice: 0.06, average: 0.03, expert: 0.01 },
  glintVisibility: 0.35,
  travelSeconds: 12,
  explorationSeconds: 120,
  visitFrom: 60,
  leaveMargin: 120,
  retrySeconds: 2,
  movingShare: 0.65,
  fightFocus: 0.4,
  travelFocus: 0.15,
  channelFocus: 0.25,
} as const;

export function fieldProfile(skill: SkillProfile) {
  const name = skill.name as keyof typeof FIELD_MODEL_ASSUMPTIONS.reach;
  if (!(name in FIELD_MODEL_ASSUMPTIONS.reach))
    throw new Error(`field model: uncalibrated skill profile ${skill.name}`);
  return {
    reach: FIELD_MODEL_ASSUMPTIONS.reach[name],
    finish: FIELD_MODEL_ASSUMPTIONS.finish[name],
    hitRate: FIELD_MODEL_ASSUMPTIONS.hitRate[name],
  };
}

export function weatherFactor(weather: WeatherId | null, type: ElementType): number {
  return weather ? (weatherDefs[weather].element[type] ?? 1) : 1;
}

export function weatherChip(
  weather: WeatherId | null,
  types: readonly ElementType[],
  guardian = false,
): number {
  const chip = weather ? weatherDefs[weather].chip : undefined;
  return chip && !types.some((type) => chip.immune.includes(type))
    ? chip.dps * (guardian ? WEATHER.guardianChip : 1)
    : 0;
}

/** Use the real scheduler, once per field. Geometry and combat are intentionally absent from its projection. */
export function modelFieldSchedule(
  stage: StageId,
  zone: number,
  rng: Rng,
  eventsUsed: FieldEventId[],
): ScheduledBeat[] {
  const projection = {
    stage,
    rng,
    eventsUsed,
    zone: { index: zone, schedule: [] },
    spawn: { fired: [] },
  };
  scheduleField(projection as unknown as World);
  return projection.zone.schedule;
}

export interface EventIncome {
  xp: number;
  cards: number;
  stardust: number;
  items: number;
  partners: number;
  healing: number;
  occupiedSeconds: number;
  opportunityXp: number;
  attempted: number;
  completed: number;
  unfinished: number;
  weatherSeconds: number;
  weatherHpCost: number;
  enemyWeatherHp: number;
  shinyAppeared: number;
  shinyCaught: number;
}

export function emptyEventIncome(): EventIncome {
  return {
    xp: 0,
    cards: 0,
    stardust: 0,
    items: 0,
    partners: 0,
    healing: 0,
    occupiedSeconds: 0,
    opportunityXp: 0,
    attempted: 0,
    completed: 0,
    unfinished: 0,
    weatherSeconds: 0,
    weatherHpCost: 0,
    enemyWeatherHp: 0,
    shinyAppeared: 0,
    shinyCaught: 0,
  };
}

export interface ModelEncounter {
  species: EnemyId;
  hp: number;
  maxHp: number;
  xp: number;
  eventXp: number;
  elite: boolean;
  until: number;
  from: number;
  retreatAt: number;
  shiny: boolean;
  pursued: boolean;
}

export interface ModelSite {
  kind: SiteKind;
  species: EnemyId | null;
  ready: boolean;
  reachable: boolean;
  at: number;
  phase: "idle" | "travel" | "wait" | "channel" | "fight" | "spent";
  left: number;
  progress: number;
  attempts: number;
  encounter: ModelEncounter | null;
  balls?: { trap: boolean; ready: boolean; spent: boolean }[];
}

export interface ModelFieldEvents {
  schedule: ScheduledBeat[];
  fired: number;
  sites: ModelSite[];
  active: ModelSite | null;
  occupied: number;
  scope: boolean;
  weather: { id: WeatherId; from: number; until: number } | null;
  outbreak: { species: EnemyId; until: number } | null;
  shinySpawned: boolean;
  shinyCredit: number;
  shiny: ModelEncounter | null;
  trace: { at: number; id: FieldEventId }[];
}

/** Spatial projection of placeSites: same shared pools/count/dormancy, no artificial map or nav. */
export function newModelFieldEvents(
  stage: StageId,
  zone: number,
  rng: Rng,
  used: FieldEventId[],
  skill: SkillProfile,
): ModelFieldEvents {
  const schedule = modelFieldSchedule(stage, zone, rng, used);
  const def = stageDefs[stage];
  const available = [...def.zones[zone]!.sites];
  const profile = fieldProfile(skill);
  const projected: ModelSite[] = [];
  for (let slot = 0; slot < SITE.count; slot++) {
    const paired = stage === "tower" && slot < 2;
    const kind = paired
      ? slot === 0
        ? "ghost"
        : "silph-scope"
      : pick(
          rng,
          available.filter((id) => id !== "ghost" && id !== "silph-scope"),
        );
    available.splice(available.indexOf(kind), 1);
    const ready = paired || !chance(rng, SITE.dormantChance);
    let species: EnemyId | null = null;
    // These species choices follow sim/sites/index.ts; their combat values come from EnemyDef.encounter.
    if (kind === "honey-tree") species = pick(rng, ["heracross", "pinsir", "munchlax"] as const);
    if (kind === "snorlax") species = "snorlax";
    if (kind === "ghost") species = "marowak";
    if (kind === "fossil") species = "aerodactyl";
    if (kind === "egg" || kind === "raid-den")
      species = pick(
        rng,
        def.zones[zone]!.roster.map(([, id]) => id).filter(
          (id) =>
            enemies[id].mobility.water !== "swim" &&
            (kind !== "raid-den" || enemies[id].radius <= SITE.raid.maxRadius),
        ),
      );
    let balls: ModelSite["balls"];
    if (kind === "item-ball") {
      const integer = (pair: readonly [number, number]) =>
        pair[0] + Math.floor(next(rng) * (pair[1] - pair[0] + 1));
      const count = integer(SITE.balls.count),
        traps = integer(SITE.balls.traps);
      const indices = Array.from({ length: count }, (_, i) => i);
      const hidden = new Set<number>();
      while (hidden.size < traps)
        hidden.add(indices.splice(Math.floor(next(rng) * indices.length), 1)[0]!);
      balls = Array.from({ length: count }, (_, i) => ({
        trap: hidden.has(i),
        ready,
        spent: false,
      }));
    }
    projected.push({
      kind,
      species,
      ready,
      ...(balls ? { balls } : {}),
      reachable: chance(
        rng,
        profile.reach * (kind === "glint" ? FIELD_MODEL_ASSUMPTIONS.glintVisibility : 1),
      ),
      at: range(
        rng,
        FIELD_MODEL_ASSUMPTIONS.visitFrom,
        Math.max(
          FIELD_MODEL_ASSUMPTIONS.visitFrom,
          def.duration - FIELD_MODEL_ASSUMPTIONS.leaveMargin,
        ),
      ),
      phase: "idle",
      left: 0,
      progress: 0,
      attempts: 0,
      encounter: null,
    });
  }
  return {
    schedule,
    fired: 0,
    sites: projected,
    active: null,
    occupied: 0,
    scope: false,
    weather: null,
    outbreak: null,
    shinySpawned: false,
    shinyCredit: 0,
    shiny: null,
    trace: [],
  };
}

export function modelWeather(state: ModelFieldEvents, time: number): WeatherId | null {
  return state.weather && time >= state.weather.from && time < state.weather.until
    ? state.weather.id
    : null;
}

export function awakenModelSite(state: ModelFieldEvents, rng: Rng): void {
  const dormant = state.sites.flatMap<{
    site: ModelSite;
    ball: { trap: boolean; ready: boolean; spent: boolean } | null;
  }>((site) =>
    site.balls
      ? site.balls.filter((ball) => !ball.ready && !ball.spent).map((ball) => ({ site, ball }))
      : !site.ready && site.phase !== "spent"
        ? [{ site, ball: null }]
        : [],
  );
  if (dormant.length > 0) {
    const { site, ball } = pick(rng, dormant);
    if (ball) ball.ready = true;
    site.ready = true;
  }
}

export interface ModelSiteRewards {
  xp: number;
  eventXp: number;
  chests: Rarity[];
  items: (ItemId | null)[];
  berries: number;
  stardust: number;
  /** Direct shiny credit, without a second pickup roll. */
  directStardust: number;
  partner: EnemyId | null;
  capture: { species: EnemyId; alpha: boolean } | null;
  fullHeal: boolean;
  damage: number;
  removed: number;
  killed: number;
  personalKills: number;
  eliteKills: number;
  personalXp: number;
  damageXp: number;
  attempted: number;
  completed: number;
  unfinished: number;
  focus: number;
  occupied: number;
  weatherRemoved: number;
}

function siteRewards(): ModelSiteRewards {
  return {
    xp: 0,
    eventXp: 0,
    chests: [],
    items: [],
    berries: 0,
    stardust: 0,
    directStardust: 0,
    partner: null,
    capture: null,
    fullHeal: false,
    damage: 0,
    removed: 0,
    killed: 0,
    personalKills: 0,
    eliteKills: 0,
    personalXp: 0,
    damageXp: 0,
    attempted: 0,
    completed: 0,
    unfinished: 0,
    focus: 0,
    occupied: 0,
    weatherRemoved: 0,
  };
}

export interface SiteStepContext {
  time: number;
  seconds: number;
  rng: Rng;
  skill: SkillProfile;
  hpScale: number;
  xpScale: number;
  dmgScale: number;
  speed: number;
  hitRate: number;
  protected: boolean;
  weather: WeatherId | null;
  outbreak: EnemyId | null;
  berryMultiplier: number;
  focusedDps: (species: EnemyId, hp: number) => number;
}

function siteEncounter(site: ModelSite, context: SiteStepContext, elite = true): ModelEncounter {
  const species = site.species!;
  const def = enemies[species];
  const ordinary = def.encounter ?? def;
  const hp =
    ordinary.hp *
    context.hpScale *
    (elite ? ELITE.hp : 1) *
    (site.kind === "snorlax" ? SITE.snorlaxHp : site.kind === "raid-den" ? SITE.raid.hp : 1);
  const xp =
    ordinary.xp *
    context.xpScale *
    (elite ? ELITE.xp : 1) *
    (species === context.outbreak ? FIELD_EVENTS.outbreak.xp : 1);
  return {
    species,
    hp,
    maxHp: hp,
    xp,
    eventXp: xp,
    elite,
    shiny: false,
    pursued: true,
    until: site.kind === "raid-den" ? context.time + SITE.raid.seconds : Infinity,
    from: context.time,
    retreatAt: chance(context.rng, fieldProfile(context.skill).finish)
      ? Infinity
      : context.time + Math.max(1, hp / Math.max(1e-9, context.focusedDps(species, hp)) / 2),
  };
}

function fightEncounter(
  encounter: ModelEncounter,
  context: SiteStepContext,
  reward: ModelSiteRewards,
): "alive" | "defeated" | "escaped" {
  if (context.time >= encounter.until || context.time >= encounter.retreatAt) return "escaped";
  if (context.time < encounter.from) return "alive";
  const ordinary = enemies[encounter.species].encounter ?? enemies[encounter.species];
  reward.damage +=
    ordinary.dmg *
    context.dmgScale *
    (encounter.elite ? ELITE.dmg : 1) *
    fieldProfile(context.skill).hitRate *
    context.seconds;
  const weather = Math.min(
    encounter.hp,
    encounter.maxHp *
      weatherChip(context.weather, enemies[encounter.species].types) *
      context.seconds,
  );
  encounter.hp -= weather;
  reward.weatherRemoved += weather;
  const direct = Math.min(
    encounter.hp,
    context.focusedDps(encounter.species, encounter.maxHp) * context.seconds,
  );
  encounter.hp -= direct;
  reward.removed += direct;
  reward.damageXp += (direct / encounter.maxHp) * encounter.xp;
  if (encounter.hp > 1e-9) return "alive";
  const earnedXp = encounter.elite
    ? LOOT.eliteXpCount * Math.ceil(encounter.xp / LOOT.eliteXpCount)
    : encounter.xp;
  reward.xp += earnedXp;
  reward.eventXp += encounter.shiny ? encounter.eventXp : earnedXp;
  reward.stardust += encounter.elite
    ? STARDUST.elite
    : STARDUST.ordinary.chance * STARDUST.ordinary.value;
  reward.berries += BERRY.chance * (direct > 0 ? context.berryMultiplier : 1);
  reward.killed++;
  if (direct > 0) {
    reward.personalXp += encounter.xp;
    reward.personalKills++;
    if (encounter.elite) reward.eliteKills++;
  }
  if (encounter.shiny && direct > 0) reward.directStardust += SHINY.stardust;
  return "defeated";
}

/** One second of exploration/channel/fight. Rewards are emitted once, at completion, never at map end. */
export function stepModelSites(
  state: ModelFieldEvents,
  context: SiteStepContext,
  player: Pick<Player, "egg" | "x" | "z">,
): ModelSiteRewards {
  const out = siteRewards();
  const dt = context.seconds;
  // Carried eggs belong to the continuous player, outside each field's exploration lifetime.
  if (player.egg) {
    player.egg.distance += context.speed * FIELD_MODEL_ASSUMPTIONS.movingShare * dt;
    if (player.egg.distance >= SITE.eggDistance) {
      out.partner = player.egg.species;
      out.completed++;
      player.egg = null;
    }
  }
  const finish = (site: ModelSite) => {
    site.phase = "spent";
    state.active = null;
    site.encounter = null;
  };
  if (state.shiny && !state.shiny.pursued) {
    if (context.time >= state.shiny.until) state.shiny = null;
    else if (context.time >= state.shiny.from) {
      // Ignored shinies retain a body until escape; do not award an unmodelled incidental catch.
      const ordinary = enemies[state.shiny.species];
      out.damage += ordinary.dmg * context.dmgScale * fieldProfile(context.skill).hitRate * dt;
    }
  }
  if (state.shiny?.pursued) {
    out.focus =
      context.time < state.shiny.from
        ? FIELD_MODEL_ASSUMPTIONS.travelFocus
        : FIELD_MODEL_ASSUMPTIONS.fightFocus;
    const result = fightEncounter(state.shiny, context, out);
    if (result !== "alive") state.shiny = null;
    if (result === "escaped") out.focus = 0;
    // Shiny pursuit does not consume one of the static site visits, but still diverts ordinary output.
    return out;
  }
  if (!state.active && state.occupied < FIELD_MODEL_ASSUMPTIONS.explorationSeconds) {
    const site = state.sites.find(
      (entry) =>
        entry.phase === "idle" &&
        entry.ready &&
        entry.reachable &&
        context.time >= entry.at &&
        (entry.kind !== "ghost" || state.scope) &&
        (entry.kind !== "egg" || !player.egg),
    );
    if (site) {
      site.phase = "travel";
      site.left = FIELD_MODEL_ASSUMPTIONS.travelSeconds;
      state.active = site;
      out.attempted++;
    }
  }
  const site = state.active;
  if (!site) return out;
  if (state.occupied + dt > FIELD_MODEL_ASSUMPTIONS.explorationSeconds) {
    out.unfinished++;
    finish(site);
    return out;
  }
  state.occupied += dt;
  out.occupied = dt;
  if (site.phase === "travel") {
    out.focus = FIELD_MODEL_ASSUMPTIONS.travelFocus;
    site.left -= dt;
    if (site.left > 0) return out;
    if (site.kind === "silph-scope") {
      state.scope = true;
      out.completed++;
      finish(site);
      return out;
    }
    if (site.kind === "spring") {
      out.fullHeal = true;
      out.completed++;
      finish(site);
      return out;
    }
    if (site.kind === "glint") {
      out.items.push(null);
      out.completed++;
      finish(site);
      return out;
    }
    if (site.kind === "item-ball") {
      const balls = site.balls;
      if (!balls)
        throw new Error("field model: item-ball placement is missing its seeded contents");
      const touched = balls.filter((ball) => ball.ready && !ball.spent);
      const traps = touched.filter((ball) => ball.trap).length;
      for (let i = 0; i < touched.length - traps; i++) {
        const draw = next(context.rng);
        if (draw < SITE.rewards.ballItemShare) out.items.push(null);
        else if (draw < SITE.rewards.ballItemShare + SITE.rewards.ballBerryShare) out.berries++;
        else out.stardust += SITE.rewards.ballStardust;
      }
      out.damage +=
        traps *
        (1 - context.skill.dodge.telegraph) *
        enemies.voltorb.dmg *
        context.dmgScale *
        SITE.balls.damage;
      for (const ball of touched) ball.spent = true;
      out.completed++;
      if (balls.some((ball) => !ball.spent)) {
        site.phase = "idle";
        site.ready = false;
        state.active = null;
      } else finish(site);
      return out;
    }
    if (site.kind === "egg") {
      player.egg = { species: site.species!, distance: 0, x: player.x, z: player.z };
      finish(site);
      return out;
    }
    const interaction = sites[site.kind].interact;
    if (typeof interaction === "object") {
      site.phase = "channel";
      return out;
    }
    site.phase = "wait";
    site.left = site.kind === "honey-tree" ? SITE.honeyDelay : SITE.warning;
    return out;
  }
  if (site.phase === "channel") {
    out.focus = FIELD_MODEL_ASSUMPTIONS.channelFocus;
    if (site.left > 0) {
      site.left -= dt;
      return out;
    }
    if (!context.protected && chance(context.rng, -Math.expm1(-context.hitRate * dt))) {
      if (site.kind === "fishing") {
        site.progress = 0;
        site.attempts++;
      }
      site.left = FIELD_MODEL_ASSUMPTIONS.retrySeconds;
      if (site.attempts >= SITE.fishing.uses) {
        out.unfinished++;
        finish(site);
      }
      return out;
    }
    site.progress += dt;
    const channel = sites[site.kind].interact;
    if (typeof channel !== "object") throw new Error(`field model: ${site.kind} has no channel`);
    if (site.progress < channel.channel) return out;
    site.progress = 0;
    if (site.kind === "fishing") {
      site.attempts++;
      const draw = next(context.rng);
      if (draw < SITE.fishing.fish) site.species = "magikarp";
      else if (draw < SITE.fishing.fish + SITE.fishing.item) {
        out.items.push(null);
        out.completed++;
        if (site.attempts >= SITE.fishing.uses) finish(site);
        return out;
      } else site.species = "gyarados";
    }
    site.phase = "fight";
    site.encounter = siteEncounter(site, context, site.species !== "magikarp");
    return out;
  }
  if (site.phase === "wait") {
    site.left -= dt;
    if (site.left <= 0) {
      site.phase = "fight";
      site.encounter = siteEncounter(site, context);
    }
    return out;
  }
  if (site.phase === "fight") {
    if (site.kind === "ghost" && !state.scope) {
      // Leave the unidentified ghost to look for the scope; it can be revisited after identification.
      site.phase = "idle";
      site.at = context.time + FIELD_MODEL_ASSUMPTIONS.travelSeconds;
      state.active = null;
      return out;
    }
    out.focus = FIELD_MODEL_ASSUMPTIONS.fightFocus;
    const result = fightEncounter(site.encounter!, context, out);
    if (result === "alive") return out;
    if (result === "escaped") {
      out.unfinished++;
      finish(site);
      return out;
    }
    if (out.personalKills > 0 && site.encounter!.elite)
      out.capture = { species: site.encounter!.species, alpha: site.kind === "raid-den" };
    if (site.kind === "snorlax") out.items.push("leftovers");
    else if (site.species === "magikarp") out.stardust += SITE.rewards.fishStardust;
    else
      out.chests.push(
        site.kind === "raid-den" || site.kind === "ghost" ? 3 : MIN_UPGRADE_RARITY.chest,
      );
    out.completed++;
    if (site.kind === "fishing" && site.attempts < SITE.fishing.uses) {
      site.phase = "channel";
      site.encounter = null;
    } else finish(site);
  }
  return out;
}

/** Sample the first ordinary shiny birth only; escaping consumes the field's slot as in the sim. */
export function modelShinyBirth(
  state: ModelFieldEvents,
  rng: Rng,
  births: number,
  pool: readonly EnemyId[],
  share: (id: EnemyId) => number,
  time: number,
  hpScale: number,
  xpScale: number,
  skill: SkillProfile,
  eventBirth: boolean,
  approachSeconds: number,
): ModelEncounter | null {
  if (state.shinySpawned) return null;
  state.shinyCredit += births;
  const count = Math.floor(state.shinyCredit);
  state.shinyCredit -= count;
  if (count <= 0) return null;
  const outbreak = state.outbreak && time < state.outbreak.until ? state.outbreak.species : null;
  const weights = pool.map((id) => share(id) * (id === outbreak ? FIELD_EVENTS.outbreak.shiny : 1));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (!chance(rng, -Math.expm1(count * Math.log1p(-SHINY.chance * sum)))) return null;
  let draw = next(rng) * sum;
  let species = pool.at(-1)!;
  for (let i = 0; i < pool.length; i++) {
    draw -= weights[i]!;
    if (draw < 0) {
      species = pool[i]!;
      break;
    }
  }
  const def = enemies[species];
  const hp = def.hp * hpScale * SHINY.hp;
  const xp = def.xp * xpScale * (species === outbreak ? FIELD_EVENTS.outbreak.xp : 1);
  const encounter: ModelEncounter = {
    species,
    hp,
    maxHp: hp,
    xp,
    eventXp: eventBirth ? xp : xp - def.xp * xpScale,
    elite: false,
    until: time + SHINY.escape,
    from: time + approachSeconds,
    retreatAt: Infinity,
    pursued: chance(rng, fieldProfile(skill).reach),
    shiny: true,
  };
  state.shinySpawned = true;
  state.shiny = encounter;
  return encounter;
}

export const FIELD_MODEL_LIMITS = [
  "触达、绕路、120秒探索预算、受击/引导重试和继续追击为显式操作画像；不是所有站点必拿。",
  "scheduleField使用逐样本种子流，跨图不重复；解析模型没有重建地图装配及逐帧战斗的全部RNG消耗，因此不声称与完整sim同种子逐位相同。",
  "site物种规则投影对应sim/sites/index.ts；数值读取encounter/共享表，需待内容表暴露物种池与奖励floor后消除这部分规则映射。",
  "普通怪仍是聚合存量；大量出现按出生权重和经验库存结算，普通耐久/地形/空间聚集沿用原模型近似。",
  "单人逐样本连续构筑；未重建多人分头探索、倒下接蛋、救援和真实空间路径。",
  "未追击的异色保留身体到逃离但不估算偶然击败；放弃交互后的遗留敌人路径/技能不再重建，未完成次数单列。",
  "一秒步长对齐窗口触发与原脉冲；未逐帧重放冷却相位、位移/霸体几何及终极技施加状态。事件敌人的近身命中使用画像期望，未复刻其完整技能AI。",
  "直接事件收入是来源归因；同种子逐图总收益差另计，包含成长、分流和条件存活改变，不能再把机会成本从实际账面重复扣除。",
] as const;
