/* marp-present: live, editable Python cells in Marp slides (CodeMirror 6 + Pyodide).
 *
 * Write a code block as ```python run  (flags: `auto` runs when its slide is first shown,
 * `hidden` is setup code that is not shown and runs before the first cell). While presenting:
 *
 *   click a cell to edit it (Python highlighting, auto-indent, brackets)
 *   Shift+Enter or ▶ runs it · Esc leaves the editor (so the arrow keys change slides again)
 *   ↺ puts the original code back · ⟲ restarts Python
 *
 * All cells share one Python (like a notebook), running in a Web Worker so the slides stay
 * responsive. Python is Pyodide, downloaded from jsdelivr the first time a cell runs (a few
 * seconds; the deck itself stays small). Packages are fetched only when needed:
 *   - Pyodide's own packages (numpy, scipy, matplotlib, pandas, sympy, scikit-learn, ...) load
 *     automatically on `import`
 *   - `%pip install seaborn lmfit` in a cell installs pure-Python packages from PyPI
 *   - a failed import is tried once from PyPI before giving up
 *   - `import pycse` installs pycse with the pycse-book recipe (its jax/flax deps are mocked)
 * Python starts downloading in the background as soon as the deck opens, runs the `hidden` setup
 * cells, then prefetches every cell's packages and imports (in slide order) without running
 * them, so the first Run is quick. A Run jumps ahead of the prefetching.
 * Output: printed text, errors, the value of the last expression, matplotlib figures.
 * Needs internet to run code; editing works offline. Requires vendor/codemirror.js (global CM).
 */
