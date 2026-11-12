import { ENEMY_HAZARD, BONEMERANG } from "../content/params/enemy-skills";
import {
  ZONE_ACTION as A,
  ZONE_ATTACK as N,
  ZONE_GUARDIAN as Z,
  TRAIL,
} from "../content/params/late-zones";
import { hasWalkableLine } from "../nav/index";
import { enemies } from "../content/enemies";
// P4–P6 guardians share the existing phase clock. Each species selects and releases its own attacks;
// no new scheduler or behaviour runtime is involved.
import { BOSS_CHASE_MIN } from "../content/params/guardian";
import { steerToward } from "../enemies";
import { attacksBlocked } from "../status";
import { heightAt } from "../terrain";
import { TICK, type World } from "../state/world";
import type { Enemy, Player } from "../state/entities";
import { atan2, cos, sin, hypot } from "../math";
import { addHazard, enter } from "../skills/kit";
import { landingHit, landingOf, lockLanding, standable } from "../skills/landing";
import { teleportSpot } from "../skills/teleport";
import { sludgeTrail } from "../skills/trail";
import { bonesOut, throwBone } from "../skills/boomerang";
import {
  action,
  beams,
  burst,
  fallAt,
  falls,
  fanWarning,
  lane,
  lowHealth,
  shots,
  telegraphScale,
} from "./zone-kit";
import { leavePool } from "./zone-hazards";
import { predictTarget } from "../enemy-aim";

function chase(world: World, boss: Enemy, target: Player, speed: number): [number, number, number] {
  const heading = steerToward(world, boss, target);
  return [heading.x, heading.z, speed];
}

function shadow(
  world: World,
  boss: Enemy,
  target: Player,
  attack: "shadow" | "gengar-shadow" | "lava-dive" | "sludge-slam",
  chain = 0,
): boolean {
  if (!standable(world, boss, target.x, target.z)) return false;
  if (
    attack === "sludge-slam" &&
    !hasWalkableLine(world.nav, enemies[boss.species].mobility, boss.x, boss.z, target.x, target.z)
  )
    return false;
  const slam = attack === "sludge-slam",
    gengar = attack === "gengar-shadow";
  action(
    world,
    boss,
    target,
    attack,
    ...(slam ? A["sludge-slam"] : gengar && lowHealth(boss) ? A["gengar-shadow-low"] : A.shadow),
    0,
    chain,
    Z.chain,
  );
  if (!slam) {
    boss.action!.windup = Math.min(A.shadow[0], boss.action!.windup);
    enter(boss, "under");
  }
  const predicted = predictTarget(world, boss, target, boss.action!.windup + boss.action!.active);
  if (
    standable(world, boss, predicted.x, predicted.z) &&
    (!slam ||
      hasWalkableLine(
        world.nav,
        enemies[boss.species].mobility,
        boss.x,
        boss.z,
        predicted.x,
        predicted.z,
      ))
  )
    target = predicted;
  lockLanding(
    world,
    boss,
    target.x,
    target.z,
    slam || gengar ? N.shadow.wideRadius : N.shadow.radius,
    boss.dmg * Z.landing,
    boss.action!.windup + boss.action!.active,
  );
  return true;
}

function dash(
  world: World,
  boss: Enemy,
  target: Player,
  attack: "dive" | "slide" | "extreme-speed",
  chained = false,
): void {
  const low = lowHealth(boss),
    old = boss.action;
  const config =
    attack === "dive"
      ? [...A.dive, ...N.dash.dive]
      : attack === "slide"
        ? [...(low ? A["slide-low"] : A.slide), ...N.dash.slide]
        : [...(low ? A["extreme-speed-low"] : A["extreme-speed"]), ...N.dash["extreme-speed"]];
  action(
    world,
    boss,
    target,
    attack,
    config[0]!,
    config[1]!,
    config[2]!,
    config[3]!,
    chained
      ? old!.chain
      : attack === "extreme-speed"
        ? Z.extremeDashes - 1
        : low
          ? Z.repeatDashes - 1
          : 0,
    attack === "extreme-speed" ? Z.extremeGap : Z.chain,
  );
  if (chained) boss.action!.windup = old!.gap;
  lane(
    world,
    boss,
    config[4]!,
    config[5]!,
    attack === "slide" ? "ice" : attack === "dive" ? "flying" : "fire",
  );
}

