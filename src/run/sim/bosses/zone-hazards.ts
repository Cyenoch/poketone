import { ENEMY_HAZARD } from "../content/params/enemy-skills";
import { ERUPTION, ZONE_ATTACK as N, ZONE_GUARDIAN as Z } from "../content/params/late-zones";
import { damagePlayer } from "../hurt";
import { formOf, hazardRadius } from "../evolution";
import { stopAtCover, coverHit, lineOfFire } from "../sight";
import { sustain } from "../status";
import { heightAt } from "../terrain";
import { HURT_TICKS } from "../content/params/environment";
import { TICK, type World } from "../state/world";
import type { Hazard, Player } from "../state/entities";
import { atan2, cos, sin, hypot } from "../math";
import { activeCaster, addHazard, chestOf, inPatch, type HazardRule } from "../skills/kit";
import { beamHits } from "../skills/psybeam";
import { range } from "../rng";
import { viewClearance } from "../viewFootprint";

/** Element and phase are data so the view draws exactly the damaging shape. */
function hit(world: World, hazard: Hazard, player: Player): boolean {
  if (!damagePlayer(world, player, hazard.dmg)) return false;
  if (hazard.slow) sustain(player, "slow", hazard.slow, -1);
  if (hazard.poison) sustain(player, "poison", hazard.poison, -1);
  return true;
}

function cancelled(world: World, h: Hazard): boolean {
  if (h.caster >= 0 && !activeCaster(world, h)) {
    h.life = 0;
    return true;
  }
  return false;
}

export function leavePool(world: World, h: Hazard): void {
  if (!h.pool) return;
  addHazard(world, {
    kind: h.pool === "fire" ? "burning-pool" : "acid-pool",
    x: h.x,
    y: heightAt(world.map.terrain, h.x, h.z),
    z: h.z,
    radius: h.poolRadius ?? h.radius,
    life: h.poolLife ?? Z.poolLife,
    dmg: h.dmg * Z.pool,
    element: h.pool === "fire" ? "fire" : "poison",
  });
}

/** Cone contains the player's body and stops at the same cover as a beam. */
export function inCone(world: World, h: Hazard, p: Player): boolean {
  if (!p.alive) return false;
  const dx = p.x - h.x,
    dz = p.z - h.z,
    d = hypot(dx, dz),
    r = hazardRadius(p);
  if (d > h.length + r || (d > r && (dx * h.dirX + dz * h.dirZ) / d < cos(h.angle!) - r / d))
    return false;
  return lineOfFire(world, h.x, h.y, h.z, p.x, chestOf(world, p), p.z);
}

/** Shared moving geometry is also exported for precise view-side reconstruction. */
export function boxHalf(h: Hazard): number {
  return h.length * Math.min(1, Math.max(0, h.life / h.active!));
}
export function orbitAngle(h: Hazard): number {
  return (h.duration! - h.life) * N.shell.angularSpeed;
}
export function sweepHeading(h: Hazard): number {
  const progress = Math.max(0, Math.min(1, 1 - h.life / h.active!));
  return atan2(h.dirZ, h.dirX) - h.angle! + 2 * h.angle! * progress;
}

const fall: HazardRule = {
  update(world, h) {
    if (h.dmg <= 0) return;
    if (cancelled(world, h) || h.life > Z.fallResidue) return;
    for (const p of world.players) if (inPatch(world, h, p, h.y)) hit(world, h, p);
    leavePool(world, h);
    h.dmg = 0;
  },
};

