// Camera yaw convention, shared by the view, input, minimap and compass. The camera orbits behind the
// player at (sin yaw, cos yaw) · back, so on the ground plane it looks along `cameraForward(yaw)`.

/** Radians per second a held turn input rotates the view. */
const TURN_SPEED = 2.4;

/** Where the camera looks, on the ground plane (unit). */
export function cameraForward(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** Screen right, on the ground plane (unit). */
export function cameraRight(yaw: number): [number, number] {
  return [Math.cos(yaw), -Math.sin(yaw)];
}

/** `turn` +1 turns the view right (E, the right button), −1 left (Q, the left button). */
export function turnYaw(yaw: number, turn: number, dt: number): number {
  return yaw - turn * TURN_SPEED * dt;
}
