# Org-Mode Syntax Reference

Quick reference for org-mode syntax as supported by scimax-vscode. Use this when helping users write, edit, or understand org files.

---

## Document Settings

Keywords at the top of an org file configure document metadata and export behavior.

```org
#+TITLE: My Document
#+AUTHOR: Jane Doe
#+DATE: 2026-03-23
#+OPTIONS: toc:2 num:t author:t email:nil
#+STARTUP: overview
#+FILETAGS: :project:research:
#+LATEX_CLASS: article
#+LATEX_HEADER: \usepackage{amsmath}
#+BIBLIOGRAPHY: references.bib
```

Common `#+OPTIONS`:
| Option | Values | Effect |
|--------|--------|--------|
| `toc:N` | `t`, `nil`, `N` | Table of contents (t=yes, nil=no, N=depth) |
| `num:t` | `t`, `nil` | Section numbering |
| `author:t` | `t`, `nil` | Show author |
| `email:t` | `t`, `nil` | Show email |
| `^:{}` | `t`, `nil`, `{}` | Subscript/superscript ({}=only with braces) |
| `H:N` | integer | Heading export depth |
| `tags:t` | `t`, `nil` | Export tags |

---

## Headings

```org
* Top-level heading
** Second level
*** Third level
**** Fourth level (and deeper)
```

With TODO states, priority, and tags:
```org
* TODO [#A] Write the introduction       :research:writing:
* DONE [#B] Review literature             :reading:
* NEXT Contact collaborators              :email:
```

- TODO states: `TODO`, `DONE`, `NEXT`, `WAITING`, or custom (configured per file/project)
- Priority: `[#A]` (highest) through `[#C]` (lowest)
- Tags: `:tag1:tag2:` at end of heading (colon-delimited)
- Tags are inherited by sub-headings

Custom TODO sequences (in file header):
```org
#+TODO: TODO NEXT WAITING | DONE CANCELLED
#+TODO: PROPOSAL DRAFT REVIEW | PUBLISHED REJECTED
```

---

## Text Markup

```org
*bold*
/italic/
_underline_
+strikethrough+
~code~
=verbatim=
```

Rules: markup markers must be preceded by whitespace or beginning-of-line and followed by whitespace or punctuation. The content cannot start or end with whitespace.

Subscripts and superscripts:
```org
H_2O              (subscript)
E = mc^2          (superscript)
x_{subscript}     (braced subscript — safer, recommended)
x^{superscript}   (braced superscript)
```

---

## Links

```org
[[https://example.com]]                        plain URL
[[https://example.com][Description]]           URL with description
[[file:other-file.org]]                        local file
[[file:other-file.org::*Heading]]              file + heading
[[file:other-file.org::42]]                    file + line number
[[file:image.png]]                             inline image
[[id:550e8400-e29b-41d4-a716]]                 ID link
[[#custom-id]]                                 custom ID in same file
```

Link types supported by scimax:
| Prefix | Example | Target |
|--------|---------|--------|
| `https:` | `[[https://...]]` | Web URL |
| `file:` | `[[file:path]]` | Local file |
| `id:` | `[[id:UUID]]` | Org ID |
| `#` | `[[#my-id]]` | Custom ID (`#+CUSTOM_ID: my-id`) |
| `doi:` | `[[doi:10.1000/xyz]]` | DOI link |
| `cite:` | `cite:key` | Citation (see Citations section) |

---

## Lists

### Unordered
```org
- Item one
- Item two
  - Nested item
  - Another nested
- Item three
```

### Ordered
```org
1. First
2. Second
   1. Sub-item
3. Third
```

### Description
```org
- Term :: Definition text here
- Another term :: Its definition
```

### Checkboxes
```org
- [ ] Not done
- [X] Done
- [-] Partially done (some sub-items checked)
```

---

## Timestamps and Planning

```org
<2026-03-23 Mon>                    active timestamp (shows in agenda)
[2026-03-23 Mon]                    inactive timestamp (does not show)
<2026-03-23 Mon 14:00>              with time
<2026-03-23 Mon 14:00-15:30>        time range
<2026-03-23 Mon>--<2026-03-25 Wed>  date range
<2026-03-23 Mon +1w>                repeating weekly
<2026-03-23 Mon .+1m>               repeating from completion
```

Planning keywords (must follow heading immediately):
```org
* TODO Write report
  SCHEDULED: <2026-03-25 Wed>
  DEADLINE: <2026-03-28 Sat>
  CLOSED: [2026-03-27 Fri 16:30]
```

- `SCHEDULED`: When you plan to start working on it
- `DEADLINE`: When it must be done
- `CLOSED`: Auto-set when marked DONE

---

## Properties and Drawers

