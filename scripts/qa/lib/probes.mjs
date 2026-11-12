// In-page probes over a UIKit stage, as expression strings for page.evaluate. Each takes `stage` (an
// expression for a UiStage) and, where it names things, `owner` (the window object that holds the
// stage, so scroll areas get stable names such as `codex.listPane`). Geometry is in stage units
// unless named `px` (host CSS px = units × viewport.scale).

const helpers = `
  const visible = (n) => n.isVisible?.value !== false;
  const textOf = (n) => { let t = ""; n.traverse((o) => { if (t || o.constructor.name !== "Text") return;
    const s = o.properties?.peek?.().text; if (typeof s === "string" && s.trim()) t = s.trim().slice(0, 16); }); return t; };
  const box = (n) => { const m = n.globalMatrix?.value?.elements, z = n.size?.value; if (!m || !z) return null;
    const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[4], m[5]), w = z[0] * sx, h = z[1] * sy;
    return { l: m[12] - w / 2, r: m[12] + w / 2, t: m[13] + h / 2, b: m[13] - h / 2, w, h }; };
  const nameIn = (owner, node) => { if (!owner) return null;
    for (const k of Object.keys(owner)) { const v = owner[k]; if (v === node || v?.panel === node || v?.root === node) return k; }
    return null; };
`;

export const scaleInfo = (stage) => `(() => { const st = ${stage}; if (!st) return null;
  return { scale: +st.viewport.scale.toFixed(5), grid: +st.pixelGrid.toFixed(5) }; })()`;

/**
 * Every visible container that can scroll (maxScrollPosition > 0 on an axis), named by the owner's
 * property that holds it when there is one, with the descendants that push past its content edge.
 */
export const scrollAreas = (stage, owner, ownerName) => `(() => { ${helpers}
  const st = ${stage}, owner = ${owner ?? "null"}; if (!st) return { error: "no stage" };
  const out = [];
  st.root.traverse((c) => {
    if (c.properties?.peek?.().overflow !== "scroll") return;
    const ms = c.maxScrollPosition?.value; if (!ms) return;
    const mx = ms[0] ?? 0, my = ms[1] ?? 0; if (mx <= 0.001 && my <= 0.001) return;
    if (!visible(c)) return;
    const own = box(c), y = c.node?.yogaNode;
    const over = [];
    if (own && y) {
      const right = own.r - y.getComputedPadding(2) - y.getComputedBorder(2), bottom = own.b + y.getComputedPadding(3) + y.getComputedBorder(3);
      c.traverse((d) => { if (d === c || !visible(d)) return; const b = box(d); if (!b) return;
        const dx = b.r - right, dy = bottom - b.b;
        if ((dx > 0.001 || dy > 0.001) && over.length < 6) over.push((textOf(d) ? '"' + textOf(d) + '" ' : d.constructor.name + " ") + "dx=" + dx.toFixed(2) + " dy=" + dy.toFixed(2)); });
    }
    const prop = nameIn(owner, c);
    out.push({ name: ${JSON.stringify(ownerName)} + "." + (prop ?? (c.constructor.name + (textOf(c) ? '"' + textOf(c) + '"' : ""))), named: !!prop,
      max: [+mx.toFixed(3), +my.toFixed(3)], size: c.size?.value?.map((v) => +v.toFixed(2)), over });
  });
  return { areas: out };
})()`;

/**
 * Focus rings whose drawn extent (control box grown by the ring's reach) runs past a clipping
 * ancestor's visible box. Reach: the UI's own \`userData.ringReach\` when it publishes one, otherwise
 * computed from \`userData.ring\` ({offset, width}) the way the shader draws it (crispLine whole device
 * pixels plus the half-pixel fringe). A control scrolled (partly) out of its scroller is clipped on
 * purpose; a cut on a side the scroller can still move toward is revealed when focused.
 */
