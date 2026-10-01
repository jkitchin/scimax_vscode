/* Scimax: the Python panel for Marp decks. Runs a deck's ```python run cells in VS Code with the
 * same Pyodide worker the slideshow uses (pycells.js, loaded first, leaves its source in
 * window.__PYCELLS_WORKER__), so code that works here works in the talk.
 *
 * Messages from the extension:
 *   { type: "run", code, name, label, line, setup: [code, ...] }  run a cell (setup cells first, once)
 *   { type: "offline", files }   Pyodide files of a presenter: offline deck (used from the next start)
 *   { type: "restart" }          a fresh Python
 *   { type: "clear" }            remove the output
 * Messages to the extension: { type: "ready" }, { type: "reveal", line }
 */
(() => {
  const vscode = acquireVsCodeApi();
  const log = document.getElementById("log");
  const status = document.getElementById("status");
  let worker = null, nextId = 0, counter = 0, setupDone = false, offline = null;
  const handlers = new Map();

  const setStatus = (text, busy) => { status.textContent = text; status.classList.toggle("busy", !!busy); };

  function getWorker() {
    if (worker) return worker;
    // A blob: module worker (the webview is not a file: page, where pycells.js needs data: URLs)
    const url = URL.createObjectURL(new Blob([window.__PYCELLS_WORKER__], { type: "text/javascript" }));
    worker = new Worker(url, { type: "module" });
    if (offline) worker.postMessage({ type: "offline", files: offline });
    worker.onmessage = e => { const h = handlers.get(e.data.id); if (h) h(e.data); };
    worker.onerror = e => {
      e.preventDefault();
      handlers.forEach(h => { h({ type: "error", text: "Python could not start (it is downloaded from cdn.jsdelivr.net: no internet?)\n" + (e.message || "") }); h({ type: "done", ok: false }); });
      handlers.clear();
      worker = null; setupDone = false;
      setStatus("Python could not start");
    };
    return worker;
  }

  function restart(note) {
    if (worker) worker.terminate();
    worker = null; counter = 0; setupDone = false;
    handlers.clear();
    setStatus(note || "Python restarted: variables cleared");
  }

  function show(out, kind, text) {
    const last = out.lastElementChild;
    if (last && last.tagName === "PRE" && last.className === kind && kind !== "result") { last.textContent += text; return; }
    const p = document.createElement("pre");
    p.className = kind; p.textContent = text;
    out.appendChild(p);
  }

  function entry(label, line, code) {
    const box = document.createElement("section");
    box.className = "entry";
    const head = document.createElement("div");
    head.className = "head";
    const n = document.createElement("span");
    n.className = "n"; n.textContent = "[*]";
    const where = document.createElement("a");
    where.href = "#"; where.textContent = label; where.title = "Show this cell in the deck";
    where.addEventListener("click", e => { e.preventDefault(); vscode.postMessage({ type: "reveal", line }); });
    const first = document.createElement("code");
    first.textContent = (code.split("\n").find(l => l.trim() && !l.trim().startsWith("#")) || "").trim();
    head.append(n, where, first);
    const out = document.createElement("div");
    out.className = "pyc-out";
    box.append(head, out);
    log.appendChild(box);
    box.scrollIntoView({ block: "end" });
    return { box, n, out };
  }

  function submit(code, name, onMessage) {
    const id = ++nextId;
    handlers.set(id, m => { onMessage(m); if (m.type === "done") handlers.delete(id); });
    getWorker().postMessage({ id, code, name });
  }

  function run(msg) {
    const e = entry(msg.label, msg.line, msg.code);
    if (!setupDone) {
      setupDone = true;
      (msg.setup || []).forEach((code, i) => submit(code, "<setup cell " + (i + 1) + ">", m => {
        if (m.type === "error") show(e.out, "error", "setup cell " + (i + 1) + " failed:\n" + m.text);
      }));
    }
    submit(msg.code, msg.name, m => {
      if (m.type === "status") setStatus(m.text, true);
      else if (m.type === "stream") show(e.out, m.name, m.text);
      else if (m.type === "result") show(e.out, "result", m.text);
      else if (m.type === "error") show(e.out, "error", m.text);
      else if (m.type === "image") {
        const img = document.createElement("img");
        img.src = "data:image/png;base64," + m.png;
        e.out.appendChild(img);
      } else if (m.type === "done") {
        e.n.textContent = "[" + (++counter) + "]";
        e.box.classList.toggle("failed", !m.ok);
        setStatus(m.ok ? "Python ready" : "error");
        e.box.scrollIntoView({ block: "end" });
      }
    });
  }

  addEventListener("message", ev => {
    const msg = ev.data || {};
    if (msg.type === "run") run(msg);
    else if (msg.type === "offline") { offline = msg.files; if (worker) restart("Python restarted with the deck's offline packages"); }
    else if (msg.type === "restart") restart();
    else if (msg.type === "clear") log.textContent = "";
  });
  document.getElementById("restart").addEventListener("click", () => restart());
  document.getElementById("clear").addEventListener("click", () => { log.textContent = ""; });
  vscode.postMessage({ type: "ready" });
})();
