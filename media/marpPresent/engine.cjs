// marp-present: Marp CLI engine that marks runnable Python code blocks.
//
//   ```python run            an editable cell with a Run button (pycells.js)
//   ```python run auto       ... that runs by itself the first time its slide is shown
//   ```python run hidden     setup code: not shown; runs before the first cell does
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

module.exports = ({ marp }) => marp.use(runnableFences);
