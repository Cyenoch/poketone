import { Container, Content, Text } from "@pmndrs/uikit";
import { releaseUploads } from "../../rendering/releaseUploads";
import { Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import { UiStage } from "../../ui/gpu/stage";
import type { UiInsets } from "../../ui/gpu/viewport";
import { cameraForward, cameraRight } from "../cameraYaw";
import { findPlayer } from "../sim/combat";
import { stationOpen } from "../sim/stations";
import { landmarkOf } from "../sim/currentZone";
import type { PlayerId } from "../sim/state/entities";
import type { World } from "../sim/state/world";
import { MapInk } from "./mapInk";
import { loadMapIcon, stationIconUrls } from "./minimapLayers";
const SPAN = (100 * Math.PI) / 180,
  PIN = (80 * Math.PI) / 180,
  TICK = (15 * Math.PI) / 180,
  FLIP = (170 * Math.PI) / 180;
const CARDINALS = [
  ["北", 0, -1],
  ["东", 1, 0],
  ["南", 0, 1],
  ["西", -1, 0],
] as const;
export interface CompassBar {
  resize(width: number, height: number, scale: number, safeArea: UiInsets): void;
  update(world: World, alpha: number, yaw: number, dt: number): void;
  afterLayout(): void;
  restore(): void;
  releaseUploads(): void;
  dispose(): void;
}
/** Tick mask and wash remain analytic, so camera motion changes uniforms without texture uploads. */
class CompassTicks {
  readonly content = new Content({
    positionType: "absolute",
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  readonly uniforms = {
    compassSize: { value: new Vector2(420, 36) },
    tick: { value: 30 },
    offset: { value: 0 },
  };
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  constructor() {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 compassUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\ncompassUv=uv;",
      );
      shader.fragmentShader =
        "varying vec2 compassUv;uniform vec2 compassSize;uniform float tick;uniform float offset;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(compassUv.x,1.-compassUv.y)*compassSize;
        float aa=max(fwidth(p.x),fwidth(p.y));
        float line=1.-smoothstep(.5-aa*.5,.5+aa*.5,abs(p.y-compassSize.y+.5));
        float grid=1.-smoothstep(.5-aa*.5,.5+aa*.5,abs(mod(p.x-offset+tick*.5,tick)-tick*.5-.5));
        grid*=step(compassSize.y-6.,p.y);
        float alpha=max(line*.7,grid*.6);
        float shade=.38*(1.-compassUv.y);
        vec3 light=sRGBTransferEOTF(vec4(.84706,.93725,.98431,1.)).rgb;
        vec3 navy=sRGBTransferEOTF(vec4(.05098,.13725,.24706,1.)).rgb;
        float combined=alpha+shade*(1.-alpha);
        float fade=clamp(min(compassUv.x,1.-compassUv.x)/.1,0.,1.);
        diffuseColor=vec4((light*alpha+navy*shade*(1.-alpha))/max(combined,.0001),combined*fade);
      `,
      );
    };
    this.material.customProgramCacheKey = () => "run-compass-ticks";
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  restore(): void {
    this.material.needsUpdate = true;
  }
  releaseUploads(): void {
    releaseUploads(this.content);
  }
  dispose(): void {
    this.releaseUploads();
    this.content.removeFromParent();
    this.content.dispose();
  }
}
/** Bearings are taken from the player `local`. */
export function createCompassBar(
  stage: UiStage,
  slot: Container,
  world: World,
  local: PlayerId,
): CompassBar {
  const panel = new Container({ width: 420, height: 36, alignSelf: "center", flexShrink: 0 });
  slot.add(panel);
  const ticks = new CompassTicks();
  panel.add(ticks.content);
  const shapes = new MapInk();
  shapes.content.setProperties({ zIndex: 2 });
  panel.add(shapes.content);
  const textures = stationIconUrls(world, local).map((url) =>
    loadMapIcon(url, () => stage.invalidate()),
  );
  const icons = textures.map((texture) => new MapInk(texture));
  for (const icon of icons) {
    icon.content.setProperties({ zIndex: 3 });
    panel.add(icon.content);
  }
  const cardinals = CARDINALS.map(([name]) => {
    const holder = new Container({
      positionType: "absolute",
      positionLeft: 0,
      positionTop: 0,
      width: 24,
      height: 16,
      zIndex: 1,
    });
    const nodes: Text[] = [];
    for (const [dx, dy] of [
      [-1.5, 0],
      [1.5, 0],
      [0, -1.5],
      [0, 1.5],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
      [0, 0],
    ]) {
      const text = new Text({
        text: name,
        positionType: "absolute",
        width: 24,
        textAlign: "center",
        fontSize: 13,
        fontWeight: 800,
        transformTranslateX: dx!,
        transformTranslateY: dy!,
        color: nodes.length === 8 ? "#fff" : "#0d233f",
        zIndex: nodes.length === 8 ? 2 : 1,
      });
      holder.add(text);
      nodes.push(text);
    }
    panel.add(holder);
    return { holder, nodes };
  });
  const sides = new Map<string, -1 | 1>();
  let width = 420,
    height = 36,
    markSize = 26,
    lastWorld = world,
    lastAlpha = 0,
    lastYaw = 0,
    lastTick = -1,
    dirty = true;
  function draw(value: World, alpha: number, yaw: number): void {
    const size = panel.size.value;
    if (size) {
      width = size[0];
      height = size[1];
    }
    const player = findPlayer(value, local),
      px = player.px + (player.x - player.px) * alpha,
      pz = player.pz + (player.z - player.pz) * alpha;
    const [fx, fz] = cameraForward(yaw),
      [rx, rz] = cameraRight(yaw);
    const bearing = (dx: number, dz: number) => Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const scale = width / 2 / SPAN;
    ticks.uniforms.compassSize.value.set(width, height);
    ticks.uniforms.tick.value = TICK * scale;
    ticks.uniforms.offset.value = width / 2 + bearing(0, -1) * scale;
    CARDINALS.forEach(([, dx, dz], i) => {
      const angle = bearing(dx, dz);
      cardinals[i]!.holder.setProperties({
        display: Math.abs(angle) > SPAN ? "none" : "flex",
        transformTranslateX: width / 2 + angle * scale - 12,
        transformTranslateY: height - 6 - 13,
      });
    });
    shapes.uniforms.inkSize.value.set(width, height);
    shapes.begin();
    for (const icon of icons) {
      icon.uniforms.inkSize.value.set(width, height);
      icon.begin();
    }
    // CSS's centre notch points up from the strip baseline.
    shapes.add(width / 2, height - 3, 7.6, 11.6, 7, "#ffd45b", "#ffd45b", 0, -Math.PI / 2);
    const seen = new Set<string>();
    const pin = (
      key: string,
      angle: number,
      kind: "station" | "chest" | "boss" | "landmark",
      icon = 0,
    ) => {
      seen.add(key);
      let side = sides.get(key) ?? 1;
      if (Math.abs(angle) < FLIP) side = angle < 0 ? -1 : 1;
      sides.set(key, side);
      const behind = Math.abs(angle) > PIN,
        shown = behind ? side * PIN : angle,
        opacity = behind ? 0.7 : 1;
      const x = width / 2 + shown * scale,
        y = height - 6 - markSize / 2;
      if (kind === "station") {
        shapes.add(x, y, markSize + 4, markSize + 4, 0, "#ffd45b", "#ffd45b", 0, 0, opacity);
        icons[icon]!.add(x, y, markSize, markSize, 10, "#fff", "#0d233f", 2, 0, opacity);
      } else if (kind === "chest") shapes.add(x, y, 16, 16, 2, "#ffd45b", "#b48129", 2, 0, opacity);
      else if (kind === "landmark") {
        const fill = value.zone.phase === "active" ? "#ffd45b" : "#bff4ff";
        shapes.add(x, y, 18, 18, 0, fill, "#0d233f", 2.5, 0, opacity);
      } else shapes.add(x, y, 24, 24, 1, "#d9384f", "#0d233f", 2, 0, opacity);
      if (behind)
        shapes.add(
          x + side * (markSize / 2 + 3.5),
          y,
          8.86,
          11.6,
          7,
          "#ffd45b",
          "#ffd45b",
          0,
          side < 0 ? Math.PI : 0,
          opacity,
        );
    };
    if (player.alive) {
      for (const station of value.stations)
        if (stationOpen(station, player))
          pin(
            `station:${station.id}`,
            bearing(station.x - px, station.z - pz),
            "station",
            station.kind === "hypno" ? 0 : 1,
          );
      for (const pickup of value.pickups)
        if (pickup.kind === "chest")
          pin(`chest:${pickup.id}`, bearing(pickup.x - px, pickup.z - pz), "chest");
      const boss = value.enemies.find((enemy) => enemy.boss);
      if (boss) pin("boss", bearing(boss.x - px, boss.z - pz), "boss");
      // The zone's landmark: where the guardian is summoned, then the exit.
      else {
        const landmark = landmarkOf(value);
        pin("landmark", bearing(landmark.x - px, landmark.z - pz), "landmark");
      }
    }
    for (const key of sides.keys()) if (!seen.has(key)) sides.delete(key);
    shapes.end();
    for (const icon of icons) icon.end();
    dirty = false;
    stage.invalidate();
  }
  return {
    resize(_hostWidth, hostHeight, scale, _safeArea) {
      markSize = hostHeight / scale <= 480 ? 20 : 26;
      height = markSize + 10;
      // As wide as the HUD's centre column it sits in (sized there on the pixel grid); the drawing
      // reads the laid-out width back.
      panel.setProperties({ width: "100%", height });
      slot.setProperties({ height });
      dirty = true;
      stage.invalidate();
    },
    update(value, alpha, yaw, _dt) {
      // A paused world (open window) hands over the same frame again; redrawing it would keep the
      // UI canvas drawing every frame for nothing.
      const same =
        !dirty &&
        value === lastWorld &&
        value.tick === lastTick &&
        alpha === lastAlpha &&
        yaw === lastYaw;
      lastWorld = value;
      lastTick = value.tick;
      lastAlpha = alpha;
      lastYaw = yaw;
      if (!same) draw(value, alpha, yaw);
    },
    afterLayout() {
      shapes.afterLayout();
      for (const icon of icons) icon.afterLayout();
      if (dirty) draw(lastWorld, lastAlpha, lastYaw);
    },
    restore() {
      ticks.restore();
      shapes.restore();
      for (const icon of icons) icon.restore();
      for (const texture of textures) texture.needsUpdate = true;
      dirty = true;
      stage.invalidate();
    },
    releaseUploads() {
      ticks.releaseUploads();
      shapes.releaseUploads();
      for (const icon of icons) icon.releaseUploads();
      // The icon samplers live in MapInk's onBeforeCompile closure, owned by this compass.
      for (const texture of textures) texture.dispose();
    },
    dispose() {
      ticks.dispose();
      shapes.dispose();
      for (const icon of icons) icon.dispose();
      for (const texture of textures) texture.dispose();
      for (const { holder, nodes } of cardinals) {
        for (const text of nodes) text.dispose();
        holder.dispose();
      }
      panel.removeFromParent();
      panel.dispose();
    },
  };
}