function circle(
  world: World,
  boss: Enemy,
  target: Player,
  attack: "song" | "bone-club" | "fire-blast",
  radius: number,
  element: "fire" | "fairy" | "ghost",
  slow = 0,
): void {
  action(world, boss, target, attack, ...A[attack]);
  addHazard(world, {
    kind: "cone",
    x: boss.x,
    y: heightAt(world.map.terrain, boss.x, boss.z) + ENEMY_HAZARD.groundSight,
    z: boss.z,
    life: boss.action!.windup + A[attack][1] + TICK,
    duration: boss.action!.windup + A[attack][1],
    active: A[attack][1],
    radius: 0,
    dirX: boss.dashX,
    dirZ: boss.dashZ,
    length: radius,
    angle: Math.PI,
    dmg: boss.dmg,
    element,
    slow,
    caster: boss.id,
  });
}

function shield(world: World, boss: Enemy, target: Player, cloyster: boolean): void {
  action(
    world,
    boss,
    target,
    cloyster ? "shell" : "light-shield",
    ...A[cloyster ? "shell" : "light-shield"],
  );
  boss.hardened = Z.shieldTime;
  boss.hardenDamage = cloyster ? Z.shellShield : Z.mimeShield;
  enter(boss, "dash");
  if (cloyster) {
    addHazard(world, {
      kind: "orbit",
      x: boss.x,
      y: heightAt(world.map.terrain, boss.x, boss.z),
      z: boss.z,
      life: Z.shieldTime,
      duration: Z.shieldTime,
      active: Z.shieldTime,
      radius: N.shell.radius,
      length: N.shell.orbit,
      dmg: boss.dmg * Z.orbit,
      slow: Z.slow,
      caster: boss.id,
      element: "ice",
    });
    if (lowHealth(boss))
      falls(
        world,
        boss,
        target,
        N.shellFalls.count,
        N.shellFalls.ring,
        N.shellFalls.radius,
        telegraphScale(world),
        "ice",
      );
  } else {
    // The shield remains up while its separately telegraphed beam fires.
    const a = boss.action!;
    a.windup = A["shield-beam"][0] * telegraphScale(world);
    a.active = A["shield-beam"][1];
    beams(world, boss, target, 1, 0, N.shieldBeam.length, N.shieldBeam.width, "psychic");
    a.windup = 0;
    a.active = Z.shieldTime;
  }
}

function cage(world: World, boss: Enemy, target: Player): void {
  action(world, boss, target, "cage", ...A.cage);
  const gap = boss.id % 4;
  for (let i = 0; i < (lowHealth(boss) ? N.cage.lowCount : N.cage.count); i++)
    addHazard(world, {
      kind: "closing-box",
      x: target.x,
      y: heightAt(world.map.terrain, target.x, target.z),
      z: target.z,
      life: boss.action!.windup + boss.action!.active + TICK,
      duration: boss.action!.windup + boss.action!.active,
      active: boss.action!.active,
      radius: N.cage.width,
      length: i === 0 ? N.cage.outer : N.cage.inner,
      gap: (gap + i + 1) % 4,
      hit: [],
      dmg: boss.dmg,
      element: "psychic",
      caster: boss.id,
    });
}

