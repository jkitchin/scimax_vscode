/* marp-present: talk timer. A countdown in the corner of every slide, for a deck built by scimax
 * with `presenter: true` and `timer: 20` (minutes; also 20m, 45:00, 1h30m, 90s).
 *
 *   t        start / pause the timer (or click it)
 *   T        reset it to the full time
 *
 * It starts by itself the first time you move to another slide. It turns amber in the last
 * 5 minutes (or the last fifth of a short talk), red in the last minute, and then counts the
 * overtime up as -m:ss. The state lives in localStorage ("marp-timer:<path>"), so the audience
 * window, the presenter view (where it sits with Marp's own clock) and a reload all show the
 * same time. A clock left for 12 hours, or a deck rebuilt with a different time, starts afresh.
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (view === "next" || window.__marpTimer) return;   // the presenter view's next-slide preview
  const DURATION = Math.round(+window.__MARP_TIMER__);
  if (!(DURATION > 0)) return;
  window.__marpTimer = true;

  const KEY = "marp-timer:" + location.pathname;
  const STALE = 12 * 3600 * 1000;
  const fresh = () => ({ duration: DURATION, running: false, remaining: DURATION * 1000, endAt: 0, started: false, savedAt: Date.now() });

  function load() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { /* storage blocked */ }
    if (!s || s.duration !== DURATION || !(Date.now() - (s.savedAt || 0) < STALE)) s = fresh();
    return s;
  }
  let state = load();
  function save() {
    state.savedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ }
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
  function reset() { state = fresh(); save(); }

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
.marp-timer.paused { background: rgba(100, 116, 139, .45); }
.marp-timer.paused::before { content: "❚❚ "; font-size: 10px; vertical-align: 2px; }
.marp-timer.warn { background: rgba(217, 119, 6, .85); opacity: .9; }
.marp-timer.late { background: rgba(220, 38, 38, .9); opacity: 1; }
.marp-timer.in-presenter { position: static; order: 1; font-size: 1.4em; opacity: 1; margin-left: .6em; }
@media print { .marp-timer { display: none !important; } }`;
  document.head.appendChild(css);

  const el = document.createElement("div");
  el.className = "marp-timer";
  el.title = "Talk timer: t or click to start/pause, T to reset";
  el.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggle(); });
  el.addEventListener("pointerdown", e => e.stopPropagation());   // not a pen stroke or a spotlight

  function place() {
    // In Marp's presenter view, sit next to its own clock and elapsed time
    const info = view === "presenter" && document.querySelector(".bespoke-marp-presenter-info-container");
    if (info) {
      if (el.parentNode !== info) { el.classList.add("in-presenter"); info.appendChild(el); }
    } else if (!el.parentNode) {
      document.body.appendChild(el);
    }
  }

  function render() {
    const ms = left();
    const warnAt = Math.min(5 * 60 * 1000, DURATION * 1000 / 5);
    el.textContent = format(ms);
    el.classList.toggle("paused", !state.running && state.started);
    el.classList.toggle("late", ms < 60 * 1000 && DURATION > 60 || ms < 0);
    el.classList.toggle("warn", ms < warnAt && !el.classList.contains("late"));
  }

  function onKey(e) {
    if (e.key !== "t" && e.key !== "T") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && /^(TEXTAREA|SELECT)$/.test(t.tagName || "")) return;
    if (t && t.tagName === "INPUT" && t.type !== "range") return;
    if (t && (t.isContentEditable || (t.closest && t.closest(".pyc")))) return;   // typing in a code cell
    e.key === "t" ? toggle() : reset();
  }
  addEventListener("keydown", onKey, true);
  // Widgets in iframes swallow keys; listen there too
  const hookFrame = f => { try { const w = f.contentWindow; if (w && !w.__marpTimerHooked) { w.__marpTimerHooked = true; w.addEventListener("keydown", onKey, true); } } catch (e) { /* cross-origin */ } };
  document.querySelectorAll("iframe").forEach(f => { hookFrame(f); f.addEventListener("load", () => hookFrame(f)); });

  // Start the first time the talk moves on from the slide it opened on (Marp changes the hash
  // with history.replaceState, which fires no hashchange, so watch it)
  const opened = location.hash;
  const moved = () => { if (!state.started && location.hash !== opened) start(); };

  // Another window (audience or presenter view) changed the timer
  addEventListener("storage", e => { if (e.key === KEY) { state = load(); render(); } });

  place();
  render();
  setInterval(() => { moved(); place(); render(); }, 250);
})();
