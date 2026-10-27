---
name: scimax-presentations
description: >-
  Makes slide decks two ways: org-mode to Beamer PDF with the scimax CLI, and
  Marp Markdown decks built with `scimax marp build` into one self-contained HTML file
  with presenter tools (pen, highlighter, laser pointer, spotlight, sticky
  notes, save-with-annotations) and live, editable Python cells run by Pyodide.
  Use when the user wants to make, convert, build, present or fix a
  presentation, slides, a slide deck, lecture slides or a talk, or mentions
  Beamer, Marp, marp-present, scimax marp build, annotating slides, a laser pointer, or live
  Python in slides.
license: MIT
compatibility: Beamer needs the scimax CLI and a LaTeX install; Marp decks need the scimax CLI and marp-cli (or npx).
metadata:
  version: "0.14.0"
  author: John Kitchin
allowed-tools: Bash(scimax:*) Bash(marp:*) Bash(npx:*) Bash(which:*) Read Glob Grep Write
---

# Scimax presentations

## Before You Respond

1. Read `~/.config/scimax/learnings.md` (or `$XDG_CONFIG_HOME/scimax/learnings.md`) if it
   exists and apply relevant corrections. Append a dated `## YYYY-MM-DD: title` entry there
   when the user corrects you; never edit existing entries.
2. Read [references/presentations-reference.md](references/presentations-reference.md)
   before making or fixing a deck. It has the Marp syntax, `scimax marp build` options, the
   presenter keys, live Python cells, the build workflow and troubleshooting.

## Two routes

| Goal | Command |
|------|---------|
| Export org to Beamer LaTeX | `scimax export slides.org --format beamer` |
| Compile Beamer to PDF | `scimax export slides.org --format beamer-pdf` |
| Build a Marp deck (one HTML file + presenter tools) | `scimax marp build talk.md --open` |

- **org → Beamer** (`scimax export slides.org --format beamer-pdf`): LaTeX-quality PDF slides
  from an org file.
- **Marp + `scimax marp build`** (the scimax presenter tools; it replaces the old standalone `marp-present`): Markdown slides built into one
  self-contained HTML file. It works offline and can be emailed. The presenter tools work while
  you talk: pen and highlighter, laser pointer, hold-to-spotlight, Markdown sticky notes and a
  right-click menu. `s` saves an annotated standalone copy, and Cmd+P prints with annotations.
  ```` ```python run ```` blocks become editable, runnable Python cells (Pyodide), warmed up in the
  background when the deck opens.

Default to Marp + `scimax marp build` for lectures and talks shown from a browser, and to Beamer when
the source is org or the output must be a PDF. If `scimax marp` is not available, build with plain
Marp CLI and say that the presenter tools are missing. When handing over a Marp deck, list the
presenter keys from the reference.

For org syntax inside a Beamer source file, use the **scimax-org** skill.
