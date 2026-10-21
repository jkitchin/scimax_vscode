/* marp-present: talk timer. A countdown in the corner of every slide, for a deck built by scimax
 * with `presenter: true` and `timer: 20` (minutes; also 20m, 45:00, 1h30m, 90s). A deck without
 * `timer:` can have one added in the slideshow: "Add a talk timer…" in the right-click menu, or Alt+T.
 *
 *   t        start / pause the timer (or click it)
 *   T        reset it to the full time
 *   + / -    add / take off a minute
 *   Alt+T    type a new time (20, 12:30, 90s, ...); T then resets to it
 *   right-click the timer for a menu with all of these
 *
 * It starts by itself the first time you move to another slide. It turns amber in the last
 * 5 minutes (or the last fifth of a short talk), red in the last minute, and then counts the
 * overtime up as -m:ss. The state lives in localStorage ("marp-timer:<path>"), so the audience
 * window, the presenter view (where it sits with Marp's own clock) and a reload all show the
 * same time. A clock left for 12 hours, or a deck rebuilt with a different time, starts afresh.
 * A timer added in the slideshow is kept there (marked `added`) until it is removed from its menu.
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || view === "overview" || window.__marpTimer) return;   // the presenter view's next-slide preview, Marp's overview
  const DURATION = Math.round(+window.__MARP_TIMER__) || 0;   // the deck's time; 0 = none (one can be added)

  const KEY = "marp-timer:" + location.pathname;
  const STALE = 12 * 3600 * 1000;
  // `base` is the deck's time, `duration` the full time now (changed with Alt+T or the menu)
  const fresh = (duration = DURATION) => ({ base: DURATION, duration, running: false, remaining: duration * 1000, endAt: 0, started: false,
    savedAt: Date.now(), ...(DURATION ? {} : { added: true }) });

  // null: no timer (the deck has no time and none was added here)
  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { /* storage blocked */ }
    const stale = !s || !(Date.now() - (s.savedAt || 0) < STALE);
    if (!DURATION) return s && s.added && s.duration > 0 ? (stale ? fresh(s.duration) : s) : null;
    if (stale || s.added || (s.base || s.duration) !== DURATION || !(s.duration > 0)) s = fresh();
    return s;
  }
  let state = load();
  function save() {
    try {
      if (state) { state.savedAt = Date.now(); localStorage.setItem(KEY, JSON.stringify(state)); }
      else localStorage.removeItem(KEY);
    } catch (e) { /* storage blocked */ }
    render();
  }
  const left = () => state.running ? state.endAt - Date.now() : state.remaining;

  function start() {
    if (state.running) return;
    state.running = true; state.started = true;
    state.endAt = Date.now() + state.remaining;
    save();
  }
  function pause() {
    if (!state.running) return;
    state.remaining = state.endAt - Date.now();
    state.running = false;
    save();
  }
  const toggle = () => state.running ? pause() : start();
  function reset() { state = fresh(state.duration); save(); }
  // A new full time, kept running if it was
  function setTime(seconds) {
    const running = state.running, started = state.started;
    state = fresh(seconds);
    state.started = started;
    if (running) start(); else save();
  }
  // A timer for a deck without one, from the slideshow; it starts when the talk moves on, as the deck's would
  function add(seconds) {
    state = fresh(seconds);
    opened = location.hash;
    save();
  }
  function remove() { state = null; save(); }
  // Add (or take off) time left; the full time grows with it, so the colours keep their meaning
  function adjust(seconds) {
    if (state.running) state.endAt += seconds * 1000; else state.remaining += seconds * 1000;
    state.duration = Math.max(1, state.duration + seconds);
    save();
  }

  // As parseTimer in presenterBundle.ts: a bare number is minutes; also 12:30, 1:05:00, 90s, 1h30m
  function parse(text) {
    text = String(text).trim().toLowerCase();
    let s;
    if (/^\d+(\.\d+)?$/.test(text)) s = parseFloat(text) * 60;
    else if (/^\d+(:\d{1,2}){1,2}$/.test(text)) s = text.split(":").map(Number).reduce((t, p) => t * 60 + p, 0);
    else {
      const m = text.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+)\s*s(?:ec(?:onds?|s)?)?)?$/);
      if (m && (m[1] || m[2] || m[3])) s = parseFloat(m[1] || 0) * 3600 + parseFloat(m[2] || 0) * 60 + parseInt(m[3] || 0, 10);
    }
    return s > 0 ? Math.round(s) : undefined;
  }

  const pad = n => String(n).padStart(2, "0");
  function format(ms) {
    const over = ms < 0;
    // Round up while counting down (0:01 until it hits zero), down while counting overtime
    let s = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    s %= 60;
    return (over ? "-" : "") + (h ? h + ":" + pad(m) : m) + ":" + pad(s);
  }

  const css = document.createElement("style");
  css.textContent = `
.marp-timer { position: fixed; top: 10px; right: 12px; z-index: 100002; font: 600 15px/1 system-ui, -apple-system, sans-serif;
  font-variant-numeric: tabular-nums; padding: 5px 9px; border-radius: 999px; color: #fff; background: rgba(30, 41, 59, .55);
  cursor: pointer; user-select: none; opacity: .75; transition: opacity .2s, background-color .4s; }
.marp-timer:hover { opacity: 1; }
body:has(.bespoke-marp-overview[data-open="1"]) .marp-timer { visibility: hidden; }   /* under the overview's close button */
.marp-timer.paused { background: rgba(100, 116, 139, .45); }
.marp-timer.paused::before { content: "❚❚ "; font-size: 10px; vertical-align: 2px; }
.marp-timer.warn { background: rgba(217, 119, 6, .85); opacity: .9; }
.marp-timer.late { background: rgba(220, 38, 38, .9); opacity: 1; }
.marp-timer.in-presenter { position: static; order: 1; font-size: 1.4em; opacity: 1; margin-left: .6em; }
.marp-timer-set { position: fixed; z-index: 100003; display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 10px;
  background: rgba(255,255,255,.97); box-shadow: 0 8px 30px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.07);
  font: 13px/1.2 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #6b7280; }
.marp-timer-set input { width: 190px; font: 600 16px system-ui, sans-serif; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 6px; color: #1f2937; }
.marp-timer-set input.bad { border-color: #dc2626; outline-color: #dc2626; }
@media print { .marp-timer, .marp-timer-menu, .marp-timer-set { display: none !important; } }`;
  document.head.appendChild(css);

  const el = document.createElement("div");
  el.className = "marp-timer";
  el.title = "Talk timer: t or click to start/pause, T to reset, +/- a minute, Alt+T to set; right-click for more";
  el.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggle(); });
  el.addEventListener("contextmenu", e => { if (e.shiftKey) return; e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); });
  el.addEventListener("pointerdown", e => e.stopPropagation());   // not a pen stroke or a spotlight

  function place() {
    if (!state) { if (el.parentNode) el.remove(); return; }
    // In Marp's presenter view, sit next to its own clock and elapsed time
    const info = view === "presenter" && document.querySelector(".bespoke-marp-presenter-info-container");
    if (info) {
      if (el.parentNode !== info) { el.classList.add("in-presenter"); info.appendChild(el); }
    } else if (!el.parentNode) {
      document.body.appendChild(el);
    }
  }

  // ---- right-click menu (styled by presenter.js's .mp-menu) and the box to type a time in ----
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const menu = document.createElement("div");
  menu.className = "mp-menu marp-timer-menu";
  menu.style.display = "none";
  document.body.appendChild(menu);
  const menuOpen = () => menu.style.display !== "none";
  function closeMenu() { menu.style.display = "none"; }
  function popAt(box, x, y) {
    box.style.left = Math.max(4, Math.min(x, innerWidth - box.offsetWidth - 4)) + "px";
    box.style.top = Math.max(4, Math.min(y, innerHeight - box.offsetHeight - 4)) + "px";
  }
  function openMenu(x, y) {
    closeSet();
    const items = [
      { label: state.running ? "Pause" : "Start", key: "t", run: toggle },
      { label: "Reset to " + format(state.duration * 1000), key: "⇧T", run: reset },
      "-",
      { label: "Add a minute", key: "+", run: () => adjust(60) },
      { label: "Take off a minute", key: "-", run: () => adjust(-60) },
      { label: "Set time…", key: MAC ? "⌥T" : "Alt+T", run: () => openSet() },
      ...(DURATION && state.duration !== DURATION ? [{ label: "Back to the deck's " + format(DURATION * 1000), run: () => setTime(DURATION) }] : []),
      ...(state.added ? ["-", { label: "Remove the timer", run: remove }] : []),
    ];
    menu.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      if (item === "-") row.className = "sep";
      else {
        row.className = "it";
        row.setAttribute("role", "button");
        row.innerHTML = '<span class="ck"></span><span class="lb"></span><span class="k"></span>';
        row.querySelector(".lb").textContent = item.label;
        row.querySelector(".k").textContent = item.key || "";
        row.addEventListener("click", e => { e.stopPropagation(); closeMenu(); item.run(); });
      }
      menu.appendChild(row);
    }
    menu.style.display = "block";
    popAt(menu, x, y);
  }

  const setBox = document.createElement("div");
  setBox.className = "marp-timer-set";
  setBox.style.display = "none";
  const input = document.createElement("input");
  input.placeholder = "20, 12:30, 90s, 1h30m";
  const hint = document.createElement("div");
  hint.textContent = "Minutes, m:ss or 1h30m · Enter sets, Esc cancels";
  setBox.append(input, hint);
  document.body.appendChild(setBox);
  function closeSet() { setBox.style.display = "none"; input.classList.remove("bad"); }
  function openSet() {
    closeMenu();
    input.value = "";
    hint.textContent = (state ? "" : "Length of the talk: ") + "Minutes, m:ss or 1h30m · Enter sets, Esc cancels";
    setBox.style.display = "flex";
    const r = state ? el.getBoundingClientRect() : { right: innerWidth - 12, bottom: 10 };
    popAt(setBox, r.right - setBox.offsetWidth, r.bottom + 6);
    input.focus();
  }
  input.addEventListener("keydown", e => {
    e.stopPropagation();   // not Marp's keys or the other tools' while typing here
    if (e.key === "Escape") { e.preventDefault(); closeSet(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const s = parse(input.value);
      if (s) { closeSet(); if (state) setTime(s); else add(s); } else input.classList.add("bad");
    }
  });
  input.addEventListener("input", () => input.classList.remove("bad"));
  [menu, setBox].forEach(b => b.addEventListener("pointerdown", e => e.stopPropagation()));   // not a pen stroke or a spotlight
  addEventListener("pointerdown", e => {
    if (menuOpen() && !menu.contains(e.target)) closeMenu();
    if (setBox.style.display !== "none" && !setBox.contains(e.target)) closeSet();
  }, true);
  addEventListener("blur", closeMenu);
  addEventListener("resize", () => { closeMenu(); closeSet(); });

  function render() {
    place();
    if (!state) return;
    const ms = left(), full = state.duration;
    const warnAt = Math.min(5 * 60 * 1000, full * 1000 / 5);
    el.textContent = format(ms);
    el.classList.toggle("paused", !state.running && state.started);
    el.classList.toggle("late", ms < 60 * 1000 && full > 60 || ms < 0);
    el.classList.toggle("warn", ms < warnAt && !el.classList.contains("late"));
  }

  function onKey(e) {
    if (e.key === "Escape" && menuOpen()) { closeMenu(); return; }
    // Alt+T: e.code, since on a Mac Option+T types a dagger
    const setKey = e.altKey && e.code === "KeyT" && !e.shiftKey;
    if (!setKey && !["t", "T", "+", "=", "-", "_"].includes(e.key)) return;
    if (e.ctrlKey || e.metaKey || (e.altKey && !setKey) || (!state && !setKey)) return;
    const t = e.target;
    if (t && /^(TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if (t && t.tagName === "INPUT" && t.type !== "range") return;
    if (t && (t.isContentEditable || (t.closest && t.closest(".pyc")))) return;   // typing in a code cell
    if (setKey) { e.preventDefault(); openSet(); }
    else if (e.key === "t") toggle();
    else if (e.key === "T") reset();
    else adjust(e.key === "+" || e.key === "=" ? 60 : -60);
    closeMenu();
  }
  addEventListener("keydown", onKey, true);
  // Widgets in iframes swallow keys; listen there too
  const hookFrame = f => { try { const w = f.contentWindow; if (w && !w.__marpTimerHooked) { w.__marpTimerHooked = true; w.addEventListener("keydown", onKey, true); } } catch (e) { /* cross-origin */ } };
  document.querySelectorAll("iframe").forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });

  // Start the first time the talk moves on from the slide it opened on (Marp changes the hash
  // with history.replaceState, which fires no hashchange, so watch it)
  let opened = location.hash;
  const moved = () => { if (state && !state.started && location.hash !== opened) start(); };

  // Another window (audience or presenter view) changed the timer
  addEventListener("storage", e => { if (e.key === KEY) { state = load(); render(); } });

  // For presenter.js's right-click menu
  window.__marpTimer = { active: () => !!state, add: () => openSet() };

  render();
  setInterval(() => { moved(); render(); }, 250);
})();
