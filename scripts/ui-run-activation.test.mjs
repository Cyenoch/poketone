import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const reactionPositions = [
  ["steam", 4, -3],
  ["shock", -7, 8],
  ["wildfire", 13, 5],
];

// Keep the real createRun and simulation. Only drawing/assets are substituted in a child process.
const fixture = process.argv.find((arg) =>
  ["--activation-fixture", "--reaction-fixture", "--hurt-fixture", "--notice-fixture"].includes(
    arg,
  ),
);
if (!fixture) {
  test("real run activation follows persistence and cannot outlive cancellation", () => {
    const child = spawnSync(process.execPath, [import.meta.filename, "--activation-fixture"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
  test("real reactions submit world text, audio and VFX after target death beside global messages", () => {
    const child = spawnSync(process.execPath, [import.meta.filename, "--reaction-fixture"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
  test("repeated damage keeps feedback and normal simulation pacing without replacing other beats", () => {
    const child = spawnSync(process.execPath, [import.meta.filename, "--hurt-fixture"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
  test("real reward and danger events reach the local notice, sound and world consumers by ownership", () => {
    const child = spawnSync(process.execPath, [import.meta.filename, "--notice-fixture"], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
  test("world combat text uses both font pages and follows projection, expiry and cleanup", async () => {
    const f = await combatTextFixture();
    try {
      for (const [reaction, x, z] of reactionPositions) f.numbers.spawnReaction(x, z, reaction);
      f.numbers.spawn(15, -8, 42, false, false);
      let cameraX = 0;
      const project = (x, y, z) => [400 + x * 10 - cameraX, 300 - y * 10 - z * 10];
      f.numbers.update(0, project);
      assertReactionPositions(f.numbers);
      const anchor = f.numbers.geometry.attributes.numberAnchor;
      assert.equal(anchor.getX(drawnGlyph(f.numbers, "4")), 150, "damage keeps its own position");
      cameraX = 45;
      f.numbers.update(0.1, project);
      assert.equal(anchor.getX(drawnGlyph(f.numbers, "蒸")), 4 * 10 - cameraX);
      cameraX = 2000;
      f.numbers.update(0, project);
      assert.equal(f.numbers.geometry.instanceCount, 0, "offscreen text frees the shared pool");
      cameraX = 0;
      f.numbers.spawnReaction(4, 3, "steam");
      f.numbers.update(0, () => null);
      assert.equal(f.numbers.geometry.instanceCount, 0, "unprojectable feedback is reclaimed");
      f.numbers.update(0, project);
      assert.equal(f.numbers.geometry.instanceCount, 0, "reclaimed text cannot reappear");
      f.numbers.spawnReaction(-2, 9, "wildfire");
      f.numbers.spawnEvade(0, 0);
      f.numbers.update(0, project);
      assert.equal(anchor.getX(drawnGlyph(f.numbers, "蔓")), -20 - cameraX);
      assert.equal(
        anchor.getX(drawnGlyph(f.numbers, "闪")),
        0 - cameraX,
        "evade stays on the player",
      );
      f.numbers.update(2, project);
      assert.equal(f.numbers.geometry.instanceCount, 0, "all feedback expires");
      f.numbers.spawnReaction(6, 2, "shock");
      f.numbers.update(0, project);
      drawnGlyph(f.numbers, "感");
      f.numbers.clear();
      f.numbers.update(0, project);
      assert.equal(f.numbers.geometry.instanceCount, 0, "scene cleanup prevents stale labels");
      f.numbers.spawnReaction(8, 4, "steam");
      f.numbers.update(0, project);
      assert.equal(
        anchor.getX(drawnGlyph(f.numbers, "蒸")),
        80 - cameraX,
        "reuse takes the new event position",
      );
    } finally {
      f.dispose();
    }
  });
} else {
  const { mock } = await import("bun:test");

  const root = process.cwd();
  const at = (p) => `${root}/${p}`;
  const { Scene, PerspectiveCamera, Object3D } = await import(
    at("node_modules/three/build/three.module.js")
  );
  const noop = () => {};
  let assetGate, actualWorld;
  const sounds = [];
  let viewEvents = [];
  let project = () => [0, 0];
  const audio = {
    setEnabled: noop,
    sfx: (name) => sounds.push(name),
    acquire: () => ({ result: Promise.resolve(), release: noop }),
    music: { play: noop, setPaused: noop, runTrack: () => "fixture" },
  };
  await mock.module(at("src/audio/engine.ts"), () => ({ getAudio: () => audio, RUN_SOUNDS: [] }));
  await mock.module(at("src/run/view/assets.ts"), () => ({
    bindModelStore: noop,
    loadRunAssets: async () => {
      if (assetGate) await assetGate.promise;
      return { dispose: noop, releaseUploads: noop };
    },
  }));
  await mock.module(at("src/run/view/createRunView.ts"), () => ({
    createRunView: function* (world) {
      yield;
      actualWorld = world;
      return {
        scene: new Scene(),
        camera: new PerspectiveCamera(),
        warmSet: noop,
        dispose: noop,
        releaseUploads: noop,
        frame: (_alpha, _dt, events) => {
          viewEvents = events;
        },
        project: (...args) => project(...args),
        debugHeight: () => 0,
      };
    },
  }));
  await mock.module(at("src/run/view/grade.ts"), () => ({
    applyWorldOutput: noop,
    createGrade: () => ({ vignette: new Object3D(), dispose: noop }),
  }));
  await mock.module(at("src/run/view/healthBars.ts"), () => ({
    createHealthBars: () => ({ mesh: new Object3D(), dispose: noop, update: noop }),
  }));
  await mock.module(at("src/run/view/boundaryWall.ts"), () => ({
    createBoundaryWall: () => ({ mesh: new Object3D(), dispose: noop, update: noop }),
  }));
  await mock.module(at("src/run/view/minimapBake.ts"), () => ({
    bakeMap: function* () {
      yield;
      return { dispose: noop };
    },
  }));
  const widget = () => ({
    dispose: noop,
    resize: noop,
    releaseUploads: noop,
    restore: noop,
    update: noop,
    afterLayout: noop,
  });
  await mock.module(at("src/run/view/minimap.ts"), () => ({ createMinimap: widget }));
  await mock.module(at("src/run/view/compassBar.ts"), () => ({ createCompassBar: widget }));
  const { installRuntime } = await import(at("src/platform/runtime.ts"));
  installRuntime({ nextFrame: async () => {} });
  const { createRun } = await import(at("src/run/createRun.ts"));
  const { NO_LAB } = await import(at("src/run/sim/stats.ts"));
  const flush = () => new Promise((r) => setTimeout(r, 1));

  for (const scenario of fixture === "--reaction-fixture"
    ? ["reaction-feedback"]
    : fixture === "--hurt-fixture"
      ? ["hurt-feedback"]
      : fixture === "--notice-fixture"
        ? ["notice-feedback", "notice-age-feedback"]
        : ["success", "refused", "dispose-preparing", "dispose-in-ready", "dispose-active"]) {
    assetGate = scenario === "dispose-preparing" ? Promise.withResolvers() : null;
    const events = [],
      errors = [];
    let client,
      controller,
      prepared = false;
    const renderer = {
      compileAsync: async () => {},
      setClearColor: noop,
      clear: noop,
      render: noop,
      initTexture: noop,
    };
    const app = {
      renderer,
      available: true,
      generation: 0,
      surface: { display: { coarsePointer: false } },
      resident: () => noop,
      subscribe: () => noop,
      inWorldTarget: (f) => f(),
      retainWorldPrograms: noop,
      setWorld: (c) => {
        events.push("setWorld");
        client = c;
        return () => {
          events.push("releaseWorld");
          client = null;
        };
      },
    };
    const hud = {
      stage: {
        viewport: {
          width: 800,
          height: 600,
          scale: 1,
          safeArea: { top: 0, left: 0, right: 0, bottom: 0 },
        },
      },
      updateIndicators: noop,
      numbers: { update: noop, clear: noop },
    };
    const textFixture = scenario === "reaction-feedback" ? await combatTextFixture() : null;
    if (textFixture) Object.assign(hud, { stage: textFixture.stage, numbers: textFixture.numbers });
    const banners = [];
    const bannerAges = [];
    const snapshots = [];
    let networkPair;
    if (scenario === "notice-age-feedback") {
      const { MultiplayerRun } = await import(at("src/network/run.ts"));
      const { createWorld } = await import(at("src/run/sim/world.ts"));
      const endpoints = [0, 1].map((self) => ({
        state: { self },
        receive(fn) {
          this.receiver = fn;
          return noop;
        },
        send(packet) {
          endpoints[1 - self].receiver(structuredClone(packet), self);
          return true;
        },
        isReachable: () => true,
        close: noop,
        finish: noop,
      }));
      const config = {
        stage: "forest",
        seed: 7,
        difficulty: 0,
        players: [{ starter: "charmander" }, { starter: "charmander" }],
      };
      const host = new MultiplayerRun(endpoints[0], config);
      const guest = new MultiplayerRun(endpoints[1], config);
      const world = createWorld(config);
      host.publishMap(world);
      networkPair = { host, guest, world };
    }
    controller = createRun(
      app,
      hud,
      {
        stage: scenario === "reaction-feedback" ? "volcano" : "forest",
        starter: scenario === "reaction-feedback" ? "squirtle" : "charmander",
        difficulty: 0,
        lab: NO_LAB,
        loadout: { archive: [], backpack: ["hp-up"] },
        sound: false,
        devMode: false,
        multiplayer: networkPair?.guest,
      },
      {
        inputBlocked: () => false,
        onReady() {
          assert.equal(client, undefined, "no world is registered before persistence commits");
          events.push("commit");
          prepared = true;
          if (scenario === "refused") throw new Error("refused backpack save");
          if (scenario === "dispose-in-ready") controller.dispose();
        },
        onError: (e) => errors.push(e.message),
        onSnapshot: (value) => snapshots.push(value),
        onBanner(text, tone, ageMs) {
          banners.push({ text, tone });
          bannerAges.push(ageMs);
        },
        onPauseRequest: noop,
        onStatsRequest: noop,
        onMapChange: noop,
        onZoneLoading: noop,
        onEnd: noop,
      },
    );
    controller.bindInput({ cancel: noop });
    if (scenario === "dispose-preparing") {
      await flush();
      controller.dispose();
      assetGate.resolve();
      for (let i = 0; i < 20; i++) await flush();
      assert.equal(prepared, false);
      assert.equal(client, undefined);
    } else {
      for (let i = 0; i < 1000 && !prepared && !errors.length; i++) await flush();
      assert.equal(prepared, true);
      if (scenario === "refused") {
        assert.deepEqual(errors, ["refused backpack save"]);
        assert.equal(client, undefined);
        assert.equal(actualWorld.tick, 0);
      } else if (scenario === "dispose-in-ready") {
        assert.equal(client, undefined);
        assert.equal(actualWorld.tick, 0);
      } else {
        assert.deepEqual(events, ["commit", "setWorld"]);
        if (scenario === "reaction-feedback") {
          await reactionFeedback(hud, client, actualWorld, banners);
        } else if (scenario === "hurt-feedback") {
          await hurtFeedback(hud, client, actualWorld);
        } else if (scenario === "notice-feedback") {
          await noticeFeedback(client, actualWorld, banners, snapshots);
        } else if (scenario === "notice-age-feedback") {
          noticeAgeFeedback(client, networkPair, banners, bannerAges);
        } else {
          client.advance(100);
          assert.ok(actualWorld.tick > 0);
        }
        if (scenario === "dispose-active") {
          const retained = client,
            tick = actualWorld.tick;
          controller.dispose();
          for (let i = 0; i < 6; i++) retained.advance(100);
          assert.equal(actualWorld.tick, tick);
        }
      }
    }
    controller.dispose();
    networkPair?.host.dispose();
    networkPair?.guest.dispose();
    if (scenario === "reaction-feedback") {
      assert.equal(hud.numbers.geometry.instanceCount, 0, "run disposal clears world feedback");
      textFixture.dispose();
    }
  }

  function noticeAgeFeedback(client, { host, world }, banners, ages) {
    const old = { t: "banner", text: "旧冲锋", tone: "danger", kind: "stampede" };
    const fresh = [
      { t: "banner", text: "新喷发", tone: "danger", kind: "eruption" },
      { t: "banner", text: "新头目", tone: "danger", kind: "alpha" },
    ];
    host.publish(world, [old], 0.1, true);
    for (let i = 0; i < 44; i++) host.publish(world, [], 0.05, true);
    host.publish(world, fresh, 0.1, true);
    host.publish(world, [], 0.1, true);
    host.publish(world, [], 0.1, true);
    sounds.length = 0;
    client.advance(100);
    assert.deepEqual(
      viewEvents.filter((event) => event.t === "banner"),
      [old, ...fresh],
      "aged danger still reaches world feedback",
    );
    assert.deepEqual(sounds, ["danger", "danger", "danger"]);
    assert.deepEqual(banners, [{ text: "火山喷发 · 头目出现", tone: "danger" }]);
    assert.ok(
      ages[0] >= 190 && ages[0] < 500,
      "a 2.5-second-old danger cannot shorten fresh notices to 100 ms",
    );
  }

  async function noticeFeedback(client, world, banners, snapshots) {
    const { applyCommand, createPlayer } = await import(at("src/run/sim/world.ts"));
    const { capture } = await import(at("src/run/sim/partners.ts"));
    const { newMoveState } = await import(at("src/run/sim/upgrades.ts"));
    const { MAX_MOVE_LEVEL } = await import(at("src/run/sim/content/params/cards.ts"));
    const { signatureFusions } = await import(at("src/run/sim/content/fusions.ts"));
    const { spawnEnemy, summonGuardian, updateDirector } = await import(
      at("src/run/sim/director.ts")
    );
    const { fireBeat } = await import(at("src/run/sim/beats.ts"));
    const { tell } = await import(at("src/run/sim/skills/kit.ts"));
    const { stageDefs } = await import(at("src/run/sim/content/stages/index.ts"));
    const { killEnemy } = await import(at("src/run/sim/combat.ts"));
    const { EnemyGrid } = await import(at("src/run/sim/grid.ts"));
    world.paused = true;
    world.events.length = 0;
    world.players.push(createPlayer(1, "charmander", world.players[0].x + 2));
    const self = world.players[0];
    const teammate = world.players[1];
    const deliver = () => {
      const events = structuredClone(world.events);
      banners.length = 0;
      sounds.length = 0;
      client.advance(100);
      assert.deepEqual(viewEvents, events, "notice routing preserves every world event");
      return events;
    };
    const { damagePlayer } = await import(at("src/run/sim/hurt.ts"));
    teammate.invulnerable = 0;
    teammate.shield = 0;
    damagePlayer(world, teammate, 1e9);
    deliver();
    assert.deepEqual(banners, [{ text: "P2 小火龙 倒地", tone: "danger" }]);
    deliver();
    assert.deepEqual(banners, [], "the same fall is not announced on later frames");
    teammate.alive = true;
    teammate.hp = 50;
    teammate.invulnerable = 0;
    damagePlayer(world, teammate, 1e9);
    // A personal revive returns the player before the tick's feedback is drained.
    teammate.alive = true;
    teammate.hp = 50;
    world.events.push({ t: "revive", player: teammate.id });
    deliver();
    assert.deepEqual(banners, [], "a teammate who immediately revives does not raise a down alarm");
    teammate.alive = false;
    teammate.departed = true;
    world.events.push({ t: "down", player: teammate.id });
    deliver();
    assert.deepEqual(banners, [], "a late down event never asks for rescue of a departed teammate");
    teammate.alive = true;
    delete teammate.departed;
    for (const player of [teammate, self]) {
      player.items.push({ id: "master-ball", level: 1 });
      const elite = spawnEnemy(world, "rattata", player.x + 2, player.z, true);
      capture(world, elite, player);
      assert.equal(world.partners.at(-1).owner, player.id);
      const caught = deliver().find((event) => event.t === "capture");
      assert.equal(caught.player, player.id);
      assert.deepEqual(banners, player === self ? [{ text: "捕获 小拉达！", tone: "reward" }] : []);
      assert.deepEqual(sounds, player === self ? ["capture"] : []);

      player.moves = signatureFusions[player.starter].match.pair.map((id) => ({
        ...newMoveState(id),
        level: MAX_MOVE_LEVEL,
      }));
      const station = world.stations.find((entry) => entry.kind === "bill");
      player.x = player.px = station.x + station.radius + 0.6;
      player.z = player.pz = station.z;
      player.dialog = { id: world.nextId++, station: station.id };
      applyCommand(world, { t: "fuse", player: player.id, dialog: player.dialog.id });
      assert.ok(station.used.includes(player.id), "fusion completes through the real command");
      const fused = deliver().find((event) => event.t === "banner" && event.kind === "fusion");
      assert.equal(fused.player, player.id);
      assert.deepEqual(banners, player === self ? [{ text: fused.text, tone: "reward" }] : []);
      assert.deepEqual(sounds, player === self ? ["boss"] : []);
    }
    world.events.push(
      { t: "evolve", player: teammate.id, stage: 1, form: "charmeleon" },
      { t: "revive", player: teammate.id, team: true },
    );
    deliver();
    assert.deepEqual(banners, []);
    assert.deepEqual(sounds, []);
    world.events.push(
      { t: "evolve", player: self.id, stage: 1, form: "charmeleon" },
      { t: "revive", player: self.id, team: true },
    );
    deliver();
    assert.equal(banners.length, 2);
    assert.ok(banners.every((entry) => entry.tone === "reward"));
    assert.deepEqual(sounds, ["evolve", "revive"]);

    summonGuardian(world, self);
    deliver();
    assert.deepEqual(banners, [], "the guardian uses its persistent health bar");
    assert.deepEqual(sounds, ["boss"]);
    const guardian = world.enemies.find((enemy) => enemy.id === world.bossId);
    world.zone.tick = stageDefs[world.stage].duration * 30;
    world.spawn.fired = stageDefs[world.stage].zones[0].beats.map(
      ([at, beat]) => `${beat.kind}@${at}`,
    );
    updateDirector(world, 0);
    assert.ok(world.events.some((event) => event.t === "banner" && event.kind === "rampage"));
    deliver();
    assert.deepEqual(banners, [], "rampage uses the persistent timer state");
    assert.ok(sounds.includes("danger"), "rampage retains its sound");

    fireBeat(world, { kind: "eruption" }, self);
    fireBeat(world, { kind: "stampede", species: "rattata", banner: "此批冲锋" }, self);
    const enemy = spawnEnemy(world, "rattata", self.x, self.z, true);
    tell(world, enemy, "danger", 1);
    const hazards = structuredClone(world.hazards);
    deliver();
    assert.deepEqual(banners, [{ text: "火山喷发 · 冲锋群", tone: "danger" }]);
    assert.deepEqual(sounds, ["tell-danger", "danger", "danger"]);
    assert.deepEqual(world.hazards, hazards, "danger feedback leaves the hazard simulation intact");
    assert.ok(viewEvents.some((event) => event.t === "tell" && event.enemy === enemy.id));
    assert.ok(snapshots.at(-1).boss, "guardian health remains available alongside danger");

    fireBeat(world, { kind: "alpha" }, self);
    fireBeat(world, { kind: "elite-wave" }, self);
    fireBeat(world, { kind: "elite-wave" }, self);
    deliver();
    assert.deepEqual(banners, [{ text: "头目出现 · 精英群", tone: "danger" }]);

    killEnemy({ world, grid: new EnemyGrid() }, guardian, self);
    const clear = deliver().find((event) => event.t === "banner" && event.kind === "clear");
    assert.deepEqual(banners, [{ text: clear.text, tone: "reward" }]);
    assert.deepEqual(sounds, ["elite-kill"], "clear does not stack a second boss cue");
  }

  async function hurtFeedback(hud, client, world) {
    const { damagePlayer } = await import(at("src/run/sim/hurt.ts"));
    const player = world.players[0];
    let flashes = 0;
    hud.flinch = () => flashes++;
    let now = performance.now();
    const originalNow = performance.now.bind(performance);
    performance.now = () => now;
    const advance = () => {
      for (let i = 0; i < 6; i++) {
        now += 1000 / 60;
        client.advance(1000 / 60);
      }
    };
    const hit = (amount) => {
      player.invulnerable = 0;
      const hp = player.hp;
      assert.equal(damagePlayer(world, player, amount), true);
      assert.ok(player.hp < hp, "the hit still deals real damage");
      client.advance(0);
      assert.ok(viewEvents.some((event) => event.t === "player-hit" && event.player === 0));
    };
    try {
      for (const amount of [12, 13, 20]) {
        hit(amount);
        const tick = world.tick;
        advance();
        assert.equal(world.tick - tick, 3, "hurt feedback preserves normal fixed-step pacing");
      }
      assert.equal(flashes, 3);
      assert.equal(sounds.filter((name) => name === "hurt").length, 3);
      world.events.push({ t: "ult", player: 0 });
      client.advance(0);
      hit(1);
      const tick = world.tick;
      advance();
      assert.ok(world.tick - tick < 3, "a hit does not cancel an ongoing ultimate beat");
      now += 200;
      const resumedTick = world.tick;
      advance();
      assert.equal(world.tick - resumedTick, 3, "the ultimate beat ends and normal pacing resumes");
    } finally {
      performance.now = originalNow;
    }
  }

  async function reactionFeedback(hud, client, world, banners) {
    const { spawnEnemy } = await import(at("src/run/sim/director.ts"));
    const { damageEnemy } = await import(at("src/run/sim/combat.ts"));
    const { apply } = await import(at("src/run/sim/status.ts"));
    const { EnemyGrid } = await import(at("src/run/sim/grid.ts"));
    const { reactions } = await import(at("src/run/sim/content/reactions.ts"));
    const grid = new EnemyGrid();
    const player = world.players[0];
    world.paused = true;
    world.events.length = 0;
    for (const [reaction, x, z] of reactionPositions) {
      const def = reactions[reaction];
      const enemy = spawnEnemy(world, "rattata", x, z);
      Object.assign(enemy, { x, z, hp: 1, maxHp: 1 });
      grid.rebuild(world.enemies);
      apply(enemy, def.primed, 3, 1, player.id);
      damageEnemy({ world, grid }, enemy, {
        owner: player,
        move: null,
        type: def.trigger,
        dmg: 10,
        crit: 0,
        statusChance: 0,
        knock: 0,
        fromX: player.x,
        fromZ: player.z,
      });
      assert.ok(enemy.hp <= 0, "the reaction target dies before feedback is presented");
    }
    const reactionEvents = world.events.filter((event) => event.t === "reaction");
    assert.deepEqual(
      reactionEvents,
      reactionPositions.map(([reaction, x, z]) => ({ t: "reaction", reaction, x, z })),
    );
    // A remote co-op burst arrives first; it must not crowd local feedback out of the pool.
    const distant = Array.from({ length: 30 }, () => ({
      t: "reaction",
      reaction: "steam",
      x: 80,
      z: 80,
    }));
    world.events.unshift(...distant);
    world.enemies.length = 0;
    world.events.push({ t: "banner", text: "区域消息", tone: "info", kind: "zone" });
    sounds.length = 0;
    const projected = [];
    project = (x, y, z) => {
      projected.push([x, z]);
      return [400 + x * 10, 300 - y * 10 - z * 10];
    };
    client.advance(0);
    assert.deepEqual(banners, [{ text: "区域消息", tone: "info" }]);
    assert.equal(
      sounds.filter((name) => name === "reaction").length,
      distant.length + reactionPositions.length,
    );
    assert.deepEqual(
      viewEvents.filter((event) => event.t === "reaction"),
      [...distant, ...reactionEvents],
    );
    for (const [, x, z] of reactionPositions)
      assert.ok(projected.some(([px, pz]) => px === x && pz === z));
    assertReactionPositions(hud.numbers);
  }
}

async function combatTextFixture() {
  const { Texture } = await import("three");
  const { UiStage } = await import("../src/ui/gpu/stage.ts");
  const { GpuDamageNumbers } = await import("../src/ui/gpu/run-damage-numbers.ts");
  const core = new URL("../public/fonts/gpu/core/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", core), "utf8"));
  const font = JSON.parse(readFileSync(new URL(manifest["ui-800"].json, core), "utf8"));
  const textures = font.pages.map(() => new Texture());
  const stage = new UiStage();
  stage.resize(800, 600);
  stage.root.setProperties({
    fontFamilies: {
      "Poketone UI": {
        800: {
          pages: [],
          pageTextures: textures,
          pageSizes: font.pageSizes,
          chars: font.glyphs.map(([id, page, x, y, width, height, xoffset, yoffset, xadvance]) => ({
            id,
            char: String.fromCodePoint(id),
            page,
            x,
            y,
            width,
            height,
            xoffset,
            yoffset,
            xadvance,
          })),
          info: { size: font.size },
          common: { lineHeight: font.lineHeight },
          distanceField: { distanceRange: font.distanceRange },
          kernings: [],
        },
      },
    },
  });
  const numbers = new GpuDamageNumbers(stage);
  for (let i = 0; i < 100 && !numbers.probe.fontSignal.value; i++) {
    stage.update(16);
    await new Promise((r) => setTimeout(r, 1));
  }
  assert.ok(numbers.probe.fontSignal.value, "the actual published bold font is ready");
  return {
    stage,
    numbers,
    dispose() {
      numbers.dispose();
      assert.equal(numbers.mesh.parent, null, "disposed feedback leaves the UI scene");
      stage.dispose();
      textures.forEach((texture) => texture.dispose());
    },
  };
}

function drawnGlyph(numbers, char) {
  const info = numbers.probe.fontSignal.value.getGlyphInfo(char);
  const { numberUv: uv, numberPage: page } = numbers.geometry.attributes;
  for (let i = 0; i < numbers.geometry.instanceCount; i++)
    if (
      page.getX(i) === info.page &&
      Math.abs(uv.getX(i) - info.uvX) < 1e-6 &&
      Math.abs(uv.getY(i) - info.uvY) < 1e-6
    )
      return i;
  assert.fail(`missing drawn glyph: ${char}`);
}

function assertReactionPositions(numbers) {
  const names = ["蒸汽", "感电", "蔓延燃烧"];
  const anchor = numbers.geometry.attributes.numberAnchor;
  reactionPositions.forEach(([, x, z], i) => {
    for (const char of names[i]) {
      const index = drawnGlyph(numbers, char);
      assert.equal(anchor.getX(index), x * 10);
      assert.equal(anchor.getY(index), 13 + z * 10);
    }
  });
  assert.deepEqual(
    numbers.material.uniforms.fontPages.value,
    numbers.probe.fontSignal.value.pages.slice(0, 2),
  );
}
