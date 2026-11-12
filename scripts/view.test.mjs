import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  PerspectiveCamera,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import { acquire } from "../src/run/sim/archetypes/kit.ts";
import { fireBeat } from "../src/run/sim/beats.ts";
import {
  spawnEnemy,
  spawnReachable,
  summonGuardian,
  updateDirector,
} from "../src/run/sim/director.ts";
import { stageDefs } from "../src/run/sim/content/stages/index.ts";
import { heightAt } from "../src/run/sim/terrain.ts";
import { createWorld } from "../src/run/sim/world.ts";
import { canReach, refreshFlowFields, requestFlowField } from "../src/run/sim/nav/index.ts";
import { cellCenterX, cellCenterZ } from "../src/run/sim/nav/grid.ts";
import { layerFor } from "../src/run/sim/nav/nav.ts";
import { SHEER, WALKABLE } from "../src/run/sim/nav/walkable.ts";
import { enemies } from "../src/run/sim/content/enemies.ts";
import { viewClearance } from "../src/run/sim/viewFootprint.ts";
import { mountRig } from "../src/run/view/playerRig.ts";
import { createWindUniforms } from "../src/run/view/environment/wind.ts";
import { stageThemes } from "../src/run/view/stageThemes.ts";
import { advanceGait } from "../src/run/view/enemyMotion.ts";
import { SnapshotBuffer } from "../src/network/interpolation.ts";

test("敌人步态在 30 Hz 模拟 / 20 Hz 快照速度变化时连续，暂停不改变姿态", () => {
  const buffer = new SnapshotBuffer();
  // A constant-speed enemy advances alternately one and two sim ticks per wire frame.
  for (let frame = 0; frame <= 20; frame++)
    buffer.push(frame / 20, [{ id: 1, x: Math.floor(frame * 1.5) / 30, z: 0 }]);
  let phase = 1.7;
  for (let i = 0; i < 60 * 600; i++) phase = advanceGait(phase, 1, 1, 1 / 60);
  const speeds = new Set();
  for (let i = 1; i < 60; i++) {
    const enemy = buffer.sample(i / 60)[0];
    const speed = Math.hypot(enemy.x - enemy.px, enemy.z - enemy.pz) * 30;
    speeds.add(speed.toFixed(2));
    const next = advanceGait(phase, speed, 1, 1 / 60);
    const distance = Math.atan2(Math.sin(next - phase), Math.cos(next - phase));
    assert(distance > 0 && distance < 0.13, `步态必须逐帧前进而非跳相位: ${distance}`);
    assert.equal(advanceGait(next, speed * 2, 1, 0), next, "冻结时速度改变也不能跳姿态");
    phase = next;
  }
  assert(speeds.size > 1, "覆盖实际快照节奏造成的速度波动");
});