```org
* My Heading
  :PROPERTIES:
  :ID:       550e8400-e29b-41d4-a716
  :CUSTOM_ID: my-heading
  :CREATED:  [2026-03-23 Mon]
  :CATEGORY: research
  :END:
```

Arbitrary drawers:
```org
:NOTES:
This is a private note in a drawer.
It won't export by default.
:END:

:LOGBOOK:
CLOCK: [2026-03-23 Mon 09:00]--[2026-03-23 Mon 10:30] =>  1:30
:END:
```

---

## Source Blocks

```org
#+BEGIN_SRC python :results output
print("Hello, world!")
#+END_SRC

#+BEGIN_SRC python :results value
import numpy as np
np.mean([1, 2, 3, 4, 5])
#+END_SRC
```

Common header arguments:
| Header | Values | Effect |
|--------|--------|--------|
| `:results` | `output`, `value`, `silent` | What to capture |
| `:exports` | `code`, `results`, `both`, `none` | What to export |
| `:var` | `x=42` | Pass variables |
| `:session` | `name` or `none` | Persistent session |
| `:dir` | `/path/to/dir` | Working directory |
| `:file` | `output.png` | Save output to file |
| `:eval` | `no`, `never`, `query` | Execution control |
| `:tangle` | `filename` | Extract to file |
| `:noweb` | `yes`, `no` | Noweb reference expansion |
| `:cache` | `yes`, `no` | Cache results |

Inline source: `src_python{2 + 2}` or `src_python[:results value]{2 + 2}`

Supported languages in scimax: `python`, `jupyter-python`, `javascript`, `typescript`, `shell`, `bash`, `sql`, `R`, `julia`, `jupyter-julia`

---

## Blocks

```org
#+BEGIN_QUOTE
A quoted passage.
#+END_QUOTE

#+BEGIN_EXAMPLE
Preformatted example text.
#+END_EXAMPLE

#+BEGIN_CENTER
Centered text.
#+END_CENTER

#+BEGIN_VERSE
Poetry or verse
  with preserved spacing.
#+END_VERSE

#+BEGIN_COMMENT
This won't be exported.
#+END_COMMENT

#+BEGIN_EXPORT html
<div class="custom">Raw HTML</div>
#+END_EXPORT

#+BEGIN_EXPORT latex
\begin{equation}
E = mc^2
\end{equation}
#+END_EXPORT
```

---

## Tables

```org
| Name  | Age | City     |
|-------+-----+----------|
| Alice |  30 | New York |
| Bob   |  25 | London   |
| Carol |  35 | Tokyo    |
```

With formulas:
```org
| Item   | Qty | Price | Total |
|--------+-----+-------+-------|
| Widget |   5 |  2.50 | 12.50 |
| Gadget |   3 |  4.00 | 12.00 |
|--------+-----+-------+-------|
| Total  |     |       | 24.50 |
#+TBLFM: $4=$2*$3::@>$4=vsum(@2..@-1)
```

Table formula syntax:
- `$N` — column N
- `@N` — row N
- `@>` — last row
- `@-1` — row above last
- `vsum(@2..@-1)` — sum rows 2 through second-to-last

---

## LaTeX and Math

Inline math:
```org
The equation $E = mc^2$ is famous.
Also valid: \(E = mc^2\)
```

Display math:
```org
\[
  \int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
\]
```

LaTeX environments:
```org
\begin{equation}
\label{eq:euler}
e^{i\pi} + 1 = 0
\end{equation}

\begin{align}
a &= b + c \\
d &= e + f
\end{align}
```

---

## Special Elements

```org
#+NAME: my-table
#+CAPTION: A descriptive caption
#+ATTR_HTML: :width 600px
#+ATTR_LATEX: :width 0.8\textwidth
[[file:figure.png]]

-----                           horizontal rule (5+ dashes)

#+INCLUDE: "other-file.org"     include another file
#+INCLUDE: "code.py" src python include as source block

# This is a comment line
```

Footnotes:
```org
Some text with a footnote[fn:1].

Another approach[fn:label].

Inline footnote[fn:: This is defined right here].

[fn:1] The footnote definition.
[fn:label] Another footnote definition.
```

---

## Citations (org-ref)

scimax supports three citation syntaxes. **org-ref v3 is the current default.**

### org-ref v3 (recommended)

```org
cite:&key1                          single citation
cite:&key1;&key2                    multiple citations
cite:&key1;&key2;&key3              three or more
citep:&key1                         parenthetical: (Author, Year)
citet:&key1                         textual: Author (Year)
citeauthor:&key1                    author name only
citeyear:&key1                      year only
Citet:&key1                         capitalized (sentence start)
```

