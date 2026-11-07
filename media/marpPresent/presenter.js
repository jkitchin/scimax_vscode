/* marp-present: presenter tools for Marp HTML decks (pen, laser pointer, save with ink).
 * Part of scimax-vscode: add `presenter: true` to a Marp deck's front matter, then present or export HTML.
 *
 *   a        annotate: editor.js's edit mode with the pen on and its Annotate row (a again: off);
 *            in the presenter view, toggle the pen alone (widgets are not clickable while it is on)
 *   1-5      pen colour: red, blue, green, black, yellow highlighter
 *   z        undo the last change to this slide's ink (a stroke, an eraser drag, a lasso move, ...)
 *   r        toggle the stroke eraser: drag over strokes to remove them whole (z puts them back)
 *   R        toggle the eraser that rubs out exactly the ink under it (drawn after it: not touched)
 *   c        clear this slide        shift+C  clear every slide
 *   l        toggle the laser pointer (a dot with a fading tail that follows the mouse, also over widgets);
 *            while it is on, 1-5 pick its colour: red, blue, green, black, yellow (remembered)
 *   n        new sticky note at the mouse: type Markdown, click away to render it; drag its bar
 *            to move it, ● picks a colour (yellow, pink, blue, green, orange), – shrinks it to a
 *            📝 icon (click to reopen), × deletes it; right-click a note for the same options
 *   h        show / hide this slide's Markdown (how it is written) in a panel that follows the slides, with a Copy button
 *   right-click  a menu with all of these (Shift+right-click, or right-click in a text field,
 *            gives the browser's own menu)
 *   (hold the mouse button on a slide)  spotlight: the screen darkens except a circle around
 *            the cursor, which follows the mouse until you let go. Not on buttons, links,
 *            sliders, code cells or widgets, and not while the pen is on or x picks a box to zoom.
 *   s        save a standalone copy of the whole deck with the ink in it (<deck>-annotated.html):
 *            one file with the theme, images, iframes, fonts and these tools inlined. Open it
 *            anywhere, keep annotating, press s again. (Needs a deck built by scimax with
 *            `presenter: true`; otherwise s falls back to m.)
 *   m        save the Markdown source with the ink baked in as SVG (<deck>-annotated.md), to
 *            edit or rebuild with Marp next to the original
 *   S        save just the annotations as JSON (a backup you can load again)
 *   i        load annotations from such a JSON file (or drag the file onto the deck)
 *   d        edit the slides' text and layout in place (editor.js); s and S save the edits too
 *            While editing, the bar's Annotate row has a pen, a pencil and a highlighter in any colour,
 *            both erasers, and a lasso (select strokes, then drag, Delete or recolour them): window.__marpInk
 *   Cmd/Ctrl+P  print → "Save as PDF" gives every slide with its ink, as vector graphics
 *
 * The keys also work while a widget has keyboard focus (e.g. after dragging a slider).
 * Ink belongs to the slide it was drawn on and is stored relative to that slide, so it
 * survives slide changes, window resizes and fullscreen. It is kept in localStorage, so a
 * reload does not lose it; shift+C wipes it. A new Present from scimax asks whether to keep
 * what an earlier showing left or start fresh. Save to a file to keep them for good, move them
 * to another machine, or share them. Loading replaces the current ink; the ink it replaced is
 * kept in localStorage under "<key>:before-load" in case you need it back.
 *
 * A deck built with `presenter: offline` also carries Pyodide (in <script id="marp-pyodide">), and s keeps it.
 * The right-click menu's "Save a copy that works offline" saves <deck>-offline.html with Pyodide and
 * the packages the Python cells import put in it (downloaded once, so it needs a connection then).
 *
 * Saving as Markdown needs the deck's source; scimax (src/marp/presenterBundle.ts) embeds it as window.__MARP_SOURCE__, and
 * without it `m` asks you to pick the .md file. Ink stored in a saved deck (the JSON block of a
 * standalone copy, or the SVGs of a deck rebuilt from an annotated .md) comes back as editable
 * ink when it is opened, so annotate → save → reopen → annotate more → save never stacks copies.
 */