function psychicFan(world: World, boss: Enemy, target: Player): void {
  action(
    world,
    boss,
    target,
    "psychic-fan",
    ...(lowHealth(boss) ? A["psychic-fan-low"] : A["psychic-fan"]),
  );
  beams(
    world,
    boss,
    target,
    N.psychicFan.count,
    (N.psychicFan.spreadDegrees * Math.PI) / 180,
    N.psychicFan.length,
    N.psychicFan.width,
    "psychic",
  );
}
function blink(world: World, boss: Enemy, target: Player): boolean {
  const spot = teleportSpot(world, boss, target, ...N.blink.destination);
  if (!spot) return false;
  action(world, boss, target, "blink", ...A.blink);
  // A neutral destination marker; the psychic fan has its own full warning afterwards.
  boss.action!.windup = A.blink[0];
  enter(boss, "under");
  addHazard(world, {
    kind: "teleport-mark",
    x: spot[0],
    y: heightAt(world.map.terrain, ...spot),
    z: spot[1],
    radius: boss.radius,
    life: A.blink[0] + 2 * TICK,
    caster: boss.id,
  });
  return true;
}

function ghostFires(world: World, boss: Enemy): void {
  const count = world.hazards.filter(
    (h) => h.kind === "ghost-fire" && h.caster === boss.id && h.life > 0,
  ).length;
  for (let i = count; i < Z.fires; i++) {
    const a = (i / Z.fires) * Math.PI * 2,
      x = boss.x + cos(a) * N.ghostFire.ring,
      z = boss.z + sin(a) * N.ghostFire.ring;
    addHazard(world, {
      kind: "ghost-fire",
      x,
      y: heightAt(world.map.terrain, x, z),
      z,
      life: N.ghostFire.life,
      duration: N.ghostFire.life,
      radius: N.ghostFire.radius,
      dmg: boss.dmg,
      element: "ghost",
      caster: boss.id,
    });
  }
}
function shadowBones(world: World, boss: Enemy, target: Player): void {
  action(
    world,
    boss,
    target,
    "shadow-bones",
    ...A["shadow-bones"],
    0,
    lowHealth(boss) ? N.shadowBones.lowCount : N.shadowBones.count,
  );
  for (const offset of boss.action!.chain === N.shadowBones.lowCount
    ? N.shadowBones.lowOffsets
    : N.shadowBones.offsets) {
    const a = atan2(boss.dashZ, boss.dashX) + (offset * Math.PI) / 180;
    addHazard(world, {
      kind: "bone-warn",
      x: boss.x,
      y: heightAt(world.map.terrain, boss.x, boss.z) + BONEMERANG.height,
      z: boss.z,
      life: boss.action!.windup + TICK,
      radius: BONEMERANG.radius,
      dirX: cos(a),
      dirZ: sin(a),
      length: Z.bone,
      caster: boss.id,
      element: "ghost",
      piercesCover: true,
    });
  }
}
function curse(world: World, boss: Enemy, target: Player): void {
  const alive = world.players.filter((p) => p.alive);
  for (let i = 0; i < (lowHealth(boss) ? N.curse.lowCount : N.curse.count); i++) {
    const p = alive[(alive.indexOf(target) + i) % alive.length]!;
    const hold = N.curse.hold * telegraphScale(world);
    addHazard(world, {
      kind: "curse-mark",
      x: p.x,
      y: heightAt(world.map.terrain, p.x, p.z),
      z: p.z,
      radius: N.curse.radius,
      life: N.curse.follow + hold + N.curse.residue + TICK,
      duration: N.curse.follow + hold + N.curse.residue,
      active: hold,
      target: p.id,
      delay: i * N.curse.delay,
      dmg: boss.dmg,
      element: "ghost",
      caster: boss.id,
    });
  }
  enter(boss, "chase");
}
function flameRing(world: World, boss: Enemy, target: Player): void {
  // Six of seven evenly spaced spots: the omitted seventh is the escape opening.
  const turn = atan2(target.z - boss.z, target.x - boss.x);
  for (let i = 0; i < N.flameRing.count; i++) {
    const a = turn + (i * Math.PI * 2) / N.flameRing.slots;
    fallAt(
      world,
      boss,
      target.x + cos(a) * N.flameRing.ring,
      target.z + sin(a) * N.flameRing.ring,
      N.flameRing.radius,
      telegraphScale(world),
      "fire",
      "fire",
      N.flameRing.poolLife,
    );
  }
  enter(boss, "chase");
}