With pre/post notes (v3):
```org
cite:see &key1 p. 42               pre="see", post="p. 42"
cite:e.g., &key1 chapter 3;&key2   notes on first key
```

### org-ref v2 (legacy)

```org
cite:key1                           single citation
cite:key1,key2                      multiple (comma-separated)
citep:key1,key2                     parenthetical
citet:key1                          textual
```

No pre/post note support in v2.

### org-cite (org 9.5+ native)

```org
[cite:@key1]                        basic citation
[cite:@key1;@key2]                  multiple
[cite/t:@key1]                      textual style
[cite/p:@key1]                      parenthetical style
[cite/a:@key1]                      author only
[cite/y:@key1]                      year only
[cite:see @key1 p. 42]             with pre/post notes
[cite:see @key1 p. 42;also @key2]  notes + multiple keys
```

### All Citation Commands

| Command | Rendering | Example |
|---------|-----------|---------|
| `cite` | (Author, Year) | cite:&doe-2024 |
| `citep` | (Author, Year) | citep:&doe-2024 |
| `citet` | Author (Year) | citet:&doe-2024 |
| `citeauthor` | Author | citeauthor:&doe-2024 |
| `citeyear` | Year | citeyear:&doe-2024 |
| `citealp` | Author, Year | citealp:&doe-2024 |
| `citealt` | Author Year | citealt:&doe-2024 |
| `citenum` | [N] | citenum:&doe-2024 |
| `Cite` | (Author, Year) cap. | Cite:&doe-2024 |
| `Citet` | Author (Year) cap. | Citet:&doe-2024 |
| `Citep` | (Author, Year) cap. | Citep:&doe-2024 |
| `Citeauthor` | Author cap. | Citeauthor:&doe-2024 |
| `Citeyear` | Year cap. | Citeyear:&doe-2024 |

### Bibliography Setup

```org
#+BIBLIOGRAPHY: references.bib

bibliography:references.bib         (org-ref style, at end of file)
```

Place the bibliography link/keyword where you want the bibliography to appear (typically at the end of the document).

### Converting Between Syntaxes

```bash
scimax cite convert paper.org --from v2 --to v3              # Preview conversion
scimax cite convert paper.org --from v2 --to v3 --inplace    # Apply in place
```

### Checking Citations

```bash
scimax cite check paper.org                  # Check for missing/invalid citations
scimax cite extract paper.org                # List all citation keys used
scimax cite list refs.bib                    # List all entries in bib file
```

---

## Entities (Special Characters)

Org-mode entities render as special characters in export:

```org
\alpha \beta \gamma \delta          Greek: α β γ δ
\Alpha \Beta \Gamma \Delta          Greek uppercase: Α Β Γ Δ
\rarr \larr \uarr \darr             Arrows: → ← ↑ ↓
\Rarr \Larr                         Double arrows: ⇒ ⇐
\infty \pm \times \div              Math: ∞ ± × ÷
\le \ge \ne \approx                 Relations: ≤ ≥ ≠ ≈
\deg \deg{}C                        Degree: °
\copy \reg \trade                   Legal: © ® ™
\nbsp                               Non-breaking space
\mdash \ndash                       Dashes: — –
```

---

## Clocking (Time Tracking)

```org
* TODO Write paper
  :LOGBOOK:
  CLOCK: [2026-03-23 Mon 09:00]--[2026-03-23 Mon 10:30] =>  1:30
  CLOCK: [2026-03-22 Sun 14:00]--[2026-03-22 Sun 16:00] =>  2:00
  :END:
```

In scimax-vscode, use:
- `C-c C-x C-i` — Clock in (start timer on heading)
- `C-c C-x C-o` — Clock out (stop timer)
- `C-c C-x C-d` — Display clock summary

---

## Export-Related Syntax

Per-heading export settings:
```org
* Heading
  :PROPERTIES:
  :EXPORT_TITLE: Custom Export Title
  :EXPORT_FILE_NAME: custom-output
  :EXPORT_OPTIONS: toc:nil
  :END:
```

Conditional export:
```org
#+BEGIN_EXPORT html
<video src="demo.mp4"></video>
#+END_EXPORT

#+BEGIN_EXPORT latex
\clearpage
#+END_EXPORT
```

---

## Scimax-Specific Extensions

### DOI Links
```org
doi:10.1021/acscatal.5b00538
[[doi:10.1021/acscatal.5b00538][Kitchin 2015]]
```

### Label and Ref Links
```org
#+NAME: fig:results
#+CAPTION: Experimental results
[[file:results.png]]

See Figure ref:fig:results for details.
See Table ref:tab:data.
See Equation eqref:eq:euler.
```

### Index Entries
```org
#+INDEX: catalysis
#+INDEX: machine learning!neural networks
```
