import { srgb, ui } from "./tokens";

const vec = (hex: string) => {
  const c = srgb(hex);
  return `vec3(${c.x.toFixed(4)},${c.y.toFixed(4)},${c.z.toFixed(4)})`;
};

/**
 * The ground stage a partner stands on, as a GLSL chunk for a host's fullscreen or quad shader: a
 * Poké Ball drawn in lines on the ground — a soft pool of type light, a slowly running dashed outer
 * ring, the ball-red rim, the ink middle seam broken by the button ring and its red dot, and the
 * partner's contact shade. Everything is in display (sRGB) colour, composited over `col`.
 *
 * `ballStage(col, p, centre, rx, time, typeColor, aa)`: `p` and `centre` in px with y down (centre
 * is where the feet stand), `rx` the red rim's horizontal radius (the ground ellipse is 0.35 as
 * tall), `time` seconds on the host's idle clock (the dashes run one lap in about 18s; step it at
 * 30Hz like the rest of the scene), `aa` half a pixel.
 */
export const BALL_STAGE_GLSL = /* glsl */ `
float ballStageEllipse(vec2 p, vec2 r) {
  float k = length(p / r);
  return k * (k - 1.) / max(length(p / (r * r)), 1e-4);
}
float ballStageLine(float d, float width, float aa) {
  return 1. - smoothstep(width * .5 - aa, width * .5 + aa, abs(d));
}
vec3 ballStage(vec3 col, vec2 p, vec2 centre, float rx, float time, vec3 typeColor, float aa) {
  float s = rx / 200.;
  vec2 q = (p - centre) / s;
  float a = aa / s;
  // The pool of type light: 28% at the centre, 8% at 60%, gone at the edge.
  float pool = length(q / vec2(250., 92.));
  col = mix(col, typeColor, pool < .6 ? mix(.28, .08, pool / .6) : mix(.08, 0., min(1., (pool - .6) / .4)));
  // The dashed outer ring (14 on, 10 off along its length), running slowly.
  float dashed = ballStageLine(ballStageEllipse(q, vec2(244., 88.)), 2.5, a);
  float along = atan(q.y / 88., q.x / 244.) * 166. + time * 40.;
  col = mix(col, ${vec("#b9bec8")}, dashed * step(mod(along, 24.), 14.));
  // The ball: its red rim, the ink seam broken by the button ring, the red button.
  col = mix(col, ${vec(ui.ball)}, ballStageLine(ballStageEllipse(q, vec2(200., 70.)), 5., a));
  float seam = ballStageLine(q.y, 4., a) * step(abs(q.x), 200.) * step(38., abs(q.x));
  float ring = ballStageLine(ballStageEllipse(q, vec2(38., 14.)), 4., a);
  col = mix(col, ${vec(ui.ink)}, .85 * max(seam, ring));
  col = mix(col, ${vec(ui.ball)}, 1. - smoothstep(-a, a, ballStageEllipse(q, vec2(16., 6.))));
  // The partner's contact shade.
  col = mix(col, ${vec(ui.ink)}, .1 * (1. - smoothstep(-a, a, ballStageEllipse(q + vec2(0., 8.), vec2(70., 14.)))));
  return col;
}
`;
