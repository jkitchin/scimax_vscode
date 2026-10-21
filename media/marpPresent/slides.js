/* marp-present: slide structure. Slides added, hidden and moved in the slideshow (editor.js: + Slide,
 * Hide slide, and dragging in Marp's overview), put in place before Marp's slideshow script starts, so Marp sees them as the deck.
 * scimax puts this script just before Marp's own; editor.js reloads the page after a change.
 *
 * The plan is kept with the editor's text and layout edits, under "@slides":
 *   { hide: [<slide fingerprint>], add: [{ id: "new-<k>", after: <fingerprint or id, "" = first>,
 *     from: <fingerprint or id of the slide whose look it takes>, html }],
 *     move: [{ id: <fingerprint or id>, after: <fingerprint or id, "" = first> }], next: <k> }
 * The moves are made in turn, after the slides are added and before any are hidden.
 * Each slide is stamped with data-mp-fp (its fingerprint, as editor.js knows it) and data-mp-slide
 * (what ink and notes are kept under: its number as built, or its id if added), so neither moves
 * when slides are added or hidden. Marp's speaker notes and page numbers follow the new order.
 * window.__marpSlides tells the other tools what was done; Marp's overview shows the hidden slides greyed out.
 */
(() => {
  const parent = document.getElementById(":$p");
  if (!parent || window.__marpSlides) return;
  const KEY = "marp-edit:" + location.pathname;

  // The fingerprint of a slide's content, exactly as editor.js computes it
  const hash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };
  const contentOf = svg => [...svg.querySelectorAll("foreignObject > section")]
    .find(s => !/^(background|pseudo)$/.test(s.getAttribute("data-marpit-advanced-background") || "")) || null;
  const built = [...parent.querySelectorAll(":scope > svg[data-marpit-svg]")];
  const seen = {};
  built.forEach((svg, i) => {
    svg.dataset.mpSlide = String(i + 1);
    const section = contentOf(svg);
    if (!section) return;
    const h = hash([...section.querySelectorAll("*")].map(e => e.tagName).join(",") + "|" + section.textContent);
    seen[h] = (seen[h] || 0) + 1;
    svg.dataset.mpFp = h + (seen[h] > 1 ? "-" + seen[h] : "");
  });

  // The plan: from this browser, or from a saved copy's data (as editor.js chooses)
  let edits = {};
  try { edits = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { /* storage blocked */ }
  try {
    const el = document.getElementById("marp-ink-data"), data = el ? JSON.parse(el.textContent || "{}") : {};
    if (data && data.edits && typeof data.edits === "object" && Object.keys(data.edits).length &&
        localStorage.getItem(KEY + ":baked") !== JSON.stringify(data.edits)) edits = data.edits;
  } catch (e) { /* no or bad block, or storage blocked */ }
  const plan = edits && edits["@slides"];
  const info = { original: built.length, hidden: [], added: [] };
  window.__marpSlides = info;
  const titleOf = svg => {
    const s = contentOf(svg), h = s && s.querySelector("h1, h2, h3, h4, h5, h6");
    return ((h || s || svg).textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  };
  if (!plan || typeof plan !== "object") return;
  const hide = new Set(Array.isArray(plan.hide) ? plan.hide.filter(f => typeof f === "string") : []);
  const adds = (Array.isArray(plan.add) ? plan.add : [])
    .filter(a => a && /^new-\d+$/.test(a.id) && typeof a.html === "string" && typeof a.after === "string");
  const moves = (Array.isArray(plan.move) ? plan.move : []).filter(m => m && typeof m.id === "string" && typeof m.after === "string");
  if (!hide.size && !adds.length && !moves.length) return;

  // Typed text is the user's own, but the plan can also come from a loaded file: keep it to markup
  function clean(html) {
    const t = document.createElement("template");
    t.innerHTML = html;
    t.content.querySelectorAll("script, iframe, object, embed, link, meta, base, form, style").forEach(e => e.remove());
    t.content.querySelectorAll("*").forEach(e => [...e.attributes].forEach(a => {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) e.removeAttribute(a.name);
    }));
    return t.innerHTML;
  }
  // A new slide with the look (theme, class, colours) of another, but none of its content or background images
  function newSlide(tpl, add) {
    const svg = tpl.cloneNode(true);
    const keep = contentOf(svg);
    [...svg.children].forEach(fo => { if (!fo.contains(keep)) fo.remove(); });
    const fo = keep.parentElement, vb = svg.viewBox.baseVal;
    fo.removeAttribute("x"); fo.removeAttribute("y");
    fo.setAttribute("width", vb.width); fo.setAttribute("height", vb.height);
    [...keep.attributes].forEach(a => { if (a.name === "id" || /^data-marpit-(advanced-background|fragments)/.test(a.name)) keep.removeAttribute(a.name); });
    keep.style.removeProperty("--marpit-advanced-background-split");
    keep.innerHTML = clean(add.html);
    svg.dataset.mpSlide = svg.dataset.mpFp = add.id;
    return svg;
  }

  // The new order: the slides as built, each added slide just after the one it follows
  const order = built.slice();
  const byKey = key => order.find(s => s.dataset.mpFp === key || s.dataset.mpSlide === key);
  for (const add of adds) {
    const tpl = byKey(add.from) || byKey(add.after) || built[0];
    if (!tpl || !contentOf(tpl)) continue;
    const svg = newSlide(tpl, add), at = add.after ? byKey(add.after) : null;
    order.splice(add.after ? (at ? order.indexOf(at) + 1 : order.length) : 0, 0, svg);
    info.added.push(add.id);
  }
  for (const move of moves) {
    const svg = byKey(move.id), at = move.after ? byKey(move.after) : null;
    if (!svg || (move.after && !at) || at === svg) continue;
    order.splice(order.indexOf(svg), 1);
    order.splice(at ? order.indexOf(at) + 1 : 0, 0, svg);
  }
  // Marp's speaker notes are numbered by slide
  const notes = {};
  document.querySelectorAll(".bespoke-marp-note[data-index]").forEach(n => { notes[+n.dataset.index] = n; });
  if (order.every(svg => hide.has(svg.dataset.mpFp))) hide.clear();   // never hide every slide
  const shown = order.filter((svg, i) => {
    if (!hide.has(svg.dataset.mpFp)) return true;
    // el and after (the slide it follows, "" = first) let the overview show it greyed out (editor.js)
    info.hidden.push({ fp: svg.dataset.mpFp, n: +svg.dataset.mpSlide, title: titleOf(svg), el: svg, after: i ? order[i - 1].dataset.mpFp : "" });
    const note = notes[+svg.dataset.mpSlide - 1];
    if (note) note.remove();
    svg.remove();
    return false;
  });
  shown.forEach((svg, i) => {
    parent.appendChild(svg);
    const n = /^\d+$/.test(svg.dataset.mpSlide) && notes[+svg.dataset.mpSlide - 1];
    if (n) n.dataset.index = String(i);
    svg.querySelectorAll("section[data-marpit-pagination]").forEach(s => {
      s.setAttribute("data-marpit-pagination", String(i + 1));
      s.setAttribute("data-marpit-pagination-total", String(shown.length));
    });
  });
})();
