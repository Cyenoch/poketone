import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { cameraRight } from "../cameraYaw";
import { formOf } from "../sim/evolution";
import type { Player } from "../sim/state/entities";
import { typeColors } from "../../ui/gpu/run-theme";

/** The opening's length: throw, landing, opening, release and settle. */
export const DEPLOYMENT_MS = 3000;
/** Beats (s): the throw leaves after the trainer's line has landed; the ball opens on the ground. */
const THROW = 0.6;
const FLIGHT = 0.7;
const LAND = THROW + FLIGHT;
const OPEN = 1.72;
const SPARKS = 8;
const R = 0.34;

const clamp = (t: number) => Math.max(0, Math.min(1, t));
const span = (t: number, start: number, length: number) => clamp((t - start) / length);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
/** Overshoots to ~1.1 and settles: the partner pops out of the light. */
const backOut = (t: number) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

interface Throw {
  player: Player;
  body: Group;
  ball: Group;
  lid: Group;
  ring: Mesh;
  core: Mesh;
  column: Mesh;
  sparks: Mesh[];
  heading: number[];
  light: MeshBasicMaterial;
  glow: MeshBasicMaterial;
}

/**
 * Each player's opening (spec 新局投球释放): a low-poly ball thrown in an arc from the trainer's side
 * of the screen, a landing bounce and wobble, the lid opening into a white core flash, a column and
 * ground ring in the partner's type colour, sparks, and the partner popping out as the ball shrinks
 * away. Its clock is the run's opening clock; nothing here enters the simulation.
 */
