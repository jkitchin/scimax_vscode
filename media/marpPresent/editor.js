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

  // ---- the edits: { <slide fingerprint>: { <path>: { html, dx, dy, w, fs, hide } } } ----
  const validOp = o => o && typeof o === "object" && ["dx", "dy", "w", "fs"].every(k => o[k] === undefined || isFinite(o[k])) &&
    (o.html === undefined || typeof o.html === "string");
  const validEdits = e => e && typeof e === "object" && !Array.isArray(e) &&
    Object.values(e).every(s => s && typeof s === "object" && Object.values(s).every(validOp));
  let edits = {};
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); if (validEdits(v)) edits = v; } catch (e) { /* storage blocked */ }

  // Edits saved in a standalone copy (s) come back when it is opened, unless already taken in
  try {
    const el = document.getElementById("marp-ink-data"), data = el ? JSON.parse(el.textContent || "{}") : {};
    if (data && validEdits(data.edits) && Object.keys(data.edits).length) {
      const sig = JSON.stringify(data.edits);
      if (localStorage.getItem(KEY + ":baked") !== sig) {
        edits = data.edits;
        localStorage.setItem(KEY, sig); localStorage.setItem(KEY + ":baked", sig);
      }
    }
  } catch (e) { /* no or bad block, or storage blocked */ }

  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(edits)); } catch (e) { /* storage blocked */ } };
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
    // Undo descendants before ancestors: putting back an ancestor's text replaces its children
    touched.sort((a, b) => depth(b[1]) - depth(a[1])).forEach(([slide, path, html]) => {
      const el = find(slide, path), orig = findPristine(slide, path);
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
        const el = find(slide, path), op = ops[path];
        if (!el) return;
        touched.push([slide, path, op.html !== undefined]);
        if (op.html !== undefined && el.innerHTML !== op.html) el.innerHTML = clean(op.html);
        if (op.dx || op.dy) el.style.translate = `${op.dx || 0}px ${op.dy || 0}px`;
        if (op.w) { el.style.width = op.w + "px"; el.style.maxWidth = "none"; if (MEDIA.test(el.tagName) && el.tagName !== "TABLE" && el.tagName !== "PRE") el.style.height = "auto"; }
        if (op.fs && op.fs !== 1) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * op.fs).toFixed(2) + "px";
        if (op.hide) el.setAttribute("data-mpe-hidden", "");
      });
    });
    if (selected && !selected.isConnected) select(null);
    placeHandle();
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
.mp-edit-bar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 100004; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 14px; border-radius: 10px; background: rgba(17, 24, 39, .88); color: #f9fafb; user-select: none;
  font: 13px/1.3 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.3); max-width: calc(100vw - 32px); }
.mp-edit-bar .tip { opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mp-edit-bar button { white-space: nowrap; font: inherit; color: inherit; background: rgba(255,255,255,.12); border: 0; border-radius: 6px; padding: 4px 9px; cursor: pointer; }
.mp-edit-bar button:hover { background: rgba(255,255,255,.25); }
.mp-edit-bar button.done { background: #2563eb; }
.mp-edit-handle { position: fixed; z-index: 100004; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 3px; background: #2563eb;
  border: 2px solid white; box-shadow: 0 0 0 1px rgba(0,0,0,.3); cursor: nwse-resize; display: none; }
.mp-edit-toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); z-index: 100004; padding: 7px 14px; border-radius: 8px;
  background: rgba(17, 24, 39, .88); color: white; font: 13px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; pointer-events: none;
  opacity: 0; transition: opacity .2s; }
