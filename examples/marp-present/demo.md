---
marp: true
presenter: true
timer: 20
theme: gaia
paginate: true
math: katex
---

<!-- _class: lead -->

# Scimax Marp demo

Every slide shows a feature and how to try it.
**Right-click** anywhere for a menu of the presenter tools.

Press → to begin. The talk timer in the corner starts when you do.

<!-- Speaker notes look like this: any comment that is not a directive. Press P to see them in the presenter view. -->

---

<!-- _class: lead invert -->
<!-- _paginate: false -->

# Part 1: presenting

The pen, pointer, timer, Python and the rest, in the browser

---

## The talk timer

`timer: 20` in the front matter puts a 20 minute countdown in the corner
(`45:00`, `1h30m` and `90s` work too).

- It starts by itself when you leave the first slide
- **t** pauses and restarts it, **T** resets it (do this after a rehearsal)
- Amber in the last 5 minutes, red in the last minute, then it counts overtime
- **P** opens Marp's presenter view, which shows the same time

---

## Draw, point and take notes

![width:300px](img/chart.png)

- **a** pen on/off, **1**–**5** colours, **r** eraser, **z** undo, **c** / **C** clear
- **l** laser pointer, **n** sticky note at the mouse (Markdown works in it)
- Hold the mouse button down for a spotlight

*Try it:* press **a** and circle the peak. Press **n**: drag the note by its bar, **●** recolours it, **–** shrinks it, **×** deletes it.

---

## Zoom in

$$ \bar y \pm t_{0.975,\,n-1}\, \frac{s}{\sqrt n} $$

| n  | ȳ    | s    | 95% interval   |
|----|------|------|----------------|
| 5  | 2.31 | 0.42 | 2.31 ± 0.52    |
| 20 | 2.28 | 0.39 | 2.28 ± 0.18    |

*Try it:* press **x** and drag a box around the formula. **x** or **Esc** zooms out.

---

<!-- _transition: fade -->

## Builds, transitions and notes

* Bullets written with `*` appear one at a time
* This slide fades in: `<!-- _transition: fade -->`
* Press **P**: the presenter view has this slide's notes

<!-- These are the notes for the builds slide. Insert → Speaker Notes in the Marp menu adds a comment like this one. -->

---

![bg right:40%](img/background.png)

## A background image

Marp's `![bg]` images are CSS backgrounds; they get inlined too.

`![bg right:40%](...)` puts it beside the text; `bg left`, `bg contain` and filters such as `sepia` also work.

---

<style scoped>
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1em; }
</style>

## Two columns

<div class="columns">
<div>

![width:420px sepia](img/chart.png)

</div>
<div>

- HTML in slides is on for presenter decks
- A `<style scoped>` block styles just this slide
- Marp menu → New Slide from Layout → Two Columns writes this

</div>
</div>

---

<!-- _class: lead -->

# <!-- fit --> Fitted headings fill the width

`# <!-- fit --> Title` (Marp menu → Insert → Fitted Heading)

---

## A live widget in an iframe

<iframe src="widget/counter.html" style="width:100%;height:380px;border:0"></iframe>

---

## Live Python: edit me, then Shift+Enter

```python run hidden
import numpy as np
import matplotlib.pyplot as plt
```

```python run
x = np.linspace(0, 10, 101)
y = np.sin(x) * np.exp(-x / 5)
print(f"max {y.max():.3f} at x = {x[y.argmax()]:.1f}")
y.mean()
```

The cells share one Python: `x` and `y` are still there on the next slides.
**Esc** leaves the editor, **↺** restores the code, **⟲** restarts Python.

---

## A cell that runs by itself

```python run auto
import sympy as sp
t = sp.symbols("t")
sp.integrate(sp.sin(t) * sp.exp(-t / 5), (t, 0, sp.oo))
```

`python run auto` ran this the first time the slide was shown.
A `python run hidden` cell on the previous slide did the imports.

---

## A plot

```python run
plt.figure(figsize=(6, 2.6))
plt.plot(x, y, lw=2)
plt.xlabel("x"); plt.ylabel("y")
plt.title("sin(x) · exp(−x/5)")
```

---

## pycse: regression with confidence intervals

```python run
from pycse import regress

rng = np.random.default_rng(1)
t = np.linspace(0, 5, 20)
c = 2.0 + 0.7 * t + rng.normal(0, 0.2, t.size)
A = np.column_stack([t**0, t])
p, pint, se = regress(A, c, alpha=0.05)
print("intercept, slope:", p.round(3))
print("95% intervals:\n", pint.round(3))
```

---

## Other packages: installed when needed

```python run
%pip install seaborn
import seaborn as sns
import pandas as pd
df = pd.DataFrame({"x": np.tile(np.arange(10), 3), "g": np.repeat(list("abc"), 10)})
df["y"] = df.x * df.g.map({"a": 1, "b": 2, "c": 3}) + np.random.default_rng(2).normal(0, 1, len(df))
sns.lmplot(data=df, x="x", y="y", hue="g", height=2.6, aspect=2)
```

