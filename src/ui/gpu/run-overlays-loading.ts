import { themeColors } from "./run-choice-surface";
import { Component, Container, Content, Image, Text } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry, Vector2 } from "three";
import { starters, type StarterId } from "../../run/sim/content/lines/index";
import { MAX_MOVE_LEVEL } from "../../run/sim/content/params/cards";
import { stageDefs, type StageId } from "../../run/sim/content/stages/index";
import { stageThemes } from "../../run/view/stageThemes";
import type { UiStage } from "./stage";
import { cubicBezier } from "./focus-mark";
import { fade, stack } from "./layer";

const tips = [
  "星星沙子带回研究所，换成永久强化",
  "引梦貘人：忘记招式或道具，换回星星沙子",
  `正辉的机器：两个招式都到 Lv.${MAX_MOVE_LEVEL} 就能融合`,
  "终极技的外环充满后即可释放",
  "升级卡的稀有度越高，加成越大",
];

/** These are the authored CSS gradients/gauge, evaluated directly on a small GPU plate. */
class LoadingSurface {
  readonly content = new Content({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    keepAspectRatio: false,
    depthTest: false,
  });
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  readonly phase = { value: 0 };
  private readonly size = { value: new Vector2(1, 1) };
  constructor(
    kind: "floor" | "portrait" | "gauge" | "shadow",
    colors: [string, string, string, string],
    theme: string,
  ) {
    this.material.customProgramCacheKey = () => `run-loading-${kind}-${theme}`;
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        loadingSize: this.size,
        loadingPhase: this.phase,
        loadingColor: { value: new Color(colors[0]) },
        loadingDeep: { value: new Color(colors[1]) },
        loadingLight: { value: new Color(colors[2]) },
        loadingSoft: { value: new Color(colors[3]) },
      });
      shader.vertexShader = "varying vec2 loadingUv;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nloadingUv=uv;",
      );
      shader.fragmentShader =
        `varying vec2 loadingUv;uniform vec2 loadingSize;uniform float loadingPhase;
        uniform vec3 loadingColor,loadingDeep,loadingLight,loadingSoft;\n` + shader.fragmentShader;
      const floor = `diffuseColor=vec4(loadingDeep,clamp((.55-loadingUv.y)/.55,0.,1.)*.55*opacity);`;
      const shadow = `
        vec2 p=(loadingUv-.5)*loadingSize+vec2(0.,20.);
        vec2 q=abs(p)-((loadingSize-vec2(252.))*.5-vec2(12.));
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-12.;
        float x=d/49.4974747;float t=1./(1.+.3275911*abs(x));
        float erf=sign(x)*(1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-x*x));
        diffuseColor=vec4(vec3(.004025,.016807,.049707),.2*(1.-erf)*opacity);
      `;
      const portrait = `
        vec2 p=vec2(loadingUv.x,1.-loadingUv.y)*loadingSize;
        float radius=length((loadingUv-vec2(.5,.65))*vec2(1.,1.));
        vec3 ink=radius<.35?mix(loadingSoft,loadingLight,radius/.35):mix(loadingLight,loadingColor,clamp((radius-.35)/.25,0.,1.));
        float grain=${theme === "fire" ? "(1.-smoothstep(1.5,2.,length(mod(p,vec2(11.,9.))-vec2(2.75,6.75))))*.55" : theme === "grass" ? "(1.-step(2.,mod(-p.x*.819152+p.y*.573576,9.)))*.3" : theme === "water" ? "(1.-smoothstep(.5,1.,abs(length(mod(p,vec2(12.,7.))-vec2(6.,9.1))-5.5)))*.4" : "step(mod(p.x+p.y,8.),2.)*.34"};
        ink=mix(ink,vec3(1.),grain);float r=length((loadingUv-.5)*loadingSize);
        float outer=min(loadingSize.x,loadingSize.y)*.5;
        ink=mix(ink,vec3(.004025,.016807,.049707),step(outer-3.,r));
        diffuseColor=vec4(ink,(1.-smoothstep(outer-aa,outer+aa,r))*opacity);
      `;
      const gauge = `
        vec2 p=vec2(loadingUv.x,1.-loadingUv.y)*loadingSize;
        vec2 q=abs(p-loadingSize*.5)-(loadingSize*.5-vec2(5.));
        float edge=length(max(q,0.))+min(max(q.x,q.y),0.)-5.;
        vec3 ink=vec3(.004025,.016807,.049707);vec2 inner=p-vec2(5.);vec2 span=loadingSize-vec2(10.);
        float inside=step(0.,inner.x)*step(0.,inner.y)*step(inner.x,span.x)*step(inner.y,span.y);
        float pitch=(span.x+3.)/10.;float pip=step(mod(inner.x,pitch),pitch-3.);
        vec3 light=mix(loadingColor,loadingLight,loadingUv.y);
        float stripWidth=span.x*.3;float stripX=stripWidth*(-1.1+4.6*loadingPhase);
        float sweep=step(stripX,inner.x)*step(inner.x,stripX+stripWidth);
        ink=mix(ink,mix(vec3(.0252,.0595,.1221),light,sweep),inside*pip);
        diffuseColor=vec4(ink,(1.-smoothstep(-aa,aa,edge))*opacity);
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>\nfloat aa=.5*max(fwidth(loadingUv.x*loadingSize.x),fwidth(loadingUv.y*loadingSize.y));\n${kind === "floor" ? floor : kind === "portrait" ? portrait : kind === "shadow" ? shadow : gauge}`,
      );
    };
    const mesh = new Mesh(this.geometry, this.material);
    mesh.onBeforeRender = () => {
      const size = this.content.size.value;
      if (size) this.size.value.set(size[0], size[1]);
    };
    this.content.add(mesh);
    this.content.notifyAncestorsChanged();
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Full-bleed stage painting, with the original bottom plate and independent loading-only motion. */
export class GpuRunLoading {
  readonly root = new Container({
    positionType: "absolute",
    positionLeft: 0,
    positionTop: 0,
    width: "100%",
    height: "100%",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  });
  readonly controls = [];
  private readonly plate = stack(
    new Container({
      width: 520,
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      paddingLeft: 12,
      paddingRight: 20,
      paddingY: 12,
      borderWidth: 3,
      borderColor: "#0d233f",
      borderRadius: 12,
      backgroundColor: "#e9f4fb",
      flexShrink: 0,
    }),
    // Above the painting and floor (0) by more than its shadow (-3) and base (-2) sink.
    4,
  );
  private readonly portrait = new Container({
    width: 96,
    height: 96,
    flexShrink: 0,
    borderRadius: 48,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  });
  private readonly avatar;
  private readonly title = new Text({
    text: "",
    fontSize: 22,
    fontWeight: 800,
    color: "#142f50",
  });
  private readonly tip = new Text({
    text: "",
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.45,
    minHeight: 22,
    color: "#536b82",
    flexShrink: 1,
  });
  private readonly gaugeBox = new Container({ width: "100%", height: 18, flexShrink: 0 });
  private readonly floor: LoadingSurface;
  private readonly shadow: LoadingSurface;
  private readonly medal: LoadingSurface;
  private readonly gauge: LoadingSurface;
  private readonly stage: UiStage;
  private elapsed = 0;
  private tipAt = 0;
  private readonly firstTip = Math.floor(Math.random() * tips.length);
  private lastTip = -1;
  private viewportKey = "";