@media print { .mp-edit-bar, .mp-edit-handle, .mp-edit-toast { display: none !important; }
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
  bar.className = "mp-edit-bar";
  bar.style.display = "none";
  bar.innerHTML = `<span class="tip"></span><button data-a="undo" title="Cmd/Ctrl+Z">Undo</button>` +
    `<button data-a="reset" title="Undo every edit on this slide">Reset slide</button><button class="done" data-a="done" title="d or Esc">Done</button>`;
  document.body.appendChild(bar);
  bar.addEventListener("click", e => {
    const a = e.target.closest("button") && e.target.closest("button").dataset.a;
    if (a === "undo") undo(false);
    else if (a === "reset") resetSlide();
    else if (a === "done") setEditing(false);
  });
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
    bar.querySelector('[data-a="reset"]').style.opacity = n ? "" : ".45";
  }

  // ---- what can be selected, and what can be typed in ----
  const NO_TEXT = "pre, code, .pyc, .marp-countdown, iframe, svg:not([data-marpit-svg]), math, .katex, mjx-container, video, img, table";
  const isText = el => /^(P|H[1-6]|LI|TD|TH|FIGCAPTION|DT|DD|HEADER|FOOTER|BLOCKQUOTE|SPAN|DIV)$/.test(el.tagName) &&
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
    placeHandle(); badge();
  }

  // ---- typing ----
  function startTyping(el) {
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
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    placeHandle(); badge();
  }
  function endTyping() {
    const el = typing;
    if (!el) return;
    typing = null;
    el.removeAttribute("contenteditable");
    el.classList.remove("mp-typing");
    el.querySelectorAll("[contenteditable]").forEach(m => m.removeAttribute("contenteditable"));
    const before = el.dataset.mpeBefore; delete el.dataset.mpeBefore;
    if (document.activeElement === el) el.blur();
    getSelection().removeAllRanges();
    // Give new elements (a <br> from Shift+Enter, a pasted line) no path; the old ones keep theirs
    const html = el.innerHTML;
    if (html !== before) {
      const op = opOf(el), orig = findPristine(op.slide, op.path);
      change(() => op.set({ html: orig && orig.innerHTML === html ? undefined : html }));
    }
    placeHandle(); badge();
  }
  // Paste plain text only
  document.addEventListener("paste", e => {
    if (!typing || !typing.contains(e.target)) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain").replace(/\s*\n\s*/g, " ");
    document.execCommand("insertText", false, text);
  }, true);

  // ---- mouse ----
  let drag = null, lastDown = { el: null, t: 0 };
  const ours = t => t && t.closest && (t.closest(".mp-edit-bar, .mp-menu, .mp-goto") || t === handle);
  addEventListener("pointerdown", e => {
    if (!editing) return;
    const t = e.target;
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
      patch = media ? { w: Math.round(Math.max(20, w0 * f)) } : { fs: Math.round(Math.max(0.2, fs0 * f) * 100) / 100 };
      // preview: apply straight to the element, committed on release
      if (media) { el.style.width = patch.w + "px"; el.style.maxWidth = "none"; if (MEDIA.test(el.tagName) && el.tagName !== "TABLE" && el.tagName !== "PRE") el.style.height = "auto"; }
      else el.style.fontSize = (base * patch.fs).toFixed(2) + "px";
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
    if (typing) {
      e.stopImmediatePropagation();                         // let the browser type, but not Marp turn the page
      if (k === "Escape" || (k === "Enter" && !e.shiftKey)) { e.preventDefault(); endTyping(); }
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
    else if (mod) used = false;
    else if (k === "Escape") { if (selected) select(null); else setEditing(false); }
    else if (k === "d") setEditing(false);
    else if (!selected) used = false;
    else if (k === "Enter") startTyping(selected);
    else if (k === "Tab" && !e.shiftKey) { const p = parentOf(selected); if (p) { downStack.push(selected); select(p, true); } }
    else if (k === "Tab") { const c = downStack.pop(); if (c) select(c, true); }
    else if (k === "Delete" || k === "Backspace") { const op = opOf(selected), h = !op.get().hide; change(() => op.set({ hide: h })); say(h ? "Hidden (Delete again shows it)" : "Shown"); }
    else if (k === "+" || k === "=") grow(1.1);
    else if (k === "-" || k === "_") grow(1 / 1.1);
    else if (k === "0") { const op = opOf(selected); change(() => { delete (edits[op.slide.fp] || {})[op.path]; }); }
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
    data: live,
    count: () => Object.values(live()).reduce((n, s) => n + Object.keys(s).length, 0),
    replace: e => { if (!validEdits(e)) return false; change(() => { edits = e; }); return true; },
    toggle: () => setEditing(!editing),
    get editing() { return editing; },
    canEdit,
  };
  addEventListener("storage", e => { if (e.key === KEY) { try { const v = JSON.parse(e.newValue || "{}"); if (validEdits(v)) { edits = v; applyAll(); badge(); } } catch (err) { /* ignore */ } } });

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
