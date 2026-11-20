---
name: scimax-excalidraw
description: >-
  Makes interactive Excalidraw diagrams for org-mode notebooks with the scimax CLI:
  writes a compact JSON spec, builds it into an editable .excalidraw.svg with
  `scimax excalidraw build`, links shapes to org headings, custom ids, files, DOIs
  or web pages, checks that every link resolves, and inserts an org link to the
  drawing into the user's org file. Clicking a shape in VS Code jumps to the
  linked heading; HTML export inlines the drawing with working links.
  Use when the user asks to make, draw, sketch or edit a diagram, figure, flowchart,
  schematic, concept map, pipeline or workflow figure for their notes, mentions
  Excalidraw, or wants parts of a figure linked to org files, headings or other resources.
license: MIT
compatibility: Needs the scimax CLI (scimax-vscode extension). Clicking links in VS Code needs the Excalidraw editor extension (pomdtr.excalidraw-editor). Never uses Emacs.
metadata:
  version: "0.1.1"
  author: John Kitchin
allowed-tools: Bash(scimax:*) Bash(rsvg-convert:*) Bash(mkdir:*) Read Glob Grep Write Edit
---

# Scimax Excalidraw diagrams

## Tools: the scimax CLI only, never Emacs

"scimax" here means the **scimax-vscode** extension and its `scimax` command-line tool, not
Emacs Scimax. Do every org-mode operation (export, tangle, table alignment, citation checks,
agenda, search, publishing) with the `scimax` CLI, or by reading and editing the files
directly. **Never run `emacs`, `emacsclient`, `emacs --batch`, or any Emacs Lisp**
(`org-table-align`, `org-export-*`, `org-babel-tangle` and so on), even if Emacs is
installed and even when it looks quicker. Do not write an ad hoc script that imitates an
org-mode operation either. If the CLI cannot do what is needed, tell the user and stop.

## Before You Respond

1. Read `~/.config/scimax/learnings.md` (or `$XDG_CONFIG_HOME/scimax/learnings.md`) if it
   exists and apply relevant corrections. Append a dated `## YYYY-MM-DD: title` entry there
   when the user corrects you; never edit existing entries.
2. Read [references/excalidraw-format.md](references/excalidraw-format.md) before writing
   a spec. It has every element field, the colour palette, layout rules and the link forms.

## Workflow: "make this diagram, link this part to ..."

1. **Find the org file.** The drawing belongs to the org file the user is working in: the
   file open in their editor (the IDE selection, when you are given one), or the file they
   name. Ask only if neither is clear.
2. **Find the link targets.** For each part the user wants linked, find the heading,
   `CUSTOM_ID`, `ID`, file or URL with Grep/Read. Prefer, in order: `id:<ID>` (survives
   moves), `file:<rel>::#custom-id`, `file:<rel>::*Exact heading title`. Paths are relative
   to the **drawing's** folder, so a drawing in `diagrams/` links to `../notes.org`.
3. **Write the spec** to a scratch file (not next to the notes): shapes with `label`,
   arrows with `from`/`to`, and `orgLink` on linked parts. Lay it out on a grid (see the
   reference) so nothing overlaps.
4. **Build** into `diagrams/<name>.excalidraw.svg` next to the org file:

   ```bash
   scimax excalidraw build /tmp/spec.json -o path/to/diagrams/flow.excalidraw.svg
   ```

   `build` checks the scene and every org link (file exists, heading or custom id is in
   it) and exits 1 on a problem. Fix the spec and rebuild until it prints no problems.
5. **Look at it** if you can view images: `rsvg-convert flow.excalidraw.svg -o /tmp/flow.png`
   and Read the PNG. Fix overlaps, cramped labels and crossing arrows.
6. **Insert the link** into the org file where the user asked (default: after the line
   they are on, or at the end of the relevant section), with a caption and name:

   ```org
   #+CAPTION: Data pipeline. Click a box to jump to its section.
   #+NAME: fig-pipeline
   [[file:diagrams/flow.excalidraw.svg]]
   ```

   Keep the link bare (no description) so HTML export inlines the drawing.
7. Tell the user the file path, which parts link where, and that they can open it with
   C-c C-o on the link (or click it) to edit it in Excalidraw.

## Commands

| Task | Command |
|------|---------|
| Spec → editable drawing | `scimax excalidraw build spec.json -o diagrams/x.excalidraw.svg` |
| Spec from stdin | `scimax excalidraw build --stdin -o diagrams/x.excalidraw.svg` |
| Check structure and links | `scimax excalidraw check diagrams/x.excalidraw.svg` |
| List links | `scimax excalidraw links diagrams/x.excalidraw.svg` |
| Print the stored scene | `scimax excalidraw json diagrams/x.excalidraw.svg` |
| `.excalidraw` → `.excalidraw.svg` | `scimax excalidraw render diagrams/x.excalidraw` |
| Export the notes with live links | `scimax export notes.org --format html` |

## Editing an existing drawing

Run `scimax excalidraw json <drawing>` to get the scene, change or add elements (new ones
may use the spec shorthands), write it to a scratch file and `build` it back to the same
path. Arrows that already exist keep their points: to reroute one after moving a shape,
replace it with a new arrow that has `from`/`to`. Never overwrite a drawing the user has
edited without starting from its current scene.

## How links work

`orgLink` becomes `vscode://jkitchin.scimax-vscode/org-link?link=<org link>` on the
element. In the Excalidraw editor, clicking the link icon on a shape sends the URI to
VS Code and scimax follows the org link from the drawing's folder (the first time, VS Code
may ask to allow scimax to open the URI). In HTML export the same links point at the
exported pages (`notes.org::*Results` → `notes.html#org-results`). Plain `link` values
(`https://...`, `doi` URLs, relative file paths) are kept as they are.

In VS Code, `Scimax: Copy Heading Link for Excalidraw` copies a link to the heading at the
cursor that the user can paste into a shape's link box (Ctrl/Cmd+K in Excalidraw).

## Rules

- One drawing per figure; name it after the figure (`diagrams/pipeline.excalidraw.svg`).
- Never invent link targets. If a heading the user named does not exist, say so and ask
  whether to create it, link elsewhere, or leave that part unlinked.
- `cite:`, `cmd:` and other VS Code-only links work in VS Code but are dropped from HTML
  export; use a DOI URL when the figure will be published.
