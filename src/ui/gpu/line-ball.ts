import { SLANT } from "./tokens";

const ANGLE = Math.atan(SLANT);

/**
 * A Poké Ball in lines, the lobby stage's language upright (`ball-stage.ts`): its rim, and the seam
 * broken by the button ring around a dot, turned −14° with the curtain. A GLSL chunk:
 * `lineBall(p, ball, width, aa)` gives the rim and dot's and the inner lines' coverage (x, y) at `p` (px,
 * y down) for a ball at `ball.xy` of radius `ball.z`, its lines `width` px wide.
 */
export const LINE_BALL_GLSL = /* glsl */ `
vec2 lineBall(vec2 p, vec3 ball, float width, float aa) {
  vec2 q = p - ball.xy;
  q = vec2(${Math.cos(ANGLE).toFixed(6)} * q.x - ${Math.sin(ANGLE).toFixed(6)} * q.y,
           ${Math.sin(ANGLE).toFixed(6)} * q.x + ${Math.cos(ANGLE).toFixed(6)} * q.y);
  float r = ball.z, d = length(q), h = .5 * width;
  float rim = 1. - smoothstep(h - aa, h + aa, abs(d - r));
  float button = .19 * r;
  float seam = (1. - smoothstep(h - aa, h + aa, abs(q.y))) * step(d, r) * step(button, d);
  float ring = 1. - smoothstep(h - aa, h + aa, abs(d - button));
  float dot = 1. - smoothstep(-aa, aa, d - .08 * r);
  return vec2(max(rim, dot), max(seam, ring));
}
`;
