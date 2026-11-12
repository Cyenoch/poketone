/**
 * GLSL `crispLine(width, px)`: a line `width` layout units wide as whole device pixels, at least
 * one (none for 0), where `px` is layout units per device pixel (`fwidth` of a layout-unit
 * coordinate). Browsers round border widths the same way; the shader-side twin of
 * UIKit's `setBorderWidthGrid`, so it follows any stage's scale and pixel ratio by itself.
 *
 * Ties round up, like `Math.round`, with a margin: `fwidth` carries float noise that differs per
 * fragment and per frame, so at a tie (3 units at scale 1.5 is 4.5 pixels) a plain `+.5` picks 4 or 5
 * pixels row by row and a straight edge comes out ragged and shimmering.
 */
export const crispLineGlsl = `float crispLine(float w,float px){return w<=0.?0.:max(px,floor(w/px+.501)*px);}`;
