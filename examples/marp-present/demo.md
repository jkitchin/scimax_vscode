---
marp: true
presenter: true
theme: gaia
paginate: true
math: katex
---

<!-- _class: lead -->

# Scimax presenter tools demo

Press **a** to draw, **l** for the laser, **s** to save this deck with your ink.

---

## An image and some math

![width:520px](img/chart.png)

$$ \bar y \pm t_{0.975,\,n-1}\, \frac{s}{\sqrt n} $$

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