---

## Exercise: change the plot

Go back to slide 11, make the decay faster, and run it and the plot again.

```countdown 2:00
Press **e** (or click here) to start, **e** to pause, **E** to reset
```

---

## Pause the room, jump around

- **b** black screen, **w** white screen: the room looks at you.
  Press it again, **Esc** or click to come back.
- **g** lists the slides: type a number or words from a title, or use the arrows, then Enter
- Or type a slide number and press Enter: **4** Enter goes back to *Draw*

*Try it:* press **g**, type `plot`, press Enter.

---

## Polish a slide just before the talk

![width:300px](img/chart.png)

Thsi sentence has a typo to fix.

*Try it:* double-click the typo to fix it. Then drag the chart, and use **+** / **-** to resize it. **Delete** hides a selection, **Tab** selects the block around it, **Cmd+Z** undoes. **Esc** twice finishes.

---

## Keep what you did

- **s** saves one HTML file with the ink, notes and edits in it
- **m** saves the Markdown with the ink as SVG (no edits)
- **S** / **i** save and load the ink, notes and edits as JSON (or drag the file onto the deck)
- Right-click → *Save a copy that works offline...* puts Python and the packages in that file
- **Cmd+P** → *Save as PDF* prints every slide with its ink

A reload keeps everything: it lives in the browser until you save it.

<!-- scimax-hidden
## Backup slide

Hidden slides stay in the Markdown and the thumbnails, but not in the show.
scimax-hidden -->

---

## Was there a slide before this one?

Yes: a *hidden* slide. It is in the thumbnails, dimmed and marked *hidden*, but not in the slideshow or any export.

**H** in the Slide Sorter, or Marp menu → Hide or Unhide Slide, wraps a slide in a `<!-- scimax-hidden ... -->` comment.

---

<!-- _class: lead invert -->
<!-- _paginate: false -->

# Part 2: writing the deck in VS Code

Open `demo.md` in VS Code to try these

---

## See the deck

- **Cmd+Shift+V** opens the Slide Sorter: every slide as a thumbnail
- The preview button in the editor title bar shows the slide under the cursor
- **Cmd+K V** gives VS Code's Markdown preview, as slides; double-click to jump to the line
- The *Marp Slides* view in the Explorer is the same thumbnails in the sidebar
- Double-click a thumbnail to go to its Markdown

---

## Rearrange slides

- Drag thumbnails to move slides; **Cmd+click** and **Shift+click** select several
- **Cmd+X** / **C** / **V**, **Cmd+D** duplicate, **Alt+↑/↓** move, **Delete**
- **H** hides a slide, **Enter** goes to its source
- Right-click a thumbnail for the slide menu
- Pasting into a deck in another folder fixes image paths, and can copy the images

Each change is one edit to the Markdown: **Cmd+Z** undoes it.

---

## The Marp menu: right-click in the deck

- **Slides**: new, split at the cursor, duplicate, move, hide, delete
- **New Slide from Layout**: title, section, image left/right, two columns, quote, big number...
- **Insert**: image, speaker notes, maths, build list, Python cell, countdown
- **This Slide** / **Deck**: class, colours, header, footer, theme, size, timer
- **Theme**: start a custom theme from a built-in one

Directives complete as you type in the front matter or `<!-- -->`, and hovering explains them.

---

## Edit slides with Claude Code

Right-click a thumbnail (or select several) → *Edit with Claude Code…*

```text
In the Marp slide deck demo.md, edit slide 9 (lines 112-118).
Change only that slide and keep the rest of the deck as it is. Change:
```

Type the change and send it. With a Claude Code chat already open, the slides go to it as an `@demo.md#L112-118` mention.

---

## Python and live reload

- **C-c C-c** in a `python run` cell runs it in a Python panel, no slideshow needed
- Saving the deck while the slideshow is open reloads it at the slide you are editing
- `presenter: offline` puts Python in the HTML, for a talk without internet
- *Scimax Marp: Check for Offline Use* lists what would still need a connection

---

## Present and export: C-c C-e

| Key | Does                     | Key | Does                          |
|-----|--------------------------|-----|-------------------------------|
| x   | Present from the start   | c   | Present from this slide       |
| p   | PDF                      | n   | PDF with notes                |
| h   | One-file HTML slideshow  | i   | PNG per slide                 |
| s   | PowerPoint (pictures)    | e/d | Editable PowerPoint           |
| g   | For Google Slides        | t   | Notes as text                 |

In an org file, `[[marp:demo.md::5][the demo]]` presents from slide 5.

---

<!-- _class: lead -->

# Thanks

*Scimax: Marp Help* (**C-c C-e ?**) opens the full guide
