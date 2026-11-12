// What a player's camera shows, for the sim. The sim never reads the camera: it reproduces the run
// camera of src/run/view/createRunView.ts from these literals and the player's `viewYaw` (sent as a
// `view` command when Q/E turn it; src/run/cameraYaw.ts convention). Change them with that camera.
// Only + − × ÷ and sim/math trig, so every engine agrees.
import { heightAt } from "./terrain";
import { cos, sin } from "./math";
import type { World } from "./state/world";
import type { Player } from "./state/entities";

/** createRunView.ts: CAMERA_HEIGHT above and CAMERA_BACK behind the player, looking at the player + LOOK_UP. */
const CAMERA_HEIGHT = 16;
const CAMERA_BACK = 13;
const LOOK_UP = 0.6;
/** tan(½ × the PerspectiveCamera's vertical FOV of 42°). */
const TAN_HALF_FOV = 0.383864035035416;

/**
 * Screen aspects. Spawning must be off the WIDEST supported view (phone landscape 844×390), auto-aim
 * must stay inside the NARROWEST (desktop 1280×800): every player sees the spawn rule hold and every
 * player sees what they shoot at.
 */
const WIDEST = 844 / 390;
const NARROWEST = 1280 / 800;

/** A spawn's feet and its top (u above them) both stay off screen, by this fraction of the half-screen
 *  more (camera lag behind a running player, shake). */
const BODY_TOP = 2;
const SPAWN_OUTSET = 0.12;

// Camera axes in the player's view frame (a: screen right, y: up, b: ground forward), camera at
// (0, CAMERA_HEIGHT, −CAMERA_BACK): `F` the look direction, `U` screen up, both unit.
const LOOK_LENGTH = Math.sqrt((CAMERA_HEIGHT - LOOK_UP) ** 2 + CAMERA_BACK ** 2);
const F_Y = (LOOK_UP - CAMERA_HEIGHT) / LOOK_LENGTH;
const F_B = CAMERA_BACK / LOOK_LENGTH;
const U_Y = CAMERA_BACK / LOOK_LENGTH;
const U_B = (CAMERA_HEIGHT - LOOK_UP) / LOOK_LENGTH;

/**
 * How far from the screen centre the point (x, z) at `rise` above the player's ground lands on that
 * player's screen of `aspect`, as the larger of |x| and |y| in normalised device units: ≤ 1 is on
 * screen. Behind the camera is Infinity.
 */
function screenReach(player: Player, x: number, z: number, rise: number, aspect: number): number {
  const dx = x - player.x;
  const dz = z - player.z;
  const c = cos(player.viewYaw);
  const s = sin(player.viewYaw);
  // cameraRight(yaw) = (cos, −sin), cameraForward(yaw) = (−sin, −cos).
  const a = dx * c - dz * s;
  const b = -dx * s - dz * c;
  const y = rise - CAMERA_HEIGHT;
  const depth = y * F_Y + (b + CAMERA_BACK) * F_B;
  if (depth <= 0) return Infinity;
  const up = y * U_Y + (b + CAMERA_BACK) * U_B;
  return Math.max(
    Math.abs(a / (depth * TAN_HALF_FOV * aspect)),
    Math.abs(up / (depth * TAN_HALF_FOV)),
  );
}

/**
 * Whether ground point (x, z) is on `player`'s screen at the narrowest supported aspect, at least
 * `inset` (fraction of the half-screen) in from every edge. Auto-aim keeps to this.
 */
export function onScreen(
  world: World,
  player: Player,
  x: number,
  z: number,
  inset: number,
): boolean {
  const rise = heightAt(world.map.terrain, x, z) - heightAt(world.map.terrain, player.x, player.z);
  return screenReach(player, x, z, rise, NARROWEST) <= 1 - inset;
}

/**
 * How far off every player's screen (widest aspect) a body standing at (x, z) is: above 1 is off all
 * of them with the spawn margin, and higher is less visible. Downed players count: their camera
 * still shows the field.
 */
export function viewClearance(world: World, x: number, z: number): number {
  const ground = heightAt(world.map.terrain, x, z);
  let least = Infinity;
  for (const player of world.players) {
    const rise = ground - heightAt(world.map.terrain, player.x, player.z);
    const feet = screenReach(player, x, z, rise, WIDEST);
    const top = screenReach(player, x, z, rise + BODY_TOP, WIDEST);
    least = Math.min(least, feet, top);
  }
  return least / (1 + SPAWN_OUTSET);
}
