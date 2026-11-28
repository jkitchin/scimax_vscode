# Scimax Project Management Reference

Answer project questions — what's next, what's stuck, who's loaded — and move
tasks forward, through the `scimax task` command family.

## Scope

`scimax project` is **not** project management. It is a projectile-style folder
registry (`--add`, `--list`, `--scan`) that fuzzy-opens a directory in VS Code.
Never use it to answer task questions. Use `scimax task`.

A **task** is an org heading with an `:ID:` property:

```org
*** TODO XRD characterization
    :PROPERTIES:
    :ID: xrd
    :EFFORT: 2d
    :ASSIGNEE: liam
    :DEPENDS: id:synth
    :END:
```

| Property | Meaning |
|---|---|
| `ID` | Stable task id — the handle every command takes |
| `ASSIGNEE` | Person handle |
| `EFFORT` | `2d` or `4h`; other formats count as 0 |
| `DEPENDS` | `id:a id:b` — must finish before this one |
| `ORDERED: t` | On a *parent*: its children run top-to-bottom |

Blocking comes from **both** `:DEPENDS:` and `:ORDERED:`. `scimax task` honors
both. Reading the `dependencies` table alone does not — it has no ORDERED edges —
so do not hand-roll SQL for readiness questions.

## Commands

```bash
scimax task next                 # what to work on now, ranked, with reasoning
scimax task list                 # open tasks; --ready --blocked --assignee X
scimax task who                  # workload per assignee
scimax task path                 # critical path through remaining work
scimax task show <id>            # one task: blockers + what it unblocks
scimax task done <id>            # mark DONE; refuses if blocked
scimax task assign <id> <who>    # set :ASSIGNEE:
scimax task files                # which files contain tasks
```

Every command takes `--file <path>`, `--local`, and `--json`.

**The scope is global by default.** Commands cover every indexed file with
tasks, so `scimax task who` is the whole team's workload across projects and
`scimax task next` ranks ready work everywhere.

- `--local` confines it to the task files under the current directory. Reach
  for it whenever the user is clearly asking about *this* project ("what's
  next here?", or the conversation is rooted in a project folder).
- `--file <path>` limits it to one file.
- `scimax task files` lists the files with task counts.

Dependencies are always resolved against every indexed task, whatever the
scope, so a task waiting on another project is blocked only while that task is
open. A dependency on an id no file defines keeps the task blocked and shows as
"(not found)". An `:ID:` defined twice prints a warning, and the first is used.

## Answering questions

| The user asks | Run |
|---|---|
| "What's next?" / "What should I work on?" | `scimax task next` |
| "What's blocked?" | `scimax task list --blocked` |
| "What can Liam start?" | `scimax task list --ready --assignee liam` |
| "Who's overloaded?" | `scimax task who` |
| "What's the long pole?" | `scimax task path` |
| "If I finish X, what opens up?" | `scimax task show X` |
| "Mark X done" | `scimax task done X` |

`scimax task next` already ranks and explains — lead with its recommendation
rather than re-deriving one. It orders by deadline, then priority, then whether
the task sits on the critical path.

## Making changes

Writes edit the org file and reindex it immediately, so a follow-up query
reflects the change.

`scimax task done` enforces the same guard as the editor: a task with unfinished
blockers is refused (exit 1). **Do not reach for `--force` on the user's behalf.**
Report the blockers and let them decide.

After marking something done, say what it unblocked — the command reports this,
and it is usually the most useful part of the answer.

## Reporting

Use the skill's numbered list + `vscode://file/ABSOLUTE_PATH:LINE` convention so
the user can say "open N".

Lead with the answer, then the reasoning:

> Next up: **Synthesize perovskite samples** (@liam, 5d, scheduled Mon).
> It's one of only 2 actionable tasks and gates the 33-day critical path.

## Limitations — state these when they matter

1. **Index freshness.** Task files are read from disk, so edits count at once,
   but which files hold tasks comes from the index. A new project file needs
   `scimax db sync` before it shows up.
2. **Effort math.** `days` are 8-hour days in any effort unit (`2d`, `4h`,
   `90m`, `0:30`); a shared task is split between its assignees, and tasks
   without an effort count as 0. `scimax task who` reports an `unestimated`
   column — mention it rather than presenting a total as complete.
3. **`ORDERED` covers direct children only.** Deeper descendants of an ORDERED
   parent are not chained.
4. **Ids are resolved within one file.** Cross-file `:DEPENDS:` works in the
   editor but not here.
5. **No cycle detection.** A dependency cycle appears as mutually blocked tasks;
   `task path` stops descending rather than looping.
6. **`done` does not add a `CLOSED:` timestamp** or run org's logging hooks, and
   it does not regenerate `project-table` / `gantt` dynamic blocks. Those refresh
   when the user next runs `C-c C-c` on the block in VS Code.

## Escape hatch

For questions the commands do not cover, query the index directly:

```bash
DB=$(scimax db stats 2>/dev/null | sed -n 's/.*Database: //p')
sqlite3 "$DB" "SELECT json_extract(properties,'\$.ASSIGNEE'), COUNT(*)
  FROM headings WHERE properties LIKE '%ASSIGNEE%' GROUP BY 1;"
```

Task properties live in the `headings.properties` JSON blob; explicit edges are
in `dependencies` (`from_id` → `to_id`). Remember ORDERED edges are absent there.
