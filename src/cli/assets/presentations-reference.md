# Presentations: Marp and the scimax presenter toolkit

Load this when the user wants to make, convert, build, present or fix a slide deck.

## Which tool

| Need | Use |
|---|---|
| Slides from an org file, LaTeX-heavy, printed handouts | org → Beamer: `scimax export slides.org --format beamer-pdf` |
| A lecture or talk in the browser: animations, live widgets, editable Python, pen/laser/notes while presenting | **Marp** Markdown built with **`marp-present`** (below) |
| An editable PowerPoint for someone else | Marp `--pptx` (slides become images) or python-pptx |

The rest of this file is about Marp.

## Marp basics

A deck is one Markdown file. The front matter switches Marp on, and `---` on its own line separates slides:

```markdown
---
marp: true
theme: default          # default | gaia | uncover | a custom theme (see below)
paginate: true
size: 16:9              # 1280 x 720 slides
math: katex             # $inline$ and $$display$$
transition: fade        # slide transitions in the HTML output
footer: My course · Lecture 3
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Title slide

---

## A content slide

- One idea per slide, at most ~6 bullets of ~10 words
- ![width:500px](figures/plot.png)

<!-- Speaker notes: an HTML comment that is not a directive. -->
```

**Directives:**
- `<!-- class: x -->` applies to this and every later slide, and `<!-- _class: x -->` to this slide only. The same goes for `paginate`, `footer`, `header`, `backgroundColor` and so on.
- Front-matter keys are global.

**Images:**
- `![width:600px](a.png)` sets the size.
- `![bg](a.png)` makes a full background, and `![bg right:40%](a.png)` a split layout with the image on the right.
- `![bg contain](a.png)` fits the image without cropping.

**Fit and layout:**
- `<!-- fit -->` before a heading shrinks it to fit.
- Columns and cards need raw HTML (`<div style="display:flex">…</div>`), which requires `--html`.
- Leave blank lines between the HTML and any Markdown inside it.

**Custom theme:** a CSS file that starts with `/* @theme name */` and usually `@import 'default';`. Use it with `theme: name` in the front matter, and build with `--theme-set path/to/theme.css`. Style `section` (the slide), `h1`/`h2`, and classes you assign with `_class`. Two traps when extending the default theme:
- **Content sits too low.** The default theme sets `align-content: safe center` on `section`, which Chrome applies to block layout, so content ends up vertically centred. Add `align-content: start` to your `section` rule.
- **`section::before` collapses.** It's the default theme's clearfix (`display: table`), so a decorative `::before` band needs `display: block` and an explicit height.

**Marp CLI pitfalls** (only relevant when calling `marp` directly; `marp-present` handles them):
- **Pass `--no-stdin`.** Without it, Marp waits on stdin forever when there is no terminal (under `make`, a background shell, or Claude Code).
- **Put the input file before `--theme-set`.** That option takes several values and swallows a following `slides.md`, and then Marp just prints its help.
- **Raw HTML needs `--html`.** That covers `<div>`, `<iframe>` and `<script>`. A plain Markdown preview, or Marp for VS Code without HTML enabled, shows such HTML as text.
- **`--allow-local-files`** is needed for local images in PDF/PPTX output.
- **PNG previews of every slide:** `marp deck.md --images png -o out/s.png`. These are good for checking layout, but iframes render blank in them.

## The scimax customization: `marp-present`

`marp-present` turns any Marp deck into **one self-contained HTML file with presenter tools**. The slides need no changes and no script tags.

- **Location:** the toolkit is in `~/Dropbox/projects/marp-present`; its README has full details.
- **Command:** `marp-present`, linked into `~/.local/bin`.
- **Fallback:** if `which marp-present` fails, build with plain Marp CLI instead and mention that the presenter tools are missing.

```bash
marp-present talk.md                       # -> talk.html (one file: email it, open it offline)
marp-present talk.md --open                # build and open in the browser
marp-present talk.md --pdf                 # also talk.pdf (plain Marp PDF, not bundled)
marp-present talk.md -- --theme-set theme/custom.css    # args after -- go to Marp
marp-present talk.md --max-width 1190      # shrink large raster images (Pillow)
marp-present talk.md --features ink,laser  # choose tools (default: ink,laser,spotlight,notes)
```

**What the build does:**
- It runs Marp with `--html --allow-local-files --no-stdin`, plus an engine plugin for runnable Python cells. Marp runs from the deck's folder, so relative paths and any `.marprc` apply.
- It inlines everything local into the HTML: images (including `![bg]`), `<iframe src="local.html">` pages (as `srcdoc`, with their own CSS, JS and data), scripts, stylesheets, and KaTeX fonts (downloaded once, cached).
- After the build, it lists any remaining web references.
- It embeds a copy of the Markdown and a pristine base64 copy of the page, which the `s` key uses to save an annotated copy.
- The file is about 2.3× the size of its content, typically 1–4 MB.

**From a Makefile:** `html: ; marp-present slides.md -- --theme-set theme/x.css`. Set `PYTHON=` if the bundler should use a particular Python. Pillow is optional.

### Presenter tools (tell the user these when you hand over a deck)