export class Deployment {
  readonly root = new Group();
  private readonly lidGeometry = new SphereGeometry(R, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly baseGeometry = new SphereGeometry(
    R,
    14,
    7,
    0,
    Math.PI * 2,
    Math.PI / 2,
    Math.PI / 2,
  );
  private readonly beltGeometry = new TorusGeometry(R, 0.035, 5, 20);
  private readonly buttonGeometry = new CylinderGeometry(0.1, 0.1, 0.06, 12);
  private readonly ringGeometry = new RingGeometry(0.82, 1, 40);
  private readonly coreGeometry = new SphereGeometry(1, 14, 8);
  private readonly columnGeometry = new CylinderGeometry(0.5, 0.75, 1, 18, 1, true);
  private readonly sparkGeometry = new OctahedronGeometry(0.09);
  private readonly red = new MeshStandardMaterial({
    color: "#e8392c",
    roughness: 0.55,
    flatShading: true,
  });
  private readonly white = new MeshStandardMaterial({
    color: "#fafafa",
    roughness: 0.6,
    flatShading: true,
  });
  private readonly ink = new MeshStandardMaterial({
    color: "#16161d",
    roughness: 0.7,
    flatShading: true,
  });
  private readonly throws: Throw[] = [];
  elapsed: number | null = null;
  private readonly ground: (x: number, z: number) => number;

  constructor(
    bodies: readonly { player: Player; group: Group }[],
    ground: (x: number, z: number) => number,
  ) {
    this.ground = ground;
    this.root.visible = false;
    for (const { player, group: body } of bodies) {
      const ball = new Group();
      ball.rotation.order = "YXZ";
      const lid = new Group();
      lid.position.z = -R;
      const top = new Mesh(this.lidGeometry, this.red);
      top.position.z = R;
      lid.add(top);
      const base = new Mesh(this.baseGeometry, this.white);
      const belt = new Mesh(this.beltGeometry, this.ink);
      belt.rotation.x = Math.PI / 2;
      const rim = new Mesh(this.buttonGeometry, this.ink);
      rim.rotation.x = Math.PI / 2;
      rim.position.z = R - 0.005;
      rim.scale.set(1.35, 1, 1.35);
      const button = new Mesh(this.buttonGeometry, this.white);
      button.rotation.x = Math.PI / 2;
      button.position.z = R + 0.02;
      button.scale.set(0.7, 1, 0.7);
      ball.add(lid, base, belt, rim, button);
      const tint = typeColors[formOf(player).types[0]!];
      const light = new MeshBasicMaterial({
        color: tint.type,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const glow = new MeshBasicMaterial({
        color: "#ffffff",
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const ring = new Mesh(this.ringGeometry, light);
      ring.rotation.x = -Math.PI / 2;
      const core = new Mesh(this.coreGeometry, glow);
      const column = new Mesh(this.columnGeometry, light);
      const sparks: Mesh[] = [];
      const heading: number[] = [];
      for (let i = 0; i < SPARKS; i++) {
        const spark = new Mesh(this.sparkGeometry, i % 2 ? light : glow);
        sparks.push(spark);
        heading.push(((i + 0.5) / SPARKS) * Math.PI * 2 + (i % 3) * 0.3);
      }
      this.root.add(ball, ring, core, column, ...sparks);
      this.throws.push({
        player,
        body,
        ball,
        lid,
        ring,
        core,
        column,
        sparks,
        heading,
        light,
        glow,
      });
    }
  }

  /** `yaw`: the camera's, so the ball comes from the screen's lower left and faces the camera. */
  frame(yaw: number): void {
    this.root.visible = this.elapsed !== null;
    if (this.elapsed === null) return;
    const [rx, rz] = cameraRight(yaw);
    const [bx, bz] = [Math.sin(yaw), Math.cos(yaw)];
    for (const [index, parts] of this.throws.entries()) {
      const { player, body, ball, lid, ring, core, column, sparks, heading, light, glow } = parts;
      // Teammates' balls land a beat apart, so four do not open as one flash.
      const t = this.elapsed / 1000 - index * 0.09;
      const y = this.ground(player.x, player.z);
      // Throw: from 4 m right-of-camera-left and 5 m toward the camera, an arc 2.6 m high.
      const flight = span(t, THROW, FLIGHT);
      const along = easeOut(flight * 0.35 + flight * 0.65 * flight);
      const fromX = player.x - rx * 4 + bx * 5;
      const fromZ = player.z - rz * 4 + bz * 5;
      // After landing: one short bounce, then two wobbles.
      const bounce = span(t, LAND, 0.26);
      const lift =
        flight < 1
          ? 1.2 * (1 - along) + Math.sin(along * Math.PI) * 2.6
          : Math.sin(bounce * Math.PI) * 0.28;
      ball.visible = t >= THROW && t < OPEN + 0.62;
      ball.position.set(
        fromX + (player.x - fromX) * along,
        y + R + lift,
        fromZ + (player.z - fromZ) * along,
      );
      const wobble = span(t, LAND + 0.26, OPEN - LAND - 0.26);
      ball.rotation.set(
        flight < 1 ? -flight * Math.PI * 6 - 0.55 : -0.55,
        yaw,
        flight < 1 ? 0 : Math.sin(wobble * Math.PI * 2) * 0.35 * (1 - wobble),
      );
      // Open: the lid swings back fast; then the empty ball shrinks away.
      const opening = easeOut(span(t, OPEN, 0.16));
      lid.rotation.x = -opening * 1.9;
      ball.scale.setScalar(1 - easeOut(span(t, OPEN + 0.3, 0.32)));
      // Release: a white core peaks in two frames and shrinks; the column rises and thins; the
      // ground ring spreads and erodes.
      const burst = span(t, OPEN, 0.55);
      const lit = t >= OPEN && burst < 1;
      core.visible = lit;
      core.position.set(player.x, y + 0.7, player.z);
      core.scale.setScalar(
        0.2 + 0.7 * easeOut(span(t, OPEN, 0.07)) * (1 - easeOut(span(t, OPEN + 0.07, 0.4))),
      );
      glow.opacity = 0.8 * (1 - burst) ** 2;
      column.visible = t >= OPEN && t < OPEN + 0.75;
      const rise = span(t, OPEN, 0.75);
      column.position.set(player.x, y + 1.3 * easeOut(rise) * 0.9 + 0.1, player.z);
      column.scale.set(1 - 0.75 * rise, 0.4 + 2.2 * easeOut(rise), 1 - 0.75 * rise);
      light.opacity = 0.75 * (1 - rise) ** 1.5;
      const spread = span(t, OPEN + 0.02, 0.5);
      ring.visible = t >= OPEN && spread < 1;
      ring.position.set(player.x, y + 0.06, player.z);
      ring.scale.setScalar(0.4 + 1.4 * easeOut(spread));
      // Sparks fly out and up, fall and shrink out.
      const fly = span(t, OPEN + 0.04, 0.8);
      for (const [i, spark] of sparks.entries()) {
        spark.visible = t >= OPEN && fly < 1;
        const d = (0.7 + (i % 3) * 0.25) * easeOut(fly);
        spark.position.set(
          player.x + Math.cos(heading[i]!) * d,
          y + 0.6 + 1.6 * fly - 2.2 * fly * fly + (i % 2) * 0.3,
          player.z + Math.sin(heading[i]!) * d,
        );
        spark.scale.setScalar(1 - fly);
        spark.rotation.y = fly * 6 + i;
      }
      // The partner: hidden until the light opens, then pops past full size and settles.
      const reveal = span(t, OPEN + 0.05, 0.42);
      body.visible = reveal > 0;
      body.scale.multiplyScalar(reveal >= 1 ? 1 : Math.max(0.001, backOut(reveal)));
    }
  }

  dispose(): void {
    for (const geometry of [
      this.lidGeometry,
      this.baseGeometry,
      this.beltGeometry,
      this.buttonGeometry,
      this.ringGeometry,
      this.coreGeometry,
      this.columnGeometry,
      this.sparkGeometry,
    ])
      geometry.dispose();
    for (const material of [
      this.red,
      this.white,
      this.ink,
      ...this.throws.flatMap((one) => [one.light, one.glow]),
    ])
      material.dispose();
    this.root.removeFromParent();
  }
}