/** Returns false when a valid landing/blink could not be found; the guardian simply keeps chasing. */
function choose(world: World, boss: Enemy, target: Player): boolean {
  const low = lowHealth(boss),
    turn = Math.round(boss.attackTimer) + 1,
    tele = telegraphScale(world);
  switch (boss.species) {
    case "haunter-guardian":
      if (turn % 2 === 1) {
        if (!shadow(world, boss, target, "shadow", low ? Z.shadowSneaks - 1 : 0)) return false;
      } else {
        action(world, boss, target, "night-shade", ...A["night-shade"]);
        fanWarning(
          world,
          boss,
          target,
          N.nightShade.count,
          N.nightShade.spread,
          N.nightShade.length,
          N.nightShade.radius,
          "ghost",
        );
      }
      break;
    case "muk":
      if (turn % 2 === 0) {
        if (!shadow(world, boss, target, "sludge-slam")) return false;
      } else {
        falls(
          world,
          boss,
          target,
          low ? N.sludgeBomb.lowCount : N.sludgeBomb.count,
          N.sludgeBomb.ring,
          N.sludgeBomb.radius,
          tele,
          "poison",
          "poison",
          N.sludgeBomb.poolLife,
        );
        enter(boss, "chase");
      }
      break;
    case "mr-mime":
      if (turn % 2 === 1) cage(world, boss, target);
      else shield(world, boss, target, false);
      break;
    case "golbat":
      if (turn % 2 === 0) dash(world, boss, target, "dive");
      else {
        action(world, boss, target, "sonic", ...A.sonic);
        addHazard(world, {
          kind: "cone",
          x: boss.x,
          y: heightAt(world.map.terrain, boss.x, boss.z) + N.sonic.height,
          z: boss.z,
          radius: 0,
          length: N.sonic.length,
          angle: Math.PI / N.sonic.halfAngleDivisor,
          dirX: boss.dashX,
          dirZ: boss.dashZ,
          life: boss.action!.windup + boss.action!.active + TICK,
          duration: boss.action!.windup + boss.action!.active,
          active: boss.action!.active,
          dmg: boss.dmg,
          slow: Z.slow,
          element: "flying",
          caster: boss.id,
        });
      }
      break;
    case "alakazam":
      if (turn % 3 === 1) {
        if (!blink(world, boss, target)) return false;
      } else if (turn % 3 === 2) psychicFan(world, boss, target);
      else {
        boss.foresight = { left: low ? N.foresight.lowCount : N.foresight.count, timer: 0 };
        enter(boss, "chase");
      }
      break;
    case "marowak-ghost":
      if (low && hypot(target.x - boss.x, target.z - boss.z) < N.boneClub.range)
        circle(world, boss, target, "bone-club", N.boneClub.radius, "ghost");
      else if (turn % 3 === 0) {
        ghostFires(world, boss);
        enter(boss, "chase");
      } else shadowBones(world, boss, target);
      break;
    case "gengar":
      if (turn % 3 === 1) {
        action(world, boss, target, "shadow-ball", ...A["shadow-ball"]);
        fanWarning(
          world,
          boss,
          target,
          N.shadowBall.count,
          N.shadowBall.spread,
          N.shadowBall.length,
          N.shadowBall.radius,
          "ghost",
        );
      } else if (turn % 3 === 2) {
        if (!shadow(world, boss, target, "gengar-shadow", low ? Z.gengarSneaks - 1 : 0))
          return false;
      } else curse(world, boss, target);
      break;
    case "dewgong":
      if (turn % 2 === 0) dash(world, boss, target, "slide");
      else {
        action(world, boss, target, "freeze", ...A["dewgong-beam"]);
        beams(world, boss, target, 1, 0, N.dewgongBeam.length, N.dewgongBeam.width, "ice", Z.slow);
      }
      break;
    case "cloyster":
      if (turn % 2 === 0) shield(world, boss, target, true);
      else {
        action(world, boss, target, "icicle-fan", ...A["icicle-fan"]);
        boss.action!.recover = A["icicle-fan"][2];
        fanWarning(
          world,
          boss,
          target,
          N.icicleFan.count,
          Math.PI / N.icicleFan.spreadDivisor,
          N.icicleFan.length,
          N.icicleFan.radius,
          "ice",
        );
      }
      break;
    case "lapras":
      if (low && turn % 3 === 0)
        circle(world, boss, target, "song", N.song.radius, "fairy", Z.song);
      else if (turn % 2 === 1) {
        action(world, boss, target, "freeze", ...A["lapras-beam"]);
        beams(
          world,
          boss,
          target,
          low ? N.laprasBeam.lowCount : N.laprasBeam.count,
          (N.laprasBeam.spreadDegrees * Math.PI) / 180,
          N.laprasBeam.length,
          N.laprasBeam.width,
          "ice",
          Z.slow,
        );
      } else {
        falls(
          world,
          boss,
          target,
          N.blizzard.count,
          N.blizzard.ring,
          N.blizzard.radius,
          tele,
          "ice",
          undefined,
          Z.poolLife,
          N.blizzard.spacing,
        );
        enter(boss, "chase");
      }
      break;
    case "magmar":
      if (turn % 2 === 0) {
        if (!shadow(world, boss, target, "lava-dive")) return false;
      } else {
        action(world, boss, target, "flame-fan", ...A["flame-fan"]);
        beams(
          world,
          boss,
          target,
          N.flameFan.count,
          Math.PI / N.flameFan.spreadDivisor,
          N.flameFan.length,
          N.flameFan.width,
          "fire",
        );
      }
      break;
    case "arcanine":
      if (turn % 2 === 1) dash(world, boss, target, "extreme-speed");
      else flameRing(world, boss, target);
      break;
    case "dragonite":
      if (low && turn % 3 === 0) {
        action(world, boss, target, "hyper-sweep", ...A["hyper-sweep"]);
        addHazard(world, {
          kind: "sweep",
          x: boss.x,
          y: heightAt(world.map.terrain, boss.x, boss.z) + N.hyperSweep.height,
          z: boss.z,
          radius: N.hyperSweep.radius,
          length: N.hyperSweep.length,
          angle: Math.PI / N.hyperSweep.halfAngleDivisor,
          dirX: boss.dashX,
          dirZ: boss.dashZ,
          life: boss.action!.windup + boss.action!.active + TICK,
          duration: boss.action!.windup + boss.action!.active,
          active: boss.action!.active,
          dmg: boss.dmg * Z.sweep,
          element: "dragon",
          caster: boss.id,
        });
      } else if (turn % 2 === 1) {
        action(world, boss, target, "hyper-beam", ...A["hyper-beam"]);
        beams(world, boss, target, 1, 0, N.hyperBeam.length, N.hyperBeam.width, "dragon");
      } else {
        falls(
          world,
          boss,
          target,
          N.meteors.count,
          N.meteors.ring,
          N.meteors.radius,
          N.meteors.windup * tele,
          "dragon",
          "fire",
          N.meteors.poolLife,
          N.meteors.spacing,
        );
        enter(boss, "chase");
      }
      break;
    default:
      throw new Error(`Unregistered zone guardian: ${boss.species}`);
  }
  boss.attackTimer = turn;
  return true;
}