| Key / action | What it does |
|---|---|
| arrows, `f`, `p`, `o` | Marp: change slides, fullscreen, presenter view, overview |
| `a` | pen on/off · `1`–`5` colours (5 = highlighter) · `z` undo · `c` clear slide · `C` clear all |
| `l` | laser pointer (a red dot, also over widgets) |
| hold mouse button | spotlight: darkens everything except a circle at the cursor until you let go |
| `n` | sticky note at the mouse: Markdown, rendered when you click away · ● colour (yellow, pink, blue, green, orange) · – minimizes to 📝 · × deletes |
| right-click | a menu with every tool, with its key. Right-clicking a note gives its colour, minimize and delete options. Shift+right-click, or right-clicking in text, gives the browser's own menu |
| `s` | save a **standalone annotated copy**, `<deck>-annotated.html`, which opens with ink and notes editable and can be saved again |
| `m` | save the Markdown with the ink as inline SVG and the notes as JSON (rebuild it next to the original .md) |
| `S` / `i` | save / load ink and notes as JSON (or drop the file on the deck) |
| Cmd/Ctrl+P | print → Save as PDF with ink and notes, as vector graphics |

**How annotations behave:**
- Ink and notes belong to their slide and are stored relative to it, so they survive resizing and fullscreen.
- They are kept in localStorage, so they also survive a reload.
- Keys typed in a note or code cell stay there.
- Note Markdown is sanitized: raw HTML shows as text, and unsafe links are dropped.

**Extending it:** the presenter is a small core (`presenter/core.js`) plus one file per tool in
`presenter/features/` (ink, laser, spotlight, notes). A new tool is one file that calls
`MarpPresent.feature({name, keys, menu, init, data, …})`, and the core wires it into keys, the
right-click menu, storage, all save formats and printing. Live Python cells register this way too.
See "Writing a feature" in the toolkit README, which has a worked example: a talk timer.

### Live Python cells

Add `run` to a fenced block. During the talk it becomes an editable CodeMirror cell, with Pyodide (Python 3.14) running in the browser:

````markdown
```python run hidden
import numpy as np, matplotlib.pyplot as plt     # setup: not shown; keep it light
```

```python run
x = np.linspace(0, 10, 101)
plt.plot(x, np.sin(x))
```
````

**Running and output:**
- Shift+Enter or ▶ runs a cell. Esc leaves the editor, ↺ restores the original code, and ⟲ restarts Python.
- Output shows printed text, tracebacks, the last value and matplotlib figures.
- One Python is shared by the whole deck, like a notebook.

**Flags:**
- `run auto` runs when its slide is first shown.
- `run hidden` is setup code that runs before any other cell. Every run waits for it, so keep it light.

**Packages are never embedded:**
- Pyodide packages (numpy, scipy, pandas, sympy, scikit-learn, …) load on `import`.
- `%pip install seaborn` installs from PyPI, and a failed import is tried once from PyPI.
- `import pycse` uses the pycse-book recipe, which mocks jax.
- Running needs internet; editing works offline.

**Warm-up:**
- When the deck opens, Python downloads in the background, the setup cells run, and every cell's imports and installs are prefetched without running your code. Heavy cells (`%pip`, pycse) go last.
- Cell bars show *preparing Python…*, then *Python ready*.
- First runs then take about 0.3 s instead of 15–40 s.
- A Run jumps the queue, but it can't interrupt the prefetch job already in progress.

**Fitting:**
- A cell never grows past the room left on its slide. The editor and output scroll inside it.
- Plots shrink to fit; click a plot for full size, and click again to fit.

**In static output:** the static HTML and the PDF show ordinary highlighted code, and `hidden` cells are left out.

### Interactive widgets (iframes)

For explorables (sliders, animations, step-through demos):
- **The pattern:** write each one as a small standalone HTML page using vanilla JS and SVG, then embed it with `<iframe class="w" src="interactive/x.html">`. `marp-present` inlines it, with its scripts.
- **Data:** put numbers computed in Python into `interactive/data/x.js` as `window.X = {...}` and load it with `<script src>`. Use a script rather than `fetch()`, because `fetch()` fails from `file://`.
- **PDF fallbacks:**
  1. Screenshot each widget with headless Chrome. Add a `?static` URL mode that renders the final state with no animation.
  2. Add `<img class="fallback">` next to each iframe.
  3. Swap them with `@media print { iframe { display: none } img.fallback { display: block } }`.
- **Example:** `discopt-plugins/doe-book/doe-slides` is a full example. It has 12 widgets, a custom theme, verified code snippets in `code/*.py`, and a Makefile.

## Making a deck: workflow

1. **Outline first.** Write about one slide per 1.5–2 minutes, so roughly 30 slides for an hour. Give each section the same structure, for example question → premise → case study → code.
2. **Write the deck** with a custom theme if it has sections (a colour per section, badges, `_class: divider` section openers). Keep text density low, since slides are visual aids.
3. **Make every code snippet real.** Keep runnable copies in `code/*.py`, check them with `make check` or similar, and paste them into slides. Or use `python run` cells.
4. **Build with `marp-present`.**
5. **Verify the layout:**
   - Render PNGs (`marp --images png`) and look at contact sheets.
   - Check overflow in the browser: for each `section`, the bottom of the last child should be ≤ 700 px in slide coordinates. Ignore KaTeX SVG paths.
   - Check that the widgets load (iframe `contentDocument` has SVG nodes) and that clicking every button throws no console errors.
6. **Hand over** with the key table above.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `marp` hangs | Missing `--no-stdin` |
| Marp prints its help and builds nothing | The input file comes after `--theme-set`; put the file first |
| `<script>`/`<div>` shown as text | The output wasn't built with `--html`, or a plain Markdown preview is being used |
| Content vertically centred / colour band missing | The default theme's `align-content` / `::before` clearfix; see Custom theme |
| Python cell: "could not start" | No internet (Pyodide comes from jsdelivr) |
| Text or plot cut off at the slide bottom | Rebuild with the current `marp-present`: cells fit the slide. Plain HTML still overflows, so split the slide |
| Widget blank in PDF | Iframes don't print; use the fallback-image pattern |
| `s` saves Markdown instead of HTML | The deck wasn't built with `marp-present` (no embedded copy) |