/** Count real telegraphs, excluding travelling shots and harmless residue. */
export function warningCount(world: World, player: Player): number {
  const view = { ...world, players: [player] };
  return world.hazards.filter((h) => {
    if (h.life <= 0 || (h.delay ?? 0) > 0) return false;
    if (viewClearance(view, h.x, h.z) > ERUPTION.viewMargin) return false;
    if (h.kind.endsWith("-warn")) return true;
    if (h.kind === "teleport-mark" || h.kind === "eruption") return false;
    if (h.active !== undefined) return h.life > h.active;
    if (
      ["landing", "rockfall", "crabhammer", "thunder-bolt", "boss-fall", "curse-mark"].includes(
        h.kind,
      )
    )
      return h.dmg > 0;
    return (
      [
        "psybeam",
        "vine",
        "ice-beam",
        "discharge",
        "discharge-wide",
        "discharge-quick",
        "self-destruct",
        "dragon-rage",
        "dragon-pulse",
        "sing",
        "sing-wide",
        "stomp",
        "hydro-pump",
        "fissure",
      ].includes(h.kind) && h.dmg > 0
    );
  }).length;
}

export const zoneHazards = {
  "boss-fall": fall,
  "boss-beam": {
    update(world, h) {
      if (h.life > h.active!) {
        cancelled(world, h);
        return;
      }
      for (const p of world.players) if (p.alive && beamHits(world, h, p)) hit(world, h, p);
    },
  },
  "boss-shot": {
    update(world, h) {
      if (stopAtCover(world, h) || h.life <= 0) {
        leavePool(world, h);
        return;
      }
      for (const p of world.players) {
        if (!p.alive || hypot(p.x - h.x, p.z - h.z) > h.radius + hazardRadius(p)) continue;
        const feet = heightAt(world.map.terrain, p.x, p.z);
        if (h.y < feet - h.radius || h.y > feet + formOf(p).height + h.radius) continue;
        if (hit(world, h, p)) {
          h.life = 0;
          leavePool(world, h);
          break;
        }
      }
    },
  },
  cone: {
    update(world, h) {
      if (h.dmg <= 0 || cancelled(world, h) || h.life > h.active!) return;
      for (const p of world.players) if (inCone(world, h, p)) hit(world, h, p);
      h.dmg = 0;
    },
  },
  "closing-box": {
    update(world, h) {
      if (cancelled(world, h) || h.life > h.active!) return;
      const half = boxHalf(h);
      for (const p of world.players) {
        if (
          !p.alive ||
          h.hit!.includes(p.id) ||
          Math.abs(heightAt(world.map.terrain, p.x, p.z) - h.y) > ENEMY_HAZARD.level
        )
          continue;
        const dx = p.x - h.x,
          dz = p.z - h.z,
          r = h.radius + hazardRadius(p);
        for (let side = 0; side < 4; side++) {
          const across = side % 2 === 0 ? dx : dz;
          const along = side % 2 === 0 ? dz : dx;
          const sign = side < 2 ? 1 : -1;
          if (Math.abs(across - sign * half) > r || Math.abs(along) > half + r) continue;
          if (side === h.gap && Math.abs(along) + hazardRadius(p) < N.cage.gapHalf) continue;
          if (hit(world, h, p)) h.hit!.push(p.id);
          break;
        }
      }
    },
  },
  orbit: {
    update(world, h) {
      const caster = activeCaster(world, h);
      if (!caster) {
        h.life = 0;
        return;
      }
      h.x = caster.x;
      h.z = caster.z;
      h.y = heightAt(world.map.terrain, h.x, h.z);
      for (let i = 0; i < N.shell.count; i++) {
        const angle = orbitAngle(h) + (i * Math.PI) / N.shell.spacingDivisor;
        const x = h.x + cos(angle) * h.length,
          z = h.z + sin(angle) * h.length;
        for (const p of world.players)
          if (
            p.alive &&
            hypot(p.x - x, p.z - z) <= h.radius + hazardRadius(p) &&
            Math.abs(heightAt(world.map.terrain, p.x, p.z) - h.y) <= ENEMY_HAZARD.level
          )
            hit(world, h, p);
      }
    },
  },
  "curse-mark": {
    update(world, h) {
      if (h.dmg <= 0 || cancelled(world, h)) return;
      if (h.life > h.active! + N.curse.residue) {
        const p = world.players.find((p) => p.id === h.target && p.alive);
        if (!p) {
          h.life = 0;
          return;
        }
        h.x = p.x;
        h.z = p.z;
        h.y = heightAt(world.map.terrain, p.x, p.z);
      }
      if (h.life > N.curse.residue) return;
      for (const p of world.players) if (inPatch(world, h, p, h.y)) hit(world, h, p);
      h.dmg = 0;
    },
  },
  sweep: {
    update(world, h) {
      if (h.life > h.active!) {
        cancelled(world, h);
        return;
      }
      const angle = sweepHeading(h),
        dx = cos(angle),
        dz = sin(angle);
      const beam = {
        ...h,
        dirX: dx,
        dirZ: dz,
        length: Math.min(h.length, coverHit(world, h.x, h.y, h.z, dx, dz, h.rise, h.length)),
      };
      for (const p of world.players)
        if (inCone(world, h, p) && beamHits(world, beam, p)) hit(world, h, p);
    },
  },
  "ice-trail": { update() {} },
  "ice-mist": {
    update(world, h) {
      const caster = activeCaster(world, h);
      if (!caster) {
        h.life = 0;
        return;
      }
      h.x = caster.x;
      h.z = caster.z;
      h.y = heightAt(world.map.terrain, h.x, h.z);
      if (world.tick % HURT_TICKS === 0)
        for (const p of world.players) if (inPatch(world, h, p, h.y)) hit(world, h, p);
    },
  },
  "burning-pool": {
    update(world, h) {
      if (world.tick % HURT_TICKS === 0)
        for (const p of world.players) if (inPatch(world, h, p, h.y)) hit(world, h, p);
    },
  },
  "ghost-fire": {
    update(world, h) {
      if (h.dmg <= 0) return;
      h.y = heightAt(world.map.terrain, h.x, h.z);
      let target: Player | undefined,
        best = Infinity;
      for (const p of world.players)
        if (p.alive) {
          const d = hypot(p.x - h.x, p.z - h.z);
          if (d < best) {
            target = p;
            best = d;
          }
        }
      h.vx = target && best > 0 ? ((target.x - h.x) / best) * N.ghostFire.speed : 0;
      h.vz = target && best > 0 ? ((target.z - h.z) / best) * N.ghostFire.speed : 0;
      if (h.duration! - h.life < N.ghostFire.arm) return;
      for (const p of world.players)
        if (inPatch(world, h, p, h.y) && hit(world, h, p)) {
          h.life = 0;
          break;
        }
    },
  },
  eruption: {
    update(world, h) {
      const age = h.duration! - h.life;
      if (age < h.length || h.length >= ERUPTION.duration) return;
      h.length += ERUPTION.every;
      // Rotate first choice when views overlap; distant players have separate warning budgets.
      for (let i = 0; i < world.players.length; i++) {
        const p = world.players[(i + h.length - 1) % world.players.length]!;
        if (!p.alive || warningCount(world, p) >= ERUPTION.warnings) continue;
        if (
          world.hazards.filter(
            (a) => a.kind === "boss-fall" && a.caster === -1 && a.target === p.id && a.dmg > 0,
          ).length >= ERUPTION.fallsPerPlayer
        )
          continue;
        const angle = range(world.rng, 0, Math.PI * 2),
          distance = range(world.rng, ...ERUPTION.ring);
        const x = p.x + cos(angle) * distance,
          z = p.z + sin(angle) * distance;
        addHazard(world, {
          kind: "boss-fall",
          x,
          y: heightAt(world.map.terrain, x, z),
          z,
          life: ERUPTION.windup + ERUPTION.active + TICK,
          duration: ERUPTION.windup + ERUPTION.active,
          active: ERUPTION.active,
          radius: ERUPTION.radius,
          dmg: ERUPTION.dmg,
          element: "fire",
          pool: "fire",
          poolLife: ERUPTION.poolLife,
          poolRadius: ERUPTION.pool,
          target: p.id,
        });
      }
    },
  },
} satisfies Record<string, HazardRule>;
