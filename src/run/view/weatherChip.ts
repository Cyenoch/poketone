import { Container, Content } from "@pmndrs/uikit";
import { Color, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { fade, stack } from "../../ui/gpu/layer";
import { RunHudSurface } from "../../ui/gpu/run-hud-surface";
import { SlantPlate } from "../../ui/gpu/slant-plate";
import { ui } from "../../ui/gpu/tokens";
import { WEATHER } from "../sim/content/params/field-events";
import type { WeatherId } from "../sim/state/field";

/** Each weather's glyph and bar colour. */
export const weatherAccent: Record<WeatherId, string> = {
  sun: "#ffd45b",
  rain: "#8fd0ff",
  sandstorm: "#e8b86a",
  hail: "#d8effb",
};
const GLYPH: Record<WeatherId, number> = { sun: 0, rain: 1, sandstorm: 2, hail: 3 };
/** The forecast's bar: the charge to the weather's start, in a quiet mist. */
const FORECAST = "#8aa7c2";

/** The weather's drawn glyph: a sun, a rain cloud, blowing sand or a hail cloud. */
class WeatherGlyph {
  readonly content = new Content({
    width: 22,
    height: 22,
    flexShrink: 0,
    keepAspectRatio: false,
    depthTest: false,
  });
  readonly uniforms = { glyphKind: { value: 0 }, glyphColor: { value: new Color("#ffffff") } };
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly material = new MeshBasicMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  constructor() {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <uv_pars_vertex>", "#include <uv_pars_vertex>\nvarying vec2 glyphUv;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\nglyphUv=uv;");
      shader.fragmentShader =
        `varying vec2 glyphUv;uniform float glyphKind;uniform vec3 glyphColor;
        float glyphSeg(vec2 p,vec2 a,vec2 b){vec2 v=b-a;return length(p-a-v*clamp(dot(p-a,v)/dot(v,v),0.,1.));}
        float glyphCloud(vec2 p){return min(min(length(p-vec2(-.38,.12))-.3,length(p-vec2(.02,.28))-.4),min(length(p-vec2(.4,.1))-.28,max(abs(p.x)-.66,abs(p.y-.02)-.2)));}\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 p=(glyphUv-.5)*2.;float aa=max(fwidth(p.x),fwidth(p.y))*1.2;float d=1.;
        if(glyphKind<.5){
          d=length(p)-.4;
          float a=atan(p.y,p.x);float k=6.2831853/8.;float s=mod(a+k*.5,k)-k*.5;
          vec2 q=length(p)*vec2(cos(s),sin(s));
          d=min(d,glyphSeg(q,vec2(.58,0.),vec2(.88,0.))-.09);
        }else if(glyphKind<1.5){
          vec2 c=p-vec2(0.,.22);d=glyphCloud(c*1.15)/1.15;
          for(int i=0;i<3;i++){float x=-.42+float(i)*.4;d=min(d,glyphSeg(p,vec2(x+.08,-.32),vec2(x-.04,-.7))-.07);}
        }else if(glyphKind<2.5){
          for(int i=0;i<3;i++){
            float y=.5-float(i)*.48;float l=.7-float(i)*.12;
            float w=abs(p.y-y-.1*sin(p.x*4.+float(i)*1.7))-.075;
            d=min(d,max(w,abs(p.x+.08*float(i))-l));
          }
        }else{
          vec2 c=p-vec2(0.,.22);d=glyphCloud(c*1.15)/1.15;
          for(int i=0;i<3;i++){float x=-.4+float(i)*.4;d=min(d,length(p-vec2(x,-.55-.12*mod(float(i),2.)))-.12);}
        }
        diffuseColor=vec4(glyphColor,(1.-smoothstep(-aa,aa,d))*opacity);`,
      );
    };
    this.material.customProgramCacheKey = () => "run-weather-glyph";
    this.content.add(new Mesh(this.geometry, this.material));
    this.content.notifyAncestorsChanged();
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The weather in the HUD's purse row: its glyph and one bar. Forecast: the glyph breathes and the
 * bar charges in mist to the start, nothing more (no harm is implied before it begins). Active:
 * the bar drains in the weather's colour over its seventy-five seconds. No words.
 */
export class WeatherChip {
  readonly root = new Container({
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingLeft: 8,
    paddingRight: 10,
    flexShrink: 0,
    display: "none",
  });
  private readonly face = new SlantPlate(this.root, { fill: ui.ink, upright: true });
  private readonly glyph = new WeatherGlyph();
  private readonly track = new Container({ width: 40, height: 6, flexShrink: 0 });
  /** Its gauge surface, for the HUD's afterLayout and dispose loop. */
  readonly bar = new RunHudSurface("bar");
  private forecast = false;
  private shown: WeatherId | null = null;

  constructor() {
    this.face.set({ depth: 3 });
    this.track.add(this.bar.content);
    this.root.add(this.face.content, stack(this.glyph.content, 1), stack(this.track, 1));
  }

  set(
    weather: { id: WeatherId; phase: "forecast" | "active"; remaining: number } | null,
    compact: boolean,
  ): void {
    this.root.setProperties({
      display: weather ? "flex" : "none",
      height: compact ? 28 : 32,
      paddingLeft: compact ? 6 : 8,
      paddingRight: compact ? 8 : 10,
    });
    this.track.setProperties({ width: compact ? 32 : 40 });
    this.glyph.content.setProperties({ width: compact ? 18 : 22, height: compact ? 18 : 22 });
    if (!weather) {
      this.shown = null;
      return;
    }
    this.shown = weather.id;
    this.forecast = weather.phase === "forecast";
    this.glyph.uniforms.glyphKind.value = GLYPH[weather.id];
    this.glyph.uniforms.glyphColor.value.set(weatherAccent[weather.id]);
    const fill = this.forecast
      ? 1 - weather.remaining / WEATHER.forecast
      : weather.remaining / WEATHER.seconds;
    this.bar.uniforms.hudFill.value = this.bar.uniforms.hudTrail.value = Math.max(
      0,
      Math.min(1, fill),
    );
    this.bar.uniforms.hudColor.value.set(this.forecast ? FORECAST : weatherAccent[weather.id]);
    if (!this.forecast) fade(this.glyph.content, 1);
  }

  /** The forecast glyph's breathing on the HUD's idle clock; true when it moved. */
  tick(elapsed: number): boolean {
    if (!this.shown || !this.forecast) return false;
    fade(this.glyph.content, 0.55 + 0.45 * (0.5 + 0.5 * Math.cos(elapsed * Math.PI * 2)));
    return true;
  }

  dispose(): void {
    this.face.dispose();
    this.glyph.dispose();
  }
}