  constructor(
    {
      starter,
      stage: map,
      zone,
    }: { starter: StarterId; stage: StageId; zone: { number: number; count: number } | null },
    stage: UiStage,
  ) {
    this.stage = stage;
    this.show(map, zone);
    // The map's haze tone until its painting has loaded.
    this.root.setProperties({ backgroundColor: stageThemes[map].haze.color });
    const theme = starters[starter].stages[0].form.types[0]!;
    const t = themeColors(theme);
    const colors: [string, string, string, string] = [t.theme, t.deep, t.light, t.soft];
    this.floor = new LoadingSurface("floor", colors, theme);
    this.shadow = new LoadingSurface("shadow", colors, theme);
    stack(this.shadow.content, -3).setProperties({
      positionLeft: -126,
      positionTop: -106,
      positionRight: -126,
      positionBottom: -146,
      width: undefined,
      height: undefined,
    });
    this.medal = new LoadingSurface("portrait", colors, theme);
    this.gauge = new LoadingSurface("gauge", colors, theme);
    this.root.add(
      new Image({
        src: stageThemes[map].loadingArt,
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        keepAspectRatio: false,
      }),
      this.floor.content,
    );
    const base = stack(
      new Container({
        positionType: "absolute",
        positionLeft: -3,
        positionRight: -3,
        positionTop: 2,
        positionBottom: -8,
        borderRadius: 12,
        backgroundColor: "#0d233f",
      }),
      -2,
    );
    const art = fade(
      new Image({
        src: `/art/cards/${theme}.webp`,
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        keepAspectRatio: false,
      }),
      0.12,
    );
    this.plate.add(
      this.shadow.content,
      base,
      art,
      new Container({
        positionType: "absolute",
        positionLeft: 0,
        positionTop: 0,
        width: "100%",
        height: "100%",
        borderWidth: 1,
        borderColor: colors[2],
        borderRadius: 9,
      }),
    );
    stack(this.portrait, 2).setProperties({ borderColor: colors[2] });
    this.portrait.add(this.medal.content);
    this.avatar = stack(
      new Image({
        src: `/art/portraits/${starter}.webp`,
        width: 84,
        height: 84,
      }),
      4,
    );
    this.portrait.add(this.avatar);
    this.gaugeBox.add(this.gauge.content);
    const copy = stack(
      new Container({
        flexDirection: "column",
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        gap: 4,
      }),
      1,
    );
    copy.add(this.title, this.gaugeBox, this.tip);
    this.plate.add(this.portrait, copy);
    this.root.add(this.plate);
    this.update(0);
  }
  /** The map is the run's own; a zone change names the zone being entered as the HUD counts it. */
  show(map: StageId, zone: { number: number; count: number } | null): void {
    const name = stageDefs[map].name;
    this.title.setProperties({
      text: zone ? `进入${name} ${zone.number}/${zone.count}…` : `进入${name}…`,
    });
  }
  update(deltaMs: number): void {
    this.elapsed += deltaMs;
    const v = this.stage.viewport;
    const key = [v.width, v.height, v.scale, ...Object.values(v.safeArea)].join(",");
    if (key !== this.viewportKey) {
      this.viewportKey = key;
      const compact = v.height <= 480 && v.width > v.height;
      this.root.setProperties({
        paddingTop: Math.max(16, v.safeArea.top),
        paddingLeft: Math.max(16, v.safeArea.left),
        paddingRight: Math.max(16, v.safeArea.right),
        paddingBottom: Math.max(16, v.safeArea.bottom) + v.height * (compact ? 0.03 : 0.06),
      });
      this.plate.setProperties({ borderWidth: compact ? 2 : 3 });
      this.portrait.setProperties({ width: compact ? 72 : 96, height: compact ? 72 : 96 });
      this.avatar.setProperties({ width: compact ? 62 : 84, height: compact ? 62 : 84 });
      this.title.setProperties({ fontSize: compact ? 18 : 22 });
      this.tip.setProperties({ fontSize: compact ? 13 : 15, minHeight: compact ? 19 : 22 });
    }
    const tip = (this.firstTip + Math.floor(this.elapsed / 3200)) % tips.length;
    if (tip !== this.lastTip) {
      this.lastTip = tip;
      this.tipAt = this.elapsed;
      this.tip.setProperties({ text: tips[tip]! });
    }
    fade(this.tip, cubicBezier(Math.min(1, (this.elapsed - this.tipAt) / 240), 0, 0, 0.58, 1));
    const hop = (this.elapsed % 1200) / 600;
    this.avatar.setProperties({
      transformTranslateY: -8 * cubicBezier(hop < 1 ? hop : 2 - hop, 0.42, 0, 0.58, 1),
    });
    this.gauge.phase.value = cubicBezier((this.elapsed % 1400) / 1400, 0.42, 0, 0.58, 1);
  }
  dispose(): void {
    this.floor.dispose();
    this.shadow.dispose();
    this.medal.dispose();
    this.gauge.dispose();
    this.root.removeFromParent();
    const parts: { dispose(): void }[] = [];
    this.root.traverse((o) => {
      if (o instanceof Component) parts.push(o);
    });
    for (const part of parts.reverse()) part.dispose();
  }
}