function release(world: World, boss: Enemy): void {
  const a = boss.action!;
  switch (a.attack) {
    case "shadow":
    case "gengar-shadow":
    case "lava-dive": {
      const mark = landingOf(world, boss);
      if (mark) {
        boss.x = boss.px = mark.x;
        boss.z = boss.pz = mark.z;
        landingHit(world, mark);
        if (a.attack === "lava-dive") {
          leavePool(world, { ...mark, dmg: boss.dmg, pool: "fire", poolLife: N.lavaDive.poolLife });
          if (lowHealth(boss)) burst(world, boss, Z.magmarBurst, "fire");
        }
      }
      break;
    }
    case "blink": {
      const mark = world.hazards.find((h) => h.kind === "teleport-mark" && h.caster === boss.id);
      if (mark) {
        boss.x = boss.px = mark.x;
        boss.z = boss.pz = mark.z;
        mark.life = 0;
      }
      break;
    }
    case "night-shade":
      shots(world, boss, N.nightShade.speed);
      break;
    case "shadow-ball":
      shots(world, boss, N.shadowBall.speed, 0, "poison");
      break;
    case "icicle-fan":
      shots(world, boss, N.icicleFan.speed, Z.slow);
      break;
    case "shadow-bones":
      for (const offset of a.chain === N.shadowBones.lowCount
        ? N.shadowBones.lowOffsets
        : N.shadowBones.offsets) {
        const angle = atan2(boss.dashZ, boss.dashX) + (offset * Math.PI) / 180;
        throwBone(world, boss, cos(angle), sin(angle), Z.bone, boss.dmg, true);
      }
      break;
    case "slide":
    case "extreme-speed":
      if (a.attack === "slide" || lowHealth(boss))
        addHazard(world, {
          kind: a.attack === "slide" ? "ice-trail" : "burning-trail",
          x: boss.x,
          y: heightAt(world.map.terrain, boss.x, boss.z),
          z: boss.z,
          radius: a.attack === "slide" ? N.slideTrail.radius : N.fireTrail.radius,
          life: a.active + (a.attack === "slide" ? N.slideTrail.life : N.fireTrail.life),
          dirX: boss.dashX,
          dirZ: boss.dashZ,
          length: 0,
          dmg: boss.dmg * Z.pool,
          caster: boss.id,
          element: a.attack === "slide" ? "ice" : "fire",
        });
      break;
  }
}

