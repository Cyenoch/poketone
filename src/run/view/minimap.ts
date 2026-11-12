import { InputGlyph } from "../../ui/gpu/input-glyph";
import { createMenuIcon } from "../../ui/gpu/icons";
import { Container, Content } from "@pmndrs/uikit";
import { releaseUploads } from "../../rendering/releaseUploads";
import {
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  Vector4,
  type DataTexture,
} from "three";
import { UiStage } from "../../ui/gpu/stage";
import { uiEaseOut } from "../../ui/gpu/focus-mark";
import type { UiInsets } from "../../ui/gpu/viewport";
import { findPlayer } from "../sim/combat";
import type { PlayerId } from "../sim/state/entities";
import { ARENA_HALF, type World } from "../sim/state/world";
import { BAKE_HALF } from "./minimapBake";
import {
  MapLayers,
  PRESSURE_SECTORS,
  loadMapIcon,
  stationIconUrls,
  type MapTransform,
} from "./minimapLayers";

const MINI_RADIUS = 22,
  ICON_RIM = 0.84,
  FULL_HALF = ARENA_HALF + 8,
  DANGER_RANGE = 9;
export interface Minimap {
  resize(width: number, height: number, scale: number, safeArea: UiInsets): void;
  update(world: World, alpha: number, yaw: number, dt: number): void;
  afterLayout(): void;
  setFullMap(open: boolean): void;
  hit(x: number, y: number): "mini" | "full-close" | null;
  restore(): void;
  releaseUploads(): void;
  dispose(): void;
}
class TerrainPaint {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  readonly uniforms = {
    mapSize: { value: 1 },
    mapAffine: { value: new Vector4(1, 0, 0, 1) },
    mapOrigin: { value: new Vector2() },
    terrain: { value: null as DataTexture | null },
    mapAlpha: { value: 1 },
    paintAlpha: { value: 1 },
    pressure: { value: new Float32Array(PRESSURE_SECTORS * 4) },
  };
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  constructor(texture: DataTexture, full: boolean) {
    this.uniforms.terrain.value = texture;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = "varying vec2 mapUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nmapUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 mapUv;uniform float mapSize;uniform vec4 mapAffine;uniform vec2 mapOrigin;
        uniform sampler2D terrain;uniform float mapAlpha;uniform float paintAlpha;
        ${full ? "" : `uniform vec4 pressure[${PRESSURE_SECTORS}];`}
        float mapSegment(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));}\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
        #include <color_fragment>
        vec2 p=vec2(mapUv.x,1.-mapUv.y)*mapSize-mapOrigin;
        float determinant=mapAffine.x*mapAffine.w-mapAffine.y*mapAffine.z;
        vec2 world=vec2(mapAffine.w*p.x-mapAffine.y*p.y,-mapAffine.z*p.x+mapAffine.x*p.y)/determinant;
        vec2 coord=(world+${BAKE_HALF.toFixed(1)})/${(BAKE_HALF * 2).toFixed(1)};
        vec4 color=texture2D(terrain,coord);
        float valid=step(0.,coord.x)*step(coord.x,1.)*step(0.,coord.y)*step(coord.y,1.);
        ${
          full
            ? `float fade=clamp(min(mapUv.x,1.-mapUv.x)/.04,0.,1.)*clamp(min(mapUv.y,1.-mapUv.y)/.04,0.,1.);diffuseColor=vec4(color.rgb,color.a*valid*fade*mapAlpha);`
            : `
          float r=length(mapUv-.5)*2.;float fade=1.-smoothstep(.60,1.,r);
          float paint=color.a*valid*fade*paintAlpha;
          float shade=.4*(1.-smoothstep(.45,1.,r));
          vec3 navy=sRGBTransferEOTF(vec4(.05098,.13725,.24706,1.)).rgb;
          float alpha=paint+shade*(1.-paint);
          diffuseColor=vec4((color.rgb*paint+navy*shade*(1.-paint))/max(alpha,.0001),alpha*mapAlpha);
          // All pressure stays beyond the 84% icon rim, in this existing terrain draw.
          float radialAa=max(fwidth(r),.5/mapSize);
          float rim=1.-smoothstep(.006,.006+radialAa,abs(r-.955));
          vec3 rimColor=sRGBTransferEOTF(vec4(.57255,.72157,.81961,1.)).rgb;
          float rimAlpha=rim*.16;
          if(r>.88 && r<1.) {
            float bearing=fract(atan(.5-mapUv.y,mapUv.x-.5)/6.28318530718+1.)*${PRESSURE_SECTORS.toFixed(1)};
            int lo=int(floor(bearing));
            vec4 a=pressure[lo],b=pressure[(lo+1)%${PRESSURE_SECTORS}];
            vec4 pressureAt=mix(a,b,smoothstep(0.,1.,fract(bearing)));
            float crowd=pressureAt.y*(.42+.58*pressureAt.x/(1.+pressureAt.x));
            float elite=clamp(pressureAt.z*1.8,0.,1.);
            float guardian=clamp(pressureAt.w*1.8,0.,1.);
            float special=max(elite,guardian);
            float strength=max(crowd,special);
            float halfWidth=mix(.010,.025,clamp(crowd+special,0.,1.));
            float band=1.-smoothstep(halfWidth,halfWidth+radialAa,abs(r-.955));
            vec3 red=sRGBTransferEOTF(vec4(.87843,.27843,.35294,1.)).rgb;
            vec3 purple=sRGBTransferEOTF(vec4(.60392,.30980,.78039,1.)).rgb;
            vec3 boss=sRGBTransferEOTF(vec4(.85098,.21961,.30980,1.)).rgb;
            vec3 gold=sRGBTransferEOTF(vec4(1.,.83137,.35686,1.)).rgb;
            vec3 pressureColor=mix(red,purple,step(.01,elite));
            pressureColor=mix(pressureColor,boss,step(.01,guardian));
            // A narrow gold core distinguishes the guardian even among a red swarm.
            pressureColor=mix(pressureColor,gold,(1.-smoothstep(.004,.004+radialAa,abs(r-.955)))*step(.01,guardian));
            float pressureAlpha=band*min(.94,strength*1.35);
            rimColor=mix(rimColor,pressureColor,pressureAlpha/max(rimAlpha+pressureAlpha*(1.-rimAlpha),.0001));
            rimAlpha=pressureAlpha+rimAlpha*(1.-pressureAlpha);
          }
          float rimCombined=rimAlpha+diffuseColor.a*(1.-rimAlpha);
          diffuseColor=vec4((rimColor*rimAlpha+diffuseColor.rgb*diffuseColor.a*(1.-rimAlpha))/max(rimCombined,.0001),rimCombined);
        
        `
        }
      `,
      );
    };
    this.material.customProgramCacheKey = () => `run-map-terrain-${full}`;
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  setMap(map: MapTransform, size: number, alpha: number): void {
    this.uniforms.mapSize.value = size;
    this.uniforms.mapAffine.value.set(map.xx, map.xz, map.zx, map.zz);
    this.uniforms.mapOrigin.value.set(map.ox, map.oy);
    this.uniforms.paintAlpha.value = alpha;
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

/** Live map geometry belongs to the persistent UI stage, never to the world's WebGL context. */
/** The map is centred on the player `local`; `base` is its terrain bake (`bakeMap`, run in steps). */
export function createMinimap(
  stage: UiStage,
  slot: Container,
  world: World,
  local: PlayerId,
  base: DataTexture,
): Minimap {
  const textures = stationIconUrls(world, local).map((url) =>
    loadMapIcon(url, () => stage.invalidate()),
  );
  const mini = new Container({
    width: 184,
    height: 184,
    flexShrink: 0,
    marginTop: 8,
    alignSelf: "flex-end",
  });
  const full = new Container({
    positionType: "absolute",
    positionTop: 0,
    positionLeft: 0,
    width: "100%",
    height: "100%",
    zIndex: 20,
    display: "none",
    alignItems: "center",
    justifyContent: "center",
  });
  // Tuple colors are linear in UIKit; convert the authored sRGB navy once at the boundary.
  full.setProperties({ backgroundColor: [0.004025, 0.016807, 0.049707, 0.52] });
  const fullPanel = new Container({ width: 400, height: 400 });
  const close = new Container({
    positionType: "absolute",
    positionTop: 16,
    positionRight: 16,
    width: 48,
    height: 48,
    backgroundColor: "#0d233f",
    borderColor: "#d8effb",
    borderWidth: 2,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 30,
  });
  const closeIcon = createMenuIcon("close");
  closeIcon.setProperties({ width: 24, height: 24, color: "#ffffff" });
  const closeCap = new InputGlyph("cancel", "Esc");
  closeCap.setProperties({ positionType: "absolute", positionBottom: -4, positionRight: -4 });
  close.add(closeIcon, closeCap);
  full.add(fullPanel, close);
  slot.setProperties({ flexDirection: "column", alignItems: "flex-end" });
  slot.add(mini);
  stage.root.add(full);
  const miniTerrain = new TerrainPaint(base, false),
    fullTerrain = new TerrainPaint(base, true);
  miniTerrain.content.setProperties({ zIndex: 10 });
  fullTerrain.content.setProperties({ zIndex: 21 });
  const mapCap = new InputGlyph("map", "M");
  mapCap.setProperties({
    positionType: "absolute",
    positionLeft: 6,
    positionBottom: 3,
    zIndex: 15,
  });
  mini.add(miniTerrain.content, mapCap);
  fullPanel.add(fullTerrain.content);
  const miniLayers = new MapLayers(mini, 1.6, textures, 10, local),
    fullLayers = new MapLayers(fullPanel, 2.4, textures, 21, local);
  miniTerrain.uniforms.pressure.value = miniLayers.pressure;
  const map: MapTransform = { xx: 1, xz: 0, zx: 0, zz: 1, ox: 0, oy: 0 };
  const point = new Vector3(),
    inverse = new Matrix4();
  const pose = { alpha: 1 };
  let danger = 0,
    open = false,
    dirty = true,
    miniSize = 184,
    fullSize = 400;
  let requestedMiniSize = miniSize;
  let fittedMiniSize = miniSize;
  let lastWorld = world,
    lastAlpha = 0,
    lastYaw = 0;
  function draw(alpha: number, yaw: number, dt: number): void {
    const player = findPlayer(lastWorld, local);
    const px = player.px + (player.x - player.px) * alpha,
      pz = player.pz + (player.z - player.pz) * alpha;
    if (!open || dirty) {
      const half = miniSize / 2,
        k = half / MINI_RADIUS,
        c = Math.cos(yaw) * k,
        s = Math.sin(yaw) * k;
      Object.assign(map, {
        xx: c,
        xz: -s,
        zx: s,
        zz: c,
        ox: half - c * px + s * pz,
        oy: half - s * px - c * pz,
      });
      danger += (threat(lastWorld, px, pz) - danger) * Math.min(1, dt * 2.5);
      miniTerrain.setMap(map, miniSize, 0.86 + 0.12 * danger);
      miniLayers.update(
        lastWorld,
        alpha,
        yaw,
        map,
        miniSize,
        1,
        half * ICON_RIM,
        0.75 + 0.25 * danger,
        false,
      );
    }
    if (open) {
      const k = fullSize / (FULL_HALF * 2);
      Object.assign(map, { xx: k, xz: 0, zx: 0, zz: k, ox: fullSize / 2, oy: fullSize / 2 });
      fullTerrain.setMap(map, fullSize, 1);
      fullLayers.update(lastWorld, alpha, yaw, map, fullSize, 1.5, Infinity, 1, true);
    }
    dirty = false;
    stage.invalidate();
  }
  function contains(panel: Container, x: number, y: number, circle: boolean): boolean {
    const matrix = panel.globalMatrix.value,
      size = panel.size.value;
    if (!matrix || !size || !panel.displayed.value || panel.isClipped.value) return false;
    point
      .set(
        x / stage.viewport.scale + stage.camera.left,
        stage.camera.top - y / stage.viewport.scale,
        0,
      )
      .applyMatrix4(inverse.copy(matrix).invert());
    return circle
      ? Math.hypot(point.x / (size[0] / 2), point.y / (size[1] / 2)) <= 1
      : Math.abs(point.x) <= size[0] / 2 && Math.abs(point.y) <= size[1] / 2;
  }
  return {
    resize(width, height, scale, safeArea) {
      const w = width / scale,
        h = height / scale,
        compact = h <= 480;
      miniSize = compact
        ? Math.max(124, Math.min(148, Math.min(w, h) * 0.3))
        : Math.max(184, Math.min(248, Math.min(w, h) * 0.24));
      fullSize = Math.min(
        760,
        w - Math.max(16, safeArea.left / scale) - Math.max(16, safeArea.right / scale),
        h - Math.max(16, safeArea.top / scale) - Math.max(16, safeArea.bottom / scale),
      );
      requestedMiniSize = fittedMiniSize = miniSize;
      mini.setProperties({ width: miniSize, height: miniSize });
      fullPanel.setProperties({ width: fullSize, height: fullSize });
      close.setProperties({
        width: Math.max(48, 44 / scale),
        height: Math.max(48, 44 / scale),
        positionTop: Math.max(16, safeArea.top / scale),
        positionRight: Math.max(16, safeArea.right / scale),
      });
      dirty = true;
      stage.invalidate();
    },
    update(value, alpha, yaw, dt) {
      lastWorld = value;
      lastAlpha = alpha;
      lastYaw = yaw;
      if (dt !== 0 || dirty) draw(alpha, yaw, dt);
    },
    afterLayout() {
      const limit = slot.properties.value.maxHeight;
      const fit =
        typeof limit === "number"
          ? Math.min(requestedMiniSize, Math.max(stage.viewport.minTarget, limit - 8))
          : requestedMiniSize;
      if (Math.abs(fit - fittedMiniSize) > 0.1) {
        fittedMiniSize = fit;
        mini.setProperties({ width: fit, height: fit });
        stage.invalidate();
      }
      const measured = mini.size.value;
      if (measured && Math.abs(measured[0] - miniSize) > 0.1) {
        miniSize = measured[0];
        dirty = true;
      }
      miniLayers.afterLayout();
      fullLayers.afterLayout();
      if (dirty) draw(lastAlpha, lastYaw, 0);
    },
    setFullMap(value) {
      if (open === value) return;
      open = value;
      dirty = true;
      full.setProperties({ display: open ? "flex" : "none" });
      stage.motion.cancel(pose);
      if (open) {
        pose.alpha = 0;
        fullTerrain.uniforms.mapAlpha.value = 0;
        fullLayers.setOpacity(0);
        full.setProperties({ opacity: 0 });
        stage.motion.animate(
          pose,
          { alpha: 1 },
          160,
          () => {
            full.setProperties({ opacity: pose.alpha });
            fullTerrain.uniforms.mapAlpha.value = pose.alpha;
            fullLayers.setOpacity(pose.alpha);
            stage.invalidate();
          },
          uiEaseOut,
        );
      }
      stage.invalidate();
    },
    hit(x, y) {
      return open
        ? contains(full, x, y, false)
          ? "full-close"
          : null
        : contains(mini, x, y, true)
          ? "mini"
          : null;
    },
    restore() {
      // Three reuploads the retained CPU data / icon images into whichever UI context is restored.
      base.needsUpdate = true;
      for (const texture of textures) texture.needsUpdate = true;
      miniTerrain.restore();
      fullTerrain.restore();
      miniLayers.restore();
      fullLayers.restore();
      dirty = true;
      stage.invalidate();
    },
    releaseUploads() {
      miniTerrain.releaseUploads();
      fullTerrain.releaseUploads();
      miniLayers.releaseUploads();
      fullLayers.releaseUploads();
      // These textures are borrowed by shader closures, outside the stage's material traversal.
      base.dispose();
      for (const texture of textures) texture.dispose();
    },
    dispose() {
      stage.motion.cancel(pose);
      miniLayers.dispose();
      fullLayers.dispose();
      miniTerrain.dispose();
      fullTerrain.dispose();
      for (const texture of textures) texture.dispose();
      base.dispose();
      mapCap.dispose();
      closeCap.dispose();
      closeIcon.dispose();
      close.dispose();
      mini.removeFromParent();
      mini.dispose();
      fullPanel.dispose();
      full.removeFromParent();
      full.dispose();
    },
  };
}
/** 0 calm … 1 swarmed, preserving weighted nearby enemies and the original smoothing. */
function threat(world: World, x: number, z: number): number {
  let sum = 0;
  for (const enemy of world.enemies) {
    const distance = Math.hypot(enemy.x - x, enemy.z - z);
    if (distance < DANGER_RANGE)
      sum += (1 - distance / DANGER_RANGE) * (enemy.elite || enemy.boss ? 4 : 1);
  }
  return Math.min(1, sum / 8);
}