function mountFootFixture(t) {
  const avatar = new Group();
  const holder = new Group();
  const root = new Group();
  holder.add(root);
  const bones = ["LeftFoot", "RightToe", "Tail", "Shell"].map((name) => {
    const bone = new Bone();
    bone.name = name;
    return bone;
  });
  const positions = [];
  const indices = [];
  const weights = [];
  // Each triangle is a surface patch; tail and shell retain minor foot/toe influences.
  for (const [x, y, skinIndices, skinWeights] of [
    [-1, 0, [3, 0, 0, 0], [0.25, 0.75, 0, 0]],
    [1, 0.25, [1, 0, 0, 0], [1, 0, 0, 0]],
    [0, -3, [0, 2, 0, 0], [0.25, 0.75, 0, 0]],
    [0, -2, [3, 1, 0, 0], [0.75, 0.25, 0, 0]],
  ]) {
    positions.push(x, y, 0, x + 0.2, y + 0.2, 0, x, y + 0.1, 0.2);
    for (let vertex = 0; vertex < 3; vertex++) {
      indices.push(...skinIndices);
      weights.push(...skinWeights);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  const material = new MeshStandardMaterial();
  const mesh = new SkinnedMesh(geometry, material);
  root.add(mesh);
  mesh.add(...bones);
  const skeleton = new Skeleton(bones);
  mesh.bind(skeleton);
  // Model normalization belongs in the returned avatar-local height.
  holder.position.y = 0.5;
  holder.scale.setScalar(2);
  root.position.y = 0.25;
  const player = {
    form: "charmander",
    holder,
    model: {
      root,
      animations: [
        new AnimationClip("idle", 2, [
          new NumberKeyframeTrack("LeftFoot.position[y]", [0, 1], [0, 0]),
          new NumberKeyframeTrack("RightToe.position[y]", [0, 1], [0, 0]),
        ]),
        new AnimationClip("run", 2, [
          new NumberKeyframeTrack("LeftFoot.position[y]", [0, 1], [0, 1]),
          new NumberKeyframeTrack("RightToe.position[y]", [0, 1], [0, -1]),
        ]),
      ],
    },
    tail: [],
  };
  const rig = mountRig(avatar, player, createWindUniforms(stageThemes.forest.clouds));
  avatar.updateMatrixWorld(true);
  t.after(() => {
    rig.unmount();
    skeleton.dispose();
    geometry.dispose();
    material.dispose();
  });
  return { rig, avatar, bones };
}

test("foot floor follows the skinned surface as run and idle poses mix", (t) => {
  const { rig } = mountFootFixture(t);
  rig.idle.setEffectiveWeight(0);
  rig.run.setEffectiveWeight(1);
  rig.mixer.update(0);
  assert.equal(rig.footFloor(), 1, "the foot starts below the toe");
  rig.mixer.update(0.5);
  assert.equal(rig.footFloor(), 0.5, "the animated toe becomes the lowest surface");
  rig.idle.setEffectiveWeight(0.5);
  rig.run.setEffectiveWeight(0.5);
  rig.mixer.update(0);
  assert.equal(rig.footFloor(), 1, "idle/run blending changes the contact height");
  rig.mixer.update(0.25);
  assert.equal(rig.footFloor(), 0.75, "the blended pose keeps following animation time");
});

for (const [label, transform] of [
  ["translation", (avatar) => avatar.position.set(12, -7, 4)],
  ["rotation", (avatar) => avatar.rotation.set(0.4, 1.2, -0.6)],
  ["scale", (avatar) => avatar.scale.set(0.5, 3, 2)],
]) {
  test(`foot floor stays in avatar space after world ${String(label)}`, (t) => {
    const { rig, avatar } = mountFootFixture(t);
    rig.idle.setEffectiveWeight(0);
    rig.run.setEffectiveWeight(1);
    rig.mixer.update(0.5);
    const floor = rig.footFloor();
    transform(avatar);
    const actual = rig.footFloor();
    assert.ok(
      Math.abs(actual - floor) < 1e-6,
      `avatar world transforms changed the local foot floor from ${floor} to ${actual}`,
    );
  });
}

test("low tail and shell surfaces with minor foot weights do not set the foot floor", (t) => {
  const { rig, bones } = mountFootFixture(t);
  assert.equal(rig.footFloor(), 1);
  bones[2].position.y = -10;
  bones[3].position.y = -2;
  // The shell also carries a quarter of the foot's weight: its motion lowers the sole.
  assert.equal(rig.footFloor(), 0, "measure the deformed sole, excluding lower body patches");
  bones[1].position.y = -1;
  assert.equal(rig.footFloor(), -0.5, "a toe below the sole still determines contact");
});

test("unmounting a moving tail restores its rest pose before the same model mounts in another zone", () => {
  const holder = new Group();
  const root = new Group();
  holder.add(root);
  const tail = [new Bone(), new Bone(), new Bone()];
  root.add(tail[0]);
  tail[0].add(tail[1]);
  tail[1].add(tail[2]);
  // Rest rotations need not be identity, especially where the tail joins the body.
  tail.forEach((bone, i) => bone.rotation.set(0.2 * (i + 1), -0.1 * i, 0.15));
  const pose = () => tail.map((bone) => bone.quaternion.toArray());
  const rest = pose();
  const player = {
    form: "charmander",
    holder,
    model: {
      root,
      animations: [new AnimationClip("run", 1, []), new AnimationClip("idle", 1, [])],
    },
    tail,
  };
  const wind = createWindUniforms(stageThemes.forest.clouds);
  const firstMotion = [];
  for (let zone = 0; zone < 3; zone++) {
    const avatar = new Group();
    const rig = mountRig(avatar, player, wind);
    try {
      assert.equal(holder.parent, avatar);
      rig.mixer.update(1 / 60);
      rig.tail.update(1 / 60, 0, 0, 0, 0);
      assert.deepEqual(pose(), rest, `zone ${zone}: stationary tail starts at the original rest`);
      for (let frame = 0; frame < 60; frame++) {
        rig.mixer.update(1 / 60);
        rig.tail.update(1 / 60, 0.06, 4, 1, frame / 30);
        if (zone === 0) firstMotion.push(pose());
        else assert.deepEqual(pose(), firstMotion[frame], `zone ${zone}, frame ${frame}: no drift`);
      }
      assert.notDeepEqual(pose(), rest, "unmount while the tail is still deflected");
    } finally {
      rig.unmount();
    }
    assert.equal(holder.parent, null);
    assert.deepEqual(pose(), rest, `zone ${zone}: unmount restores every tail bone`);
  }
});

/** The run camera of src/run/view/createRunView.ts, built with three as the view builds it. */
const CAMERA = { height: 16, back: 13, lookUp: 0.6, fov: 42 };
const PHONE = 844 / 390;

/** Whether three draws the world point (x, y, z) inside `player`'s phone-landscape screen. */
function drawnOnPhone(world, player, x, y, z) {
  const camera = new PerspectiveCamera(CAMERA.fov, PHONE, 0.5, 120);
  const ground = heightAt(world.map.terrain, player.x, player.z);
  camera.position.set(
    player.x + Math.sin(player.viewYaw) * CAMERA.back,
    ground + CAMERA.height,
    player.z + Math.cos(player.viewYaw) * CAMERA.back,
  );
  camera.lookAt(player.x, ground + CAMERA.lookUp, player.z);
  camera.updateMatrixWorld();
  const p = new Vector3(x, y, z).project(camera);
  return p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
}

function offEveryScreen(world, enemies, what) {
  assert.ok(enemies.length > 0, `${what}: nothing spawned`);
  for (const enemy of enemies) {
    const feet = heightAt(world.map.terrain, enemy.x, enemy.z);
    for (const player of world.players)
      for (const y of [feet, feet + 1])
        assert.ok(
          !drawnOnPhone(world, player, enemy.x, y, enemy.z),
          `${what}: ${enemy.species} at (${enemy.x.toFixed(1)}, ${enemy.z.toFixed(1)}) is on player ${player.id}'s screen`,
        );
  }
}

const stage = stageDefs.forest;
const swarm = stage.zones[0].beats.find(([, beat]) => beat.kind === "swarm")[1];

for (const [label, players, place] of [
  ["solo", [{ starter: "squirtle" }], () => {}],
  [
    "co-op, players apart and turned",
    [{ starter: "squirtle" }, { starter: "charmander" }],
    (world) => {
      world.players[0].viewYaw = 2.2;
      world.players[1].x = 14;
      world.players[1].z = -9;
      world.players[1].viewYaw = -0.9;
    },
  ],
]) {
  test(`${/** @type {string} */ (label)}: ring spawns, a surround beat and the guardian appear off every player's screen`, () => {
    for (const seed of [3, 11, 29]) {
      const world = createWorld({ stage: "forest", seed, difficulty: 1, players });
      place(world);
      const spawned = (run) => {
        const before = world.enemies.length;
        run();
        return world.enemies.slice(before);
      };
      // Ring spawns, with every beat already rung so only the credit loop runs.
      world.spawn.fired.push(...stage.zones[0].beats.map(([at, beat]) => `${beat.kind}@${at}`));
      // The director ticks the zone clock first: this call runs at 60 s.
      world.zone.tick = 60 * 30 - 1;
      world.spawn.credit = 6;
      offEveryScreen(
        world,
        spawned(() => updateDirector(world, 0)),
        `seed ${seed} ring`,
      );

      offEveryScreen(
        world,
        spawned(() => fireBeat(world, swarm, world.players[0])),
        `seed ${seed} swarm`,
      );

      // A guardian nobody summoned comes on its own with the final swarm.
      world.spawn.credit = 0;
      world.zone.tick = stage.duration * 30 - 1;
      const guardian = spawned(() => updateDirector(world, 0)).filter((enemy) => enemy.boss);
      assert.equal(guardian.length, 1, `seed ${seed}: one guardian`);
      offEveryScreen(world, guardian, `seed ${seed} guardian`);
    }
  });
}

test("a spawn aimed past the arena wall behind a player at the wall still lands off screen when the arena has room", () => {
  const world = createWorld({
    stage: "forest",
    seed: 3,
    difficulty: 0,
    players: [{ starter: "squirtle" }],
  });
  const player = world.players[0];
  player.x = 0;
  player.z = 40;
  player.viewYaw = 0;
  // Its own ray only has on-screen ground, but (0, 5) is reachable and off screen.
  assert.ok(viewClearance(world, 0, 5) > 1);
  const enemy = spawnReachable(world, "zubat", player, 0, 43);
  assert.ok(enemy);
  assert.ok(viewClearance(world, enemy.x, enemy.z) > 1);
  offEveryScreen(world, [enemy], "wall spawn");
});

test("a player standing on ground walkers call wall still draws spawns and the guardian", () => {
  // Forest seed 21 put a player on such a cell by the north wall: every ground spawn was skipped
  // and the guardian's spawn threw.
  const world = createWorld({
    stage: "forest",
    seed: 21,
    difficulty: 2,
    players: [{ starter: "squirtle" }],
  });
  const { grid } = world.nav;
  const ground = enemies.scyther.mobility;
  const layer = layerFor(world.nav, ground);
  // A playable wall cell beside walkable ground (the padding ring round the arena is wall too).
  const playable = (cell) => {
    const gx = (cell % grid.stride) - 1;
    const gz = Math.floor(cell / grid.stride) - 1;
    return gx >= 0 && gz >= 0 && gx < grid.size && gz < grid.size;
  };
  const wall = layer.kinds.findIndex(
    (kind, cell) =>
      kind === SHEER &&
      playable(cell) &&
      grid.offset
        .slice(0, 4)
        .some((o) => layer.kinds[cell + o] === WALKABLE && layer.homeward[cell + o]),
  );
  const player = world.players[0];
  player.x = cellCenterX(grid, wall);
  player.z = cellCenterZ(grid, wall);
  // Living ground enemies ask for their field every tick; this one asks once.
  requestFlowField(world.nav, ground);
  refreshFlowFields(world.nav, world.players, Infinity);
  let reachable = 0;
  for (let z = -40; z <= 40; z += 4)
    for (let x = -40; x <= 40; x += 4) if (canReach(world.nav, ground, x, z)) reachable++;
  assert.ok(
    reachable > 21 * 21 * 0.5,
    `ground walkers reach ${reachable} of ${21 * 21} sample points`,
  );

  summonGuardian(world, null);
  assert.ok(world.enemies.some((enemy) => enemy.boss));
});

test("a bolt starter does not auto-aim at an enemy below the screen's bottom edge, and does once the camera turns to it", () => {
  const world = createWorld({
    stage: "forest",
    seed: 5,
    difficulty: 0,
    players: [{ starter: "charmander" }],
  });
  world.spawn.credit = -Infinity;
  const player = world.players[0];
  // Yaw 0: the camera sits at +z, so +z is the bottom of the screen.
  const below = spawnEnemy(world, "caterpie", player.x, player.z + 10);
  assert.deepEqual(acquire(world, player, 1), []);
  player.viewYaw = Math.PI;
  assert.deepEqual(acquire(world, player, 1), [below]);
});