function complete(world: World, boss: Enemy, target: Player): void {
  const a = boss.action!,
    low = lowHealth(boss);
  if (a.attack === "sludge-slam") {
    const mark = landingOf(world, boss);
    if (mark) {
      landingHit(world, mark);
      leavePool(world, {
        ...mark,
        radius: N.sludgeSlam.poolRadius,
        dmg: boss.dmg,
        pool: "poison",
        poolLife: N.sludgeSlam.poolLife,
      });
    }
    if (low) burst(world, boss, Z.burstCount, "poison", Z.burstPoison);
  }
  if (a.chain > 0 && !attacksBlocked(boss)) {
    a.chain--;
    if (a.attack === "dive" || a.attack === "slide" || a.attack === "extreme-speed") {
      dash(world, boss, target, a.attack, true);
      return;
    }
    if (a.attack === "shadow" || a.attack === "gengar-shadow") {
      const remaining = a.chain;
      if (shadow(world, boss, target, a.attack, remaining)) {
        boss.action!.windup = Z.chain * telegraphScale(world);
        const mark = landingOf(world, boss);
        if (mark) mark.life = boss.action!.windup + 3 * TICK;
        return;
      }
    }
  }
  if (low && !attacksBlocked(boss)) {
    if (a.attack === "shadow" || a.attack === "gengar-shadow")
      burst(world, boss, Z.burstCount, "ghost");
    if (a.attack === "dive") burst(world, boss, Z.sonicBurst, "flying");
    if (a.attack === "slide")
      falls(
        world,
        boss,
        target,
        N.slideFalls.count,
        N.slideFalls.ring,
        N.slideFalls.radius,
        telegraphScale(world),
        "ice",
      );
    if (a.attack === "extreme-speed") {
      circle(world, boss, target, "fire-blast", N.fireBlast.radius, "fire");
      return;
    }
    if (a.attack === "bone-club") ghostFires(world, boss);
    if (a.attack === "blink") {
      psychicFan(world, boss, target);
      return;
    }
  }
  enter(boss, "recover");
}