(() => {
  if (window.__pycells) return;
  window.__pycells = true;
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

  const style = document.createElement("style");
  style.textContent = `
.pyc { margin: 8px 0; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.12); background: #f6f8fa;
  display: flex; flex-direction: column; }
.pyc-bar, .pyc-ed { flex: none; }
.pyc-bar { display: flex; align-items: center; gap: 0.5em; padding: 0.2em 0.7em; background: rgba(0,0,0,.05);
  font: 0.62em/1.6 Helvetica, Arial, sans-serif; color: #6b7280; }
.pyc-bar button { font: 600 1em Helvetica, Arial, sans-serif; border: 1px solid #cbd5e1; background: white; color: #1f2937;
  border-radius: 0.4em; padding: 0.05em 0.7em; cursor: pointer; }
.pyc-bar button.run { border-color: #16a34a; color: #15803d; }
.pyc-bar button:hover { background: #1f2937; color: white; border-color: #1f2937; }
.pyc-bar .n { font-family: ui-monospace, Menlo, monospace; min-width: 2.6em; }
.pyc-bar .st { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.pyc-bar .busy::before { content: ""; display: inline-block; width: 0.7em; height: 0.7em; margin-right: 0.4em; border-radius: 50%;
  border: 2px solid #16a34a; border-right-color: transparent; animation: pyc-spin .8s linear infinite; vertical-align: -1px; }
@keyframes pyc-spin { to { transform: rotate(360deg); } }
.pyc .cm-editor { background: transparent; max-height: 330px; }   /* fit() lowers these to what the slide has room for */
.pyc .cm-editor.cm-focused { outline: 2px solid #16a34a; outline-offset: -2px; }
.pyc .cm-scroller { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; line-height: 1.4; }
.pyc .cm-content { padding: 8px 0; }
.pyc .cm-line { padding: 0 14px; }
.pyc-out { flex: 1 1 auto; min-height: 0; overflow: auto; background: white; border-top: 1px solid #e5e7eb; }
.pyc-out:empty { display: none; }
.pyc-out pre { margin: 0; padding: 4px 14px; white-space: pre-wrap; font: 0.8em/1.35 ui-monospace, Menlo, monospace;
  background: none !important; border: 0 !important; box-shadow: none; color: #111827; }
.pyc-out pre.stderr { color: #b45309; } .pyc-out pre.error { color: #b91c1c; background: #fef2f2 !important; }
.pyc-out pre.result { color: #1d4ed8; } .pyc-out pre.note { color: #6b7280; font-style: italic; }
.pyc-out img { display: block; max-width: 100%; max-height: 280px; margin: 4px auto; cursor: zoom-in; }
.pyc-out img.full { max-width: none; max-height: none; cursor: zoom-out; }
@media print { .pyc-bar button { display: none; } .pyc .cm-editor { max-height: none; } .pyc { max-height: none !important; } }`;
  document.head.appendChild(style);

  // ---------------------------------------------------------------- the Python worker --
  const WORKER = `
import { loadPyodide } from ${JSON.stringify(PYODIDE + "pyodide.mjs")};   // a module worker: classic importScripts is not reliable
let py = null, cur = null, pycseDone = false, quiet = false;   // quiet: installer chatter goes to the status line
const tried = new Set();
const post = (type, extra) => postMessage(Object.assign({ type, id: cur }, extra));
const note = text => post("status", { text });
const NAME = { sklearn: "scikit-learn", PIL: "Pillow", yaml: "pyyaml", bs4: "beautifulsoup4", skimage: "scikit-image", cv2: "opencv-python" };

async function init() {
  note("loading Python (first run only)…");
  py = await loadPyodide({ indexURL: ${JSON.stringify(PYODIDE)} });
  py.setStdout({ batched: s => quiet ? note(s.slice(0, 120)) : post("stream", { name: "stdout", text: s + "\\n" }) });
  py.setStderr({ batched: s => post("stream", { name: "stderr", text: s + "\\n" }) });
  await py.loadPackage("micropip", { messageCallback: () => {} });
  await py.runPythonAsync(\`
import os, sys, warnings
os.environ["MPLBACKEND"] = "Agg"
warnings.filterwarnings("ignore", message=".*non-interactive.*")
from pyodide.code import eval_code_async

async def __pycells_run(code, name):
    r = await eval_code_async(code, globals(), filename=name)
    return None if r is None else repr(r)

def __pycells_preimport(code):
    import ast, importlib
    try:
        tree = ast.parse(code)
    except Exception:
        return
    mods = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            mods.append(node.module)
    for m in mods:
        if m not in sys.modules:
            try:
                importlib.import_module(m)
            except Exception:
                pass

def __pycells_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return []
    import io, base64
    import matplotlib.pyplot as plt
    out = []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for n in plt.get_fignums():
            buf = io.BytesIO()
            plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            out.append(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")
    return out
\`);
}

// pycse's jax/flax dependencies cannot run in the browser: the pycse-book recipe
async function installPycse() {
  if (pycseDone) return;
  note("installing pycse (first time only)…");
  await py.runPythonAsync(\`
import micropip
if hasattr(micropip, "add_mock_package"):
    for _n in ["jax", "jaxlib", "flax", "optax"]:
        micropip.add_mock_package(_n, "99.0.0")
    await micropip.install(["pycse"])
else:
    await micropip.install(["numpy", "scipy", "matplotlib", "pandas", "ipython", "numdifftools", "joblib"])
    await micropip.install("pycse", deps=False)
try:
    await micropip.install("pyodide-http")
    import pyodide_http
    pyodide_http.patch_all()
except Exception:
    pass
\`);
  pycseDone = true;
}

async function pipInstall(names) {
  names = names.filter(n => n && !n.startsWith("-"));
  if (names.includes("pycse")) { await installPycse(); names = names.filter(n => n !== "pycse"); }
  if (!names.length) return;
  note("pip install " + names.join(" ") + "…");
  py.globals.set("__pycells_pkgs", JSON.stringify(names));
  await py.runPythonAsync("import json, micropip\\nawait micropip.install(json.loads(__pycells_pkgs))");
}

const quietly = async f => { quiet = true; try { return await f(); } finally { quiet = false; } };

// %pip / !pip install lines: collected, and blanked so the rest keeps its line numbers
function stripPip(code) {
  const pips = [];
  code = code.split("\\n").map(l => {
    const m = l.match(/^\\s*[%!]pip\\s+install\\s+(.*)$/);
    if (!m) return l;
    pips.push(...m[1].trim().split(/\\s+/));
    return "";
  }).join("\\n");
  return { code, pips };
}

// Get a cell ready without running it: install what it pip-installs, download the Pyodide
// packages it imports, and import its modules (matplotlib's first import alone takes seconds).
async function prefetch({ id, code }) {
  cur = id;
  try {
    if (!py) await init();
    const s = stripPip(code);
    await quietly(async () => {
      if (s.pips.length) await pipInstall(s.pips).catch(() => {});
      if (/^\\s*(import|from)\\s+pycse\\b/m.test(s.code)) await installPycse().catch(() => {});
      await py.loadPackagesFromImports(s.code, { messageCallback: () => {} }).catch(() => {});
      py.globals.get("__pycells_preimport")(s.code);
    });
  } catch (e) { /* best effort: the real run reports any problem */ }
  post("done", { ok: true });
}

async function run({ id, code, name }) {
  cur = id;
  try {
    if (!py) await init();
    const s = stripPip(code), pips = s.pips;
    code = s.code;
    if (pips.length) await quietly(() => pipInstall(pips));
    if (/^\\s*(import|from)\\s+pycse\\b/m.test(code)) await quietly(installPycse);
    note("loading packages…");
    await quietly(() => py.loadPackagesFromImports(code, { messageCallback: () => {} }));
    note("running…");
    let repr;
    for (;;) {
      try { repr = await py.globals.get("__pycells_run")(code, name); break; }
      catch (e) {
        const m = String(e.message).match(/ModuleNotFoundError: No module named '([\\w.]+)'/);
        const mod = m && m[1].split(".")[0];
        if (!mod || tried.has(mod)) throw e;
        tried.add(mod);
        try { await quietly(() => pipInstall([NAME[mod] || mod])); } catch (e2) { throw e; }
        post("stream", { name: "note", text: "installed " + (NAME[mod] || mod) + " from PyPI\\n" });
      }
    }
    const figs = py.globals.get("__pycells_figures")(), pngs = figs.toJs();
    figs.destroy();
    for (const png of pngs) post("image", { png });
    // a plotting call's return value (Text(...), [<matplotlib.lines.Line2D ...>]) is noise next to the figure
    const plotty = ["[<matplotlib", "<matplotlib", "[<seaborn", "<seaborn", "Text(", "(<Figure", "<Axes"].some(p => (repr || "").startsWith(p));
    if (repr !== undefined && !(pngs.length && plotty)) post("result", { text: repr });
    post("done", { ok: true });
  } catch (e) {
    let t = String(e && e.message || e);
    const i = t.indexOf('File "' + name + '"');                 // drop Pyodide's own frames
    if (i > 0) t = "Traceback (most recent call last):\\n  " + t.slice(i);
    post("error", { text: t });
    post("done", { ok: false });
  }
}
// Two queues: cells you run go ahead of background prefetching, so a run waits for at most
// the one prefetch in progress.
const runs = [], prefetches = [];
let busy = false;
async function pump() {
  if (busy) return;
  busy = true;
  while (runs.length || prefetches.length) {
    const job = runs.length ? runs.shift() : prefetches.shift();
    await (job.type === "prefetch" ? prefetch(job) : run(job));
  }
  busy = false;
}
self.onmessage = e => { (e.data.type === "prefetch" ? prefetches : runs).push(e.data); pump(); };
`;

  let worker = null, nextId = 0, counter = 0, setupQueued = false;
  const handlers = new Map();
  function getWorker() {
    if (worker) return worker;
    // A module worker (Pyodide 314 refuses classic workers) from a data: URL: a blob: URL module
    // worker fails when the deck is opened from file://, a data: URL works there and on http(s).
    worker = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(WORKER), { type: "module" });
    worker.onmessage = e => { const h = handlers.get(e.data.id); if (h) h(e.data); };
    worker.onerror = e => {
      e.preventDefault();
      handlers.forEach(h => { h({ type: "error", text: "Python could not start (it is downloaded from cdn.jsdelivr.net: no internet?)\n" + (e.message || "") }); h({ type: "done", ok: false }); });
      worker = null; setupQueued = false;
    };
    return worker;
  }
  function restart() {
    if (worker) worker.terminate();
    worker = null; counter = 0; setupQueued = false; pending = 0;
    handlers.forEach(h => h({ type: "restart" }));
    handlers.clear();
    cells.filter(c => !c.hidden).forEach(c => { c.n.textContent = "[ ]"; c.running = c.ran = false; c.setStatus(""); });
    setTimeout(warm, 100);                     // get the fresh Python ready again
  }

  // ------------------------------------------------------------------ the cells --
  // Marp's runtime swaps <pre is="marp-pre"> for a <marp-pre> element (it auto-shrinks code)
  const pres = [...document.querySelectorAll("pre[data-run], marp-pre[data-run]")];
  if (!pres.length || !window.CM) return;
  const { EditorView, EditorState, keymap, drawSelection, highlightActiveLine, Prec, history, historyKeymap,
          defaultKeymap, indentWithTab, syntaxHighlighting, defaultHighlightStyle, indentOnInput,
          bracketMatching, closeBrackets, closeBracketsKeymap, python, indentUnit } = window.CM;
  const cells = [];

  // Start Python, run the hidden setup cells, then prefetch every cell's packages in slide order.
  let pending = 0;
  function idleStatus() {
    const text = pending ? "preparing Python…" : "Python ready";
    cells.filter(c => !c.hidden && !c.running && !c.ran).forEach(c => c.setStatus(text, pending > 0));
    if (!pending) setTimeout(() => cells.filter(c => !c.hidden && c.statusText === "Python ready").forEach(c => c.setStatus("")), 4000);
  }
  function warm() {
    if (setupQueued) return;
    setupQueued = true;
    const setup = cells.filter(c => c.hidden);
    setup.length ? setup.forEach(c => submit(c)) : submit({ hidden: true, code: () => "pass" });
    // heavy prefetches (pip installs, pycse) go last: a Run can't interrupt the one in progress
    const heavy = c => /^\s*[%!]pip\s|^\s*(import|from)\s+pycse\b/m.test(c.code());
    const visibleCells = cells.filter(c => !c.hidden);
    for (const c of [...visibleCells.filter(c => !heavy(c)), ...visibleCells.filter(heavy)]) {
      const id = ++nextId;
      pending++;
      handlers.set(id, m => { if (m.type === "done" || m.type === "restart") { handlers.delete(id); pending = Math.max(0, pending - 1); idleStatus(); } });
      getWorker().postMessage({ id, type: "prefetch", code: c.code() });
    }
    idleStatus();
  }
  function execute(cell) {
    warm();                                  // hidden setup cells run first, once per Python
    return submit(cell);
  }
  function submit(cell) {
    const id = ++nextId, name = "<cell " + (cells.indexOf(cell) + 1) + ">";
    if (!cell.hidden) { cell.out.textContent = ""; cell.n.textContent = "[*]"; cell.setStatus("queued", true); cell.running = true; }
    handlers.set(id, m => {
      if (cell.hidden) {                     // setup cells report problems only
        if (m.type === "error") cells.filter(c => !c.hidden)[0]?.show("error", "setup cell failed:\n" + m.text);
        if (m.type === "done" || m.type === "restart") handlers.delete(id);
        return;
      }
      if (m.type === "status") cell.setStatus(m.text, true);
      else if (m.type === "stream") cell.show(m.name, m.text);
      else if (m.type === "result") cell.show("result", m.text);
      else if (m.type === "error") cell.show("error", m.text);
      else if (m.type === "image") {
        const img = document.createElement("img"); img.src = "data:image/png;base64," + m.png;
        img.title = "click for full size";
        img.addEventListener("click", () => { img.classList.toggle("full"); img.style.maxHeight = ""; img.title = img.classList.contains("full") ? "click to fit" : "click for full size"; fit(cell); });
        img.addEventListener("load", () => fit(cell));
        cell.out.appendChild(img); fit(cell);
      } else if (m.type === "done") {
        cell.n.textContent = "[" + (++counter) + "]"; cell.setStatus(m.ok ? "" : "error"); handlers.delete(id);
        cell.running = false; cell.ran = true; fit(cell);
      } else if (m.type === "restart") { cell.setStatus("restarted"); }
    });
    getWorker().postMessage({ id, code: cell.code(), name });
  }

  // Marp slides clip whatever overflows them, so a cell never grows past the space left on its
  // slide: it measures the room below its top (minus anything that follows it on the slide),
  // gives the editor at most 55% of it (40% once there is output), and the output scrolls in the rest. Plots shrink to fit;
  // click one for full size (then it scrolls), click again to fit.
  function fit(cell) {
    const box = cell.box, sec = box && box.closest("section");
    if (!sec || !sec.offsetHeight || !box.offsetParent) return;          // slide not displayed yet
    const sr = sec.getBoundingClientRect(), scale = sr.height / sec.offsetHeight || 1;
    const top = (box.getBoundingClientRect().top - sr.top) / scale;
    let after = 0;                                                        // content below the cell
    for (let el = box; el && el !== sec; el = el.parentElement) {
      for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
        const cs = getComputedStyle(sib);
        if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none" || /^(SCRIPT|STYLE)$/.test(sib.tagName)) continue;
        after += sib.offsetHeight + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
      }
    }
    const pad = parseFloat(getComputedStyle(sec).paddingBottom) || 0;
    const avail = Math.max(140, sec.clientHeight - pad - top - after - 10);
    box.style.maxHeight = avail + "px";
    const bar = box.querySelector(".pyc-bar").offsetHeight, ed = box.querySelector(".cm-editor");
    const share = cell.out.childElementCount ? 0.4 : 0.55;              // output gets more room once there is some
    ed.style.maxHeight = Math.min(330, Math.max(60, share * (avail - bar))) + "px";
    const room = avail - bar - box.querySelector(".pyc-ed").offsetHeight - 14;
    cell.out.querySelectorAll("img:not(.full)").forEach(img => { img.style.maxHeight = Math.max(80, room) + "px"; });
  }
  const fitAll = () => cells.forEach(c => { if (!c.hidden) fit(c); });

  pres.forEach(pre => {
    const flags = (pre.dataset.run || "").split(/\s+/);
    const original = pre.textContent.replace(/\n$/, "");
    const cell = { hidden: flags.includes("hidden"), auto: flags.includes("auto"), original };
    cells.push(cell);
    if (cell.hidden) { cell.code = () => original; return; }

    const cs = getComputedStyle(pre);
    const box = document.createElement("div");
    box.className = "pyc";
    box.innerHTML = '<div class="pyc-bar"><button class="run" title="Run (Shift+Enter)">▶ Run</button>' +
      '<span class="n">[ ]</span><span class="st"></span>' +
      '<button class="reset" title="Put the original code back">↺</button>' +
      '<button class="restart" title="Restart Python (clears all variables)">⟲</button></div>' +
      '<div class="pyc-ed"></div><div class="pyc-out"></div>';
    box.style.fontSize = cs.fontSize;
    if (cs.borderLeftWidth !== "0px") box.style.borderLeft = `${cs.borderLeftWidth} solid ${cs.borderLeftColor}`;
    pre.replaceWith(box);
    cell.box = box;
    cell.out = box.querySelector(".pyc-out");
    cell.n = box.querySelector(".n");
    const st = box.querySelector(".st");
    cell.setStatus = (t, busy) => { cell.statusText = t; st.textContent = t; st.classList.toggle("busy", !!busy); };
    cell.show = (kind, text) => {
      const last = cell.out.lastElementChild;
      if (last && last.tagName === "PRE" && last.className === kind && kind !== "result") { last.textContent += text; return; }
      const p = document.createElement("pre"); p.className = kind; p.textContent = text;
      cell.out.appendChild(p);
    };

    const view = new EditorView({
      parent: box.querySelector(".pyc-ed"),
      state: EditorState.create({
        doc: original,
        extensions: [
          Prec.highest(keymap.of([
            { key: "Shift-Enter", run: () => { execute(cell); return true; } },
            { key: "Escape", run: v => { v.contentDOM.blur(); return true; } },
          ])),
          history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
          indentUnit.of("    "), syntaxHighlighting(defaultHighlightStyle, { fallback: true }), python(),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        ],
      }),
    });
    cell.code = () => view.state.doc.toString();
    box.querySelector(".run").addEventListener("click", () => execute(cell));
    box.querySelector(".reset").addEventListener("click", () =>
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: original } }));
    box.querySelector(".restart").addEventListener("click", restart);
    // keys typed into a cell belong to the cell, not to the slide show or the presenter tools
    for (const t of ["keydown", "keyup", "keypress"]) box.addEventListener(t, e => e.stopPropagation());
  });

  // Python starts downloading in the background as soon as the deck opens (after a moment, so the
  // slides render first), and every cell's packages are fetched while you talk. A slide with
  // cells being shown starts it at once. `auto` cells run the first time their slide is shown.
  const shown = c => { const svg = c.box.closest("svg[data-marpit-svg]"); return !svg || svg.classList.contains("bespoke-marp-active"); };
  const visible = cells.filter(c => !c.hidden);
  const check = () => {
    visible.forEach(c => { if (shown(c)) fit(c); });
    if (!setupQueued && visible.some(shown)) warm();
    visible.forEach(c => { if (c.auto && !c.didAuto && shown(c)) { c.didAuto = true; execute(c); } });
  };
  new MutationObserver(check).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("load", check);
  addEventListener("resize", fitAll);
  setTimeout(check, 0);
  const startSoon = () => setTimeout(() => (window.requestIdleCallback || setTimeout)(warm, { timeout: 2000 }), 800);
  document.readyState === "complete" ? startSoon() : addEventListener("load", startSoon);
})();
