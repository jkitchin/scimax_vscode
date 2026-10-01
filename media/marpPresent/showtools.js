/* marp-present: show tools for Marp HTML decks (blank screen, zoom, jump to a slide, exercise countdowns).
 * Part of scimax-vscode, added with the presenter tools (`presenter: true`).
 *
 *   b / w    black / white screen, to pause for discussion (again, Esc or a click brings the slide back)
 *   x        zoom: drag a box around part of the slide to fill the screen with it, or click to
 *            magnify around a point; x or Esc zooms out (so does moving to another slide)
 *   g        go to a slide: type part of a title (or any words on the slide) or a number, Enter
 *   12 Enter type a slide number and press Enter to jump to it
 *   e / E    start or pause / reset the exercise countdown on this slide (or click it)
 *
 * Exercise countdowns are ```countdown 3:00 fences (engine.cjs). Pressing these keys in Marp's
 * presenter view acts on the audience window too: blank, zoom and countdowns are shared through
 * localStorage ("marp-show:<path>"), and the presenter view only shows that the screen is blank.
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || window.__marpShow) return;   // the presenter view's next-slide preview
  window.__marpShow = true;
  const presenterView = view === "presenter";

  const KEY = "marp-show:" + location.pathname;
  const RECENT = 15 * 60 * 1000;   // a blank screen or zoom older than this is not restored on load

  // ---- shared state: { blank, blankAt, zoom: {slide, box:[u0,v0,u1,v1]}, zoomAt, countdowns: {i: {...}} }
  let state = {};
  function load(initial) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { /* storage blocked */ }
    if (initial) {
      if (!(Date.now() - (s.blankAt || 0) < RECENT)) s.blank = null;
      if (!(Date.now() - (s.zoomAt || 0) < RECENT)) s.zoom = null;
    }
    s.countdowns = s.countdowns || {};
    return s;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
    apply();
  }

  // ---- slides
  const slides = () => [...document.querySelectorAll("svg[data-marpit-svg]")];
  const activeSvg = () => document.querySelector("svg[data-marpit-svg].bespoke-marp-active");
  const slideNo = () => {
    const i = slides().indexOf(activeSvg());
    return i >= 0 ? i + 1 : +((location.hash.match(/^#(\d+)/) || [, "1"])[1]);
  };
  function goTo(n) {
    const count = slides().length;
    n = Math.max(1, Math.min(count || n, Math.round(n)));
    if (n !== slideNo()) location.hash = "#" + n;   // Marp follows the hash (and syncs the other window)
  }

  // ---- styles
  const css = document.createElement("style");
  css.textContent = `
.mp-blank { position: fixed; inset: 0; z-index: 100005; cursor: none; }
.mp-blank.black { background: #000; }
.mp-blank.white { background: #fff; }
.mp-blank-badge { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); z-index: 100005; padding: 4px 12px;
  border-radius: 999px; font: 600 13px system-ui, sans-serif; background: #111; color: #fff; border: 1px solid #666; pointer-events: none; }
.mp-blank-badge.white { background: #fff; color: #111; }
.mp-zoom-pick { position: fixed; inset: 0; z-index: 100004; cursor: crosshair; }
.mp-zoom-box { position: fixed; border: 2px dashed #2563eb; background: rgba(37, 99, 235, .12); pointer-events: none; }
.mp-zoom-hint, .mp-goto-hint { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 100006; padding: 6px 14px;
  border-radius: 999px; font: 600 14px system-ui, sans-serif; background: rgba(15, 23, 42, .85); color: #fff; pointer-events: none; }
svg[data-marpit-svg].mp-zoomed { transition: transform .35s ease; transform-origin: 0 0; }
.mp-goto { position: fixed; left: 50%; top: 12%; transform: translateX(-50%); z-index: 100006; width: min(560px, 90vw);
  background: #fff; color: #111827; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.35); font: 15px system-ui, sans-serif; overflow: hidden; }
.mp-goto input { box-sizing: border-box; width: 100%; padding: 12px 14px; border: 0; border-bottom: 1px solid #e5e7eb; font: inherit; font-size: 17px; outline: none; }
.mp-goto ol { list-style: none; margin: 0; padding: 4px; max-height: 50vh; overflow-y: auto; }
.mp-goto li { display: flex; gap: 10px; padding: 7px 10px; border-radius: 7px; cursor: pointer; }
.mp-goto li .n { color: #6b7280; min-width: 2.2em; text-align: right; font-variant-numeric: tabular-nums; }
.mp-goto li .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-goto li.sel { background: #dbeafe; }
.mp-goto li.here .n::after { content: " ●"; color: #2563eb; }
.marp-countdown.running { box-shadow: 0 0 0 .15em rgba(37, 99, 235, .35); }
.marp-countdown.paused .marp-countdown-time { opacity: .55; }
.marp-countdown.done { animation: mp-done 1s ease-in-out 3; color: #dc2626 !important; }
@keyframes mp-done { 50% { transform: scale(1.06); } }
@media print { .mp-blank, .mp-blank-badge, .mp-zoom-pick, .mp-zoom-hint, .mp-goto, .mp-goto-hint { display: none !important; }
  svg[data-marpit-svg].mp-zoomed { transform: none !important; } }`;
  document.head.appendChild(css);

  const div = (cls, parent) => { const d = document.createElement("div"); d.className = cls; (parent || document.body).appendChild(d); return d; };
  const nudge = () => dispatchEvent(new Event("resize"));   // presenter.js redraws ink and notes on the moved slide

  // ---- blank screen
  const blank = div("mp-blank");
  blank.style.display = "none";
  blank.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); setBlank(null); });
  const badge = div("mp-blank-badge");
  badge.style.display = "none";
  function setBlank(color) {
    state.blank = state.blank === color ? null : color;
    state.blankAt = Date.now();
    save();
  }

  // ---- zoom
  let picking = null, zoomedSvg = null, zoomKey = "";
  const hint = div("mp-zoom-hint");
  hint.style.display = "none";
  function startPick() {
    const svg = activeSvg();
    if (!svg) return;
    picking = div("mp-zoom-pick");
    hint.textContent = "Drag a box to zoom, or click a point · Esc cancels";
    hint.style.display = "";
    let from = null, box = null;
    picking.addEventListener("pointerdown", e => {
      e.preventDefault(); e.stopPropagation();
      picking.setPointerCapture(e.pointerId);
      from = [e.clientX, e.clientY];
      box = div("mp-zoom-box", picking);
    });
    picking.addEventListener("pointermove", e => {
      if (!from) return;
      Object.assign(box.style, { left: Math.min(from[0], e.clientX) + "px", top: Math.min(from[1], e.clientY) + "px",
        width: Math.abs(e.clientX - from[0]) + "px", height: Math.abs(e.clientY - from[1]) + "px" });
    });
    picking.addEventListener("pointerup", e => {
      if (!from) return;
      e.preventDefault(); e.stopPropagation();
      const r = baseRect(svg);
      const u = x => (x - r.left) / r.width, v = y => (y - r.top) / r.height;
      let b;
      if (Math.abs(e.clientX - from[0]) < 8 && Math.abs(e.clientY - from[1]) < 8) {
        const cu = u(e.clientX), cv = v(e.clientY);       // a click: 2.5x around the point
        b = [cu - 0.2, cv - 0.2, cu + 0.2, cv + 0.2];
      } else {
        b = [u(Math.min(from[0], e.clientX)), v(Math.min(from[1], e.clientY)), u(Math.max(from[0], e.clientX)), v(Math.max(from[1], e.clientY))];
      }
      endPick();
      state.zoom = { slide: slideNo(), box: b };
      state.zoomAt = Date.now();
      save();
    });
  }
  function endPick() {
    if (picking) picking.remove();
    picking = null;
    hint.style.display = "none";
  }
  function zoomOut() {
    if (!state.zoom) return;
    state.zoom = null; state.zoomAt = Date.now();
    save();
  }
  // The slide's place on the screen without the zoom
  function baseRect(svg) {
    const t = svg.style.transform;
    svg.style.transition = "none"; svg.style.transform = "";
    const r = svg.getBoundingClientRect();
    svg.style.transform = t;
    svg.getBoundingClientRect();   // apply it before the transition comes back (SVG has no offsetWidth)
    svg.style.transition = "";
    return r;
  }
  function applyZoom() {
    const svg = activeSvg();
    const z = state.zoom && state.zoom.slide === slideNo() ? state.zoom : null;
    if (zoomedSvg && (zoomedSvg !== svg || !z)) {
      const old = zoomedSvg;
      old.style.transform = "";
      zoomedSvg = null; zoomKey = "";
      setTimeout(() => { if (old !== zoomedSvg) old.classList.remove("mp-zoomed"); nudge(); }, 400);
      nudge();
    }
    if (!z || !svg) return;
    const key = JSON.stringify(z.box) + innerWidth + "x" + innerHeight;
    if (zoomedSvg === svg && zoomKey === key) return;   // already there
    const r = baseRect(svg);
    const [u0, v0, u1, v1] = z.box;
    const s = Math.min(8, 1 / Math.max(u1 - u0, 0.02), 1 / Math.max(v1 - v0, 0.02));
    const cx = (u0 + u1) / 2 * r.width, cy = (v0 + v1) / 2 * r.height;
    const transform = `translate(${r.width / 2 - s * cx}px, ${r.height / 2 - s * cy}px) scale(${s})`;
    svg.classList.add("mp-zoomed");
    svg.style.transform = transform;
    zoomedSvg = svg; zoomKey = key;
    nudge();
    setTimeout(nudge, 400);   // after the transition
  }

  // ---- go to a slide
  let palette = null;
  function slideTitle(svg, i) {
    const h = svg.querySelector("h1, h2, h3, h4, h5, h6");
    const text = s => (s || "").replace(/\s+/g, " ").trim();
    if (h && text(h.textContent)) return text(h.textContent);
    const p = [...svg.querySelectorAll("section > *:not(header):not(footer)")].map(e => text(e.textContent)).find(Boolean);
    return p ? p.slice(0, 80) : "Slide " + (i + 1);
  }
  function openPalette() {
    if (palette) return;
    const items = slides().map((svg, i) => ({ n: i + 1, title: slideTitle(svg, i), text: (svg.textContent || "").toLowerCase() }));
    const here = slideNo();
    palette = div("mp-goto");
    const input = document.createElement("input");
    input.placeholder = "Go to slide: a title, words on the slide, or a number";
    const list = document.createElement("ol");
    palette.append(input, list);
    let shown = [], sel = 0;
    function render() {
      const q = input.value.trim().toLowerCase();
      if (!q) shown = items;
      else if (/^\d+$/.test(q)) shown = items.filter(it => String(it.n).startsWith(q)).sort((a, b) => (b.n === +q) - (a.n === +q));
      else {
        const words = q.split(/\s+/);
        shown = items.filter(it => words.every(w => it.text.includes(w) || it.title.toLowerCase().includes(w)))
          .sort((a, b) => b.title.toLowerCase().includes(q) - a.title.toLowerCase().includes(q));
      }
      sel = Math.max(0, Math.min(sel, shown.length - 1));
      if (!q) sel = Math.max(0, shown.findIndex(it => it.n === here));
      list.textContent = "";
      shown.forEach((it, i) => {
        const li = document.createElement("li");
        li.className = (i === sel ? "sel " : "") + (it.n === here ? "here" : "");
        const n = document.createElement("span"); n.className = "n"; n.textContent = it.n;
        const t = document.createElement("span"); t.className = "t"; t.textContent = it.title;
        li.append(n, t);
        li.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); closePalette(); goTo(it.n); });
        list.appendChild(li);
      });
      const cur = list.children[sel];
      if (cur) cur.scrollIntoView({ block: "nearest" });
    }
    input.addEventListener("input", () => { sel = 0; render(); });
    input.addEventListener("keydown", e => {
      e.stopPropagation();   // not Marp's keys or ours while typing here
      if (e.key === "Escape") { e.preventDefault(); closePalette(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const q = input.value.trim();
        const it = /^\d+$/.test(q) && items.find(x => x.n === +q) || shown[sel];
        closePalette();
        if (it) goTo(it.n);
      }
    });
    for (const t of ["keyup", "keypress"]) input.addEventListener(t, e => e.stopPropagation());
    input.addEventListener("blur", () => setTimeout(closePalette, 150));
    render();
    input.focus();
  }
  function closePalette() {
    if (!palette) return;
    palette.remove();
    palette = null;
  }

  // Typing a number then Enter jumps to that slide
  let digits = "", digitsTimer = 0;
  const gotoHint = div("mp-goto-hint");
  gotoHint.style.display = "none";
  function showDigits() {
    clearTimeout(digitsTimer);
    gotoHint.textContent = "Go to slide " + digits + " ⏎";
    gotoHint.style.display = digits ? "" : "none";
    if (digits) digitsTimer = setTimeout(() => { digits = ""; showDigits(); }, 2500);
  }
  const penOn = () => { const c = document.querySelector("canvas.annotate-layer"); return !!c && c.style.pointerEvents === "auto"; };

  // ---- exercise countdowns (```countdown 3:00)
  const boxes = () => [...document.querySelectorAll(".marp-countdown")];
  const total = el => +el.dataset.seconds || 300;
  function countdown(i) {
    const el = boxes()[i];
    return state.countdowns[i] || { running: false, remaining: total(el) * 1000, endAt: 0, started: false };
  }
  const leftOf = c => c.running ? c.endAt - Date.now() : c.remaining;
  function toggleCountdown(i) {
    const c = countdown(i);
    if (c.running) { c.remaining = Math.max(0, c.endAt - Date.now()); c.running = false; }
    else {
      if (c.remaining <= 0) c.remaining = total(boxes()[i]) * 1000;   // finished: run it again
      c.running = true; c.started = true; c.endAt = Date.now() + c.remaining;
    }
    state.countdowns[i] = c;
    save();
  }
  function resetCountdown(i) { delete state.countdowns[i]; save(); }
  const onSlide = () => { const svg = activeSvg(); return boxes().map((el, i) => [el, i]).filter(([el]) => svg && svg.contains(el)).map(([, i]) => i); };
  const fmt = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s % 60).padStart(2, "0");
  };
  function renderCountdowns() {
    boxes().forEach((el, i) => {
      const c = countdown(i), ms = leftOf(c), done = c.started && ms <= 0;
      const time = el.querySelector(".marp-countdown-time");
      const text = done ? "⏱ Time's up" : "⏱ " + fmt(ms);
      if (time && time.textContent !== text) time.textContent = text;
      el.classList.toggle("running", c.running && !done);
      el.classList.toggle("paused", !c.running && c.started && !done);
      el.classList.toggle("done", done);
    });
  }
  document.addEventListener("click", e => {
    const el = e.target && e.target.closest && e.target.closest(".marp-countdown");
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    toggleCountdown(boxes().indexOf(el));
  }, true);

  // ---- apply the shared state to this window
  function apply() {
    const b = state.blank;
    if (presenterView) {
      badge.style.display = b ? "" : "none";
      badge.className = "mp-blank-badge " + (b || "");
      badge.textContent = b ? `Audience screen is ${b} · ${b[0]} or Esc to show the slide` : "";
    } else {
      blank.style.display = b ? "" : "none";
      blank.className = "mp-blank " + (b || "");
    }
    applyZoom();
    renderCountdowns();
  }

  // ---- keys
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && /^(TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if (t && t.tagName === "INPUT" && t.type !== "range") return;
    if (t && (t.isContentEditable || (t.closest && t.closest(".pyc")))) return;   // typing in a code cell
    const k = e.key;
    let used = true;
    if (/^[0-9]$/.test(k) && !penOn()) { digits = (digits + k).slice(-4); showDigits(); used = false; }
    else if (k === "Enter" && digits) { const n = +digits; digits = ""; showDigits(); goTo(n); }
    else if (k === "Backspace" && digits) { digits = digits.slice(0, -1); showDigits(); }
    else if (k === "Escape") {
      if (digits) { digits = ""; showDigits(); }
      else if (picking) endPick();
      else if (state.blank) setBlank(null);
      else if (state.zoom) zoomOut();
      else used = false;
      // Esc otherwise belongs to presenter.js (closing its menu) and the browser (leaving full screen)
      if (used) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    else if (k === "b") setBlank("black");
    else if (k === "w") setBlank("white");
    else if (k === "x") { if (picking) endPick(); else if (state.zoom && state.zoom.slide === slideNo()) zoomOut(); else startPick(); }
    else if (k === "g") { e.preventDefault(); openPalette(); }
    else if (k === "e" || k === "E") { const ids = onSlide(); ids.forEach(i => k === "e" ? toggleCountdown(i) : resetCountdown(i)); used = ids.length > 0; }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  addEventListener("keydown", onKey, true);
  // Widgets in iframes swallow keys; listen there too
  const hookFrame = f => { try { const w = f.contentWindow; if (w && !w.__marpShowHooked) { w.__marpShowHooked = true; w.addEventListener("keydown", onKey, true); } } catch (e) { /* cross-origin */ } };
  document.querySelectorAll("iframe").forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });

  // Another window changed something
  addEventListener("storage", e => { if (e.key === KEY) { state = load(false); apply(); } });

  state = load(true);
  apply();
  let lastSlide = slideNo();
  setInterval(() => {
    const n = slideNo();
    if (n !== lastSlide) {
      lastSlide = n;
      if (state.zoom && state.zoom.slide !== n) { state.zoom = null; state.zoomAt = Date.now(); save(); }
      if (picking) endPick();
    }
    applyZoom();
    renderCountdowns();
  }, 250);
})();
