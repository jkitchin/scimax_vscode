/* marp-present: presenter tools for Marp HTML decks (pen, laser pointer, save with ink).
 * Part of scimax-vscode: add `presenter: true` to a Marp deck's front matter, then present or export HTML.
 *
 *   a        toggle the pen (widgets are not clickable while it is on)
 *   1-5      pen colour: red, blue, green, black, yellow highlighter
 *   z        undo the last stroke on this slide
 *   r        toggle the eraser: drag over strokes to remove them (z puts them back)
 *   c        clear this slide        shift+C  clear every slide
 *   l        toggle the laser pointer (a red dot with a fading tail that follows the mouse, also over widgets)
 *   n        new sticky note at the mouse: type Markdown, click away to render it; drag its bar
 *            to move it, ● picks a colour (yellow, pink, blue, green, orange), – shrinks it to a
 *            📝 icon (click to reopen), × deletes it; right-click a note for the same options
 *   right-click  a menu with all of these (Shift+right-click, or right-click in a text field,
 *            gives the browser's own menu)
 *   (hold the mouse button on a slide)  spotlight: the screen darkens except a circle around
 *            the cursor, which follows the mouse until you let go. Not on buttons, links,
 *            sliders, code cells or widgets, and not while the pen is on.
 *   s        save a standalone copy of the whole deck with the ink in it (<deck>-annotated.html):
 *            one file with the theme, images, iframes, fonts and these tools inlined. Open it
 *            anywhere, keep annotating, press s again. (Needs a deck built by scimax with
 *            `presenter: true`; otherwise s falls back to m.)
 *   m        save the Markdown source with the ink baked in as SVG (<deck>-annotated.md), to
 *            edit or rebuild with Marp next to the original
 *   S        save just the annotations as JSON (a backup you can load again)
 *   i        load annotations from such a JSON file (or drag the file onto the deck)
 *   d        edit the slides' text and layout in place (editor.js); s and S save the edits too
 *   Cmd/Ctrl+P  print → "Save as PDF" gives every slide with its ink, as vector graphics
 *
 * The keys also work while a widget has keyboard focus (e.g. after dragging a slider).
 * Ink belongs to the slide it was drawn on and is stored relative to that slide, so it
 * survives slide changes, window resizes and fullscreen. It is kept in localStorage, so a
 * reload does not lose it; shift+C wipes it. Save to a file to keep them for good, move them
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
  if (params.get("view") === "presenter" || params.get("view") === "next") return;  // presenter window
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
    background: "radial-gradient(circle, #fff 0 18%, #ff2030 32%, rgba(255,32,48,.55) 60%, rgba(255,32,48,0) 72%)",
    boxShadow: "0 0 14px 6px rgba(255,32,48,.45)",
  });
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
  const ctx = canvas.getContext("2d");

  let ink = {}, notes = {};           // per slide ("1", "2", ...): strokes, and sticky notes
  try { ink = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { ink = {}; }
  try { notes = JSON.parse(localStorage.getItem(KEY + ":notes")) || {}; } catch (e) { notes = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ink)); } catch (e) { /* private mode */ } };
  const saveNotes = () => { try { localStorage.setItem(KEY + ":notes", JSON.stringify(notes)); } catch (e) { /* private mode */ } };

  let enabled = false, pen = 0, stroke = null, laserOn = false;
  let erasing = false, rubbing = null;                // the eraser, and the strokes one drag of it removed
  const erased = {};                                  // per slide: what each drag removed, for z

  // ---- save / load annotations as a JSON file ----
  const DECK = decodeURIComponent(location.pathname.split("/").pop() || "slides").replace(/\.html?$/, "");
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const count = (ink, nts = {}) => {
    const has = o => Object.keys(o).filter(k => o[k] && o[k].length);
    const ids = new Set([...has(ink), ...has(nts)]);
    return { slides: ids.size, strokes: has(ink).reduce((n, k) => n + ink[k].length, 0),
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
  const validInk = o => o && typeof o === "object" && Object.values(o).every(v => Array.isArray(v) && v.every(s => s && Array.isArray(s.pts) && PENS[s.pen]));
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

  // ---- ink as SVG: one overlay per slide, in the slide's own 1280 x 720 coordinates ----
  const SW = 1280, SH = 720;
  function inkSvg(strokes, extraClass = "") {
    const lines = strokes.map(s => {
      const p = PENS[s.pen], pts = s.pts.length === 1 ? [s.pts[0], [s.pts[0][0] + 1e-4, s.pts[0][1]]] : s.pts;
      const xy = pts.map(([u, v]) => `${(u * SW).toFixed(1)},${(v * SH).toFixed(1)}`).join(" ");
      return `<polyline data-pen="${s.pen}" points="${xy}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join("");
    return `<svg class="marp-ink${extraClass}" viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none" ` +
      `style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:50">${lines}</svg>`;
  }
  const sectionOf = svg => svg.querySelector("foreignObject > section") || svg.querySelector("section");

  // Printing (Cmd/Ctrl+P -> Save as PDF): put the ink on every slide for the printout.
  addEventListener("beforeprint", () => {
    document.querySelectorAll("svg.marp-ink:not(.print-ink)").forEach(el => { el.dataset.hidden = "1"; el.style.display = "none"; });
    slides().forEach((svg, i) => {
      const strokes = ink[String(i + 1)], sec = sectionOf(svg);
      if (strokes && strokes.length && sec) sec.insertAdjacentHTML("beforeend", inkSvg(strokes, " print-ink"));
      if (sec) (notes[String(i + 1)] || []).forEach(n => sec.appendChild(printNote(n)));
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
    const n = slides().length;
    if (n && chunks.length !== n) throw new Error(`the Markdown has ${chunks.length} slides but the deck shows ${n}`);
    chunks.forEach((c, i) => {
      const strokes = ink[String(i + 1)], nts = notes[String(i + 1)], add = [];
      if (strokes && strokes.length) add.push("", inkSvg(strokes));
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
    const lost = editCount() ? " Text and layout edits are not in Markdown: press s to keep them." : "";
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
        const pen = +pl.getAttribute("data-pen"), pts = (pl.getAttribute("points") || "").trim().split(/\s+/)
          .map(p => p.split(",").map(Number)).filter(p => p.length === 2 && p.every(isFinite)).map(([x, y]) => [x / SW, y / SH]);
        if (PENS[pen] && pts.length) (bInk[String(i + 1)] = bInk[String(i + 1)] || []).push({ pen, pts });
      });
      svg.querySelectorAll("script.marp-notes").forEach(sc => {
        try { const v = JSON.parse(sc.textContent); if (validNotes({ x: v })) bNotes[String(i + 1)] = (bNotes[String(i + 1)] || []).concat(v); } catch (e) { /* ignore */ }
      });
    });
    const sig = JSON.stringify({ ink: bInk, notes: bNotes });
    let seen = null; try { seen = localStorage.getItem(KEY + ":baked"); } catch (e) { /* ignore */ }
    if (nothing(count(bInk, bNotes)) || sig === seen) return;
    try { localStorage.setItem(KEY + ":before-load", JSON.stringify({ ink, notes })); localStorage.setItem(KEY + ":baked", sig); } catch (e) { /* ignore */ }
    ink = bInk; notes = bNotes; save(); saveNotes(); redraw(); buildNotes();
  }
  function loadText(text, name) {
    let data;
    try { data = JSON.parse(text); } catch (e) { say(`Could not read ${name}: not a JSON file`); return; }
    const valid = data && data.format === "marp-ink" && validInk(data.ink) && (data.notes === undefined || validNotes(data.notes));
    if (!valid) { say(`${name} is not an annotation file saved from these slides`); return; }
    try { localStorage.setItem(KEY + ":before-load", JSON.stringify({ ink, notes })); } catch (e) { /* ignore */ }
    ink = data.ink; notes = data.notes || {}; stroke = null; save(); saveNotes(); redraw(); buildNotes();
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
  const slideId = () => {
    const i = slides().indexOf(activeSvg());
    return i >= 0 ? String(i + 1) : (location.hash.match(/^#(\d+)/) || [, "1"])[1];
  };
  const slideRect = () => {
    const el = activeSvg();
    const r = el && el.getBoundingClientRect();
    return r && r.width ? r : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  };
  // Points are stored as fractions of the slide, so ink stays put when the slide rescales.
  const toSlide = e => { const r = slideRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };

  function drawStroke(s, r) {
    const p = PENS[s.pen];
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.width * r.width / 1280;             // widths scale with the slide
    ctx.beginPath();
    s.pts.forEach(([u, v], i) => {
      const x = r.left + u * r.width, y = r.top + v * r.height;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    if (s.pts.length === 1) ctx.lineTo(r.left + s.pts[0][0] * r.width + 0.1, r.top + s.pts[0][1] * r.height);
    ctx.stroke();
  }
  function redraw() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const r = slideRect();
    (ink[slideId()] || []).forEach(s => drawStroke(s, r));
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
    badge.style.display = enabled || erasing ? "block" : "none";
    badge.style.background = erasing ? "rgba(75,85,99,.9)" : PENS[pen].color.replace("0.45", "0.9");
    badge.textContent = erasing ? "⌫ eraser  ·  drag over ink to remove it  ·  r: off  z: undo" : "✎ pen " + (pen + 1) + "  ·  a: off  z: undo  c: clear";
  }

  // ---- spotlight: hold the mouse button to darken everything but a circle at the cursor ----
  let spotOn = false;
  const INTERACTIVE = "a, button, input, select, textarea, label, summary, iframe, video, audio, [contenteditable], " +
    ".pyc, .mp-note, .mp-note-icon, .mp-menu, .bespoke-marp-osc, [role=button], [onclick]";
  function placeSpot(x, y) {
    const r = slideRect(), radius = Math.max(40, 0.14 * r.height);     // scales with the slide
    spot.style.background = `radial-gradient(circle ${radius}px at ${x}px ${y}px, ` +
      `rgba(0,0,0,0) ${radius - 1}px, rgba(0,0,0,.72) ${radius + 1}px)`;
  }
  function spotStart(e) {
    if (overview || e.button !== 0 || enabled || erasing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
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
  const noteFont = () => Math.max(11, slideRect().height / 34);

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
  // a note as it appears on paper (Cmd/Ctrl+P), in the slide's own 1280 x 720 coordinates
  function printNote(n) {
    const d = document.createElement("div");
    d.className = "mp-print-note" + (n.min ? " min" : "");
    paint(d, n.color);
    Object.assign(d.style, { left: n.x * SW + "px", top: n.y * SH + "px", width: n.w * SW + "px" });
    if (n.h && !n.min) d.style.height = n.h * SH + "px";
    if (n.min) d.textContent = "📝"; else d.appendChild(Object.assign(document.createElement("div"), { className: "mp-md" })).appendChild(renderMarkdown(n.text));
    return d;
  }

  // ---- laser pointer ----
  const iframes = () => [...document.querySelectorAll("iframe")];
  // The tail is the pointer's recent path, drawn as a stroke that thins and fades with age.
  const TRAIL_MS = 350, tctx = trail.getContext("2d");
  let tail = [], tailFrame = 0;
  function drawTail() {
    tailFrame = 0;
    const now = performance.now(), scale = window.devicePixelRatio || 1;
    tail = tail.filter(p => now - p.t < TRAIL_MS);
    const w = Math.round(innerWidth * scale), h = Math.round(innerHeight * scale);
    if (trail.width !== w || trail.height !== h) { trail.width = w; trail.height = h; }
    tctx.setTransform(scale, 0, 0, scale, 0, 0);
    tctx.clearRect(0, 0, innerWidth, innerHeight);
    tctx.lineCap = "round";
    tctx.shadowColor = "rgba(255,32,48,.6)"; tctx.shadowBlur = 10;
    for (let i = 1; i < tail.length; i++) {
      const life = 1 - (now - tail[i].t) / TRAIL_MS;
      tctx.strokeStyle = `rgba(255,32,48,${(0.85 * life).toFixed(3)})`;
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
    iframes().forEach(f => { try { f.contentDocument.documentElement.classList.toggle("laser-on", on); } catch (e) { /* cross-origin */ } });
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
      const pts = s.pts.map(px), half = PENS[s.pen].width * r.width / 1280 / 2 + reach;
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
      if (near(list[i])) { rubbing.push({ i, s: list[i] }); list.splice(i, 1); gone = true; }
    }
    if (gone) redraw();
  }
  canvas.addEventListener("pointerdown", e => {
    if (!enabled && !erasing) return;
    e.preventDefault(); e.stopPropagation();
    canvas.setPointerCapture(e.pointerId);
    if (erasing) { rubbing = []; rubOut(e); return; }
    stroke = { pen, pts: [toSlide(e)] };
    (ink[slideId()] = ink[slideId()] || []).push(stroke);
    delete erased[slideId()];                           // z now undoes this stroke, not an erase
    redraw();
  });
  canvas.addEventListener("pointermove", e => {
    if (rubbing) { e.preventDefault(); e.stopPropagation(); rubOut(e); return; }
    if (!stroke) return;
    e.preventDefault(); e.stopPropagation();
    stroke.pts.push(toSlide(e));
    redraw();
  });
  const end = () => {
    if (stroke) { stroke = null; save(); }
    if (rubbing) {
      if (rubbing.length) { (erased[slideId()] = erased[slideId()] || []).push(rubbing); save(); }
      rubbing = null;
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  // The canvas takes the mouse while the pen or the eraser is on (other tools check this)
  const ERASER_CURSOR = "url(\"data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="rgba(255,255,255,.5)" stroke="#374151" stroke-width="1.5"/></svg>') + "\") 12 12, cell";
  function setCanvas() {
    canvas.style.pointerEvents = enabled || erasing ? "auto" : "none";
    canvas.style.cursor = erasing ? ERASER_CURSOR : "";
  }
  function onKey(e) {
    if (overview) return;
    if (e.key === "Escape" && menuOpen()) { e.preventDefault(); closeMenu(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    if (e.target && e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.target && (e.target.isContentEditable || (e.target.closest && e.target.closest(".pyc")))) return;  // typing in a code cell
    if (act(e.key)) { if (e.key === "n") e.preventDefault(); closeMenu(); }
  }
  // One action per key; the keyboard and the right-click menu both come here. Returns true if handled.
  function act(k) {
    const id = slideId();
    if (k === "a" || k === "A") {
      enabled = !enabled;
      if (enabled) { erasing = false; if (laserOn) setLaser(false); }
      setCanvas();
    } else if (k === "r" || k === "R") {
      erasing = !erasing;
      if (erasing) { enabled = false; if (laserOn) setLaser(false); }
      setCanvas();
    } else if (k === "l" || k === "L") {
      setLaser(!laserOn);
      if (laserOn) { enabled = erasing = false; setCanvas(); }
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
    } else if (k === "c") {
      delete ink[id]; save(); redraw();
    } else if (k === "C") {
      ink = {}; save(); redraw();
    } else if (k === "z" && erased[id] && erased[id].length) {
      const list = ink[id] = ink[id] || [];             // put back what the last drag of the eraser removed
      erased[id].pop().slice().reverse().forEach(({ i, s }) => list.splice(i, 0, s));
      save(); redraw();
    } else if (k === "z" && ink[id] && ink[id].length) {
      ink[id].pop(); save(); redraw();
    } else if (enabled && k >= "1" && k <= String(PENS.length)) {
      pen = +k - 1;
    } else return false;
    showBadge();
    return true;
  }
  addEventListener("keydown", onKey, true);

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
    const here = ink[slideId()] && ink[slideId()].length, fs = !!document.fullscreenElement;
    const noteItems = menuNote ? [{ header: "Note colour" }, { noteSwatches: menuNote },
      { label: menuNote.min ? "Open note" : "Minimize note", run: () => { menuNote.min = !menuNote.min; saveNotes(); buildNotes(); } },
      { label: "Delete note", run: () => removeNote(menuNote.id) }, "-"] : [];
    return [...noteItems,
      { label: "Pen", key: "a", check: enabled, run: () => act("a") },
      { swatches: true },
      { label: "Eraser", key: "r", check: erasing, off: !total().strokes && !erasing, run: () => act("r") },
      { label: "Laser pointer", key: "l", check: laserOn, run: () => act("l") },
      { label: "Add a note here", key: "n", run: () => { lastX = menuX; lastY = menuY; act("n"); } },
      ...(window.__marpEdits && window.__marpEdits.canEdit ? [{ label: "Edit text and layout", key: "d", check: window.__marpEdits.editing, run: () => window.__marpEdits.toggle() }] : []),
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
      { label: fs ? "Exit fullscreen" : "Fullscreen", key: "f",
        run: () => fs ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}) },
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
          if (enabled && pen === i) b.className = "on";
          b.addEventListener("click", () => { closeMenu(); pen = i; if (!enabled) act("a"); else showBadge(); });
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
  const NATIVE_MENU = "textarea, input, select, [contenteditable], .cm-editor, .mp-menu";
  let menuNote = null;                                   // the note that was right-clicked, if any
  function onContextMenu(e, x, y) {
    if (overview || e.shiftKey || (e.target && e.target.closest && e.target.closest(NATIVE_MENU))) return;
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
    stroke = null;
    closeMenu();
    redraw(); buildNotes();
    setTimeout(() => { redraw(); layoutNotes(); }, 450);       // again once the slide transition has settled
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
  addEventListener("fullscreenchange", () => setTimeout(() => { resize(); layoutNotes(); }, 100));
  resize();
  hookAll();
  addEventListener("load", hookAll);
  loadSource();
  // The script runs from the first slide, before the later slides are parsed.
  const ready = () => { importBaked(); if (overview) showInOverview(); else { redraw(); buildNotes(); } };
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
      const strokes = ink[String(i + 1)], sec = sectionOf(svg);
      if (strokes && strokes.length && sec) sec.insertAdjacentHTML("beforeend", inkSvg(strokes, " thumb-ink"));
      if (sec) (notes[String(i + 1)] || []).forEach(n => sec.appendChild(printNote(n)));
    });
  }
  document.readyState === "loading" ? addEventListener("DOMContentLoaded", ready) : ready();
})();