export const rings = (stage, onlyControl) => `(() => { ${helpers}
  const st = ${stage}; if (!st) return { error: "no stage" };
  const only = ${onlyControl ?? "null"};
  const inner = (n) => { const b = box(n), i = n.borderInset?.value; if (!b || !i) return b; return { l: b.l + i[3], r: b.r - i[1], t: b.t - i[0], b: b.b + i[2] }; };
  const g = st.pixelGrid, crisp = (w) => (w <= 0 ? 0 : Math.max(1, Math.round(w * g)) / g);
  const clipped = []; let count = 0, published = 0;
  st.root.traverse((o) => {
    const spec = o.userData?.ring, given = o.userData?.ringReach; if (!spec && given == null) return;
    const control = o.parentContainer?.value; if (!control || !visible(control)) return;
    if (only && control !== only) return;
    const c = box(control); if (!c) return;
    let reach;
    if (typeof given === "number") { reach = given; published++; }
    else reach = Math.sign(spec.offset) * crisp(Math.abs(spec.offset)) + crisp(spec.width) + 0.5 / g;
    count++;
    const ring = { l: c.l - reach, r: c.r + reach, t: c.t + reach, b: c.b - reach };
    for (let a = control.parentContainer.value; a; a = a.parentContainer.value) {
      const overflow = a.properties?.peek?.().overflow; if (!overflow || overflow === "visible") continue;
      const v = inner(a); if (!v) continue;
      if (c.l < v.l - 0.01 || c.r > v.r + 0.01 || c.t > v.t + 0.01 || c.b < v.b - 0.01) return;
      const cut = { left: v.l - ring.l, right: ring.r - v.r, top: ring.t - v.t, bottom: v.b - ring.b };
      const at = a.scrollPosition?.value ?? [0, 0], max = a.maxScrollPosition?.value ?? [];
      const more = { left: at[0] > 0.01, right: at[0] < (max[0] ?? 0) - 0.01, top: at[1] > 0.01, bottom: at[1] < (max[1] ?? 0) - 0.01 };
      const sides = Object.entries(cut).filter(([s, d]) => d > 0.01 && !more[s]).map(([s, d]) => s + " " + d.toFixed(2));
      if (sides.length) { clipped.push('"' + (textOf(control) || control.constructor.name) + '" reach ' + reach.toFixed(2) + " cut by " + (textOf(a) ? '"' + textOf(a) + '"' : a.constructor.name) + ": " + sides.join(", ")); return; }
    }
  });
  return { count, published, clipped };
})()`;

/** Visible UIKit texts holding a character their loaded font has no glyph for (drawn as a solid box). */
export const glyphs = (stage) => `(() => { ${helpers}
  const st = ${stage}; if (!st) return { error: "no stage" };
  const missing = []; let texts = 0, unloaded = 0;
  st.root.traverse((o) => {
    if (o.constructor.name !== "Text" || !visible(o)) return;
    const text = o.properties?.peek?.().text; if (typeof text !== "string" || !text.trim()) return;
    const font = o.fontSignal?.value; texts++;
    if (!font?.glyphInfoMap) { unloaded++; return; }
    const lost = [...new Set([...text].filter((ch) => !/\\s/.test(ch) && !font.glyphInfoMap.has(ch)))];
    if (lost.length) missing.push('"' + text.slice(0, 24) + '" lacks ' + lost.map((ch) => ch + " U+" + ch.codePointAt(0).toString(16).toUpperCase()).join(", "));
  });
  return { texts, unloaded, missing };
})()`;

/**
 * Hit sizes of every control: the owner's \`controls[].panel\` plus every focus-ring host, as their
 * on-screen min side in host CSS px.
 */
export const targets = (stage, owner) => `(() => { ${helpers}
  const st = ${stage}, owner = ${owner ?? "null"}; if (!st) return { error: "no stage" };
  const s = st.viewport.scale, set = new Set();
  for (const c of owner?.controls ?? []) if (c?.panel) set.add(c.panel);
  st.root.traverse((o) => { if (o.userData?.ring || o.userData?.ringReach != null) { const p = o.parentContainer?.value; if (p) set.add(p); } });
  const rows = [];
  for (const p of set) { if (!visible(p)) continue; const b = box(p); if (!b || b.w <= 0 || b.h <= 0) continue;
    if (p.properties?.peek?.().display === "none") continue;
    rows.push({ label: textOf(p) || p.constructor.name, x: +((b.l - st.camera.left) * s).toFixed(0), y: +((st.camera.top - b.t) * s).toFixed(0),
      w: +(b.w * s).toFixed(1), h: +(b.h * s).toFixed(1) }); }
  return { scale: s, rows };
})()`;

/** HUD clock, meta line and compass slot centres against the top row's middle, in host px. */
export const hudCentring = `(() => {
  const h = window.__poketoneUi.run?.hud; if (!h) return { error: "no run HUD" };
  const st = h.stage, cam = st.camera, s = st.viewport.scale, v = st.viewport;
  const mid = (n) => { const m = n?.globalMatrix?.value?.elements; return m ? (m[12] - cam.left) * s : null; };
  const pick = (k) => h[k]?.fill ?? h[k];
  const padL = Math.max(v.safeArea?.left ?? 0, 0) * s, padR = Math.max(v.safeArea?.right ?? 0, 0) * s;
  return { scale: s, rowMid: (padL + v.width * s - padR) / 2, clock: mid(pick("clock")), meta: mid(pick("meta")), compass: mid(h.compassSlot),
    clockText: h.clock?.fill?.properties?.peek?.().text ?? null };
})()`;
