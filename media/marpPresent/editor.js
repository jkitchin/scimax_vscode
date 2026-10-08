/* marp-present: slide editing. Last-minute fixes to the text and layout of a Marp HTML deck
 * built by scimax with `presenter: true`, in the slideshow itself. The edits stay in the HTML:
 * they do not change the Markdown.
 *
 *   d          start / stop editing (or right-click → Edit text and layout)
 *   double-click a heading, paragraph, image, ...: start editing it (text to type in, anything else selected)
 *
 * While editing:
 *   click            select a heading, paragraph, list item, image, table, ...
 *   drag             move it (Shift keeps it level or upright)
 *   double-click     edit its text (Enter or a click elsewhere finishes, Shift+Enter breaks the line)
 *   Enter            edit the selected text
 *   arrows           nudge the selection (Shift: 10 px); with nothing selected they change slide
 *   + / -            bigger / smaller (text size, or the width of an image, table or code)
 *   corner handle    drag to resize
 *   Delete           hide it (it shows faintly while editing; Delete again shows it)
 *   Tab / Shift+Tab  select the enclosing block (the list, not the item) / back again
 *   0                undo every edit to the selection
 *   Cmd/Ctrl+Z       undo        Cmd/Ctrl+Shift+Z  redo
 *   Esc              clear the selection, then stop editing
 *   t                a new text box
 *   Cmd/Ctrl+B I U / bold, italic, underline, strikethrough (the words selected while typing, or the selection)
 *   Cmd/Ctrl+C / X   copy / cut the selection (cutting hides a slide's own element, removes an inserted one)
 *   Cmd/Ctrl+V       paste it as a new element, on this slide or another; or paste an image, or text as a new text box
 *
 * The bar at the top inserts text, an image (from a file) or a table, and sets the font, size,
 * bold, italic, underline, strikethrough and colour: of the words selected while typing, or else
 * of the selected heading, paragraph, text box, ... Selecting words while typing also shows those
 * controls in a small bar just above them. In a table you are typing in, Tab and Shift+Tab move
 * between cells, and Tab in the last cell adds a row. Delete removes an inserted element.
 *
 * Edits are kept in localStorage ("marp-edit:<path>"), so a reload keeps them and the presenter
 * view shows them too. s (save the deck with its annotations) puts them in the saved copy with
 * the ink. Each slide's edits belong to that slide's content: if a rebuild (live reload) changes a
 * slide, its edits are set aside rather than put in the wrong place, and slides that only moved
 * keep theirs. presenter.js calls window.__marpEdits to save and load them.
 */
