// marp-present: Marp CLI engine that marks runnable Python code blocks.
//
//   ```python run            an editable cell with a Run button (pycells.js)
//   ```python run auto       ... that runs by itself the first time its slide is shown
//   ```python run hidden     setup code: not shown; runs before the first cell does
//   ```countdown 3:00        an exercise countdown on the slide (showtools.js makes it run); the
//                            fence's lines are its label (inline Markdown). The time is minutes
//                            (3, 2.5) or 3m, 90s, 1m30s, 3:00.
//
// Marp drops everything after the language name, so this plugin records the flags on the <pre>
// (data-run="auto" etc.) while keeping Marp's normal syntax highlighting; the static HTML and the
// PDF show ordinary highlighted code. scimax passes it to Marp CLI as `--engine` for decks with `presenter: true`.
function runnableFences(md) {
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const words = (tokens[idx].info || "").trim().split(/\s+/);
    const html = fence(tokens, idx, options, env, self);
    if (!/^(python|py|python3)$/i.test(words[0] || "") || !words.includes("run")) return html;
    const flags = words.slice(1).filter(w => w !== "run");
    const attrs = ` data-run="${md.utils.escapeHtml(flags.join(" "))}"` +
      (flags.includes("hidden") ? ' style="display:none"' : "");
    return html.replace(/<pre\b/, "<pre" + attrs);
  };
}

// Seconds in "3", "2.5", "3m", "90s", "1m30s", "1h", "3:00" or "1:05:00"; 0 if it is not a time.
function seconds(text) {
  const t = String(text || "").trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(parseFloat(t) * 60);
  if (/^\d+(:\d{1,2}){1,2}$/.test(t)) return t.split(":").reduce((n, p) => n * 60 + +p, 0);
  const m = t.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+)s(?:ec)?)?$/);
  return m && (m[1] || m[2] || m[3]) ? Math.round((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) : 0;
}

function clock(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

// The box is styled inline so it also looks right in PDF, PowerPoint and image exports. The fence
// becomes open/label/close tokens while the deck is parsed, so the label is parsed with the rest of
// the slide (calling md.renderInline from a render rule re-runs Marp's core rules and loses its math
// CSS for the whole deck).
function countdowns(md) {
  md.core.ruler.after("block", "marp_countdown", (state) => {
    const out = [];
    for (const t of state.tokens) {
      const words = t.type === "fence" ? (t.info || "").trim().split(/\s+/) : [];
      if ((words[0] || "").toLowerCase() !== "countdown") { out.push(t); continue; }
      const total = seconds(words.slice(1).join("")) || 300;
      const lines = t.content.split(/\n/).map(l => l.trim()).filter(Boolean);
      const meta = { total, label: lines.length > 0 };
      const open = new state.Token("marp_countdown_open", "div", 1);
      Object.assign(open, { map: t.map, block: true, level: t.level, meta });
      out.push(open);
      if (meta.label) {
        const label = new state.Token("inline", "", 0);
        Object.assign(label, { content: lines.join("\\\n"), map: t.map, level: t.level + 1, children: [] });
        out.push(label);
      }
      const close = new state.Token("marp_countdown_close", "div", -1);
      Object.assign(close, { block: true, level: t.level, meta });
      out.push(close);
    }
    state.tokens = out;
  });
  md.renderer.rules.marp_countdown_open = (tokens, idx) => {
    const { total, label } = tokens[idx].meta;
    return `<div class="marp-countdown" data-seconds="${total}" title="Click or press e to start" style="` +
      "display:inline-flex;flex-direction:column;align-items:center;gap:.15em;margin:.4em 0;padding:.35em 1em;" +
      "border:3px solid currentColor;border-radius:.6em;line-height:1.1;cursor:pointer;user-select:none\">" +
      `<span class="marp-countdown-time" style="font-size:2.2em;font-weight:700;font-variant-numeric:tabular-nums">⏱ ${clock(total)}</span>` +
      (label ? '<span class="marp-countdown-label" style="font-size:.8em">' : "");
  };
  md.renderer.rules.marp_countdown_close = (tokens, idx) => (tokens[idx].meta.label ? "</span>" : "") + "</div>\n";
}

module.exports = ({ marp }) => marp.use(runnableFences).use(countdowns);
module.exports.seconds = seconds;