(() => {
  const params = new URLSearchParams(location.search);
  if (["presenter", "next", "mic"].includes(params.get("view"))) return;  // presenter window, microphone window (audio.js)
  if (window.__annotate) return;
  window.__annotate = true;
  // Marp's overview (the four squares) shows the deck in a frame with ?view=overview: there the
  // slides only show their ink and notes, small, and the tools are off
  const overview = params.get("view") === "overview";

  const PENS = [
    { color: "#ff3040", width: 4 },
    { color: "#2563eb", width: 4 },
    { color: "#059669", width: 4 },
    { color: "#111827", width: 4 },
    { color: "rgba(250, 204, 21, 0.45)", width: 22 },       // highlighter
  ];
  // A stroke is {pen, pts} with one of the PENS (keys 1-5), or {c, hl, pts} / {c, pencil, pts}: any
  // colour ("#rrggbb") as a pen, a highlighter or a pencil (the editor's Annotate tools). A pen or
  // highlighter stroke that matches one of the PENS is kept as {pen}, so decks saved by older
  // versions and these read each other's ink. Any stroke may carry its own width, w (slide pixels of a
  // 1280-wide slide); without one it has its kind's default. (An older version draws {pen, w} at the
  // default width.)
  const HEX = /^#[0-9a-f]{6}$/i, HL_HEX = "#facc15", PENCIL_HEX = "#4b5563";
  const PEN_W = 4, HL_W = 22, PENCIL_W = 5, HL_ALPHA = 0.45;
  const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;
  // "pen", "hl" or "pencil"
  // An eraser stroke, {erase, w, pts}, takes away the ink drawn before it, under its path (w: its width)
  const kindOf = s => (s.erase ? "erase" : s.c ? (s.pencil ? "pencil" : s.hl ? "hl" : "pen") : s.pen === 4 ? "hl" : "pen");
  const DEFAULT_W = { pen: PEN_W, pencil: PENCIL_W, hl: HL_W }, MIN_W = 1, MAX_W = 80;
  const look = s => {
    if (s.erase) return { color: "#000", width: s.w };
    const base = !s.c ? PENS[s.pen] : s.pencil ? { color: s.c, width: PENCIL_W }
      : { color: s.hl ? rgba(s.c, HL_ALPHA) : s.c, width: s.hl ? HL_W : PEN_W };
    return s.w ? { color: base.color, width: s.w } : base;
  };
  const presetOf = (c, kind) => (kind === "hl" ? (c.toLowerCase() === HL_HEX ? 4 : -1)
    : kind === "pen" ? PENS.findIndex((p, i) => i < 4 && p.color === c.toLowerCase()) : -1);
  const strokeOf = (c, kind, pts, w) => {
    const i = presetOf(c, kind), s = i >= 0 ? { pen: i, pts }
      : kind === "pencil" ? { c: c.toLowerCase(), pencil: true, pts } : { c: c.toLowerCase(), hl: kind === "hl", pts };
    if (w && w !== DEFAULT_W[kind]) s.w = w;
    return s;
  };
  // A pencil stroke is drawn as a bundle of thin strands along its path, each offset sideways,
  // wobbling a little, lighter toward the edges, with ragged ends; painted with a grain texture they
  // give graphite's streaks. The randomness is seeded by the stroke, so it looks the same every
  // time. Points are in slide pixels of an SW x SH slide; widths too.
  const strandCache = new WeakMap();
  // A pencil stroke's grain is seeded by the stroke (seed, or else its first point), so it looks
  // the same every time. A piece the eraser cut off keeps the seed and its distance along the
  // stroke (d0), so its graphite does not change, and its cut ends (open) are not made ragged.
  const seedOf = s => s.seed || (Math.floor(s.pts[0][0] * 7919 + s.pts[0][1] * 104729 + s.pts.length * 31) >>> 0) || 1;
  // Graphite builds up: going over a place again darkens it. The grain has gaps, and a pass that
  // used the same grain would land on the same gaps and never fill them. So each strand is cut into
  // short pieces, painted one by one (a path that crosses itself would be painted once), each with
  // one of GRAINS grains, picked from the stroke's seed and the distance along the stroke: the same
  // for all the strands at a place, so one pass looks as grainy as ever, and a piece the eraser cut
  // off keeps its grain.
  const GRAINS = 8, PIECE = 24;                       // PIECE: slide pixels of a 1280-wide slide
  function grainPieces(pts, dist, seed, SW) {
    const len = PIECE * SW / 1280, pieces = [];
    const bucket = d => Math.floor(d / len);
    const grainOf = b => {
      let h = (seed ^ Math.imul(b + 7, 0x85ebca6b)) >>> 0;
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      return (h ^ (h >>> 13)) % GRAINS;
    };
    let start = 0;
    for (let i = 1; i < pts.length; i++) {
      if (i === pts.length - 1 || bucket(dist[i]) !== bucket(dist[start])) {
        pieces.push({ pts: pts.slice(start, i + 1), grain: grainOf(bucket(dist[start])) });
        start = i;                                    // pieces share their end points, butt to butt
      }
    }
    return pieces;
  }
  function pencilStrands(s, SW, SH) {
    const open = s.open || [false, false];
    const key = [s.pts.length, (s.pts[0] || []).join(), (s.pts[s.pts.length - 1] || []).join(), s.w, SW, SH, s.seed, s.d0, open.join()].join(":");
    const hit = strandCache.get(s);
    if (hit && hit.key === key) return hit.strands;
    const w = look(s).width * SW / 1280;
    const P = s.pts.length === 1 ? [[s.pts[0][0] * SW, s.pts[0][1] * SH], [s.pts[0][0] * SW + 0.5, s.pts[0][1] * SH]]
      : s.pts.map(([u, v]) => [u * SW, v * SH]);
    // the normal at each point (from its neighbours)
    const N = P.map((_, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [-dy / L, dx / L];
    });
    // distance along the stroke, for a wobble that follows it smoothly
    const D = [(s.d0 || 0) * SW / 1280];
    for (let i = 1; i < P.length; i++) D.push(D[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    let seed = seedOf(s);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const n = Math.max(3, Math.min(30, Math.round(w / 1.1)));
    const strands = [];
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * 2 - 1 + (rnd() - 0.5) * (1.2 / n);   // across the stroke, -1 .. 1
      const edge = Math.min(1, Math.abs(t));
      const off = t * w / 2, amp = w * (0.03 + 0.05 * rnd()), freq = 0.02 + 0.05 * rnd(), phase = rnd() * 6.3;
      let pts = P.map((p, i) => {
        const o = off + amp * Math.sin(D[i] * freq + phase);
        return [p[0] + N[i][0] * o, p[1] + N[i][1] * o];
      });
      let dist = D;                                     // each point's distance along the stroke
      // ragged ends: the outer strands start later and stop sooner (not where the eraser cut). By
      // distance, not by point, so a piece cut off a stroke keeps its end as it was.
      const r1 = rnd(), r2 = rnd();                     // always drawn, so the rest of the grain stays put
      const L = D[D.length - 1] - D[0];
      let trimA = open[0] ? 0 : 2.5 * w * edge * r1, trimB = open[1] ? 0 : 2.5 * w * edge * r2;
      if (trimA + trimB > 0.5 * L) { const f = 0.5 * L / (trimA + trimB); trimA *= f; trimB *= f; }   // a short stroke
      if (trimA || trimB) {                             // cut at exactly that distance, however the points are spaced
        const from = D[0] + trimA, to = D[D.length - 1] - trimB;
        const at = d => {                               // the point at distance d along the strand
          let i = 1;
          while (i < D.length - 1 && D[i] < d) i++;
          const f = D[i] > D[i - 1] ? (d - D[i - 1]) / (D[i] - D[i - 1]) : 0;
          return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
        };
        if (to > from) {
          const keep = D.map((d, i) => i).filter(i => D[i] > from && D[i] < to);
          pts = [at(from), ...keep.map(i => pts[i]), at(to)];
          dist = [from, ...keep.map(i => D[i]), to];
        }
      }
      if (pts.length < 2) continue;
      strands.push({
        pts,
        pieces: grainPieces(pts, dist, seedOf(s), SW),
        width: Math.max(0.5, (w / n) * (0.8 + 0.9 * rnd())),
        alpha: (0.75 - 0.5 * edge * edge) * (0.65 + 0.35 * rnd()),
      });
    }
    strandCache.set(s, { key, strands });
    return strands;
  }
  const validW = w => w === undefined || (typeof w === "number" && w >= MIN_W && w <= MAX_W);
  // cuts: the eraser's bites out of a stroke, [{w, pts}], moved with it. ({erase, w, pts} records,
  // from a build that kept the eraser as a stroke of its own, are turned into cuts when read.)
  // A cut is the eraser's path, {w, pts}, or a lasso's loop, {poly}: the ink inside it is taken away,
  // or with keep, everything outside it (the piece a lasso cut out keeps only what was inside).
  const validCut = c => c && (Array.isArray(c.poly) ? c.poly.length > 2 && (c.keep === undefined || typeof c.keep === "boolean")
    : typeof c.w === "number" && c.w > 0 && c.w <= 2 * MAX_W && Array.isArray(c.pts));
  const copyCut = c => (c.poly ? Object.assign({ poly: c.poly.map(p => p.slice()) }, c.keep ? { keep: true } : {})
    : { w: c.w, pts: c.pts.map(p => p.slice()) });
  const validStroke = s => !!(s && Array.isArray(s.pts) && (s.erase === true
    ? typeof s.w === "number" && s.w >= MIN_W && s.w <= 2 * MAX_W
    : validW(s.w) && (s.c !== undefined ? typeof s.c === "string" && HEX.test(s.c) : PENS[s.pen]) &&
      (s.cuts === undefined || (Array.isArray(s.cuts) && s.cuts.every(validCut)))));
  // The laser pointer's colours, as "r,g,b": the pens' colours
  const LASERS = [["255,32,48", "red"], ["37,99,235", "blue"], ["5,150,105", "green"], ["17,24,39", "black"], ["250,204,21", "yellow"]];
  const LASER_PREF = "marp-laser-colour";
  let laserColour = 0;
  try { laserColour = Math.min(LASERS.length - 1, Math.max(0, +localStorage.getItem(LASER_PREF) || 0)); } catch (e) { /* storage blocked */ }
  const KEY = "marp-ink:" + location.pathname;
  try {                                               // ink saved by the first (DOE) version
    const old = "doe-slides-ink:" + location.pathname;
    if (localStorage.getItem(old) && !localStorage.getItem(KEY)) localStorage.setItem(KEY, localStorage.getItem(old));
  } catch (e) { /* storage blocked */ }

  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed", inset: "0", zIndex: "99999", pointerEvents: "none",
    cursor: "crosshair", touchAction: "none",
  });
  const badge = document.createElement("div");
  Object.assign(badge.style, {
    position: "fixed", left: "14px", bottom: "14px", zIndex: "100000", display: "none",
    padding: "4px 12px", borderRadius: "999px", color: "white", fontSize: "14px",
    fontFamily: "Helvetica, Arial, sans-serif", boxShadow: "0 1px 4px rgba(0,0,0,.3)",
  });
  const style = document.createElement("style");
  const HIDE_CURSOR = "html.laser-on, html.laser-on * { cursor: none !important; }";
  style.textContent = "@media print { .annotate-layer { display: none !important; } }\n" + HIDE_CURSOR +
    "\n@media screen { svg.marp-ink:not(.thumb-ink) { display: none !important; } }" +   // baked ink: the canvas draws it on screen
    // the slideshow's ink and notes are of the slide on screen: hide them while the overview is open
    "\nbody:has(.bespoke-marp-overview[data-open=\"1\"]) .annotate-layer { visibility: hidden !important; }";
  const laser = document.createElement("div");
  Object.assign(laser.style, {
    position: "fixed", left: "0", top: "0", zIndex: "100001", pointerEvents: "none", display: "none",
    width: "22px", height: "22px", margin: "-11px 0 0 -11px", borderRadius: "50%",
  });
  function paintLaser() {
    const c = LASERS[laserColour][0];
    laser.style.background = `radial-gradient(circle, #fff 0 18%, rgb(${c}) 32%, rgba(${c},.55) 60%, rgba(${c},0) 72%)`;
    laser.style.boxShadow = `0 0 14px 6px rgba(${c},.45)`;
  }
  paintLaser();
  const trail = document.createElement("canvas");     // the laser's fading tail
  Object.assign(trail.style, {
    position: "fixed", inset: "0", zIndex: "100000", pointerEvents: "none", display: "none",
  });
  const toast = document.createElement("div");
  Object.assign(toast.style, {
    position: "fixed", left: "50%", top: "18px", transform: "translateX(-50%)", zIndex: "100002",
    padding: "8px 18px", borderRadius: "8px", background: "rgba(17,24,39,.92)", color: "white",
    fontSize: "15px", fontFamily: "Helvetica, Arial, sans-serif", pointerEvents: "none",
    opacity: "0", transition: "opacity .3s",
  });
  const spot = document.createElement("div");
  Object.assign(spot.style, {
    position: "fixed", inset: "0", zIndex: "99998", pointerEvents: "none",
    opacity: "0", transition: "opacity .15s ease-out", visibility: "hidden",
  });
  canvas.className = badge.className = laser.className = trail.className = toast.className = spot.className = "annotate-layer";
  document.head.appendChild(style);
  document.body.append(spot, canvas, badge, trail, laser, toast);
  let toastTimer = null;
  const say = msg => {
    toast.textContent = msg; toast.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.opacity = "0"; }, 3500);
  };
  window.__marpSay = say;                             // captions.js and recorder.js report here too
  const ctx = canvas.getContext("2d");

  let ink = {}, notes = {};           // per slide ("1", "2", ...): strokes, and sticky notes
  try { ink = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { ink = {}; }
  let migrateOnStart = Object.values(ink).some(l => Array.isArray(l) && l.some(st => st && st.erase));   // once the slides are laid out
  try { notes = JSON.parse(localStorage.getItem(KEY + ":notes")) || {}; } catch (e) { notes = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ink)); } catch (e) { /* private mode */ } };
  const saveNotes = () => { try { localStorage.setItem(KEY + ":notes", JSON.stringify(notes)); } catch (e) { /* private mode */ } };

  let enabled = false, stroke = null, laserOn = false;
  let brush = "pen";                                  // what the pen draws: "pen", "pencil" or "hl" (highlighter)
  const colors = { pen: PENS[0].color, pencil: PENCIL_HEX, hl: HL_HEX };
  const widths = { pen: PEN_W, pencil: PENCIL_W, hl: HL_W, rub: 12 };   // each tool's size (rub: the eraser's radius)
  // the eraser: whole strokes it touches, or (area) only the ink under it; what one drag of it changed
  let erasing = false, rubArea = false, rubbing = null;
  let lassoOn = false, lasso = null, sel = [], moving = null;   // the lasso: the loop drawn, the strokes it selected, a move
  // Undo (z): per slide, the strokes as they were before each change (a stroke, an eraser drag, a move, ...)
  const history = {};
  // A lasso that cuts strokes at its loop changes nothing you can see, so it is no undo step of its
  // own: the next change (moving, deleting, ... the selection) undoes back to before the cut.
  let preSplit = null;
  const checkpoint = (id = slideId()) => {
    const h = history[id] = history[id] || [];
    if (preSplit && preSplit.id === id) { h.push(preSplit.json); preSplit = null; } else h.push(JSON.stringify(ink[id] || []));
    if (h.length > 200) h.shift();
  };
  const inkListeners = [];                            // the editor's Annotate bar follows the tools
  const forget = () => { Object.keys(history).forEach(id => delete history[id]); sel = []; lasso = moving = preSplit = null; };   // the ink was replaced

  // ---- save / load annotations as a JSON file ----
  const DECK = decodeURIComponent(location.pathname.split("/").pop() || "slides").replace(/\.html?$/, "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const count = (ink, nts = {}) => {
    const has = o => Object.keys(o).filter(k => o[k] && o[k].length);
    const ids = new Set([...has(ink), ...has(nts)]);
    return { slides: ids.size, strokes: has(ink).reduce((n, k) => n + ink[k].filter(s => !s.erase).length, 0),
             notes: has(nts).reduce((n, k) => n + nts[k].length, 0) };
  };
  const total = () => count(ink, notes);
  // Text and layout edits from editor.js (d), saved alongside the ink
  const edits = () => (window.__marpEdits ? window.__marpEdits.data() : {});
  const editCount = () => (window.__marpEdits ? window.__marpEdits.count() : 0);
  const nothing = c => !c.strokes && !c.notes && !editCount();
  const describe = c => [(c.strokes || c.notes) && [c.strokes && plural(c.strokes, "stroke"), c.notes && plural(c.notes, "note")]
      .filter(Boolean).join(" and ") + " on " + plural(c.slides, "slide"),
    editCount() && plural(editCount(), "text or layout edit")].filter(Boolean).join(", and ");
  const validInk = o => o && typeof o === "object" && Object.values(o).every(v => Array.isArray(v) && v.every(validStroke));
  const validNotes = o => o && typeof o === "object" && Object.values(o).every(v => Array.isArray(v) && v.every(n => n && typeof n.text === "string" && isFinite(n.x) && isFinite(n.y)));
  function download(text, name, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function saveJson() {
    const c = total();
    if (nothing(c)) { say("Nothing to save: no annotations yet"); return; }
    const now = new Date(), pad = n => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const name = `${DECK}-annotations-${stamp}.json`;
    download(JSON.stringify({ format: "marp-ink", version: 2, deck: DECK, saved: now.toISOString(), ink, notes, edits: edits() }, null, 1),
             name, "application/json");
    say(`Saved ${describe(c)} → ${name}`);
  }

  // ---- ink as SVG: one overlay per slide, in the slide's own coordinates ----
  // A slide's size is its viewBox: 1280 x 720 for Marp's 16:9, anything a theme's @size says
  // (a poster, 4:3). Pen widths are for a 1280-wide slide and scale with the slide's width.
  const slideSize = svg => {
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    return vb && vb.width && vb.height ? [vb.width, vb.height] : [1280, 720];
  };
  let filterCount = 0;
  function inkSvg(strokes, extraClass = "", [SW, SH] = [1280, 720]) {
    const k = SW / 1280, fid = "mp-pencil-" + (++filterCount);   // ids unique in the page: one filter per overlay
    // Pencil grain: fractal noise as an alpha mask over the stroke
    const masks = [];
    // (GRAINS of them, one noise seed each: see grainPieces)
    const pencil = strokes.some(s => s.pencil) ? Array.from({ length: GRAINS }, (_, g) =>
      `<filter id="${fid}-${g}" x="-10%" y="-10%" width="120%" height="120%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="${7 + 101 * g}" result="n"/>` +
      `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.2 -0.55" result="g"/>` +
      `<feComposite in="SourceGraphic" in2="g" operator="in"/></filter>`).join("") : "";
    // An eraser stroke masks everything drawn before it: that ink goes in a group with a mask that
    // is white except under the eraser. Its own polyline (unpainted) follows, for a saved deck to read back.
    let lines = "";
    strokes.forEach(s => {
      const p = look(s), pts = s.pts.length === 1 ? [s.pts[0], [s.pts[0][0] + 1e-4, s.pts[0][1]]] : s.pts;
      const xy = pts.map(([u, v]) => `${(u * SW).toFixed(1)},${(v * SH).toFixed(1)}`).join(" ");
      if (s.erase) {
        const mid = `${fid}-erase-${masks.length + 1}`;
        masks.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SW}" height="${SH}">` +
          `<rect width="${SW}" height="${SH}" fill="white"/><polyline data-pen="-1" points="${xy}" fill="none" stroke="black" ` +
          `stroke-width="${+(s.w * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></mask>`);
        lines = `<g mask="url(#${mid})">${lines}</g><polyline data-erase="1" data-w="${s.w}" points="${xy}" fill="none" stroke="none"/>`;
        return;
      }
      // what else a stroke carries (the eraser's cuts, a pencil piece's grain), for a saved deck to read back
      const extra = {};
      ["cuts", "seed", "d0", "open"].forEach(f => { if (s[f] !== undefined) extra[f] = s[f]; });
      const el = (() => {
        const kind = (s.c ? `data-c="${s.c}"${s.hl ? ' data-hl="1"' : ""}${s.pencil ? ' data-pencil="1"' : ""}` : `data-pen="${s.pen}"`) + (s.w ? ` data-w="${s.w}"` : "") +
          (Object.keys(extra).length ? ` data-x="${JSON.stringify(extra).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"` : "");
        if (s.pencil) {
          // the stroke itself, unpainted (it is what a saved deck reads back), and its strands with the
          // grain. The strands' data-pen="-1" is no pen, so neither this version nor an older one reads them as ink.
          // Each strand's pieces, grouped by grain: butt ends, so pieces that meet do not overlap.
          const byGrain = Array.from({ length: GRAINS }, () => "");
          pencilStrands(s, SW, SH).forEach(st => st.pieces.forEach(pc => {
            byGrain[pc.grain] += `<polyline data-pen="-1" points="${pc.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" ` +
              `stroke-width="${st.width.toFixed(2)}" stroke-opacity="${st.alpha.toFixed(2)}"/>`;
          }));
          return `<polyline ${kind} points="${xy}" fill="none" stroke="none"/>` +
            `<g fill="none" stroke="${s.c}" stroke-linecap="butt" stroke-linejoin="round">` +
            byGrain.map((g, i) => (g ? `<g filter="url(#${fid}-${i})">${g}</g>` : "")).join("") + `</g>`;
        }
        return `<polyline ${kind} points="${xy}" fill="none" stroke="${p.color}" stroke-width="${+(p.width * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
      })();
      if (!s.cuts || !s.cuts.length) { lines += el; return; }
      // the eraser's cuts: a mask of this stroke alone, white except under them
      const mid = `${fid}-cut-${masks.length + 1}`;
      masks.push(`<mask id="${mid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" fill="white"/>` +
        s.cuts.map(c => {
          const xy = pts => pts.map(([u, v]) => `${(u * SW).toFixed(1)},${(v * SH).toFixed(1)}`);
          if (c.poly && c.keep) return `<path d="M0,0H${SW}V${SH}H0Z M${xy(c.poly).join(" L")} Z" fill="black" fill-rule="evenodd"/>`;
          if (c.poly) return `<polygon points="${xy(c.poly).join(" ")}" fill="black"/>`;
          return `<polyline data-pen="-1" points="${xy(c.pts).join(" ")}" fill="none" stroke="black" ` +
            `stroke-width="${+(c.w * k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }).join("") + `</mask>`);
      lines += `<g mask="url(#${mid})">${el}</g>`;
    });
    const defs = pencil || masks.length ? `<defs>${pencil}${masks.join("")}</defs>` : "";
    return `<svg class="marp-ink${extraClass}" viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none" ` +
      `style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:50">${defs}${lines}</svg>`;
  }
  const sectionOf = svg => svg.querySelector("foreignObject > section") || svg.querySelector("section");

  // Printing (Cmd/Ctrl+P -> Save as PDF): put the ink on every slide for the printout.
  addEventListener("beforeprint", () => {
    document.querySelectorAll("svg.marp-ink:not(.print-ink)").forEach(el => { el.dataset.hidden = "1"; el.style.display = "none"; });
    slides().forEach((svg, i) => {
      const strokes = ink[idOf(svg, i)], sec = sectionOf(svg);
      if (strokes && strokes.length && sec) sec.insertAdjacentHTML("beforeend", inkSvg(strokes, " print-ink", slideSize(svg)));
      if (sec) (notes[idOf(svg, i)] || []).forEach(n => sec.appendChild(printNote(n, slideSize(svg))));
    });
  });
  addEventListener("afterprint", () => {
    document.querySelectorAll("svg.print-ink, .mp-print-note").forEach(el => el.remove());
    document.querySelectorAll("svg.marp-ink[data-hidden]").forEach(el => { el.style.display = ""; delete el.dataset.hidden; });
  });

  // ---- save the whole presentation as Markdown with the ink baked in ----
  let source = null;                                  // the deck's Markdown (window.__MARP_SOURCE__)
  const loadSource = () => { if (typeof window.__MARP_SOURCE__ === "string") source = window.__MARP_SOURCE__; };
  // Split Marp Markdown into its slides the way Marp does: front matter, then `---` rules
  // (outside code fences, on their own line after a blank line).
  function splitSlides(src) {
    const lines = src.replace(/\r\n/g, "\n").split("\n");
    let start = 0;
    if (/^---\s*$/.test(lines[0])) {
      const end = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
      if (end > 0) start = end + 1;
    }
    const chunks = [[]], seps = [];
    let fence = null;
    for (let i = start; i < lines.length; i++) {
      const l = lines[i], m = l.match(/^\s*(`{3,}|~{3,})/);
      if (m) { if (!fence) fence = m[1]; else if (m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; }
      if (!fence && /^(---|\*\*\*|___)\s*$/.test(l) && (i === start || lines[i - 1].trim() === "")) {
        seps.push(l); chunks.push([]); continue;
      }
      chunks[chunks.length - 1].push(l);
    }
    return { head: lines.slice(0, start), chunks, seps };
  }
  function annotatedMarkdown(src) {
    // drop ink baked in by an earlier save (and the blank line we put before it)
    const kept = [];
    for (const l of src.split("\n")) {
      if (l.startsWith('<svg class="marp-ink') || l.startsWith(NOTES_TAG)) { if (kept.length && kept[kept.length - 1].trim() === "") kept.pop(); }
      else kept.push(l);
    }
    const clean = kept.join("\n");
    const { head, chunks, seps } = splitSlides(clean);
    // The Markdown has the slides as built: hidden ones too, not ones added in the slideshow
    const n = window.__marpSlides ? window.__marpSlides.original : slides().length, size = slideSize(slides()[0]);
    if (n && chunks.length !== n) throw new Error(`the Markdown has ${chunks.length} slides but the deck shows ${n}`);
    chunks.forEach((c, i) => {
      const strokes = ink[String(i + 1)], nts = notes[String(i + 1)], add = [];
      if (strokes && strokes.length) add.push("", inkSvg(strokes, "", size));
      if (nts && nts.length) add.push("", NOTES_TAG + JSON.stringify(nts).replace(/</g, "\\u003c") + "</script>");
      if (!add.length) return;
      let last = c.length - 1;
      while (last >= 0 && c[last].trim() === "") last--;
      c.splice(last + 1, 0, ...add);
    });
    return [...head, ...chunks.flatMap((c, i) => i ? [seps[i - 1], ...c] : c)].join("\n");
  }
  async function saveMarkdown() {
    const c = total();
    if (!c.strokes && !c.notes) { say(editCount() ? "No ink or notes to save: text and layout edits are saved with s" : "Nothing to save: no annotations yet"); return; }
    if (!source) { mdPicker.click(); return; }       // not bundled: ask for the .md
    let text;
    try { text = annotatedMarkdown(source); } catch (e) { say("Could not save Markdown: " + e.message + ". Press S to save the ink as JSON."); return; }
    const name = DECK.replace(/-annotated$/, "") + "-annotated.md";
    const lost = editCount() ? " Text and layout edits, and slides added, hidden or moved, are not in Markdown: press s to keep them." : "";
    await writeFile(text, name, "Markdown", "text/markdown", ".md",
      `Saved ${name} to Downloads. Build it next to the original .md so its images and widgets resolve.${lost}`);
  }
  // Chrome/Edge let you choose where the file goes; elsewhere (or if that fails) it downloads.
  async function writeFile(text, name, what, type, ext, downloadedMsg) {
    const c = total();
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: what, accept: { [type]: [ext] } }] });
        const w = await h.createWritable(); await w.write(text); await w.close();
        const done = describe(c);
        say(done ? `Saved ${done} → ${h.name}` : `Saved ${h.name}`);
        return;
      } catch (e) { if (e.name === "AbortError") return; /* otherwise fall back to a download */ }
    }
    download(text, name, type);
    say(downloadedMsg || `Saved ${name} to Downloads`);
  }

  // ---- save a standalone copy of the whole deck, ink included ----
  // scimax (src/marp/presenterBundle.ts) puts a base64 copy of the pristine page in <script id="marp-self"> and an empty
  // <script id="marp-ink-data">. The copy is written back out with the ink filled in and the
  // self-copy restored, so every saved deck can be annotated and saved again. (The tags are
  // assembled from pieces so these literals never match themselves inside the page.)
  const TAG = (type, id) => "<script type=\"" + type + "\" id=\"marp-" + id + "\">";
  const NOTES_TAG = "<script type=\"application/json\" class=\"marp-" + "notes\">";   // notes in an annotated .md
  const INK_EMPTY = TAG("application/json", "ink-data") + "{}</script>";
  const SELF_EMPTY = TAG("text/plain", "self") + "</script>";
  // an offline deck's Pyodide files are not in the copy (they would double its size): take them from this page
  const PYODIDE_EMPTY = TAG("application/json", "pyodide") + "</script>";
  const selfCopy = () => { const el = document.getElementById("marp-self"); return el && el.textContent.trim(); };
  const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)));
  const b64encode = str => b64bytes(new TextEncoder().encode(str));
  const b64bytes = bytes => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  // offline: also put Pyodide and the packages the cells import in the copy (<deck>-offline.html),
  // as `presenter: offline` does when scimax builds the deck
  async function saveStandalone(offline) {
    if (!offline && nothing(total())) { say("Nothing to save: no annotations yet"); return; }
    let b64 = selfCopy();
    if (!b64) {
      if (offline) { say("This deck was not built with scimax presenter tools: use presenter: offline in its front matter instead"); return; }
      say("This deck was not built with scimax presenter tools, so saving the Markdown instead"); saveMarkdown(); return;
    }
    let page = b64decode(b64);
    if (!page.includes(INK_EMPTY) || !page.includes(SELF_EMPTY)) { say("Could not save: the embedded copy of the deck is damaged. Press m or S instead."); return; }
    const el = document.getElementById("marp-pyodide");
    let pyodide = el ? el.textContent : "", pipNote = "";
    if (offline && !pyodide.trim() && window.__PYCELLS_PYODIDE__) {
      let got;
      try { got = await offlinePython(window.__PYCELLS_PYODIDE__); }
      catch (e) { say("Could not get Python for offline use (" + e.message + "). It is downloaded once, so this needs an internet connection."); return; }
      pyodide = got.json;
      if (got.pip) pipNote = " Cells that %pip install still need a connection.";
      if (!page.includes(PYODIDE_EMPTY)) { page = page.replace(SELF_EMPTY, () => SELF_EMPTY + PYODIDE_EMPTY); b64 = b64encode(page); }
    }
    const inkJson = JSON.stringify({ ink, notes, edits: edits() }).replace(/</g, "\\u003c");
    const text = page.replace(INK_EMPTY, () => INK_EMPTY.replace("{}", inkJson))
                     .replace(SELF_EMPTY, () => SELF_EMPTY.replace("</script>", b64 + "</script>"))
                     .replace(PYODIDE_EMPTY, () => PYODIDE_EMPTY.replace("</script>", pyodide + "</script>"));
    const base = DECK.replace(/-(annotated|offline)$/, "");
    const name = base + (offline || /-offline$/.test(DECK) ? "-offline.html" : "-annotated.html");
    await writeFile(text, name, "Web page", "text/html", ".html",
      offline ? `Saved ${name} to Downloads: it works without internet.${pipNote}` : undefined);
    if (offline && pipNote) setTimeout(() => say(pipNote.trim()), 3600);
  }

  // Pyodide's own files, micropip, and the Pyodide packages the Python cells import with what they
  // depend on: the same choice as planOfflinePython in src/marp/presenterBundle.ts.
  async function offlinePython(BASE) {
    const get = async name => {
      const r = await fetch(BASE + name);
      if (!r.ok) throw new Error(name + ": HTTP " + r.status);
      return new Uint8Array(await r.arrayBuffer());
    };
    say("Getting Python for offline use…");
    const lockBytes = await get("pyodide-lock.json");
    const lock = JSON.parse(new TextDecoder().decode(lockBytes)).packages || {};
    const code = [];
    const fence = /^([ \t]*)(`{3,}|~{3,})[ \t]*(python|py|python3)\b([^\n]*)\n([\s\S]*?)^\1\2[ \t]*$/gim;
    for (let m; source && (m = fence.exec(source.replace(/\r\n/g, "\n")));) if (m[4].trim().split(/\s+/).includes("run")) code.push(m[5]);
    document.querySelectorAll(".pyc .cm-content").forEach(c => code.push(c.innerText));   // cells as edited now
    const byImport = {};
    for (const [name, pkg] of Object.entries(lock)) for (const imp of pkg.imports || []) byImport[imp] = name;
    const wanted = ["micropip"];
    for (const line of code.join("\n").split("\n")) {
      const imp = line.match(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/);
      const from = line.match(/^\s*from\s+(\w[\w.]*)\s+import\b/);
      const names = imp ? imp[1].split(",").map(p => p.trim().split(/[.\s]/)[0]) : from ? [from[1].split(".")[0]] : [];
      for (const n of names) if (byImport[n] || lock[n]) wanted.push(byImport[n] || n);
    }
    const packages = new Set(), stack = [...wanted];
    while (stack.length) {
      const n = stack.pop();
      if (packages.has(n) || !lock[n]) continue;
      packages.add(n);
      stack.push(...(lock[n].depends || []));
    }
    const names = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", ...[...packages].map(n => lock[n].file_name)];
    const files = { "pyodide-lock.json": b64bytes(lockBytes) };
    for (let i = 0; i < names.length; i++) {
      say(`Getting Python for offline use: ${i + 1} of ${names.length} files…`);
      files[names[i]] = b64bytes(await get(names[i]));
    }
    // Base64 and file names never contain '<', so the JSON cannot close the script
    return { json: JSON.stringify(files), pip: code.some(c => /^\s*[%!]pip\s/m.test(c)) };
  }
  const mdPicker = document.createElement("input");
  Object.assign(mdPicker, { type: "file", accept: ".md,text/markdown" });
  mdPicker.style.display = "none";
  mdPicker.addEventListener("change", () => {
    const f = mdPicker.files[0]; mdPicker.value = "";
    if (f) f.text().then(t => { source = t; saveMarkdown(); });
  });

  // Ink baked into a deck built from an annotated .md: make it editable again. It replaces the
  // stored ink only when the baked ink changed (i.e. the deck was rebuilt from a newer save).
  function importBaked() {
    let bInk = {}, bNotes = {};
    try {
      const el = document.getElementById("marp-ink-data"), data = el ? JSON.parse(el.textContent || "{}") : {};
      if (data && data.ink !== undefined) {                 // {ink, notes} (with notes)
        if (validInk(data.ink)) bInk = data.ink;
        if (validNotes(data.notes)) bNotes = data.notes;
      } else if (validInk(data)) bInk = data;                // ink only (older saves)
    } catch (e) { /* no or bad ink block */ }
    if (nothing(count(bInk, bNotes))) slides().forEach((svg, i) => {
      svg.querySelectorAll("svg.marp-ink:not(.print-ink) polyline").forEach(pl => {
        const [SW, SH] = slideSize(pl.ownerSVGElement);
        const pen = +pl.getAttribute("data-pen"), c = pl.getAttribute("data-c"), pts = (pl.getAttribute("points") || "").trim().split(/\s+/)
          .map(p => p.split(",").map(Number)).filter(p => p.length === 2 && p.every(isFinite)).map(([x, y]) => [x / SW, y / SH]);
        const s = pl.hasAttribute("data-erase") ? { erase: true, pts } : !c ? { pen, pts }
          : pl.hasAttribute("data-pencil") ? { c, pencil: true, pts } : { c, hl: pl.hasAttribute("data-hl"), pts };
        if (pl.hasAttribute("data-w")) s.w = +pl.getAttribute("data-w");
        try { Object.assign(s, JSON.parse(pl.getAttribute("data-x") || "{}")); } catch (e) { /* not ours */ }
        if (validStroke(s) && pts.length) (bInk[idOf(svg, i)] = bInk[idOf(svg, i)] || []).push(s);
      });
      svg.querySelectorAll("script.marp-notes").forEach(sc => {
        try { const v = JSON.parse(sc.textContent); if (validNotes({ x: v })) bNotes[idOf(svg, i)] = (bNotes[idOf(svg, i)] || []).concat(v); } catch (e) { /* ignore */ }
      });
    });
    const sig = JSON.stringify({ ink: bInk, notes: bNotes });
    let seen = null; try { seen = localStorage.getItem(KEY + ":baked"); } catch (e) { /* ignore */ }
    if (nothing(count(bInk, bNotes)) || sig === seen) return;
    try { localStorage.setItem(KEY + ":before-load", JSON.stringify({ ink, notes })); localStorage.setItem(KEY + ":baked", sig); } catch (e) { /* ignore */ }
    ink = migrateErasers(bInk); notes = bNotes; forget(); save(); saveNotes(); redraw(); buildNotes();
  }
  function loadText(text, name) {
    let data;
    try { data = JSON.parse(text); } catch (e) { say(`Could not read ${name}: not a JSON file`); return; }
    const valid = data && data.format === "marp-ink" && validInk(data.ink) && (data.notes === undefined || validNotes(data.notes));
    if (!valid) { say(`${name} is not an annotation file saved from these slides`); return; }
    try { localStorage.setItem(KEY + ":before-load", JSON.stringify({ ink, notes })); } catch (e) { /* ignore */ }
    ink = migrateErasers(data.ink); notes = data.notes || {}; stroke = null; forget(); save(); saveNotes(); redraw(); buildNotes();
    if (data.edits && window.__marpEdits) window.__marpEdits.replace(data.edits);
    say(`Loaded ${describe(total())} from ${name}` +
        (data.deck && data.deck !== DECK ? ` (saved from "${data.deck}")` : ""));
  }
  const readFile = f => { if (f) f.text().then(t => loadText(t, f.name)); };
  const picker = document.createElement("input");
  Object.assign(picker, { type: "file", accept: ".json,application/json" });
  picker.style.display = "none";
  picker.addEventListener("change", () => { readFile(picker.files[0]); picker.value = ""; });
  document.body.appendChild(picker);
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  function acceptDrops(w) {
    w.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
    w.addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); readFile(e.dataTransfer.files[0]); });
  }
  acceptDrops(window);
  document.body.appendChild(mdPicker);

  // The visible slide: Marp's bespoke template marks it with .bespoke-marp-active. (It updates
  // the URL with history.replaceState, which fires no hashchange, so we watch the class.)
  const slides = () => [...document.querySelectorAll("svg[data-marpit-svg]")];
  const activeSvg = () => document.querySelector("svg[data-marpit-svg].bespoke-marp-active");
  // Ink and notes are kept by slide: its number as built, or its id if added in the slideshow
  // (slides.js stamps both), so they stay with their slide when slides are added or hidden
  const idOf = (svg, i) => (svg && svg.dataset.mpSlide) || String(i + 1);
  const slideId = () => {
    const all = slides(), i = all.indexOf(activeSvg());
    if (i >= 0) return idOf(all[i], i);
    const n = +(location.hash.match(/^#(\d+)/) || [, "1"])[1];
    return idOf(all[n - 1], n - 1);
  };
  const slideRect = () => {
    const el = activeSvg();
    const r = el && el.getBoundingClientRect();
    return r && r.width ? r : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  };
  // Points are stored as fractions of the slide, so ink stays put when the slide rescales.
  const toSlide = e => { const r = slideRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };

  // Pencil: the stroke painted with a grain texture of its colour, over a faint solid core
  const grains = new Map();
  function grain(c, cx = ctx) {
    const key = c + (cx === ctx ? "" : ":scratch");
    if (grains.has(key)) return grains.get(key);
    const t = document.createElement("canvas"), N = 96;
    t.width = t.height = N;
    const g = t.getContext("2d"), img = g.createImageData(N, N);
    const [R, G, B] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    let seed = 12345;                                   // the same grain every time
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < N * N; i++) {
      const a = rnd();
      img.data.set([R, G, B, a < 0.45 ? 0 : Math.round(110 + 145 * rnd())], i * 4);
    }
    g.putImageData(img, 0, 0);
    const pattern = cx.createPattern(t, "repeat");
    grains.set(key, pattern);
    return pattern;
  }
  // Paint a stroke (without its cuts) on a 2D context
  function paintStroke(cx, s, r) {
    if (s.pencil) {
      // the strands in a 1280-wide slide's pixels, then onto the screen
      const SH = 1280 * r.height / r.width, k = r.width / 1280;
      cx.save();
      const pattern = grain(s.c, cx);
      cx.strokeStyle = pattern;
      cx.lineCap = "butt";                              // pieces that meet do not overlap
      cx.lineJoin = "round";
      pencilStrands(s, 1280, SH).forEach(st => {
        cx.globalAlpha = st.alpha;
        cx.lineWidth = st.width * k;
        st.pieces.forEach(pc => {                       // each piece on its own, with its grain (see grainPieces)
          if (pattern.setTransform) pattern.setTransform(new DOMMatrix([1, 0, 0, 1, (pc.grain * 37) % 96, (pc.grain * 61) % 96]));
          cx.beginPath();
          pc.pts.forEach(([x, y], i) => (i ? cx.lineTo(r.left + x * k, r.top + y * k) : cx.moveTo(r.left + x * k, r.top + y * k)));
          cx.stroke();
        });
      });
      cx.restore();
      return;
    }
    const p = look(s);
    cx.strokeStyle = p.color;
    cx.lineWidth = p.width * r.width / 1280;            // widths scale with the slide
    polyline(cx, s.pts, r);
    cx.stroke();
  }
  function polyline(cx, pts, r) {
    cx.beginPath();
    pts.forEach(([u, v], i) => (i ? cx.lineTo(r.left + u * r.width, r.top + v * r.height) : cx.moveTo(r.left + u * r.width, r.top + v * r.height)));
    if (pts.length === 1) cx.lineTo(r.left + pts[0][0] * r.width + 0.1, r.top + pts[0][1] * r.height);
  }
  // A stroke with cuts is painted on a scratch canvas, cut there, and copied over (only its box),
  // so the cuts take away only this stroke's ink
  const scratch = document.createElement("canvas"), sctx = scratch.getContext("2d");
  function drawStroke(s, r) {
    if (s.erase) {                                      // the eraser being dragged: take the ink away under it
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000"; ctx.lineWidth = s.w * r.width / 1280;
      polyline(ctx, s.pts, r);
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (!s.cuts || !s.cuts.length) { paintStroke(ctx, s, r); return; }
    const d = window.devicePixelRatio || 1;
    if (scratch.width !== canvas.width || scratch.height !== canvas.height) { scratch.width = canvas.width; scratch.height = canvas.height; }
    sctx.setTransform(d, 0, 0, d, 0, 0); sctx.lineCap = "round"; sctx.lineJoin = "round";
    const pad = look(s).width * r.width / 1280 + 4;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    s.pts.forEach(([u, v]) => { const x = r.left + u * r.width, y = r.top + v * r.height; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    x0 = Math.max(0, Math.floor(x0 - pad)); y0 = Math.max(0, Math.floor(y0 - pad));
    x1 = Math.min(innerWidth, Math.ceil(x1 + pad)); y1 = Math.min(innerHeight, Math.ceil(y1 + pad));
    if (x1 <= x0 || y1 <= y0) return;
    sctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    paintStroke(sctx, s, r);
    sctx.save();
    sctx.globalCompositeOperation = "destination-out";
    sctx.strokeStyle = "#000";
    s.cuts.forEach(c => {
      if (c.poly) {                                     // a lasso's loop: inside away, or (keep) outside away
        sctx.globalCompositeOperation = c.keep ? "destination-in" : "destination-out";
        polyline(sctx, c.poly, r); sctx.closePath(); sctx.fillStyle = "#000"; sctx.fill();
        sctx.globalCompositeOperation = "destination-out";
      } else { sctx.lineWidth = c.w * r.width / 1280; polyline(sctx, c.pts, r); sctx.stroke(); }
    });
    sctx.restore();
    ctx.drawImage(scratch, x0 * d, y0 * d, (x1 - x0) * d, (y1 - y0) * d, x0, y0, x1 - x0, y1 - y0);
  }
  function redraw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const r = slideRect(), list = ink[slideId()] || [];
    list.forEach(s => drawStroke(s, r));
    sel = sel.filter(s => list.includes(s));            // undo, another slide, ... leave nothing stale selected
    const b = selBox();
    if (b || lasso) {
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = "#2563eb"; ctx.fillStyle = "rgba(37, 99, 235, .07)";
      if (b) { ctx.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); }
      if (lasso) { ctx.beginPath(); lasso.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
  }
  // The selection's box on screen (padded), or null
  function selBox() {
    if (!sel.length) return null;
    const r = slideRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    sel.forEach(s => {
      const pad = look(s).width * r.width / 1280 / 2 + 6;
      s.pts.forEach(([u, v]) => {
        const x = r.left + u * r.width, y = r.top + v * r.height;
        x0 = Math.min(x0, x - pad); y0 = Math.min(y0, y - pad); x1 = Math.max(x1, x + pad); y1 = Math.max(y1, y + pad);
      });
    });
    return { x0, y0, x1, y1 };
  }
  function resize() {
    const scale = window.devicePixelRatio || 1;
    canvas.width = innerWidth * scale;
    canvas.height = innerHeight * scale;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    redraw();
  }
  function showBadge() {
    // while editing, the editor's bar shows the tool instead
    badge.style.display = (enabled || erasing || lassoOn) && !window.__marpEditing ? "block" : "none";
    badge.style.background = erasing || lassoOn ? "rgba(75,85,99,.9)" : brush === "hl" ? rgba(colors.hl, 0.9) : colors[brush];
    badge.textContent = erasing ? (rubArea ? "⌫ eraser  ·  rub out the ink under it  ·  R: off  z: undo"
                                           : "⌫ stroke eraser  ·  drag over ink to remove whole strokes  ·  r: off  z: undo")
      : lassoOn ? "◌ lasso  ·  circle ink to select it, drag to move, Delete removes  ·  z: undo"
      : { pen: "✎ pen", pencil: "✏ pencil", hl: "▬ highlighter" }[brush] + "  ·  a: off  z: undo  c: clear";
    inkListeners.forEach(f => f());
  }

  // ---- spotlight: hold the mouse button to darken everything but a circle at the cursor ----
  let spotOn = false;
  const INTERACTIVE = "a, button, input, select, textarea, label, summary, iframe, video, audio, [contenteditable], " +
    ".pyc, .mp-note, .mp-note-icon, .mp-menu, .bespoke-marp-osc, [role=button], [onclick], " +
    ".mp-zoom-pick, .mp-src";                                              // x: dragging the box to zoom into
  function placeSpot(x, y) {
    const r = slideRect(), radius = Math.max(40, 0.14 * r.height);     // scales with the slide
    spot.style.background = `radial-gradient(circle ${radius}px at ${x}px ${y}px, ` +
      `rgba(0,0,0,0) ${radius - 1}px, rgba(0,0,0,.72) ${radius + 1}px)`;
  }
  function spotStart(e) {
    if (overview || e.button !== 0 || enabled || erasing || lassoOn || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (menuOpen()) return;                                    // this click just closes the menu
    if (e.target && e.target.closest && e.target.closest(INTERACTIVE)) return;
    spotOn = true;
    placeSpot(e.clientX, e.clientY);
    spot.style.visibility = "visible"; spot.style.opacity = "1";
    document.documentElement.style.userSelect = "none";       // no text selection while holding
  }
  function spotEnd() {
    if (!spotOn) return;
    spotOn = false;
    spot.style.opacity = "0";
    document.documentElement.style.userSelect = "";
    setTimeout(() => { if (!spotOn) spot.style.visibility = "hidden"; }, 160);
  }
  addEventListener("pointerdown", spotStart, true);
  addEventListener("pointermove", e => { if (spotOn) placeSpot(e.clientX, e.clientY); }, true);
  addEventListener("pointerup", spotEnd, true);
  addEventListener("pointercancel", spotEnd, true);
  addEventListener("blur", spotEnd);
  // Holding the button on an image would start the browser's drag of it (which ends the spotlight)
  addEventListener("dragstart", e => { if (spotOn) e.preventDefault(); }, true);

  // ---- sticky notes: n adds one at the mouse; Markdown, rendered when you click away ----
  const noteLayer = document.createElement("div");
  noteLayer.className = "annotate-layer";
  Object.assign(noteLayer.style, { position: "fixed", inset: "0", zIndex: "99997", pointerEvents: "none" });
  document.body.appendChild(noteLayer);
  const noteCss = document.createElement("style");
  noteCss.textContent = `
.mp-note { --bg: #fff8c4; --bar: #fde68a; --ink: #92400e; --head: #78350f; --line: #e7c873;
  position: fixed; display: flex; flex-direction: column; background: var(--bg); color: #1f2937; border-radius: 8px;
  box-shadow: 0 3px 14px rgba(0,0,0,.25); pointer-events: auto; overflow: hidden; resize: both; min-width: 9em; min-height: 3.2em;
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; line-height: 1.35; }
.mp-note-bar { display: flex; align-items: center; gap: .3em; padding: .15em .35em .15em .6em; background: var(--bar); cursor: move;
  font-size: .7em; color: var(--ink); user-select: none; flex: none; }
.mp-note-bar .col { width: .95em; height: .95em; padding: 0; border-radius: 50%; background: var(--bg); box-shadow: 0 0 0 1.5px var(--ink); }
.mp-note-sw { display: flex; gap: .45em; padding: .3em .6em; background: var(--bar); flex: none; }
.mp-note-sw button { width: 1.1em; height: 1.1em; border-radius: 50%; border: 2px solid white; padding: 0; cursor: pointer; box-shadow: 0 0 0 1px rgba(0,0,0,.25); }
.mp-note-sw button.on { box-shadow: 0 0 0 2px #1f2937; }
.mp-note-bar .t { flex: 1; font-weight: 600; letter-spacing: .03em; }
.mp-note-bar button { border: 0; background: transparent; color: var(--ink); font: 700 1.2em/1 Helvetica, Arial, sans-serif; cursor: pointer;
  padding: 0 .3em; border-radius: 4px; }
.mp-note-bar button:not(.col):hover { background: rgba(0,0,0,.1); }
.mp-note textarea { flex: 1; border: 0; outline: 0; resize: none; background: transparent; color: #1f2937; padding: .45em .7em;
  font: .85em/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; min-height: 4em; }
.mp-note-body { flex: 1; overflow: auto; padding: .35em .75em .5em; cursor: text; }
.mp-note-body:empty::before { content: "empty note"; color: #a8a29e; font-style: italic; }
.mp-md > :first-child { margin-top: 0; } .mp-md > :last-child { margin-bottom: 0; }
.mp-md p, .mp-md ul, .mp-md ol, .mp-md pre, .mp-md blockquote, .mp-md table { margin: .35em 0; }
.mp-md h1, .mp-md h2, .mp-md h3, .mp-md h4 { margin: .4em 0 .25em; line-height: 1.2; color: var(--head, #78350f); }
.mp-md h1 { font-size: 1.35em; } .mp-md h2 { font-size: 1.2em; } .mp-md h3, .mp-md h4 { font-size: 1.05em; }
.mp-md ul, .mp-md ol { padding-left: 1.3em; } .mp-md li { margin: .1em 0; }
.mp-md code { font: .88em ui-monospace, Menlo, Consolas, monospace; background: rgba(0,0,0,.07); padding: .05em .3em; border-radius: 3px; }
.mp-md pre { background: rgba(0,0,0,.06); padding: .4em .6em; border-radius: 5px; overflow: auto; }
.mp-md pre code { background: none; padding: 0; }
.mp-md blockquote { border-left: 3px solid var(--ink, #f59e0b); padding-left: .6em; color: #57534e; }
.mp-md a { color: #1d4ed8; } .mp-md img { max-width: 100%; }
.mp-md table { border-collapse: collapse; font-size: .9em; } .mp-md th, .mp-md td { border: 1px solid var(--line, #e7c873); padding: .15em .45em; }
.mp-note-icon { position: fixed; pointer-events: auto; border: 0; border-radius: 50%; background: var(--bar, #fde68a); cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,.3); display: grid; place-items: center; padding: 0; line-height: 1; }
.mp-note-icon:hover { transform: scale(1.1); }
.mp-print-note { position: absolute; z-index: 60; background: var(--bg, #fff8c4); color: #1f2937; border-radius: 8px; padding: 8px 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,.25); font: 18px/1.35 "Helvetica Neue", Helvetica, Arial, sans-serif; overflow: hidden; }
.mp-print-note.min { background: var(--bar, #fde68a); padding: 0; width: 34px !important; height: 34px; border-radius: 50%; display: grid; place-items: center; font-size: 20px; }`;
  document.head.appendChild(noteCss);

  // Markdown -> safe HTML. Raw HTML in a note is shown as text, and only plain formatting
  // elements, http(s)/mailto links and http(s)/data images survive (notes can come from files).
  const escapeHtml = t => String(t).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  if (window.marked) window.marked.use({ gfm: true, breaks: true, renderer: { html(t) { return escapeHtml(typeof t === "string" ? t : t.text); } } });
  const MD_TAGS = new Set("P BR HR H1 H2 H3 H4 H5 H6 STRONG B EM I DEL S CODE PRE BLOCKQUOTE UL OL LI A TABLE THEAD TBODY TR TH TD IMG INPUT SPAN".split(" "));
  const MD_ATTRS = { A: ["href", "title"], IMG: ["src", "alt", "title"], INPUT: ["type", "checked", "disabled"], OL: ["start"], TH: ["align"], TD: ["align"] };
  function renderMarkdown(text) {
    const t = document.createElement("template");
    t.innerHTML = window.marked ? window.marked.parse(text, { async: false }) : "<p>" + escapeHtml(text).replace(/\n/g, "<br>") + "</p>";
    t.content.querySelectorAll("*").forEach(el => {
      if (!MD_TAGS.has(el.tagName)) { el.replaceWith(document.createTextNode(el.textContent)); return; }
      for (const a of [...el.attributes]) if (!(MD_ATTRS[el.tagName] || []).includes(a.name)) el.removeAttribute(a.name);
      if (el.tagName === "A") {
        if (!/^(https?:|mailto:|#)/i.test(el.getAttribute("href") || "")) el.removeAttribute("href");
        el.target = "_blank"; el.rel = "noopener";
      }
      if (el.tagName === "IMG" && !/^(https?:|data:image\/)/i.test(el.getAttribute("src") || "")) el.remove();
      if (el.tagName === "INPUT") { if (el.getAttribute("type") !== "checkbox") el.remove(); else el.disabled = true; }
    });
    return t.content;
  }

  // note colours: stored by name, applied as CSS variables (card, bar, text accent, heading, table lines)
  const NOTE_COLORS = {
    yellow: ["#fff8c4", "#fde68a", "#92400e", "#78350f", "#e7c873"],
    pink:   ["#ffe4ef", "#fbcfe0", "#9d174d", "#831843", "#f5b5cf"],
    blue:   ["#e0efff", "#bfdbfe", "#1e40af", "#1e3a8a", "#a9c8f5"],
    green:  ["#e3f8e8", "#bbf0c9", "#166534", "#14532d", "#9fdcb0"],
    orange: ["#ffedd9", "#fed2a8", "#9a3412", "#7c2d12", "#f5bf8e"],
  };
  function paint(el, color) {
    const c = NOTE_COLORS[color] || NOTE_COLORS.yellow;
    ["--bg", "--bar", "--ink", "--head", "--line"].forEach((v, i) => el.style.setProperty(v, c[i]));
  }
  function setNoteColor(note, color) {
    if (!NOTE_COLORS[color]) return;
    note.color = color; saveNotes(); buildNotes();
  }
  function colorSwatches(current, pick) {              // a row of five colour buttons
    const row = document.createElement("div");
    for (const name of Object.keys(NOTE_COLORS)) {
      const b = document.createElement("button");
      b.style.background = NOTE_COLORS[name][0];
      b.style.outline = "1px solid " + NOTE_COLORS[name][2];
      b.title = name;
      if (name === (current || "yellow")) b.className = "on";
      b.addEventListener("click", e => { e.stopPropagation(); pick(name); });
      row.appendChild(b);
    }
    return row;
  }

  let lastX = innerWidth / 2, lastY = innerHeight / 3;
  addEventListener("pointermove", e => { lastX = e.clientX; lastY = e.clientY; }, true);
  const noteEls = new Map();                   // note id -> element, for the visible slide
  // Notes are sized by the slide's height, but no taller than a 4:3 slide of its width, so a
  // portrait page (a poster) gets notes the size a landscape slide of that width would.
  const noteSide = (w, h) => Math.min(h, 0.75 * w);
  const noteFont = () => { const r = slideRect(); return Math.max(11, noteSide(r.width, r.height) / 34); };

  function newNote() {
    const r = slideRect(), w = 0.28;
    let x = (lastX - r.left) / r.width, y = (lastY - r.top) / r.height;
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) { x = 0.36; y = 0.3; }
    const note = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                   x: Math.min(Math.max(x, 0.01), 0.99 - w), y: Math.min(Math.max(y, 0.01), 0.85), w, text: "", min: false, color: "yellow" };
    (notes[slideId()] = notes[slideId()] || []).push(note);
    saveNotes();
    buildNotes(note.id);
  }
  function removeNote(id) {
    const list = notes[slideId()] || [];
    const i = list.findIndex(n => n.id === id);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) delete notes[slideId()];
    saveNotes(); buildNotes();
  }
  // Rebuild the visible slide's notes (on slide change, load, add, delete). `editId` opens one for typing.
  function buildNotes(editId) {
    const active = document.activeElement;
    if (active && active.closest && active.closest(".mp-note")) active.blur();   // finish an edit first
    noteLayer.replaceChildren();
    noteEls.clear();
    const id = slideId();                        // drop notes left empty (e.g. the page closed mid-edit)
    if (notes[id]) {
      const keep = notes[id].filter(n => n.text.trim() || n.id === editId);
      if (keep.length !== notes[id].length) { keep.length ? (notes[id] = keep) : delete notes[id]; saveNotes(); }
    }
    for (const note of notes[id] || []) {
      const el = note.min ? noteIcon(note) : noteCard(note, note.id === editId);
      noteLayer.appendChild(el);
      noteEls.set(note.id, el);
    }
    layoutNotes();
    const ed = editId && noteEls.get(editId);
    if (ed && ed.querySelector("textarea")) ed.querySelector("textarea").focus();
  }
  function layoutNotes() {
    const r = slideRect(), f = noteFont();
    noteLayer.style.fontSize = f + "px";
    for (const note of notes[slideId()] || []) {
      const el = noteEls.get(note.id);
      if (!el) continue;
      el.style.left = r.left + note.x * r.width + "px";
      el.style.top = r.top + note.y * r.height + "px";
      if (note.min) { el.style.width = el.style.height = 1.9 * f + "px"; el.style.fontSize = 1.05 * f + "px"; continue; }
      el.style.width = note.w * r.width + "px";
      el.style.height = note.h ? note.h * r.height + "px" : "";
      el.style.maxHeight = (0.98 - note.y) * r.height + "px";
    }
  }
  function dragHandle(handle, note, el, onClick) {
    handle.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.target.closest("button:not(.mp-note-icon)")) return;
      e.preventDefault(); e.stopPropagation();
      const r = slideRect(), x0 = e.clientX, y0 = e.clientY, nx = note.x, ny = note.y;
      let moved = false;
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or ended pointer */ }
      const move = ev => {
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 3) moved = true;
        note.x = Math.min(Math.max(nx + (ev.clientX - x0) / r.width, 0), 0.97);
        note.y = Math.min(Math.max(ny + (ev.clientY - y0) / r.height, 0), 0.95);
        layoutNotes();
      };
      const up = () => {
        handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up);
        if (moved) saveNotes(); else if (onClick) onClick();
      };
      handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up);
    });
  }
  function noteIcon(note) {
    const b = document.createElement("button");
    b.className = "mp-note-icon"; b.textContent = "📝"; b.title = "Note (click to open, drag to move)";
    b.dataset.noteId = note.id;
    paint(b, note.color);
    dragHandle(b, note, b, () => { note.min = false; saveNotes(); buildNotes(); });
    return b;
  }
  function noteCard(note, editing) {
    const el = document.createElement("div");
    el.className = "mp-note";
    el.dataset.noteId = note.id;
    paint(el, note.color);
    el.innerHTML = '<div class="mp-note-bar"><span class="t">NOTE</span><button class="col" title="Note colour"></button>' +
      '<button class="min" title="Minimize to an icon">–</button><button class="del" title="Delete note">×</button></div>' +
      '<div class="mp-note-body mp-md"></div><textarea spellcheck="true" placeholder="Type Markdown… (Esc or click away to finish)"></textarea>';
    const body = el.querySelector(".mp-note-body"), ta = el.querySelector("textarea");
    const showRendered = () => { body.replaceChildren(renderMarkdown(note.text)); body.style.display = ""; ta.style.display = "none"; };
    const edit = () => { ta.value = note.text; body.style.display = "none"; ta.style.display = ""; ta.focus(); };
    editing ? (body.style.display = "none", ta.value = note.text) : showRendered();
    if (!editing) ta.style.display = "none";
    ta.addEventListener("blur", () => {
      note.text = ta.value;
      if (!note.text.trim()) { removeNote(note.id); return; }
      saveNotes(); showRendered();
    });
    ta.addEventListener("keydown", e => {
      if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) { e.preventDefault(); ta.blur(); }
    });
    body.addEventListener("click", e => { if (!e.target.closest("a")) edit(); });
    el.querySelector(".min").addEventListener("click", () => {
      if (document.activeElement === ta) { note.text = ta.value; }
      if (!note.text.trim()) { removeNote(note.id); return; }
      note.min = true; saveNotes(); buildNotes();
    });
    el.querySelector(".del").addEventListener("click", () => removeNote(note.id));
    el.querySelector(".col").addEventListener("click", () => {
      const open = el.querySelector(".mp-note-sw");
      if (open) { open.remove(); return; }
      const sw = colorSwatches(note.color, name => setNoteColor(note, name));
      sw.className = "mp-note-sw";
      el.querySelector(".mp-note-bar").after(sw);
    });
    dragHandle(el.querySelector(".mp-note-bar"), note, el);
    // remember a size the user dragged out with the resize corner
    el.addEventListener("pointerup", () => {
      const r = slideRect(), w = el.offsetWidth / r.width, h = el.offsetHeight / r.height;
      if (Math.abs(w - note.w) > 0.005 || (note.h && Math.abs(h - note.h) > 0.005) || (!note.h && el.style.height)) { note.w = w; note.h = h; saveNotes(); }
    });
    new ResizeObserver(() => {
      if (!el.isConnected || !el.matches(":hover")) return;             // only sizes the user makes
      const r = slideRect(), w = el.offsetWidth / r.width;
      if (Math.abs(w - note.w) > 0.01) { note.w = w; note.h = el.offsetHeight / r.height; saveNotes(); }
    }).observe(el);
    // keys typed in a note belong to the note, not to the slide show or the presenter tools
    for (const t of ["keydown", "keyup", "keypress"]) el.addEventListener(t, e => e.stopPropagation());
    return el;
  }
  // a note as it appears on paper (Cmd/Ctrl+P), in the slide's own coordinates; its text and
  // padding are sized for a 720-high slide and scaled like the notes on screen (noteSide)
  function printNote(n, [SW, SH] = [1280, 720]) {
    const d = document.createElement("div"), k = noteSide(SW, SH) / 720;
    d.className = "mp-print-note" + (n.min ? " min" : "");
    paint(d, n.color);
    Object.assign(d.style, { left: n.x * SW + "px", top: n.y * SH + "px", width: n.w * SW / k + "px",
      transform: k === 1 ? "" : `scale(${k})`, transformOrigin: "0 0" });
    if (n.h && !n.min) d.style.height = n.h * SH / k + "px";
    if (n.min) d.textContent = "📝"; else d.appendChild(Object.assign(document.createElement("div"), { className: "mp-md" })).appendChild(renderMarkdown(n.text));
    return d;
  }

  // ---- laser pointer ----
  const iframes = () => [...document.querySelectorAll("iframe")];
  const FRAME_NAV = /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/;
  // The tail is the pointer's recent path, drawn as a stroke that thins and fades with age.
  const TRAIL_MS = 350, tctx = trail.getContext("2d");
  let tail = [], tailFrame = 0;
  function drawTail() {
    tailFrame = 0;
    const now = performance.now(), scale = window.devicePixelRatio || 1;
    tail = tail.filter(p => now - p.t < TRAIL_MS);
    const w = Math.round(innerWidth * scale), h = Math.round(innerHeight * scale);
    if (trail.width !== w || trail.height !== h) {
      trail.width = w; trail.height = h;
      // a canvas does not stretch to its insets: pin its CSS size, or it shows at w x h CSS pixels
      trail.style.width = innerWidth + "px"; trail.style.height = innerHeight + "px";
    }
    tctx.setTransform(scale, 0, 0, scale, 0, 0);
    tctx.clearRect(0, 0, innerWidth, innerHeight);
    tctx.lineCap = "round";
    const c = LASERS[laserColour][0];
    tctx.shadowColor = `rgba(${c},.6)`; tctx.shadowBlur = 10;
    for (let i = 1; i < tail.length; i++) {
      const life = 1 - (now - tail[i].t) / TRAIL_MS;
      tctx.strokeStyle = `rgba(${c},${(0.85 * life).toFixed(3)})`;
      tctx.lineWidth = 2 + 8 * life;
      tctx.beginPath(); tctx.moveTo(tail[i - 1].x, tail[i - 1].y); tctx.lineTo(tail[i].x, tail[i].y); tctx.stroke();
    }
    if (tail.length) tailFrame = requestAnimationFrame(drawTail);
  }
  const moveLaser = (x, y) => {
    laser.style.transform = `translate(${x}px, ${y}px)`;
    if (!laserOn) return;
    tail.push({ x, y, t: performance.now() });
    if (!tailFrame) tailFrame = requestAnimationFrame(drawTail);
  };
  addEventListener("pointermove", e => moveLaser(e.clientX, e.clientY), true);
  document.documentElement.addEventListener("mouseleave", () => { laser.style.visibility = "hidden"; tail = []; });
  document.documentElement.addEventListener("mouseenter", () => { laser.style.visibility = "visible"; });
  function setLaser(on) {
    laserOn = on;
    laser.style.display = trail.style.display = on ? "block" : "none";
    if (!on) { tail = []; tctx.clearRect(0, 0, trail.width, trail.height); }
    document.documentElement.classList.toggle("laser-on", on);
    if (on) say(`Laser pointer (${LASERS[laserColour][1]}): 1-5 change its colour, l turns it off`);
    iframes().forEach(f => { try { f.contentDocument.documentElement.classList.toggle("laser-on", on); } catch (e) { /* cross-origin */ } });
  }
  function setLaserColour(i) {
    laserColour = i;
    try { localStorage.setItem(LASER_PREF, String(i)); } catch (e) { /* storage blocked */ }
    paintLaser();
  }
  // Widgets live in same-origin iframes, which swallow mouse and key events: follow the
  // mouse into them (scaled by how Marp has resized the slide) and forward the keys.
  function hookFrame(f) {
    let w, d;
    try { w = f.contentWindow; d = f.contentDocument; } catch (e) { return; }
    if (!w || !d || !d.documentElement || w.__annotateHooked) return;
    w.__annotateHooked = true;
    const st = d.createElement("style"); st.textContent = HIDE_CURSOR; d.head.appendChild(st);
    d.documentElement.classList.toggle("laser-on", laserOn);
    w.addEventListener("pointermove", e => {
      const r = f.getBoundingClientRect(), sx = r.width / (f.clientWidth || r.width), sy = r.height / (f.clientHeight || r.height);
      moveLaser(r.left + e.clientX * sx, r.top + e.clientY * sy);
    }, true);
    w.addEventListener("keydown", onKey, true);
    w.addEventListener("contextmenu", e => {
      const r = f.getBoundingClientRect(), sx = r.width / (f.clientWidth || r.width), sy = r.height / (f.clientHeight || r.height);
      onContextMenu(e, r.left + e.clientX * sx, r.top + e.clientY * sy);
    }, true);
    w.addEventListener("pointerdown", () => closeMenu(), true);
    // Marp changes slides on keys, and shows its controls on mouse moves, in the deck's own
    // document: hand it those the widget leaves alone, and leave the frame once its slide is gone
    w.addEventListener("keydown", e => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !FRAME_NAV.test(e.key)) return;
      const t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT|BUTTON|AUDIO|VIDEO)$/.test(t.nodeName) || t.isContentEditable)) return;
      e.preventDefault();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
      if (!f.closest(".bespoke-marp-active")) { f.blur(); focus(); }
    });
    w.addEventListener("mousemove", () => document.dispatchEvent(new MouseEvent("mousemove")), true);
    acceptDrops(w);
  }
  const hookAll = () => iframes().forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });

  // The eraser removes whole strokes: any stroke passing within a few pixels of the pointer
  function rubOut(e) {
    const id = slideId(), list = ink[id];
    if (!list || !list.length) return;
    const r = slideRect(), x = e.clientX, y = e.clientY, reach = 10;
    const px = ([u, v]) => [r.left + u * r.width, r.top + v * r.height];
    const near = s => {
      const pts = s.pts.map(px), half = look(s).width * r.width / 1280 / 2 + reach;
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[Math.min(i + 1, pts.length - 1)];
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= half) return true;
      }
      return false;
    };
    let gone = false;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].erase) continue;
      if (near(list[i])) { rubbing.push({ i, s: list[i] }); list.splice(i, 1); gone = true; }
    }
    if (gone) redraw();
  }
  // The eraser (rubbing out) applied to the strokes drawn so far: a stroke whose middle it passes
  // over is split into the pieces on either side, and every piece it touches keeps the eraser's
  // path as a cut, so its edge follows the eraser exactly, also after the piece is moved. Points
  // are compared in the pixels of a 1280-wide slide. Returns true if any ink was rubbed out.
  // A stroke with a point every few pixels (in a 1280-wide slide's pixels), and how far along it each is
  function densify(st, toPx, step) {
    const dense = [], D = [];
    st.pts.forEach((p, k) => {
      if (k) {
        const q = st.pts[k - 1], [ax, ay] = toPx(q), [bx, by] = toPx(p);
        const m = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
        for (let j = 1; j < m; j++) dense.push([q[0] + (p[0] - q[0]) * j / m, q[1] + (p[1] - q[1]) * j / m]);
      }
      dense.push(p);
    });
    dense.forEach((p, k) => {
      if (!k) { D.push(0); return; }
      const [x, y] = toPx(p), [x0, y0] = toPx(dense[k - 1]);
      D.push(D[k - 1] + Math.hypot(x - x0, y - y0));
    });
    return { dense, D };
  }
  // Points a..b of a stroke as a stroke of their own, with its cuts and these new ones. A pencil
  // piece keeps its graphite as it was (seed, distance along the stroke), with no ragged ends where
  // it was cut (openA, openB).
  function pieceOf(st, dense, D, a, b, more, openA, openB) {
    const { pts, cuts, ...style } = st;
    const piece = Object.assign({}, style, { pts: dense.slice(a, b + 1) });
    const cs = (cuts || []).map(copyCut).concat(more);
    if (cs.length) piece.cuts = cs; else delete piece.cuts;
    if (st.pencil) {
      const open = st.open || [false, false];
      piece.seed = seedOf(st);
      piece.d0 = (st.d0 || 0) + D[a];
      piece.open = [openA || open[0], openB || open[1]];
    }
    return piece;
  }
  const slidePx = () => { const r = slideRect(), SH = 1280 * r.height / r.width; return ([u, v]) => [u * 1280, v * SH]; };

  // The eraser (rubbing out) applied to the strokes drawn so far: a stroke whose middle it passes
  // over is split into the pieces on either side, and every piece it touches keeps the eraser's
  // path as a cut, so its edge follows the eraser exactly, also after the piece is moved.
  // Returns true if any ink was rubbed out.
  function applyEraser(list, er) {
    const toPx = slidePx(), R = er.w / 2, E = er.pts.map(toPx);
    const dist = ([x, y]) => {                          // to the eraser's path
      let best = Infinity;
      for (let i = 0; i < E.length; i++) {
        const [ax, ay] = E[i], [bx, by] = E[Math.min(i + 1, E.length - 1)];
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
      }
      return best;
    };
    const cut = () => copyCut(er);
    let changed = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const st = list[i];
      if (st.erase) continue;
      const half = look(st).width / 2;
      const { dense, D } = densify(st, toPx, Math.max(0.5, Math.min(R, half + 1) / 2));
      const far = dense.map(p => dist(toPx(p)));
      if (far.every(f => f > R + half)) continue;       // not touched
      changed = true;
      if (far.every(f => f >= R)) {                     // only its edge: a bite, no split
        st.cuts = (st.cuts || []).map(copyCut).concat(cut());
        continue;
      }
      const runs = [];                                  // the pieces left: [first index, last index]
      let start = -1;
      far.forEach((f, k) => {
        if (f >= R) { if (start < 0) start = k; }
        else if (start >= 0) { runs.push([start, k - 1]); start = -1; }
      });
      if (start >= 0) runs.push([start, far.length - 1]);
      const pieces = runs.filter(([a, b]) => b > a).map(([a, b]) =>
        pieceOf(st, dense, D, a, b, far.slice(a, b + 1).some(f => f <= R + half) ? [cut()] : [], a > 0, b < dense.length - 1));
      list.splice(i, 1, ...pieces);
    }
    return changed;
  }
  // The lasso's loop (in slide fractions) cuts the strokes it crosses at its edge: the pieces inside
  // keep only what is inside the loop, the pieces outside lose it, so both edges follow the loop
  // exactly, and a piece moved away keeps its edge. Each piece reaches a point past the loop (the
  // cuts trim it), so nothing is lost or doubled where they meet. Returns the strokes and pieces inside.
  function lassoCut(list, poly) {
    const toPx = slidePx(), chosen = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const st = list[i];
      if (st.erase) continue;
      const inside0 = st.pts.map(([u, v]) => inLoop(u, v, poly));
      if (!inside0.some(Boolean)) continue;
      if (inside0.every(Boolean)) { chosen.push(st); continue; }
      const { dense, D } = densify(st, toPx, Math.max(0.5, (look(st).width / 2 + 1) / 2));
      const inside = dense.map(([u, v]) => inLoop(u, v, poly));
      const pieces = [];
      let a = 0;
      for (let k = 1; k <= dense.length; k++) {
        if (k < dense.length && inside[k] === inside[a]) continue;
        const keep = inside[a], lo = Math.max(0, a - 1), hi = Math.min(dense.length - 1, k);
        const piece = pieceOf(st, dense, D, lo, hi, [Object.assign({ poly: poly.map(p => p.slice()) }, keep ? { keep: true } : {})], a > 0, k < dense.length);
        pieces.push(piece);
        if (keep) chosen.push(piece);
        a = k;
      }
      list.splice(i, 1, ...pieces);
    }
    return chosen;
  }
  // Ink saved by the build that kept the eraser as a stroke of its own: apply those as cuts
  function migrateErasers(all) {
    Object.keys(all).forEach(id => {
      const list = all[id];
      if (!Array.isArray(list) || !list.some(st => st && st.erase)) return;
      const out = [];
      list.forEach(st => { if (st.erase) applyEraser(out, st); else out.push(st); });
      if (out.length) all[id] = out; else delete all[id];
    });
    return all;
  }
  // Is a point inside the lasso's loop? (even-odd rule)
  const inLoop = (x, y, loop) => {
    let inside = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i], [xj, yj] = loop[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inSel = (x, y) => { const b = selBox(); return !!b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; };
  canvas.addEventListener("pointerdown", e => {
    if (!enabled && !erasing && !lassoOn) return;
    e.preventDefault(); e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    if (lassoOn) {                                      // drag the selection, or draw a new loop
      if (inSel(e.clientX, e.clientY)) {
        checkpoint();
        moving = { x: e.clientX, y: e.clientY, moved: false,
          from: sel.map(st => ({ pts: st.pts, cuts: (st.cuts || []).map(c => c.poly || c.pts) })) };
      } else { sel = []; lasso = [[e.clientX, e.clientY]]; }
      redraw(); showBadge(); return;
    }
    if (erasing && !rubArea) { checkpoint(); rubbing = []; rubOut(e); return; }
    checkpoint();
    stroke = erasing ? { erase: true, w: 2 * widths.rub, pts: [toSlide(e)] }    // the eraser that rubs out
      : strokeOf(colors[brush], brush, [toSlide(e)], widths[brush]);
    (ink[slideId()] = ink[slideId()] || []).push(stroke);
    redraw();
  });
  canvas.addEventListener("pointermove", e => {
    if (lassoOn && !lasso && !moving) { canvas.style.cursor = inSel(e.clientX, e.clientY) ? "move" : "crosshair"; return; }
    if (lasso) { e.preventDefault(); lasso.push([e.clientX, e.clientY]); redraw(); return; }
    if (moving) {
      e.preventDefault();
      const r = slideRect(), du = (e.clientX - moving.x) / r.width, dv = (e.clientY - moving.y) / r.height;
      if (Math.hypot(e.clientX - moving.x, e.clientY - moving.y) > 2) moving.moved = true;
      const shift = pts => pts.map(([u, v]) => [u + du, v + dv]);
      sel.forEach((st, k) => {
        st.pts = shift(moving.from[k].pts);
        (st.cuts || []).forEach((c, j) => { c[c.poly ? "poly" : "pts"] = shift(moving.from[k].cuts[j]); });   // its cuts go along
      });
      redraw(); return;
    }
    if (rubbing) { e.preventDefault(); e.stopPropagation(); rubOut(e); return; }
    if (!stroke) return;
    e.preventDefault(); e.stopPropagation();
    stroke.pts.push(toSlide(e));
    redraw();
  });
  const end = () => {
    if (stroke) {
      const id = slideId(), list = ink[id] || [];
      if (stroke.erase) {                                // cut what it rubbed out; it is not kept itself
        list.splice(list.indexOf(stroke), 1);
        if (applyEraser(list, stroke)) save(); else (history[id] || []).pop();   // nothing rubbed out: no undo step
        if (!list.length) delete ink[id];
        redraw();
      } else save();
      stroke = null;
    }
    if (rubbing) {
      if (rubbing.length) save(); else (history[slideId()] || []).pop();   // nothing erased: nothing to undo
      rubbing = null;
    }
    if (lasso) {                                        // select the ink inside the loop, cutting strokes at its edge
      const loop = lasso, r = slideRect();
      lasso = null;
      const id = slideId(), list = ink[id];
      if (loop.length > 2 && list) {
        const poly = loop.map(([x, y]) => [(x - r.left) / r.width, (y - r.top) / r.height]);
        const before = JSON.stringify(list), n = list.length;
        sel = lassoCut(list, poly);
        if (list.length !== n) { preSplit = { id, json: before }; save(); }
      }
      redraw(); showBadge();
    }
    if (moving) {
      if (moving.moved) save(); else (history[slideId()] || []).pop();
      moving = null;
    }
  };
  function deleteSelection() {
    if (!sel.length) return false;
    const id = slideId();
    checkpoint(id);
    ink[id] = (ink[id] || []).filter(st => !sel.includes(st));
    if (!ink[id].length) delete ink[id];
    sel = []; save(); redraw(); showBadge();
    return true;
  }
  function recolorSelection(c) {
    checkpoint();
    sel.forEach(st => { if (st.erase) return; const ns = strokeOf(c, kindOf(st), st.pts, st.w); delete st.pen; delete st.c; delete st.hl; delete st.pencil; Object.assign(st, ns); });
    save(); redraw();
  }
  function resizeSelection(w) {
    checkpoint();
    sel.forEach(st => { if (st.erase) return; if (w === DEFAULT_W[kindOf(st)]) delete st.w; else st.w = w; });
    save(); redraw();
  }
  // Pick one of the PENS (keys 1-5, the right-click menu's swatches)
  function pickPreset(i) {
    brush = i === 4 ? "hl" : "pen";
    colors[brush] = i === 4 ? HL_HEX : PENS[i].color;
  }
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  // The canvas takes the mouse while the pen or the eraser is on (other tools check this)
  const ERASER_CURSOR = "url(\"data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,.5)" stroke="#374151" stroke-width="1.5"/></svg>') + "\") 12 12, cell";
  // The area eraser's cursor: a circle the size of what it rubs out
  function areaCursor() {
    const d = Math.max(8, Math.min(120, Math.round(2 * widths.rub * slideRect().width / 1280))), h = d / 2;
    return "url(\"data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${d + 2}" height="${d + 2}"><circle cx="${h + 1}" cy="${h + 1}" r="${h}" fill="rgba(255,255,255,.45)" stroke="#374151" stroke-width="1.2"/></svg>`) + `") ${h + 1} ${h + 1}, cell`;
  }
  function setCanvas() {
    canvas.style.pointerEvents = enabled || erasing || lassoOn ? "auto" : "none";
    canvas.style.cursor = erasing ? (rubArea ? areaCursor() : ERASER_CURSOR) : lassoOn ? "crosshair" : "";
  }
  function onKey(e) {
    if (e.key === "Escape" && menuOpen()) { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }   // not Marp's overview too
    if (e.key === "Escape" && !srcPanel.hidden && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); toggleSource(false); return; }
    if (overview) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    if (e.target && e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.target && (e.target.isContentEditable || (e.target.closest && e.target.closest(".pyc")))) return;  // typing in a code cell
    if (lassoOn && /^(Delete|Backspace|Escape)$/.test(e.key) && window.__marpInk.key(e)) { e.preventDefault(); return; }
    if (act(e.key)) { if (e.key === "n") e.preventDefault(); closeMenu(); }
  }
  // One action per key; the keyboard and the right-click menu both come here. Returns true if handled.
  function act(k) {
    const id = slideId();
    const E = window.__marpEdits;
    if ((k === "a" || k === "A") && E && E.canEdit && E.annotate) {
      E.annotate(); return true;                        // editor.js: edit mode with the pen, and the Annotate row
    } else if (k === "a" || k === "A") {                // the presenter view: the pen alone
      enabled = !enabled;
      if (enabled) { erasing = lassoOn = false; sel = []; if (laserOn) setLaser(false); }
      setCanvas(); redraw();
    } else if (k === "r" || k === "R") {                // r: whole strokes, R: only the ink under the eraser
      const area = k === "R";
      erasing = !(erasing && rubArea === area); rubArea = area;
      if (erasing) { enabled = lassoOn = false; sel = []; if (laserOn) setLaser(false); }
      setCanvas(); redraw();
    } else if (k === "l" || k === "L") {
      setLaser(!laserOn);
      if (laserOn) { enabled = erasing = lassoOn = false; sel = []; setCanvas(); redraw(); }
    } else if (k === "s") {
      saveStandalone(); return true;
    } else if (k === "m") {
      saveMarkdown(); return true;
    } else if (k === "S") {
      saveJson(); return true;
    } else if (k === "i") {
      picker.click(); return true;
    } else if (k === "n") {
      newNote(); return true;
    } else if (k === "h") {
      toggleSource(); return true;
    } else if (k === "c") {
      if (ink[id]) checkpoint(id);
      say(ink[id] ? "Cleared this slide's ink (z puts it back)" : "No ink on this slide");
      delete ink[id]; save(); redraw();
    } else if (k === "C") {
      const n = Object.keys(ink).length;
      Object.keys(ink).forEach(i => checkpoint(i));    // z gives each slide its ink back
      say(n ? `Cleared the ink on ${n} slide${n === 1 ? "" : "s"} (z on a slide puts its ink back)` : "No ink on any slide");
      ink = {}; save(); redraw();
    } else if (k === "z" && ((history[id] && history[id].length) || (ink[id] && ink[id].length))) {
      if (history[id] && history[id].length) {          // the strokes as they were before the last change
        const before = JSON.parse(history[id].pop());
        if (before.length) ink[id] = before; else delete ink[id];
      } else ink[id].pop();                             // ink from an earlier session: a stroke at a time
      save(); redraw();
    } else if (enabled && k >= "1" && k <= String(PENS.length)) {
      pickPreset(+k - 1);
    } else if (laserOn && k >= "1" && k <= String(LASERS.length)) {
      setLaserColour(+k - 1);
      say("Laser pointer: " + LASERS[laserColour][1]);
    } else return false;
    showBadge();
    return true;
  }
  addEventListener("keydown", onKey, true);

  // ---- for the editor's Annotate tools (editor.js): this pen, highlighter, eraser and lasso ----
  const toolName = () => (lassoOn ? "lasso" : erasing ? (rubArea ? "rub" : "erase") : enabled ? brush : "");
  function setTool(t) {
    enabled = t === "pen" || t === "pencil" || t === "hl"; erasing = t === "erase" || t === "rub"; lassoOn = t === "lasso";
    if (enabled) brush = t;
    if (erasing) rubArea = t === "rub";
    if (t && laserOn) setLaser(false);
    if (!lassoOn) { sel = []; lasso = moving = null; }
    stroke = null;
    setCanvas(); redraw(); showBadge();
  }
  const colorOf = st => st.c || (st.pen === 4 ? HL_HEX : PENS[st.pen].color);
  window.__marpInk = {
    tool: toolName,                                   // "pen", "pencil", "hl", "rub", "erase", "lasso" or ""
    setTool,
    // The colour to show: the selection's (lasso), else the pen's, pencil's or highlighter's
    color: () => { const st = sel.find(x => !x.erase); return st ? colorOf(st) : colors[enabled ? brush : "pen"]; },
    // A colour recolours the lasso's selection, else is the drawing tool's (with no drawing tool on, it picks the pen)
    setColor(c) {
      if (typeof c !== "string" || !HEX.test(c)) return;
      c = c.toLowerCase();
      if (sel.length) recolorSelection(c);
      else if (enabled) colors[brush] = c;
      else { colors.pen = c; setTool("pen"); return; }
      showBadge();
    },
    // Keys while a tool is on (the editor passes them here while editing). True if used.
    key(e) {
      const k = e.key, mod = e.metaKey || e.ctrlKey;
      if (!toolName() || e.altKey) return false;
      if (k === "Escape") { if (sel.length) { sel = []; redraw(); showBadge(); } else setTool(""); return true; }
      if ((k === "Delete" || k === "Backspace") && !mod) return deleteSelection();
      if ((k === "z" || k === "Z") && !e.shiftKey) { act("z"); return true; }        // z, or Cmd/Ctrl+Z
      if (!mod && enabled && k >= "1" && k <= String(PENS.length)) { pickPreset(+k - 1); showBadge(); return true; }
      return false;
    },
    hasSelection: () => sel.length > 0,
    // The size to show (slide pixels): the selection's, the drawing tool's width, or the eraser's radius
    width: () => { const st = sel.find(x => !x.erase); return st ? look(st).width : erasing && rubArea ? widths.rub : widths[enabled ? brush : "pen"]; },
    widthRange: [MIN_W, MAX_W],
    // A size resizes the lasso's selection (final: when the slider is let go), else is the tool's size
    setWidth(w, final = true) {
      w = Math.round(+w * 2) / 2;
      if (!(w >= MIN_W && w <= MAX_W)) return;
      if (sel.length) { if (!final) return; resizeSelection(w); }   // once, when the slider is let go
      else if (erasing && rubArea) { widths.rub = w; setCanvas(); }
      else if (enabled) widths[brush] = w;
      else return;
      showBadge();
    },
    onChange: f => { inkListeners.push(f); },
    clear: all => { act(all ? "C" : "c"); },          // this slide's ink, or every slide's (z puts it back)
    undo: () => { act("z"); },
    note: () => { act("n"); },                         // a sticky note at the mouse
  };

  // ---- h: this slide's Markdown, as written, in a panel that follows the slides ----
  const srcPanel = document.createElement("div");
  srcPanel.className = "annotate-layer mp-src";
  srcPanel.hidden = true;
  srcPanel.innerHTML = '<div class="hd"><span class="t"></span><button class="cp" title="Copy the Markdown">Copy</button>' +
    '<button class="x" title="Close (h or Esc)" aria-label="Close">×</button></div><pre></pre>';
  document.body.appendChild(srcPanel);
  const srcCss = document.createElement("style");
  srcCss.textContent = `
.mp-src { position: fixed; z-index: 100002; top: 56px; right: 12px; width: min(46vw, 640px); max-height: calc(100vh - 120px);
  display: flex; flex-direction: column; border-radius: 10px; background: rgba(24,26,33,.96); color: #e5e7eb;
  box-shadow: 0 8px 30px rgba(0,0,0,.35); font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; overflow: hidden; }
.mp-src[hidden] { display: none; }
.mp-src .hd { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; background: rgba(255,255,255,.07);
  font: 600 12px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; letter-spacing: .03em; user-select: none; }
.mp-src .t { flex: 1; }
.mp-src button { border: 0; border-radius: 6px; padding: 3px 9px; background: rgba(255,255,255,.12); color: inherit; font: inherit; cursor: pointer; }
.mp-src button:hover { background: rgba(255,255,255,.24); }
.mp-src pre { margin: 0; padding: 10px 14px 12px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }`;
  document.head.appendChild(srcCss);
  // The slide's chunk of the deck's Markdown (slide 1 with the front matter); null: no source in the deck,
  // "": a slide added in the slideshow
  function slideMarkdown() {
    loadSource();
    if (!source) return null;
    const id = slideId();
    if (!/^\d+$/.test(id)) return "";
    const { head, chunks } = splitSlides(source);
    const c = chunks[+id - 1];
    if (!c) return "";
    const lines = (id === "1" ? [...head, ...c] : c)
      .filter(l => !l.startsWith('<svg class="marp-ink') && !l.startsWith(NOTES_TAG));   // ink from an annotated .md
    let a = 0, b = lines.length;
    while (a < b && !lines[a].trim()) a++;
    while (b > a && !lines[b - 1].trim()) b--;
    return lines.slice(a, b).join("\n");
  }
  function fillSource() {
    const md = slideMarkdown();
    srcPanel.querySelector(".t").textContent = "Slide " + slideId() + " · Markdown";
    srcPanel.querySelector("pre").textContent = md === null ? "This deck has no Markdown in it: build it with scimax to see its source."
      : md === "" ? "This slide was added in the slideshow, so it has no Markdown." : md;
    srcPanel.querySelector(".cp").hidden = !md;
  }
  function toggleSource(on = srcPanel.hidden) { srcPanel.hidden = !on; if (on) fillSource(); }
  srcPanel.querySelector(".x").addEventListener("click", () => toggleSource(false));
  srcPanel.querySelector(".cp").addEventListener("click", () => {
    const md = slideMarkdown();
    if (!md) return;
    (navigator.clipboard ? navigator.clipboard.writeText(md) : Promise.reject())
      .then(() => say("Copied this slide's Markdown"), () => say("Could not copy: select the text and press " + (MAC ? "⌘C" : "Ctrl+C")));
  });
  // Clicks, selections and scrolling in the panel are not pen strokes, spotlights or slide changes
  ["pointerdown", "mousedown", "click", "wheel", "touchstart"].forEach(t => srcPanel.addEventListener(t, e => e.stopPropagation(), { passive: true }));
  window.__marpSource = { toggle: () => toggleSource(), open: () => !srcPanel.hidden };   // editor.js passes h on while editing

  // ---- right-click menu: every tool in one place, each with its key ----
  const menu = document.createElement("div");
  menu.className = "annotate-layer mp-menu";
  menu.style.display = "none";
  document.body.appendChild(menu);
  const menuCss = document.createElement("style");
  menuCss.textContent = `
.mp-menu { position: fixed; z-index: 100003; min-width: 250px; padding: 5px; border-radius: 10px; background: rgba(255,255,255,.97);
  box-shadow: 0 8px 30px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.07); font: 14px/1.2 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #1f2937; user-select: none; backdrop-filter: blur(8px); }
.mp-menu .it { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; cursor: default; }
.mp-menu .it:hover:not(.off) { background: #2563eb; color: white; }
.mp-menu .it:hover:not(.off) .k { color: rgba(255,255,255,.8); }
.mp-menu .it.off { color: #9ca3af; }
.mp-menu .ck { width: 14px; text-align: center; font-weight: 700; }
.mp-menu .lb { flex: 1; white-space: nowrap; }
.mp-menu .k { color: #9ca3af; font: 12px ui-monospace, Menlo, monospace; }
.mp-menu .sep { height: 1px; margin: 4px 8px; background: #e5e7eb; }
.mp-menu .sw { display: flex; gap: 8px; padding: 4px 10px 6px 32px; }
.mp-menu .sw button { width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 1px rgba(0,0,0,.25); cursor: pointer; padding: 0; }
.mp-menu .sw button.on { box-shadow: 0 0 0 2px #1f2937; }
.mp-menu .note { padding: 4px 10px 6px 32px; color: #6b7280; font-size: 12px; }`;
  document.head.appendChild(menuCss);
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  let menuX = 0, menuY = 0;
  const menuOpen = () => menu.style.display !== "none";
  function closeMenu() { menu.style.display = "none"; }
  function menuItems() {
    if (overview) return window.__marpEdits.overviewItems(menuThumb);   // a thumbnail: add, hide, move
    const here = ink[slideId()] && ink[slideId()].length, fs = !!document.fullscreenElement;
    const noteItems = menuNote ? [{ header: "Note colour" }, { noteSwatches: menuNote },
      { label: menuNote.min ? "Open note" : "Minimize note", run: () => { menuNote.min = !menuNote.min; saveNotes(); buildNotes(); } },
      { label: "Delete note", run: () => removeNote(menuNote.id) }, "-"] : [];
    return [...noteItems,
      { label: "Pen", key: "a", check: enabled, run: () => act("a") },
      { swatches: true },
      { label: "Eraser (whole strokes)", key: "r", check: erasing && !rubArea, off: !total().strokes && !erasing, run: () => act("r") },
      { label: "Eraser (only what is under it)", key: "⇧R", check: erasing && rubArea, off: !total().strokes && !erasing, run: () => act("R") },
      { label: "Laser pointer", key: "l", check: laserOn, run: () => act("l") },
      { laserSwatches: true },
      { label: "Add a note here", key: "n", run: () => { lastX = menuX; lastY = menuY; act("n"); } },
      ...(window.__marpEdits && window.__marpEdits.canEdit ? [{ label: "Edit text and layout", key: "d", check: window.__marpEdits.editing, run: () => window.__marpEdits.toggle() }] : []),
      ...(window.__marpEdits && window.__marpEdits.slideItems ? window.__marpEdits.slideItems() : []),
      "-",
      { label: "Undo last stroke", key: "z", off: !here, run: () => act("z") },
      { label: "Clear ink on this slide", key: "c", off: !here, run: () => act("c") },
      { label: "Clear all ink", key: "⇧C", off: !total().strokes, run: () => act("C") },
      "-",
      { label: "Save deck with annotations…", key: "s", run: () => act("s") },
      { label: "Save a copy that works offline…", run: () => saveStandalone(true) },
      { label: "Save annotated Markdown…", key: "m", run: () => act("m") },
      { label: "Save annotations (JSON)", key: "⇧S", run: () => act("S") },
      { label: "Load annotations…", key: "i", run: () => act("i") },
      { label: "Print / save as PDF", key: MAC ? "⌘P" : "Ctrl+P", run: () => setTimeout(() => print(), 50) },
      "-",
      { label: srcPanel.hidden ? "Show this slide's Markdown" : "Hide the Markdown", key: "h", check: !srcPanel.hidden, run: () => toggleSource() },
      { label: fs ? "Exit fullscreen" : "Fullscreen", key: "f",
        run: () => fs ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}) },
      // timer.js: a deck without a timer can have one added (one it has is right-clicked on itself)
      ...(window.__marpTimer && !window.__marpTimer.active() ? [{ label: "Add a talk timer…", key: MAC ? "⌥T" : "Alt+T", run: () => window.__marpTimer.add() }] : []),
      // captions.js, recorder.js and audio.js: live captions, recording the talk, the microphone
      ...(window.__marpCaptions || window.__marpRecorder ? ["-"] : []),
      ...(window.__marpCaptions ? window.__marpCaptions.menuItems() : []),
      ...(window.__marpRecorder ? window.__marpRecorder.menuItems() : []),
      ...(window.__marpMic && window.__marpMic.menuItems ? window.__marpMic.menuItems() : []),   // audio.js
      { note: "Hold the mouse button on a slide for a spotlight · Shift+right-click for the browser's menu" },
    ];
  }
  function openMenu(x, y) {
    menuX = x; menuY = y;
    menu.replaceChildren();
    for (const item of menuItems()) {
      let row;
      if (item === "-") { row = document.createElement("div"); row.className = "sep"; }
      else if (item.header) { row = document.createElement("div"); row.className = "note"; row.style.fontWeight = "600"; row.textContent = item.header; }
      else if (item.noteSwatches) {
        const n = item.noteSwatches;
        row = colorSwatches(n.color, name => { closeMenu(); setNoteColor(n, name); });
        row.className = "sw";
      }
      else if (item.note) { row = document.createElement("div"); row.className = "note"; row.textContent = item.note; }
      else if (item.swatches) {
        row = document.createElement("div"); row.className = "sw";
        PENS.forEach((p, i) => {
          const b = document.createElement("button");
          b.style.background = p.color.replace("0.45", "1");
          b.title = (i === 4 ? "highlighter" : "pen colour") + " (" + (i + 1) + ")";
          if (enabled && presetOf(colors[brush], brush) === i) b.className = "on";
          b.addEventListener("click", () => { closeMenu(); pickPreset(i); if (!enabled) act("a"); else showBadge(); });
          row.appendChild(b);
        });
      } else if (item.laserSwatches) {
        row = document.createElement("div"); row.className = "sw";
        LASERS.forEach(([c, name], i) => {
          const b = document.createElement("button");
          b.style.background = `rgb(${c})`;
          b.title = "laser " + name + " (l, then " + (i + 1) + ")";
          if (laserOn && laserColour === i) b.className = "on";
          b.addEventListener("click", () => { closeMenu(); setLaserColour(i); if (!laserOn) act("l"); });
          row.appendChild(b);
        });
      } else {
        row = document.createElement("div");
        row.className = "it" + (item.off ? " off" : "");
        row.innerHTML = '<span class="ck"></span><span class="lb"></span><span class="k"></span>';
        row.querySelector(".ck").textContent = item.check ? "✓" : "";
        row.querySelector(".lb").textContent = item.label;
        row.querySelector(".k").textContent = item.key || "";
        if (!item.off) row.addEventListener("click", () => { closeMenu(); item.run(); });
      }
      menu.appendChild(row);
    }
    menu.style.display = "block";
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x, innerWidth - w - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, innerHeight - h - 4)) + "px";
  }
  // Text you can type in keeps the browser's own menu (copy/paste); Shift+right-click too.
  // The talk timer (timer.js) has a menu of its own.
  const NATIVE_MENU = "textarea, input, select, [contenteditable], .cm-editor, .mp-menu, .marp-timer, .marp-timer-set";
  let menuNote = null;                                   // the note that was right-clicked, if any
  let menuThumb = null;                                  // in the overview: the slide that was right-clicked
  function onContextMenu(e, x, y) {
    if (e.shiftKey || (e.target && e.target.closest && e.target.closest(NATIVE_MENU))) return;
    if (overview) {
      menuThumb = e.target && e.target.closest && e.target.closest("svg[data-marpit-svg], svg[data-mp-ghost]");   // a hidden slide's greyed-out copy too
      if (!window.__marpEdits || !window.__marpEdits.overviewItems || !window.__marpEdits.overviewItems(menuThumb).length) return;
      e.preventDefault();
      menuNote = null;
      openMenu(x, y);
      return;
    }
    e.preventDefault();
    const host = e.target && e.target.closest && e.target.closest("[data-note-id]");
    menuNote = host ? (notes[slideId()] || []).find(n => n.id === host.dataset.noteId) || null : null;
    openMenu(x, y);
  }
  addEventListener("contextmenu", e => onContextMenu(e, e.clientX, e.clientY), true);
  addEventListener("pointerdown", e => { if (menuOpen() && !menu.contains(e.target)) closeMenu(); }, true);
  addEventListener("wheel", closeMenu, { passive: true });
  addEventListener("blur", closeMenu);
  addEventListener("resize", closeMenu);

  addEventListener("resize", () => { resize(); layoutNotes(); });
  let shown = slideId();
  new MutationObserver(() => {
    const id = slideId();
    if (id === shown) return;
    shown = id;
    stroke = null; sel = []; lasso = moving = null;
    closeMenu();
    redraw(); buildNotes();
    if (!srcPanel.hidden) fillSource();
    setTimeout(() => { redraw(); layoutNotes(); }, 450);       // again once the slide transition has settled
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("fullscreenchange", () => setTimeout(() => { resize(); layoutNotes(); }, 100));
  resize();
  hookAll();
  addEventListener("load", hookAll);
  loadSource();
  // The script runs from the first slide, before the later slides are parsed.
  const ready = () => { if (migrateOnStart) { migrateOnStart = false; migrateErasers(ink); save(); } importBaked(); if (overview) showInOverview(); else { redraw(); buildNotes(); askKeepOrFresh(); } };
  // scimax's Present puts a new show id in the page each time (live reloads keep it). On a new
  // one, if this browser still has ink, notes or edits from an earlier showing, ask whether to
  // keep them or start fresh. A saved copy (s) has no id, so it never asks.
  function askKeepOrFresh() {
    const id = typeof window.__MARP_SHOW_ID__ === "string" ? window.__MARP_SHOW_ID__ : "";
    if (!id) return;
    let seen = null;
    try { seen = localStorage.getItem(KEY + ":show"); localStorage.setItem(KEY + ":show", id); } catch (e) { return; }
    if (seen === id || nothing(total())) return;
    const box = document.createElement("div");
    box.className = "annotate-layer";
    Object.assign(box.style, {
      position: "fixed", left: "50%", top: "18px", transform: "translateX(-50%)", zIndex: "100003",
      padding: "10px 16px", borderRadius: "8px", background: "rgba(17,24,39,.95)", color: "white",
      fontSize: "15px", fontFamily: "Helvetica, Arial, sans-serif", display: "flex", gap: "12px",
      alignItems: "center", boxShadow: "0 4px 16px rgba(0,0,0,.3)",
    });
    const text = document.createElement("span");
    text.textContent = `This deck has ${describe(total())} from an earlier showing.`;
    const button = (label, act) => {
      const b = document.createElement("button");
      b.textContent = label;
      Object.assign(b.style, {
        font: "inherit", padding: "4px 12px", borderRadius: "6px", cursor: "pointer",
        border: "1px solid rgba(255,255,255,.5)", background: "transparent", color: "white",
      });
      b.addEventListener("click", e => { e.stopPropagation(); box.remove(); act(); });
      return b;
    };
    ["pointerdown", "mousedown", "click"].forEach(t => box.addEventListener(t, e => e.stopPropagation()));
    box.append(text, button("Keep", () => {}), button("Start fresh", () => {
      try { localStorage.setItem(KEY + ":before-load", JSON.stringify({ ink, notes, edits: edits() })); } catch (e) { /* ignore */ }
      ink = {}; notes = {}; stroke = null; forget(); save(); saveNotes(); redraw(); buildNotes();
      if (window.__marpEdits && editCount()) window.__marpEdits.replace({});
      say(`Starting fresh. The earlier annotations are kept in this browser under "${KEY}:before-load".`);
    }));
    document.body.appendChild(box);
  }
  // In the overview: every slide with its own ink and notes, as for printing. The ink comes from
  // the slideshow itself: Chrome treats a file:// frame as another site, and may not let it read
  // the slideshow's storage.
  function showInOverview() {
    thumbnails();
    if (parent === window) return;
    addEventListener("message", e => {
      const d = e.source === parent && e.data && e.data.marpInk;
      if (!d || typeof d !== "object") return;
      if (validInk(d.ink)) ink = d.ink;
      if (validNotes(d.notes)) notes = d.notes;
      if (d.edits && window.__marpEdits) window.__marpEdits.replace(d.edits);
      thumbnails();
    });
    parent.postMessage({ marpInk: "want" }, "*");
  }
  addEventListener("message", e => {
    const f = !overview && document.querySelector(".bespoke-marp-overview iframe");
    if (!f || e.source !== f.contentWindow || !e.data || e.data.marpInk !== "want") return;
    e.source.postMessage({ marpInk: { ink, notes, edits: edits() } }, "*");
  });
  function thumbnails() {
    document.querySelectorAll(".annotate-layer").forEach(el => { el.style.display = "none"; });
    document.querySelectorAll("svg.thumb-ink, .mp-print-note").forEach(el => el.remove());
    slides().forEach((svg, i) => {
      const strokes = ink[idOf(svg, i)], sec = sectionOf(svg);
      if (strokes && strokes.length && sec) sec.insertAdjacentHTML("beforeend", inkSvg(strokes, " thumb-ink", slideSize(svg)));
      if (sec) (notes[idOf(svg, i)] || []).forEach(n => sec.appendChild(printNote(n, slideSize(svg))));
    });
  }
  document.readyState === "loading" ? addEventListener("DOMContentLoaded", ready) : ready();
})();
