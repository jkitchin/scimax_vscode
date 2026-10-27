---
name: scimax-projects
description: >-
  Project management over org-mode tasks with the scimax CLI: what to work on
  next, what is ready or blocked, who is overloaded, the critical path, marking
  tasks done and reporting what got unblocked. Covers :DEPENDS: and :ORDERED:
  task dependencies, :ASSIGNEE: and people, :EFFORT: totals, and project-table
  and gantt dynamic blocks. Use when the user asks what's next, what can I work
  on, what's blocked or ready, about a blocker or task dependency, who's working
  on something or overloaded, project status, a Gantt chart or project table,
  the critical path, or wants to assign, unblock or finish a task.
license: MIT
compatibility: Requires the scimax CLI (installed with the scimax-vscode extension) on PATH.
metadata:
  version: "0.14.0"
  author: John Kitchin
allowed-tools: Bash(scimax:*) Bash(code --goto:*) Read Glob Grep Write
---

# Scimax project management

Task questions are answered with **`scimax task`** — never with `scimax project`,
which is only a folder registry with no task semantics.

## Before You Respond

1. Read `~/.config/scimax/learnings.md` (or `$XDG_CONFIG_HOME/scimax/learnings.md`) if it
   exists and apply relevant corrections. Append a dated `## YYYY-MM-DD: title` entry there
   when the user corrects you; never edit existing entries.
2. Read [references/pm-reference.md](references/pm-reference.md) for the full `scimax task`
   command reference, how to pick the right project file, and the known limitations. Do not
   improvise database queries.

## Quick Reference

| Question | Command |
|---|---|
| What's next? | `scimax task next` |
| What's blocked? | `scimax task list --blocked` |
| What can X start? | `scimax task list --ready --assignee X` |
| Who's overloaded? | `scimax task who` |
| What's the long pole? | `scimax task path` |
| If I finish X? | `scimax task show X` |
| Mark X done | `scimax task done X` |
| Assign X to someone | `scimax task assign X <person>` |
| Which files have tasks? | `scimax task files` |

`scimax task next` already ranks and explains its recommendation — lead with it
instead of re-deriving one from a raw task list.

## Three things to get right

- **`scimax task done` refuses blocked tasks** by design, matching the editor's
  guard. Report the blockers; do not pass `--force` on the user's behalf.
- **Say what got unblocked.** After a `done`, the command reports newly ready
  tasks — that is usually the most useful part of the answer.
- **Pick the right file.** Selection is global by default — the file with the
  most tasks anywhere wins, regardless of the working directory. Add `--local`
  when the user means the current project, `--file <path>` when you know which,
  and run `scimax task files` to see the candidates when you don't.

Effort totals only count `Nd`/`Nh`; `task who` reports an `unestimated` column.
Mention it rather than presenting a total as complete.

## Display Conventions

List tasks as a numbered list with clickable links whose URI uses the absolute path:

```
1. TODO  XRD characterization   [project.org:42](vscode://file/Users/you/org/project.org:42)
```

When the user says **"open N"**, run `code --goto /absolute/path/to/file.org:LINE`.

## Writing tasks

For the org syntax of `:ID:`, `:DEPENDS:`, `:ORDERED:`, `:ASSIGNEE:`, `:person:` headings and
the `project-table`/`gantt` dynamic blocks, use the **scimax-org** skill. The agenda, search
and journal are in the **scimax** skill.
