---
marp: true
theme: scimax-poster
size: poster
paginate: false
presenter: true
math: katex
---

<div class="banner">
<img class="logo" src="img/scimax-logo.png">
<div class="titles">

# scimax for VS Code

<p class="tagline">Structured plain text for scientists and engineers</p>
<p class="authors">John R. Kitchin <span>·</span> Department of Chemical Engineering <span>·</span> Carnegie Mellon University</p>

</div>
<div>
<img class="qr" src="img/qr-repo.svg">
<div class="qrcap">github.com/jkitchin/scimax_vscode</div>
</div>
</div>

<div class="lede">

Your notes, papers, code, data and plans live in **plain text you own**: diffable, greppable, durable and free of lock-in, in org-mode, Markdown/MyST or LaTeX. scimax makes the editor **understand their structure** (headings, tasks, citations, equations, code), so you write once and then **search it, run it, schedule it, publish it and present it**. It brings the Emacs scimax and org-mode experience to VS Code, with no Emacs required.

</div>

<div class="grid">
<div class="col">
<div class="card">

## Structure-aware editing

<img src="img/org-editor.png">
<p class="cap">An org file with folding, tables and TODO states.</p>

- **Speed commands** at headings
- **Tables** with spreadsheet formulas
- **Timestamps**, repeaters, clocking
- **Live LaTeX** preview and entities

</div>
<div class="card amber">

## Executable documents

```org
#+BEGIN_SRC jupyter-python :session main
import numpy as np
np.linspace(0, 1, 5).mean()
#+END_SRC

#+RESULTS:
: 0.5
```

- `C-c C-c` runs a block; results land in the document
- Python, R, Julia, shell, SQL, JS/TS, or **any Jupyter kernel**; tangling and noweb for literate programs

</div>
<div class="card grow">

## Presentations with Marp

- Slides are **Markdown**, with a slide sorter
- Present in the browser: **pen**, **laser**, **notes**, timer
- **Live Python** cells run in the browser with Pyodide
- One self-contained HTML file, or PDF and PPTX; *this poster is one too*

</div>
</div>

<div class="col">
<div class="card">

## Scientific publishing

<img src="img/citation-hover.png">
<p class="cap">Hover a citation for the full reference.</p>

- Citations from **BibTeX**, a **DOI** (OpenAlex) or **Zotero**
- `cite:&key`, `[@key]` and `{cite:t}`, in any **CSL** style
- Labelled equations, figures and tables; references link and preview on hover

| Output  | Route              | Good for             |
|---------|--------------------|----------------------|
| PDF     | LaTeX              | Journals, theses     |
| DOCX    | Pandoc             | Collaborators        |
| HTML    | Built-in exporter  | Web, supporting info |
| ipynb   | Jupyter exporter   | Notebooks            |
| Website | `scimax publish`   | Books, course notes  |

</div>
<div class="card grow">

## Every file, indexed

- **SQLite** index of headings, tasks, code blocks and text
- **Full-text** search (FTS5, BM25 ranking)
- **Semantic** search with local Ollama embeddings: notes never leave your machine
- **Hybrid** search fuses both by reciprocal rank fusion

### From the terminal

The same index powers the editor and the `scimax` CLI.

```bash
scimax search "activation energy"
scimax agenda today
scimax db sync    # cron-friendly
scimax export paper.org --format html
scimax publish
```

</div>
</div>

<div class="col">
<div class="card">

## Agenda and projects

<img src="img/gantt.png">
<p class="cap">Task dependencies drawn as a Gantt chart.</p>

- Tasks live **in your notes**, with deadlines, schedules and warning periods
- Day to month **agenda** over every file
- **Dependencies**, assignees, Gantt and a drag-and-drop project view
- **Journal** and **capture** templates, all indexed

</div>
<div class="card amber grow">

## AI agent skills

Four [Agent Skills](https://agentskills.io) teach Claude Code, Copilot, Codex and Cursor to drive the `scimax` CLI over **your own notes**.

<div class="skills">
<div class="skill"><b>scimax</b><span>search, agenda, journal, export; morning briefings and weekly reviews</span></div>
<div class="skill"><b>scimax-org</b><span>org syntax, source blocks, tables and citations</span></div>
<div class="skill"><b>scimax-projects</b><span>what's next, what's blocked, the critical path</span></div>
<div class="skill"><b>scimax-presentations</b><span>Beamer and Marp decks, and this poster</span></div>
</div>

<p class="ask">“What's on my plate today?”<br>“What is blocking the reactor paper?”<br>“Make a poster about this project.”<br>“Prep me for tomorrow's group meeting.”</p>

```bash
scimax skill install
```

Or run *Scimax: Install AI Agent Skills* in VS Code.

</div>
</div>
</div>

<div class="foot">
<div><b>Install:</b> download the VSIX from GitHub releases, then <i>Extensions: Install from VSIX…</i></div>
<div>MIT license · <b>github.com/jkitchin/scimax_vscode</b></div>
</div>