export function zoneGuardianBrain(
  world: World,
  boss: Enemy,
  target: Player,
  speed: number,
  dt: number,
): [number, number, number] {
  const low = lowHealth(boss);
  if (
    boss.species === "muk" &&
    world.tick % TRAIL.guardianTicks === 0 &&
    (boss.phase === "chase" || boss.phase === "dash")
  )
    sludgeTrail(world, boss, true);
  if (boss.species === "lapras" && low) {
    // Keep one stable ring identity; the hazard owns its half-second damage cadence.
    const mist = world.hazards.find((h) => h.kind === "ice-mist" && h.caster === boss.id);
    if (mist) mist.life = N.mist.life + TICK;
    else
      addHazard(world, {
        kind: "ice-mist",
        x: boss.x,
        y: heightAt(world.map.terrain, boss.x, boss.z),
        z: boss.z,
        life: N.mist.life + TICK,
        radius: N.mist.radius,
        dmg: boss.dmg * N.mist.damage,
        slow: N.mist.slow,
        element: "ice",
        caster: boss.id,
      });
  }
  if (boss.foresight && !attacksBlocked(boss)) {
    boss.foresight.timer -= dt;
    if (boss.foresight.timer <= 0) {
      const point = predictTarget(world, boss, target, N.foresight.windup * telegraphScale(world));
      fallAt(
        world,
        boss,
        point.x,
        point.z,
        N.foresight.radius,
        N.foresight.windup * telegraphScale(world),
        "psychic",
      );
      boss.foresight.left--;
      boss.foresight.timer += N.foresight.gap;
      if (boss.foresight.left <= 0) delete boss.foresight;
    }
  }
  boss.phaseTime += dt;
  if (boss.phase === "chase") {
    if (
      boss.phaseTime > BOSS_CHASE_MIN &&
      !attacksBlocked(boss) &&
      hypot(target.x - boss.x, target.z - boss.z) < Z.range &&
      !bonesOut(world, boss)
    ) {
      if (!choose(world, boss, target)) boss.attackTimer = Math.round(boss.attackTimer) + 1;
      return [boss.dashX, boss.dashZ, 0];
    }
    return chase(world, boss, target, speed);
  }
  const a = boss.action!;
  if (boss.phase === "windup" || boss.phase === "under") {
    if (boss.phaseTime >= a.windup) {
      release(world, boss);
      enter(boss, "dash");
    }
    return [boss.dashX, boss.dashZ, 0];
  }
  if (boss.phase === "dash") {
    if (a.attack === "shadow-bones" && bonesOut(world, boss))
      return chase(world, boss, target, speed);
    if (a.attack === "slide" || a.attack === "extreme-speed") {
      const trail = world.hazards.findLast(
        (h) => h.caster === boss.id && (h.kind === "ice-trail" || h.kind === "burning-trail"),
      );
      if (trail) {
        trail.length = Math.max(
          trail.length,
          (boss.x - trail.x) * trail.dirX + (boss.z - trail.z) * trail.dirZ,
        );
        if (boss.phaseTime >= a.active) trail.caster = -1;
      }
    }
    if (boss.phaseTime >= a.active) {
      complete(world, boss, target);
      return [0, 0, 0];
    }
    if (a.attack === "sludge-slam") {
      const mark = landingOf(world, boss);
      if (mark) {
        const dx = mark.x - boss.x,
          dz = mark.z - boss.z,
          d = hypot(dx, dz);
        if (d > 0) return [dx / d, dz / d, d / Math.max(dt, a.active - boss.phaseTime)];
      }
    }
    return [boss.dashX, boss.dashZ, a.speed * (speed / boss.speed)];
  }
  if (boss.phaseTime >= a.recover) {
    enter(boss, "chase");
    delete boss.action;
  }
  return [0, 0, 0];
}
