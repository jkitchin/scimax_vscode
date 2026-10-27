---
name: scimax-org
description: >-
  Org-mode syntax reference as implemented by scimax-vscode: headings, TODO
  keywords, markup, links, anchors, radio targets, #+NAME, back-links and orphan
  links, dialog/decision notes, lists, timestamps, properties and drawers,
  source blocks and header arguments, tables and formulas, LaTeX, footnotes,
  org-ref citations and bibliographies, clocking, export keywords, and entities
  (contacts, locations, reagents via :person:/:location: tags and the Pick
  Entity selector). Use when the user asks how to write something in org-mode,
  about org syntax, how to cite, a source block or header argument, an org
  table, link, timestamp or property, anchors or backlinks, adding a note or
  footnote, or inserting a contact, email or address.
license: MIT
metadata:
  version: "0.14.0"
  author: John Kitchin
allowed-tools: Read Glob Grep Write Bash(scimax:*)
---

# Scimax org-mode syntax

Answer org-mode syntax questions for the **scimax-vscode** extension without web
lookups. Scimax follows the [Org syntax specification](https://orgmode.org/worg/org-syntax.html)
and adds a few extensions (DOI links, label/ref links, granular addressing, dialog notes,
entities).

## Before You Respond

1. Read `~/.config/scimax/learnings.md` (or `$XDG_CONFIG_HOME/scimax/learnings.md`) if it
   exists and apply relevant corrections. Append a dated `## YYYY-MM-DD: title` entry there
   when the user corrects you; never edit existing entries.
2. Read [references/orgmode-reference.md](references/orgmode-reference.md) for the exact
   syntax. Quote examples from it rather than from memory: scimax differs from Emacs in
   places (citations, entities, dialog notes).

## What the reference covers

| Topic | Section in the reference |
|---|---|
| `#+TITLE`, `#+OPTIONS`, `#+STARTUP`, `#+TODO` | Document Settings, Headings |
| `*bold*`, `/italic/`, `=verbatim=`, `~code~` | Text Markup |
| `[[file:...]]`, `[[id:...]]`, `<<anchor>>`, `<<<radio>>>`, back-links, orphans | Links, Granular Addressing |
| Decision, question and comment notes | Dialog Notes |
| Lists and checkboxes | Lists |
| `SCHEDULED`, `DEADLINE`, repeaters | Timestamps and Planning |
| `:PROPERTIES:`, `:LOGBOOK:` | Properties and Drawers |
| `:DEPENDS:`, `:ORDERED:`, `:ASSIGNEE:`, `project-table`, `gantt` | Task Dependencies and Project Management |
| Contacts, locations, reagents | Entities (Contacts, Locations, …) |
| `#+BEGIN_SRC` and header arguments | Source Blocks |
| Quote, example, export blocks | Blocks |
| Tables and `#+TBLFM` | Tables |
| Inline and display math | LaTeX and Math |
| Captions, `#+ATTR_*`, `#+INCLUDE`, footnotes, comments | Special Elements |
| `cite:&key`, `[cite:@key]`, bibliography setup, citation checks | Citations (org-ref) |
| `CLOCK:` entries | Clocking |
| `doi:`, `label:`/`ref:`, index entries | Scimax-Specific Extensions |

For running tasks, finding what is ready or blocked, and assignee workload, use the
**scimax-projects** skill. For searching notes, the agenda, export and citation checks from
the command line, use the **scimax** skill (`scimax cite check file.org`).

## Answering style

- Show a minimal, copy-pasteable org snippet first, then explain.
- When editing a user's file, keep their existing conventions (TODO keywords, citation
  style, property names).
- Point out the editor command when one exists (for example, Pick Entity for contacts),
  as described in the reference.
