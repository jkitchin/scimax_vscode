---
marp: true
presenter: true
timer: 20
theme: gaia
paginate: true
math: katex
---

<!-- _class: lead -->

# Scimax presenter tools demo

Every slide shows a tool and how to try it.
**Right-click** anywhere for a menu of them all.

Press → to begin. The talk timer in the corner starts when you do.

---

## The talk timer

`timer: 20` in the front matter puts a 20 minute countdown in the corner.

- It starts by itself when you leave the first slide
- **t** pauses and restarts it, **T** resets it (do this after a rehearsal)
- Amber in the last 5 minutes, red in the last minute, then it counts overtime
- **P** opens Marp's presenter view, which shows the same time

---

## Draw, point and take notes

![width:300px](img/chart.png)

- **a** pen on/off, **1**–**5** colours, **z** undo, **c** / **C** clear
- **l** laser pointer, **n** sticky note at the mouse
- Hold the mouse button down for a spotlight

*Try it:* press **a** and circle the peak.

---

## Zoom in

$$ \bar y \pm t_{0.975,\,n-1}\, \frac{s}{\sqrt n} $$

| n  | ȳ    | s    | 95% interval   |
|----|------|------|----------------|
| 5  | 2.31 | 0.42 | 2.31 ± 0.52    |
| 20 | 2.28 | 0.39 | 2.28 ± 0.18    |

*Try it:* press **x** and drag a box around the formula. **x** or **Esc** zooms out.

---

![bg right:40%](img/background.png)

## A background image

Marp's `![bg]` images are CSS backgrounds; they get inlined too.

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

The cells share one Python: `x` and `y` are still there on the next slide.

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

Go back to slide 7, make the decay faster, and run it and the plot again.

```countdown 2:00
Press **e** (or click here) to start, **e** to pause, **E** to reset
```

---

## Pause the room, jump around

- **b** black screen, **w** white screen: the room looks at you.
  Press it again, **Esc** or click to come back.
- **g** lists the slides: type a number or words from a title, then Enter
- Or type a slide number and press Enter: **3** Enter goes back to *Draw*

*Try it:* press **g**, type `plot`, press Enter.

---

## Polish a slide just before the talk

![width:300px](img/chart.png)

Thsi sentence has a typo to fix.

*Try it:* press **d**. Drag the chart, double-click the text to fix it, then **+** / **-** to resize. **Esc** twice finishes.

---

## Keep what you did

- **s** saves one HTML file with the ink, notes and edits in it
- **m** saves the Markdown with the ink as SVG (no edits)
- **S** / **i** save and load the ink, notes and edits as JSON
- **Cmd+P** → *Save as PDF* prints every slide with its ink

A reload keeps everything: it lives in the browser until you save it.

---

## Writing the deck in VS Code

- **C-c C-c** in a `python run` cell runs it in a Python panel, no slideshow needed
- Saving the deck while the slideshow is open reloads it at the slide you are editing
- `presenter: offline` puts Python in the HTML, for a talk without internet
- *Scimax Marp: Check for Offline Use* lists what would still need a connection
