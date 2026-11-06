---
marp: true
presenter: true
theme: scimax
paginate: true
---

<!-- _class: lead -->

# Code in Marp slides

Highlighted code, live Python cells, and code that fails on purpose.

Open with **Present** to run the cells.
Click a cell to edit it, **Shift+Enter** or **▶** runs it, **Esc** leaves the editor.

---

## Highlighted code (not run)

A plain fence is ordinary, highlighted code, in any language.
In VS Code, C-c C-c in a Python one shows what it does in the Python panel.

```python
def mean(xs):
    """The average of a list of numbers."""
    return sum(xs) / len(xs)
```

```bash
pip install numpy matplotlib
```

---

## More languages

```javascript
const squares = [1, 2, 3].map(x => x ** 2);
```

```sql
SELECT name, grade FROM students WHERE grade > 90 ORDER BY grade DESC;
```

```text
Plain text: no highlighting at all.
```

---

## Smaller code for a long listing

<style scoped>
pre { font-size: 0.6em; }
</style>

A `<style scoped>` block changes only this slide.

```python
import numpy as np

def newton(f, fprime, x0, tol=1e-10, maxiter=50):
    """Find a root of f with Newton's method."""
    x = x0
    for i in range(maxiter):
        step = f(x) / fprime(x)
        x -= step
        if abs(step) < tol:
            return x, i + 1
    raise RuntimeError("did not converge")

root, n = newton(lambda x: x**2 - 2, lambda x: 2 * x, 1.0)
print(f"sqrt(2) = {root:.12f} after {n} steps")
```

---

## A live cell

The fence is `python run`. Edit the code, then Shift+Enter.

```python run
name = "students"
print(f"Hello, {name}!")
```

Printed text shows under the cell. **↺** puts the original code back.

---

## The value of the last expression

As in Jupyter, the last line's value is shown (in blue) without `print`.

```python run
import math
radius = 2
math.pi * radius**2
```

---

## Cells share one Python

Variables from one cell are there in the next, like a notebook.
**⟲** restarts Python and clears them.

```python run
data = [3, 1, 4, 1, 5, 9, 2, 6]
```

```python run
sorted(data), sum(data) / len(data)
```

---

## Setup code and a cell that runs by itself

A `python run hidden` cell is not shown; it runs before the first cell.
A `python run auto` cell runs when its slide is first shown.

```python run hidden
GREETING = "set up by a hidden cell"
```

```python run auto
print(GREETING)
```

---

## Asking for input

`input()` shows a box under the cell: type, then Enter (Esc cancels).
It always returns a string. Needs Chrome or Edge.

```python run
val: str = input("Enter your value: ")
print(type(val))
print("doubled:", 2 * float(val))
```

---

## A plot

Figures show under the cell. Click one for full size.

```python run
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 2 * np.pi, 200)
plt.plot(x, np.sin(x), label="sin")
plt.plot(x, np.cos(x), label="cos")
plt.legend();
```

---

## Packages

Pyodide's packages load on `import`. `%pip install` gets pure-Python
packages from PyPI.

```python run
%pip install tabulate
from tabulate import tabulate
print(tabulate([["H", 1.008], ["He", 4.003]], headers=["element", "mass"]))
```

---

<!-- _class: lead invert -->

# Code that fails

Errors show the traceback with the failing line, and the message in red in the cell's bar.

---

## A NameError

A typo in a variable name.

```python run
total = 10
print(totl)
```

Fix the name and run it again.

---

## A SyntaxError

A missing colon. The caret points at the problem.

```python run
for i in range(3)
    print(i)
```

---

## An IndentationError

```python run
def greet(name):
print("Hello", name)
```

---

## A TypeError

Adding a number to a string.

```python run
age = 20
print("Next year you will be " + age + 1)
```

---

## An error inside a function

Each call is in the traceback; output from before the error stays.

```python run
def mean(xs):
    return sum(xs) / len(xs)
print(mean([1, 2, 3]))
print(mean([]))
```

---

## An IndexError and a KeyError

```python run
scores = [90, 85, 77]
scores[3]
```

```python run
ages = {"ana": 20, "ben": 22}
ages["cara"]
```

---

## A numpy error

```python run
import numpy as np
np.array([1, 2]) + np.array([1, 2, 3])
```

---

## Raising your own error

```python run
def sqrt(x):
    if x < 0:
        raise ValueError(f"sqrt needs x >= 0, got {x}")
    return x ** 0.5

sqrt(-4)
```

---

## Catching an error

```python run
try:
    int("forty-two")
except ValueError as e:
    print("could not convert:", e)
```

---

## A warning is not an error

Warnings go to stderr (amber) and the cell keeps running.

```python run
import warnings
warnings.warn("this function is deprecated")
print("still ran")
```

---

## A tall cell still shows its error

<style scoped>
.pyc .cm-editor { max-height: 600px !important; }
</style>

This slide makes the editor taller. The output keeps room for the error,
and the editor scrolls.

```python run
a = 1
b = 2
c = 3
d = 4
e = 5
f = 6
g = 7
h = 8
i = 9
j = 10
k = 11
print(a + b + c + l)
```

---

<!-- _class: lead -->

# Exercise

Fix each broken cell in this deck, then run it again.