(() => {
  const view = new URLSearchParams(location.search).get("view");
  if (window.__marpEdits) return;
  const canEdit = !view;                                   // not in the presenter view or its preview

  const KEY = "marp-edit:" + location.pathname;
  const slides = () => [...document.querySelectorAll("svg[data-marpit-svg]")];
  const activeSvg = () => document.querySelector("svg[data-marpit-svg].bespoke-marp-active") || (slides().length === 1 ? slides()[0] : null);
  // The section with the slide's content (Marp adds background and pseudo sections for ![bg])
  const contentOf = svg => [...svg.querySelectorAll("foreignObject > section")]
    .find(s => !/^(background|pseudo)$/.test(s.getAttribute("data-marpit-advanced-background") || "")) || null;

  // ---- number every element of every slide, and remember the slide as built ----
  // An element is found again by its data-mpe path, so elements other tools add later (Python
  // output, widgets) do not shift it. A slide is known by a fingerprint of its content.
  const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };
  const deck = [];                                         // per slide: { section, pristine, fp }
  const seen = {};
  slides().forEach(svg => {
    const section = contentOf(svg);
    if (!section) { deck.push(null); return; }
    const number = (el, path) => [...el.children].forEach((c, i) => { const p = path ? path + "." + i : String(i); c.setAttribute("data-mpe", p); number(c, p); });
    number(section, "");
    const sig = [...section.querySelectorAll("*")].map(e => e.tagName).join(",") + "|" + section.textContent;
    const h = hash(sig);
    seen[h] = (seen[h] || 0) + 1;
    deck.push({ section, pristine: section.cloneNode(true), fp: h + (seen[h] > 1 ? "-" + seen[h] : "") });
  });
  const slideOf = svg => deck[slides().indexOf(svg)] || null;
  const find = (slide, path) => slide.section.querySelector(`[data-mpe="${path}"]`);
  const findPristine = (slide, path) => slide.pristine.querySelector(`[data-mpe="${path}"]`);
  const depth = path => path.split(".").length;

  // ---- the edits: { <slide fingerprint>: { <path>: { html, dx, dy, w, fs, px, color, ff, b, i, u, hide } } } ----
  // An inserted element has a path "n<k>" and also { add: <its empty tag>, x, y, img }. Inserted
  // images live once in a pool, "@images": { <id>: <data URL> }, kept out of the undo history.
  const IMAGES = "@images";
  const validOp = o => o && typeof o === "object" && ["dx", "dy", "w", "fs", "px", "x", "y"].every(k => o[k] === undefined || isFinite(o[k])) &&
    ["html", "add", "img", "color", "ff"].every(k => o[k] === undefined || typeof o[k] === "string") &&
    ["b", "i", "u", "s"].every(k => o[k] === undefined || typeof o[k] === "boolean");
  const validImages = im => im === undefined || (im && typeof im === "object" && !Array.isArray(im) &&
    Object.values(im).every(u => typeof u === "string" && /^data:image\/[\w.+-]+[;,]/.test(u)));
  const validEdits = e => e && typeof e === "object" && !Array.isArray(e) && validImages(e[IMAGES]) &&
    Object.keys(e).every(fp => fp === IMAGES || (e[fp] && typeof e[fp] === "object" && Object.values(e[fp]).every(validOp)));
  let edits = {};
  const images = {};
  const take = v => { const e = Object.assign({}, v); Object.assign(images, e[IMAGES] || {}); delete e[IMAGES]; return e; };
  const withImages = e => {
    const used = {};
    Object.values(e).forEach(s => Object.values(s).forEach(o => { if (o.img && images[o.img]) used[o.img] = images[o.img]; }));
    return Object.keys(used).length ? Object.assign({}, e, { [IMAGES]: used }) : e;
  };
  const added = path => path[0] === "n";
  const isAdded = el => !!(el && el.hasAttribute && el.hasAttribute("data-mpe-add"));
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); if (validEdits(v)) edits = take(v); } catch (e) { /* storage blocked */ }

  // Edits saved in a standalone copy (s) come back when it is opened, unless already taken in
  try {
    const el = document.getElementById("marp-ink-data"), data = el ? JSON.parse(el.textContent || "{}") : {};
    if (data && validEdits(data.edits) && Object.keys(data.edits).length) {
      const sig = JSON.stringify(data.edits);
      if (localStorage.getItem(KEY + ":baked") !== sig) {
        edits = take(data.edits);
        localStorage.setItem(KEY, sig); localStorage.setItem(KEY + ":baked", sig);
      }
    }
  } catch (e) { /* no or bad block, or storage blocked */ }

  let full = false;
  const store = () => {
    try { localStorage.setItem(KEY, JSON.stringify(withImages(edits))); full = false; }
    catch (e) {                                             // storage blocked, or full (images)
      if (!full && e && e.name === "QuotaExceededError") say("The browser's storage is full, so a reload would lose the latest edits: press s to save the deck with them");
      full = true;
    }
  };
  const opsFor = slide => edits[slide.fp] || {};

  // Typed text is the user's own, but edits can also come from a loaded file: keep it to markup
  function clean(html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    t.content.querySelectorAll("script, iframe, object, embed, link, meta, base, form, style").forEach(e => e.remove());
    t.content.querySelectorAll("*").forEach(e => [...e.attributes].forEach(a => {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name);
    }));
    return t.innerHTML;
  }

  // ---- put the slides back as built, then apply the edits ----
  let touched = [];                                         // [slide, path, hadHtml]
  const MEDIA = /^(IMG|VIDEO|SVG|IFRAME|CANVAS|TABLE|PRE|FIGURE|svg)$/;
  const isMedia = el => MEDIA.test(el.tagName);             // resized by width; everything else by text size
  function applyAll() {
    const keep = selected && [slideOf(selected.closest("svg[data-marpit-svg]")), selected.getAttribute("data-mpe")];
    // Undo descendants before ancestors: putting back an ancestor's text replaces its children
    touched.sort((a, b) => depth(b[1]) - depth(a[1])).forEach(([slide, path, html]) => {
      const el = find(slide, path), orig = findPristine(slide, path);
      if (added(path)) { if (el) el.remove(); return; }
      if (!el || !orig) return;
      if (html && el.innerHTML !== orig.innerHTML) el.innerHTML = orig.innerHTML;
      const st = orig.getAttribute("style");
      st === null ? el.removeAttribute("style") : el.setAttribute("style", st);
      el.removeAttribute("data-mpe-hidden");
    });
    touched = [];
    deck.forEach(slide => {
      if (!slide) return;
      const ops = opsFor(slide);
      Object.keys(ops).sort((a, b) => depth(a) - depth(b)).forEach(path => {
        const op = ops[path], el = find(slide, path) || (op.add && added(path) ? build(slide, path, op) : null);
        if (!el) return;
        touched.push([slide, path, op.html !== undefined]);
        if (op.html !== undefined && el.innerHTML !== op.html) el.innerHTML = clean(op.html);
        if (op.add) { el.style.left = (op.x || 0) + "px"; el.style.top = (op.y || 0) + "px"; }
        if (op.dx || op.dy) el.style.translate = `${op.dx || 0}px ${op.dy || 0}px`;
        if (op.w) { el.style.width = op.w + "px"; el.style.maxWidth = "none"; if (MEDIA.test(el.tagName) && el.tagName !== "TABLE" && el.tagName !== "PRE") el.style.height = "auto"; }
        if (op.color) el.style.color = op.color;
        if (op.ff) el.style.fontFamily = op.ff;
        if (op.b !== undefined) el.style.fontWeight = op.b ? "bold" : "normal";
        if (op.i !== undefined) el.style.fontStyle = op.i ? "italic" : "normal";
        if (op.u !== undefined || op.s !== undefined) {
          const has = k => (op[k] !== undefined ? op[k] : styled(el, k));
          el.style.textDecorationLine = [has("u") && "underline", has("s") && "line-through"].filter(Boolean).join(" ") || "none";
        }
        if (op.px) el.style.fontSize = op.px + "px";
        else if (op.fs && op.fs !== 1) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * op.fs).toFixed(2) + "px";
        if (op.hide) el.setAttribute("data-mpe-hidden", "");
      });
    });
    // An inserted element is built afresh each time: keep it selected
    if (selected && !selected.isConnected) select((keep && keep[0] && find(keep[0], keep[1])) || null, true);
    placeHandle();
  }
  // An inserted element, placed on the slide at x, y (slide pixels from its top left corner)
  function build(slide, path, op) {
    const t = document.createElement("template");
    t.innerHTML = clean(op.add);
    const el = t.content.firstElementChild;
    if (!el) return null;
    el.querySelectorAll("[data-mpe]").forEach(c => c.removeAttribute("data-mpe"));
    el.setAttribute("data-mpe", path); el.setAttribute("data-mpe-add", "");
    if (op.img) el.src = images[op.img] || "";
    if (getComputedStyle(slide.section).position === "static") slide.section.style.position = "relative";
    slide.section.appendChild(el);
    return el;
  }

  // ---- history ----
  let past = [], future = [];
  function change(fn) {
    past.push(JSON.stringify(edits)); if (past.length > 200) past.shift();
    future = [];
    fn();
    for (const fp of Object.keys(edits)) {                  // drop empty ops and slides
      for (const p of Object.keys(edits[fp])) {
        const o = edits[fp][p];
        for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === 0 && k !== "html" || (k === "fs" && o[k] === 1) || (k === "hide" && !o[k])) delete o[k];
        if (!Object.keys(o).length) delete edits[fp][p];
      }
      if (!Object.keys(edits[fp]).length) delete edits[fp];
    }
    store(); applyAll(); badge();
  }
  function undo(redo) {
    const from = redo ? future : past, to = redo ? past : future;
    if (!from.length) { say(redo ? "Nothing to redo" : "Nothing to undo"); return; }
    to.push(JSON.stringify(edits));
    edits = JSON.parse(from.pop());
    store(); applyAll(); badge();
  }
  const opOf = el => {
    const slide = slideOf(el.closest("svg[data-marpit-svg]")), path = el.getAttribute("data-mpe");
    return { slide, path, get: () => (edits[slide.fp] && edits[slide.fp][path]) || {},
             set: patch => { const s = edits[slide.fp] = edits[slide.fp] || {}; s[path] = Object.assign(s[path] || {}, patch); } };
  };

  // ---- styles and controls ----
  const css = document.createElement("style");
  css.textContent = `
[data-mpe-hidden] { visibility: hidden !important; }
.mp-editing [data-mpe-hidden] { visibility: visible !important; opacity: .25; outline: 2px dashed rgba(220, 38, 38, .7); }
.mp-editing svg[data-marpit-svg] section [data-mpe] { cursor: default; }
.mp-editing svg[data-marpit-svg] section [data-mpe]:hover { outline: 1px dashed rgba(37, 99, 235, .55); outline-offset: 2px; }
.mp-editing [data-mpe].mp-sel { outline: 2px solid #2563eb !important; outline-offset: 2px; cursor: move; }
.mp-editing [data-mpe].mp-typing { outline: 2px solid #059669 !important; cursor: text; caret-color: currentColor; }
[data-mpe-add] { position: absolute; margin: 0; z-index: 5; box-sizing: border-box; }
table[data-mpe-add] :is(td, th) { min-width: 3em; height: 1.4em; }
.mp-edit-ui { position: fixed; z-index: 100004; display: flex; gap: 5px; padding: 6px 8px; border-radius: 10px; background: rgba(17, 24, 39, .88);
  color: #f9fafb; user-select: none; font: 13px/1.3 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.3); }
.mp-edit-bar { top: 10px; left: 50%; transform: translateX(-50%); flex-direction: column; width: max-content; max-width: calc(100vw - 32px); }
.mp-edit-pop { align-items: center; gap: 4px; padding: 5px 6px; }
.mp-edit-pop[hidden] { display: none; }
.mp-edit-ui .row { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px; }
.mp-edit-ui .sep { width: 1px; align-self: stretch; margin: 0 4px; background: rgba(255,255,255,.25); }
.mp-edit-ui .tip { opacity: .85; text-align: center; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-edit-ui button { white-space: nowrap; font: inherit; color: inherit; background: rgba(255,255,255,.12); border: 0; border-radius: 6px; padding: 4px 9px; cursor: pointer; }
.mp-edit-ui button:hover { background: rgba(255,255,255,.25); }
.mp-edit-ui button.done, .mp-edit-ui button.on { background: #2563eb; }
.mp-edit-ui button[data-s] { min-width: 28px; padding: 4px 6px; }
.mp-edit-ui select, .mp-edit-ui input { font: inherit; color: #111827; background: #f9fafb; border: 0; border-radius: 6px; padding: 3px 4px; height: 25px; box-sizing: border-box; }
.mp-edit-ui input[type=number] { width: 4.5em; }
.mp-edit-ui input[type=color] { width: 30px; padding: 1px 2px; cursor: pointer; }
.mp-edit-ui :disabled { opacity: .4; cursor: default; }
.mp-edit-grid { position: absolute; top: calc(100% + 4px); padding: 8px; border-radius: 8px; background: rgba(17, 24, 39, .95);
  display: grid; grid-template-columns: repeat(8, 16px); gap: 3px; box-shadow: 0 6px 24px rgba(0,0,0,.3); }
.mp-edit-grid[hidden] { display: none; }
.mp-edit-grid i { width: 16px; height: 16px; box-sizing: border-box; border: 1px solid rgba(255,255,255,.4); border-radius: 2px; cursor: pointer; }
.mp-edit-grid i.on { background: #2563eb; border-color: #93c5fd; }
.mp-edit-grid span { grid-column: 1 / -1; text-align: center; }
.mp-edit-handle { position: fixed; z-index: 100004; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 3px; background: #2563eb;
  border: 2px solid white; box-shadow: 0 0 0 1px rgba(0,0,0,.3); cursor: nwse-resize; display: none; }
.mp-edit-toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 100004; padding: 7px 14px; border-radius: 8px;
  background: rgba(17, 24, 39, .88); color: white; font: 13px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; pointer-events: none;
  opacity: 0; transition: opacity .2s; }
@media print { .mp-edit-ui, .mp-edit-handle, .mp-edit-toast { display: none !important; }
  .mp-editing [data-mpe-hidden] { visibility: hidden !important; } [data-mpe].mp-sel, [data-mpe].mp-typing { outline: none !important; } }`;
  document.head.appendChild(css);

  const toast = document.createElement("div");
  toast.className = "mp-edit-toast";
  document.body.appendChild(toast);
  let toastTimer = 0;
  function say(text) {
    toast.textContent = text; toast.style.opacity = "1";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.opacity = "0"; }, 2600);
  }

  const bar = document.createElement("div");
  bar.className = "mp-edit-ui mp-edit-bar";
  bar.style.display = "none";
  const FONTS = [["", "Theme font"], ["system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif", "Sans"],
    ["Georgia, 'Times New Roman', serif", "Serif"], ["'SF Mono', Menlo, Consolas, monospace", "Mono"], ["Arial, Helvetica, sans-serif", "Arial"],
    ["Helvetica, Arial, sans-serif", "Helvetica"], ["Georgia, serif", "Georgia"], ["'Times New Roman', Times, serif", "Times"],
    ["'Courier New', Courier, monospace", "Courier"], ["Verdana, sans-serif", "Verdana"], ["'Comic Sans MS', 'Comic Sans', cursive", "Comic Sans"]];
  const ROWS = 6, COLS = 8;
  const STYLE_CONTROLS = `<select data-s="font" title="Font">${FONTS.map(([v, n]) => `<option value="${v.replace(/"/g, "&quot;")}">${n}</option>`).join("")}</select>` +
    `<input data-s="size" type="number" min="4" max="400" title="Text size (slide pixels)">` +
    `<button data-s="b" title="Bold (Cmd/Ctrl+B)"><b>B</b></button><button data-s="i" title="Italic (Cmd/Ctrl+I)"><i>I</i></button>` +
    `<button data-s="u" title="Underline (Cmd/Ctrl+U)"><u>U</u></button><button data-s="s" title="Strikethrough (Cmd/Ctrl+/)"><s>S</s></button>` +
    `<input data-s="color" type="color" title="Text colour">`;
  bar.innerHTML = `<div class="row">` +
    `<button data-a="text" title="New text box (t)">+ Text</button><button data-a="image" title="Insert an image from a file (or paste one with Cmd/Ctrl+V)">+ Image</button>` +
    `<button data-a="table" title="Insert a table">+ Table</button><span class="sep"></span>` +
    STYLE_CONTROLS + `<span class="sep"></span>` +
    `<button data-a="undo" title="Cmd/Ctrl+Z">Undo</button><button data-a="reset" title="Undo every edit on this slide">Reset slide</button>` +
    `<button class="done" data-a="done" title="d or Esc">Done</button></div><div class="tip"></div>` +
    `<div class="mp-edit-grid" hidden>${"<i></i>".repeat(ROWS * COLS)}<span></span></div>`;
  document.body.appendChild(bar);
  // The same controls over the words selected while typing
  const pop = document.createElement("div");
  pop.className = "mp-edit-ui mp-edit-pop";
  pop.hidden = true;
  pop.innerHTML = STYLE_CONTROLS;
  document.body.appendChild(pop);
  const UI = ".mp-edit-bar, .mp-edit-pop";
  const inUi = t => !!(t && t.closest && t.closest(UI));
  const ctls = name => document.querySelectorAll(`.mp-edit-ui [data-s="${name}"]`);
  const grid = bar.querySelector(".mp-edit-grid");
  const imagePicker = document.createElement("input");
  Object.assign(imagePicker, { type: "file", accept: "image/*" });
  imagePicker.style.display = "none";
  imagePicker.addEventListener("change", () => { const f = imagePicker.files[0]; imagePicker.value = ""; if (f) addImage(f); });
  document.body.appendChild(imagePicker);
  // Buttons keep the focus (and the words selected) in the text being typed
  [bar, pop].forEach(c => {
    c.addEventListener("mousedown", e => { if (e.target.closest("button, .mp-edit-grid")) e.preventDefault(); });
    c.addEventListener("change", e => {
      const k = e.target.dataset.s, v = e.target.value;
      if (k === "font") setStyle("ff", v);
      else if (k === "color") setStyle("color", v);
      else if (k === "size") { const n = Math.round(+v); if (n >= 4 && n <= 400) setStyle("px", n); }
    });
  });
  pop.addEventListener("click", e => { const b = e.target.closest("button[data-s]"); if (b) toggleStyle(b.dataset.s); });
  bar.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const a = b.dataset.a;
    if (a !== "table") grid.hidden = true;
    if (a === "undo") undo(false);
    else if (a === "reset") resetSlide();
    else if (a === "done") setEditing(false);
    else if (a === "text") addText();
    else if (a === "image") { endTyping(); imagePicker.click(); }
    else if (a === "table") { grid.hidden = !grid.hidden; grid.style.left = b.offsetLeft + "px"; showGrid(1, 1); }
    else if (b.dataset.s) toggleStyle(b.dataset.s);
  });
  const showGrid = (r, c) => {
    [...grid.querySelectorAll("i")].forEach((cell, k) => cell.classList.toggle("on", Math.floor(k / COLS) < r && k % COLS < c));
    grid.querySelector("span").textContent = `${r} × ${c}`;
  };
  const cellAt = t => { const k = [...grid.querySelectorAll("i")].indexOf(t); return k < 0 ? null : [Math.floor(k / COLS) + 1, k % COLS + 1]; };
  grid.addEventListener("mouseover", e => { const rc = cellAt(e.target); if (rc) showGrid(...rc); });
  grid.addEventListener("click", e => { const rc = cellAt(e.target); if (rc) { grid.hidden = true; addTable(...rc); } });
  const handle = document.createElement("div");
  handle.className = "mp-edit-handle";
  document.body.appendChild(handle);

  const NAMES = { H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading", P: "paragraph",
    LI: "list item", UL: "list", OL: "list", IMG: "image", TABLE: "table", PRE: "code", BLOCKQUOTE: "quote", FIGURE: "figure",
    HEADER: "header", FOOTER: "footer", TD: "table cell", TH: "table cell", IFRAME: "widget", VIDEO: "video", DIV: "block" };
  function badge() {
    if (!editing) return;
    const tip = bar.querySelector(".tip");
    if (typing) tip.textContent = "Typing · Enter or click elsewhere to finish · Shift+Enter new line";
    else if (selected) {
      const name = NAMES[selected.tagName] || selected.tagName.toLowerCase();
      const up = parentOf(selected);
      tip.textContent = `${name[0].toUpperCase() + name.slice(1)} · drag to move · ${isText(selected) ? "double-click or Enter to edit text · " : ""}+/− size · Delete hides` +
        (up ? ` · Tab: the ${NAMES[up.tagName] || up.tagName.toLowerCase()}` : "");
    } else tip.textContent = "Editing slides · click to select, drag to move, double-click to edit text · d or Esc when done";
    const n = Object.keys(opsFor(slideOf(activeSvg()) || { fp: "" })).length;
    bar.querySelector('[data-a="reset"]').disabled = !n;
    controls();
  }
  // The text controls show the font, size, ... of the text being typed in, or of the selection
  function controls() {
    const el = typing || selected, off = !el || isMedia(el);
    document.querySelectorAll(".mp-edit-ui [data-s]").forEach(c => { c.disabled = off; });
    if (off) { document.querySelectorAll(".mp-edit-ui button[data-s]").forEach(c => c.classList.remove("on")); return; }
    // the words selected while typing, else the element
    const r = rangeIn(), n = r && r.startContainer, at = n ? (n.nodeType === 1 ? n.childNodes[r.startOffset] || n : n.parentElement) : el;
    const of = at && at.nodeType === 1 && el.contains(at) ? at : el;
    const cs = getComputedStyle(of), op = opOf(el).get();
    ["b", "i", "u", "s"].forEach(k => ctls(k).forEach(c => c.classList.toggle("on", styled(of, k))));
    ctls("font").forEach(c => { c.value = !r && FONTS.some(f => f[0] === op.ff) ? op.ff : ""; });
    ctls("size").forEach(c => { if (document.activeElement !== c) c.value = Math.round(parseFloat(cs.fontSize)); });
    const m = cs.color.match(/[\d.]+/g);
    if (m) ctls("color").forEach(c => { c.value = "#" + m.slice(0, 3).map(v => (+v).toString(16).padStart(2, "0")).join(""); });
  }
  const styled = (el, k) => {
    const cs = getComputedStyle(el);
    if (k === "b") return parseInt(cs.fontWeight, 10) >= 600;
    if (k === "i") return cs.fontStyle === "italic";
    // a line through or under the text is drawn by the element or one around it
    const line = k === "u" ? "underline" : "line-through";
    for (let x = el; x && x.nodeType === 1 && !/^SECTION$/.test(x.tagName); x = x.parentElement) if (getComputedStyle(x).textDecorationLine.includes(line)) return true;
    return false;
  };

  // ---- what can be selected, and what can be typed in ----
  const NO_TEXT = "pre, code, .pyc, .marp-countdown, iframe, svg:not([data-marpit-svg]), math, .katex, mjx-container, video, img, table";
  const isText = el => (isAdded(el) && el.tagName !== "IMG") || /^(P|H[1-6]|LI|TD|TH|FIGCAPTION|DT|DD|HEADER|FOOTER|BLOCKQUOTE|SPAN|DIV)$/.test(el.tagName) &&
    !el.closest(NO_TEXT) && !el.querySelector("pre, iframe, table, .marp-countdown, .pyc, img, video") && el.textContent.trim() !== "";
  const BLOCK = /^(P|H[1-6]|LI|UL|OL|DL|IMG|VIDEO|IFRAME|TABLE|PRE|BLOCKQUOTE|FIGURE|HEADER|FOOTER|DIV|SECTION|SVG|svg|MJX-CONTAINER|CANVAS)$/;
  function pick(target) {
    const svg = activeSvg(), slide = svg && slideOf(svg);
    if (!slide || !target || !slide.section.contains(target) || target === slide.section) return null;
    let el = target.closest("[data-mpe]");
    // A Python cell, countdown or display maths as a whole; otherwise the nearest block
    const whole = el && el.closest(".pyc, .marp-countdown, .katex-display, mjx-container, iframe");
    if (whole) el = whole.closest("[data-mpe]") || whole;
    while (el && el !== slide.section && !(el.hasAttribute("data-mpe") && BLOCK.test(el.tagName))) el = el.parentElement;
    return el && el !== slide.section && el.hasAttribute("data-mpe") ? el : null;
  }
  const parentOf = el => { const p = el.parentElement && el.parentElement.closest("[data-mpe]"); return p && slideOf(activeSvg()) && slideOf(activeSvg()).section.contains(p) ? p : null; };

  // ---- state ----
  let editing = false, selected = null, typing = null, downStack = [];
  function select(el, keepStack) {
    if (selected) selected.classList.remove("mp-sel");
    selected = el;
    if (!keepStack) downStack = [];
    if (el) el.classList.add("mp-sel");
    placeHandle(); badge();
  }
  function placeHandle() {
    if (!editing || !selected || typing || !selected.isConnected) { handle.style.display = "none"; return; }
    const r = selected.getBoundingClientRect();
    Object.assign(handle.style, { display: "block", left: r.right + 3 + "px", top: r.bottom + 3 + "px" });
  }
  const scale = () => { const svg = activeSvg(); if (!svg) return 1; const vb = svg.viewBox && svg.viewBox.baseVal; return svg.getBoundingClientRect().width / ((vb && vb.width) || 1280) || 1; };

  function setEditing(on) {
    if (!canEdit || on === editing) return;
    if (on) {
      const pen = document.querySelector("canvas.annotate-layer");
      if (pen && pen.style.pointerEvents === "auto") dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));   // the pen off
    }
    editing = on;
    window.__marpEditing = on;
    document.documentElement.classList.toggle("mp-editing", on);
    if (!on) { endTyping(); select(null); }
    bar.style.display = on ? "" : "none";
    grid.hidden = true;
    placeHandle(); badge();
  }

  // ---- typing ----
  let savedRange = null;                                   // the words selected while typing, kept while the bar has the focus
  document.addEventListener("selectionchange", () => {
    const s = getSelection();
    if (typing && s.rangeCount && typing.contains(s.getRangeAt(0).commonAncestorContainer)) { savedRange = s.getRangeAt(0).cloneRange(); placePop(); }
  });
  // The small bar over the words selected while typing
  function placePop() {
    const r = rangeIn();
    if (!r || !editing) { pop.hidden = true; return; }
    const was = pop.hidden;
    pop.hidden = false;
    const box = r.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const top = box.top - h - 10 < 4 ? box.bottom + 10 : box.top - h - 10;
    pop.style.left = Math.max(4, Math.min(innerWidth - w - 4, box.left + box.width / 2 - w / 2)) + "px";
    pop.style.top = Math.max(4, top) + "px";
    if (was || !inUi(document.activeElement)) controls();
  }
  function startTyping(el, selectAll) {
    if (!el || !isText(el)) {
      const inner = el && [...el.querySelectorAll("[data-mpe]")].find(isText);
      if (!inner) { say("This has no text to edit"); return; }
      el = inner;
    }
    select(el);
    typing = el;
    el.querySelectorAll(".katex, mjx-container, img, svg").forEach(m => m.setAttribute("contenteditable", "false"));
    el.dataset.mpeBefore = el.innerHTML;
    el.contentEditable = "true";
    el.classList.add("mp-typing");
    el.focus();
    savedRange = null;
    const cell = el.tagName === "TABLE" && el.querySelector("th, td");
    const range = document.createRange(); range.selectNodeContents(cell || el);
    if (!selectAll) range.collapse(!!cell);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    placeHandle(); badge();
  }
  function endTyping() {
    const el = typing;
    if (!el) return;
    typing = null;
    savedRange = null; pop.hidden = true;
    el.removeAttribute("contenteditable");
    el.classList.remove("mp-typing");
    el.querySelectorAll("[contenteditable]").forEach(m => m.removeAttribute("contenteditable"));
    const before = el.dataset.mpeBefore; delete el.dataset.mpeBefore;
    if (document.activeElement === el) el.blur();
    getSelection().removeAllRanges();
    // Give new elements (a <br> from Shift+Enter, a pasted line) no path; the old ones keep theirs
    const html = el.innerHTML;
    if (isAdded(el) && el.tagName !== "TABLE" && !el.textContent.trim() && !el.querySelector("img, svg")) {
      const op = opOf(el);                                   // an emptied text box goes
      change(() => { delete edits[op.slide.fp][op.path]; });
    } else if (html !== before) {
      const op = opOf(el), orig = findPristine(op.slide, op.path);
      change(() => op.set({ html: orig && orig.innerHTML === html ? undefined : html }));
    }
    placeHandle(); badge();
  }
  // ---- copy, cut and paste whole elements ----
  // The copy is kept here (the system clipboard gets its text): pasting puts in a new element like it
  let clip = null;
  const AS_P = /^(LI|TD|TH|DT|DD)$/;                       // a list item or cell on its own becomes a paragraph
  function copyOf(el) {
    const op = opOf(el).get(), cs = getComputedStyle(el), s = scale();
    const shell = document.createElement(AS_P.test(el.tagName) ? "p" : el.tagName.toLowerCase());
    if (!AS_P.test(el.tagName)) [...el.attributes].forEach(a => { if (!/^(data-mpe|style$|contenteditable$)/.test(a.name)) shell.setAttribute(a.name, a.value); });
    shell.classList.remove("mp-sel", "mp-typing");
    if (!shell.classList.length) shell.removeAttribute("class");
    const sec = el.closest("section").getBoundingClientRect(), r = el.getBoundingClientRect();
    const c = { add: shell.outerHTML, img: op.img, color: op.color, ff: op.ff, b: op.b, i: op.i, u: op.u, s: op.s,
                x: Math.round((r.left - sec.left) / s), y: Math.round((r.top - sec.top) / s) };
    if (el.tagName !== "IMG") c.html = el.innerHTML;
    if (isMedia(el)) c.w = Math.round(el.getBoundingClientRect().width / s);
    else c.px = Math.round(parseFloat(cs.fontSize));
    return { op: c, text: el.innerText || "", from: opOf(el).slide };
  }
  function copyCut(e, cut) {
    if (!editing || typing || !selected || (e.target && e.target.closest && inUi(e.target))) return;
    e.preventDefault();
    clip = copyOf(selected);
    e.clipboardData.setData("text/plain", clip.text || " ");
    if (!cut) { say("Copied: Cmd/Ctrl+V pastes it here or on another slide"); return; }
    const op = opOf(selected);
    if (isAdded(selected)) { select(null); change(() => { delete edits[op.slide.fp][op.path]; }); }
    else change(() => op.set({ hide: true }));
    say("Cut: Cmd/Ctrl+V pastes it here or on another slide");
  }
  document.addEventListener("copy", e => copyCut(e, false), true);
  document.addEventListener("cut", e => copyCut(e, true), true);

  // Paste an element copied here, an image as a new image, text into the text being typed (plain
  // text only) or else as a new text box
  document.addEventListener("paste", e => {
    if (!editing) return;
    const cd = e.clipboardData || window.clipboardData;
    if (clip && !typing && cd.getData("text/plain") === (clip.text || " ") && !inUi(e.target)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const op = Object.assign({}, clip.op);
      if (clip.from === slideOf(activeSvg())) { op.x += 24; op.y += 24; }    // beside the one copied, not on it
      insert(op);
      return;
    }
    const file = [...(cd.items || [])].map(i => (i.kind === "file" && /^image\//.test(i.type) ? i.getAsFile() : null)).find(Boolean);
    if (file) { e.preventDefault(); e.stopImmediatePropagation(); endTyping(); addImage(file); return; }
    if (typing && typing.contains(e.target)) {
      e.preventDefault();
      document.execCommand("insertText", false, cd.getData("text/plain").replace(/\s*\n\s*/g, " "));
    } else if (!typing && !inUi(e.target)) {
      const text = cd.getData("text/plain").trim();
      if (text) { e.preventDefault(); addText(text); }
    }
  }, true);

  // ---- the font, size, ... of the words selected while typing, or else of the whole element ----
  const rangeIn = () => (typing && savedRange && !savedRange.collapsed && typing.contains(savedRange.commonAncestorContainer) ? savedRange : null);
  function styleRange(cmd, value) {
    const r = rangeIn();
    typing.focus();
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    document.execCommand("styleWithCSS", false, true);
    if (cmd !== "px") document.execCommand(cmd, false, value);
    else {                                                  // execCommand knows only sizes 1-7: mark with 7, then set the size
      document.execCommand("fontSize", false, "7");
      typing.querySelectorAll('font[size="7"]').forEach(f => { const sp = document.createElement("span"); sp.append(...f.childNodes); f.replaceWith(sp); sp.style.fontSize = "xxx-large"; });
      typing.querySelectorAll("[style]").forEach(x => { if (x.style.fontSize === "xxx-large") x.style.fontSize = value + "px"; });
    }
    savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : savedRange;
    placeHandle(); badge(); placePop();
  }
  const COMMANDS = { ff: "fontName", color: "foreColor", px: "px", b: "bold", i: "italic", u: "underline", s: "strikeThrough" };
  function setStyle(key, value) {
    if (rangeIn()) { styleRange(COMMANDS[key], key === "ff" && !value ? "inherit" : value); return; }
    const el = typing || selected;
    if (!el) { say("Select some text first"); return; }
    endTyping();
    const op = opOf(el.isConnected ? el : selected);
    change(() => op.set(key === "px" ? { px: value, fs: undefined } : { [key]: value || undefined }));
  }
  const toggleStyle = k => (rangeIn() ? styleRange(COMMANDS[k]) : (typing || selected) && setStyle(k, !styled(typing || selected, k)));

  // ---- inserting text, images and tables ----
  const esc = t => t.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  // Put a new element on the slide (at op.x, op.y, or else centred; below and right of one already
  // there) and return it
  function insert(op, size) {
    const slide = slideOf(activeSvg());
    if (!slide) { say("Go to a slide first"); return null; }
    endTyping();
    const ops = opsFor(slide), path = "n" + (Math.max(0, ...Object.keys(ops).filter(added).map(p => +p.slice(1) || 0)) + 1);
    const W = slide.section.offsetWidth || 1280, H = slide.section.offsetHeight || 720;
    change(() => { (edits[slide.fp] = edits[slide.fp] || {})[path] = Object.assign({ x: Math.round(W / 3), y: Math.round(H / 3) }, op); });
    let el = find(slide, path);
    if (!el) return null;
    const s = scale(), r = el.getBoundingClientRect(), w = size ? size[0] : r.width / s, h = size ? size[1] : r.height / s;
    let x = op.x !== undefined ? op.x : Math.max(0, Math.round((W - w) / 2)), y = op.y !== undefined ? op.y : Math.max(0, Math.round((H - h) / 2));
    while (Object.entries(edits[slide.fp]).some(([p, o]) => p !== path && o.add && o.x === x && o.y === y)) { x += 24; y += 24; }
    Object.assign(edits[slide.fp][path], { x, y });
    store(); applyAll();
    el = find(slide, path);
    select(el);
    return el;
  }
  function addText(text) {
    const el = insert({ add: "<p></p>", html: esc(text || "Text") });
    if (el && !text) startTyping(el, true);
  }
  function addTable(rows, cols) {
    const tr = cell => "<tr>" + cell.repeat(cols) + "</tr>";
    const el = insert({ add: "<table></table>", html: "<thead>" + tr("<th></th>") + "</thead>" + (rows > 1 ? "<tbody>" + tr("<td></td>").repeat(rows - 1) + "</tbody>" : "") });
    if (el) startTyping(el);
  }
  // Big pictures are scaled down to 1920 pixels, so the deck (and the browser's storage) stays small
  const readUrl = blob => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
  const loadImg = url => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
  async function addImage(file) {
    let url, img;
    try { url = await readUrl(file); img = await loadImg(url); } catch (e) { say("Could not read that image"); return; }
    let w = img.naturalWidth || 640, h = img.naturalHeight || 480;
    const MAX = 1920, big = Math.max(w, h);
    if (!/svg|gif/.test(file.type) && (big > MAX || url.length > 700000)) {
      const f = Math.min(1, MAX / big), c = document.createElement("canvas");
      c.width = Math.round(w * f); c.height = Math.round(h * f);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      url = c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
      w = c.width; h = c.height;
    }
    const id = "i" + hash(url);
    images[id] = url;
    const slide = slideOf(activeSvg()), W = (slide && slide.section.offsetWidth) || 1280, H = (slide && slide.section.offsetHeight) || 720;
    const sw = Math.round(Math.min(w, W * 0.6, H * 0.7 * w / h));
    insert({ add: '<img alt="">', img: id, w: sw }, [sw, sw * h / w]);
  }
  // Tab and Shift+Tab move between the cells of a table being typed in; Tab in the last cell adds a row
  function nextCell(back) {
    const s = getSelection(), n = s.anchorNode, at = n && (n.nodeType === 1 ? n : n.parentElement);
    const cells = [...typing.querySelectorAll("th, td")];
    let i = cells.indexOf(at && at.closest("th, td")) + (back ? -1 : 1);
    if (i < 0) return;
    if (i >= cells.length) {
      const body = typing.tBodies[0] || typing.appendChild(document.createElement("tbody")), row = body.insertRow();
      for (let c = 0; c < typing.rows[0].cells.length; c++) row.insertCell();
      cells.push(...row.cells);
    }
    const r = document.createRange(); r.selectNodeContents(cells[i]);
    s.removeAllRanges(); s.addRange(r);
  }

  // ---- mouse ----
  let drag = null, lastDown = { el: null, t: 0 };
  const ours = t => t && t.closest && (t.closest(".mp-edit-bar, .mp-edit-pop, .mp-menu, .mp-goto") || t === handle);
  addEventListener("pointerdown", e => {
    if (!editing) return;
    const t = e.target;
    if (!t.closest(".mp-edit-grid, [data-a=table]")) grid.hidden = true;
    if (ours(t)) { if (t === handle) startResize(e); return; }
    e.stopImmediatePropagation();                            // no spotlight, notes or pen while editing
    if (e.button !== 0) return;
    if (typing && typing.contains(t)) return;                // moving the caret
    endTyping();
    const el = pick(t);
    if (!el) { select(null); return; }
    e.preventDefault();
    const now = Date.now();
    if (lastDown.el === el && now - lastDown.t < 450) { lastDown = { el: null, t: 0 }; startTyping(el); return; }
    lastDown = { el, t: now };
    if (el !== selected) select(el);
    const op = opOf(el).get();
    drag = { el, x: e.clientX, y: e.clientY, dx: op.dx || 0, dy: op.dy || 0, s: scale(), moved: false };
  }, true);
  addEventListener("pointermove", e => {
    if (!drag) return;
    e.stopImmediatePropagation();
    let mx = (e.clientX - drag.x) / drag.s, my = (e.clientY - drag.y) / drag.s;
    if (!drag.moved && Math.hypot(mx, my) * drag.s < 3) return;
    drag.moved = true;
    if (e.shiftKey) Math.abs(mx) > Math.abs(my) ? (my = 0) : (mx = 0);
    drag.nx = Math.round(drag.dx + mx); drag.ny = Math.round(drag.dy + my);
    drag.el.style.translate = `${drag.nx}px ${drag.ny}px`;
    placeHandle();
  }, true);
  addEventListener("pointerup", e => {
    if (!drag) return;
    e.stopImmediatePropagation();
    const d = drag; drag = null;
    if (d.moved) { const op = opOf(d.el); change(() => op.set({ dx: d.nx, dy: d.ny })); }
  }, true);

  // Double-clicking the slide starts editing too: text to type in, anything else selected
  const LIVE = "a, button, input, select, textarea, label, summary, iframe, video, audio, [contenteditable], .pyc, .marp-countdown";
  addEventListener("dblclick", e => {
    if (editing || !canEdit || e.button !== 0) return;
    const t = e.target, svg = activeSvg(), slide = svg && slideOf(svg);
    if (!slide || !t || !t.closest || !slide.section.contains(t) || t.closest(LIVE)) return;
    const el = pick(t);
    if (!el) return;
    e.preventDefault(); e.stopImmediatePropagation();
    getSelection().removeAllRanges();                       // not the word the double-click selected
    setEditing(true);
    if (isText(el) || [...el.querySelectorAll("[data-mpe]")].some(isText)) startTyping(el); else select(el);
  }, true);

  // Resize from the corner handle: width for media, text size for text
  function startResize(e) {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!selected) return;
    const el = selected, op = opOf(el), cur = op.get(), s = scale(), r = el.getBoundingClientRect();
    const media = isMedia(el);
    const w0 = cur.w || r.width / s, fs0 = cur.fs || 1, x0 = e.clientX, width0 = r.width;
    const base = parseFloat(getComputedStyle(el).fontSize) / fs0;   // the text size before any edit
    handle.setPointerCapture(e.pointerId);
    let patch = null;
    const move = ev => {
      const f = Math.max(0.1, (width0 + ev.clientX - x0) / width0);
      patch = media ? { w: Math.round(Math.max(20, w0 * f)) } : cur.px ? { px: Math.max(4, Math.round(cur.px * f)) } : { fs: Math.round(Math.max(0.2, fs0 * f) * 100) / 100 };
      // preview: apply straight to the element, committed on release
      if (media) { el.style.width = patch.w + "px"; el.style.maxWidth = "none"; if (MEDIA.test(el.tagName) && el.tagName !== "TABLE" && el.tagName !== "PRE") el.style.height = "auto"; }
      else el.style.fontSize = patch.px ? patch.px + "px" : (base * patch.fs).toFixed(2) + "px";
      placeHandle();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up);
      if (patch) change(() => op.set(patch));
    };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  }

  function grow(f) {
    if (!selected) return;
    const el = selected, op = opOf(el), cur = op.get();
    if (isMedia(el)) change(() => op.set({ w: Math.round(Math.max(20, (cur.w || el.getBoundingClientRect().width / scale()) * f)) }));
    else if (cur.px) change(() => op.set({ px: Math.max(4, Math.round(cur.px * f)) }));
    else change(() => op.set({ fs: Math.round(Math.max(0.2, (cur.fs || 1) * f) * 100) / 100 }));
  }
  function resetSlide() {
    const slide = slideOf(activeSvg());
    if (!slide || !edits[slide.fp]) { say("No edits on this slide"); return; }
    change(() => { delete edits[slide.fp]; });
    say("Edits on this slide undone (Cmd/Ctrl+Z brings them back)");
  }

  // ---- keys: while editing, every key is ours, so Marp and the other tools do not see it ----
  const NAV = /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|PageUp|PageDown|Home|End| )$/;
  function onKey(e) {
    const k = e.key, mod = e.metaKey || e.ctrlKey;
    if (!editing) {
      if (k === "d" && !mod && !e.altKey && canEdit) {
        const t = e.target;
        if (t && (/^(TEXTAREA|SELECT|INPUT)$/.test(t.tagName || "") || t.isContentEditable || (t.closest && t.closest(".pyc")))) return;
        e.preventDefault(); e.stopImmediatePropagation(); setEditing(true);
      }
      return;
    }
    if (inUi(e.target)) {                                    // the size box, font menu, ...
      if (k === "Escape") { grid.hidden = true; e.target.blur(); }
      e.stopImmediatePropagation(); return;
    }
    if (typing) {
      e.stopImmediatePropagation();                         // let the browser type, but not Marp turn the page
      const style = mod && !e.altKey && !e.shiftKey && { b: "b", i: "i", u: "u", "/": "s" }[k];
      if (style) {                                         // on the words selected, or on what is typed next
        e.preventDefault();
        document.execCommand("styleWithCSS", false, true);
        document.execCommand(COMMANDS[style]);
        badge(); placePop();
      } else if (k === "Tab" && typing.tagName === "TABLE") { e.preventDefault(); nextCell(e.shiftKey); }
      else if (k === "Escape" || (k === "Enter" && !e.shiftKey)) { e.preventDefault(); endTyping(); }
      else if (k === "Enter" && e.shiftKey) { e.preventDefault(); document.execCommand("insertLineBreak"); }
      return;
    }
    if (e.target && e.target.closest && e.target.closest(".mp-menu, .mp-goto")) return;
    if (!selected && NAV.test(k) && !mod) return;           // change slide
    if (mod && (k === "s" || k === "p" || k === "P")) return;   // the browser's save and print
    if (k === "s" || k === "S") return;                     // presenter.js saves the deck
    e.stopImmediatePropagation();
    let used = true;
    if (mod && (k === "z" || k === "Z")) undo(e.shiftKey);
    else if (mod && k === "y") undo(true);
    else if (mod && selected && !e.altKey && !e.shiftKey && { b: 1, i: 1, u: 1, "/": 1 }[k]) toggleStyle(k === "/" ? "s" : k);
    else if (mod) used = false;
    else if (k === "Escape") { if (!grid.hidden) grid.hidden = true; else if (selected) select(null); else setEditing(false); }
    else if (k === "d") setEditing(false);
    else if (k === "t") addText();
    else if (!selected) used = false;
    else if (k === "Enter") startTyping(selected);
    else if (k === "Tab" && !e.shiftKey) { const p = parentOf(selected); if (p) { downStack.push(selected); select(p, true); } }
    else if (k === "Tab") { const c = downStack.pop(); if (c) select(c, true); }
    else if ((k === "Delete" || k === "Backspace") && isAdded(selected)) { const op = opOf(selected); select(null); change(() => { delete edits[op.slide.fp][op.path]; }); }
    else if (k === "Delete" || k === "Backspace") { const op = opOf(selected), h = !op.get().hide; change(() => op.set({ hide: h })); say(h ? "Hidden (Delete again shows it)" : "Shown"); }
    else if (k === "+" || k === "=") grow(1.1);
    else if (k === "-" || k === "_") grow(1 / 1.1);
    else if (k === "0") {                                   // an inserted element keeps what it is and where it was put
      const op = opOf(selected), o = op.get();
      change(() => { if (o.add) edits[op.slide.fp][op.path] = { add: o.add, img: o.img, html: o.html, x: o.x, y: o.y }; else delete (edits[op.slide.fp] || {})[op.path]; });
    }
    else if (/^Arrow/.test(k)) {
      const op = opOf(selected), cur = op.get(), step = e.shiftKey ? 10 : 1;
      const dx = (cur.dx || 0) + (k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0);
      const dy = (cur.dy || 0) + (k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0);
      change(() => op.set({ dx, dy }));
    } else used = false;
    if (used || !mod) e.preventDefault();
  }
  addEventListener("keydown", onKey, true);

  // ---- for presenter.js (save and load) and other windows ----
  const live = () => {                                      // only the edits that apply to this build
    const out = {};
    deck.forEach(s => { if (s && edits[s.fp]) out[s.fp] = edits[s.fp]; });
    return out;
  };
  window.__marpEdits = {
    data: () => withImages(live()),
    count: () => Object.values(live()).reduce((n, s) => n + Object.keys(s).length, 0),
    replace: e => { if (!validEdits(e)) return false; change(() => { edits = take(e); }); return true; },
    toggle: () => setEditing(!editing),
    get editing() { return editing; },
    canEdit,
  };
  addEventListener("storage", e => { if (e.key === KEY) { try { const v = JSON.parse(e.newValue || "{}"); if (validEdits(v)) { edits = take(v); applyAll(); badge(); } } catch (err) { /* ignore */ } } });

  // Slide change: drop the selection; keep the handle on the element as the window resizes
  let lastSlide = activeSvg();
  setInterval(() => {
    const a = activeSvg();
    if (a !== lastSlide) { lastSlide = a; endTyping(); select(null); }
    if (editing) placeHandle();
  }, 250);
  addEventListener("resize", placeHandle);

  // Edits for slides this build no longer has (the slide changed, or was deleted) move to
  // "<key>:set-aside", once, so they are not lost but do not linger
  const gone = Object.keys(edits).filter(fp => !deck.some(s => s && s.fp === fp));
  if (gone.length && canEdit) {
    try {
      const aside = JSON.parse(localStorage.getItem(KEY + ":set-aside") || "{}");
      gone.forEach(fp => { aside[fp] = edits[fp]; delete edits[fp]; });
      localStorage.setItem(KEY + ":set-aside", JSON.stringify(aside));
      store();
    } catch (e) { /* storage blocked */ }
    say(`Edits on ${gone.length} slide${gone.length === 1 ? "" : "s"} were set aside: ${gone.length === 1 ? "that slide has" : "those slides have"} changed since`);
  }
  applyAll();
})();
