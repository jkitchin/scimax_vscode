# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.1] - 2026-10-04

### Fixed

- **`C-c C-c` on a `project-table` block** - it reported "Unknown dynamic block type: project", because the block name was cut at the hyphen. Hyphenated block names are now read whole.

## [0.8.0] - 2026-10-04

### Added

- **The agenda keeps itself current** - Before showing the agenda, the TODO list or the agenda tree, Scimax re-indexes org files that changed on disk since they were indexed (such as edits Dropbox synced from another machine) and drops deleted ones. Checking takes well under a second even for tens of thousands of files. Turn it off with `scimax.agenda.updateChangedFiles`.
- **Double-click a Marp slide to jump to its source** - double-clicking a slide in the Markdown preview puts the cursor on the exact source line: the right line of a multi-line paragraph or code block, list item, or table row. VS Code's own double-click estimates the line from the click's height on the page, which lands several lines off inside scaled slides. Requires `"markdown.preview.doubleClickToSwitchToEditor": true`, which current VS Code releases leave off by default. See `docs/44-marp.org`.
- **Reveal the cursor in the Markdown preview** - `scimax.marp.revealInPreview` (command palette: *Scimax: Reveal Cursor in Markdown Preview*) scrolls the preview so the element on the cursor line sits at its top, opening a preview to the side if none is showing. Works for Marp decks and ordinary Markdown.
- **MyST (Jupyter Book) directives and roles in the Markdown preview** - `:::{admonition}` and typed admonitions render as coloured callouts (`:class: dropdown` collapses), `{figure}` shows its image and caption, `{code-cell}` is highlighted, `{index}` and `{toctree}` are hidden, unknown directives get a labelled box, and roles like `` {ref}`text <target>` `` show their text. Previously directives showed as raw `:::{...}` text or empty code boxes. Controlled by `scimax.markdown.myst.enabled`. See `docs/45-myst-preview.org`.
- **Marp slide thumbnails and Slide Sorter** - A *Marp Slides* view in the Explorer and a Slide Sorter editor tab (`Cmd+Shift+V` in a deck, or the layout icon in its title bar) show a zoomable grid of the active deck's slides. Double-click a thumbnail to jump to its source. Select slides to cut, copy, paste, duplicate, insert, move (keys or drag and drop), hide and delete them; each operation is one edit to the Markdown. Copied slides keep their images when pasted into another deck. The sorter also has a single-slide preview that follows the cursor. See `docs/44-marp.org`.
- **Marp without the Marp extension** - Scimax renders decks in VS Code's Markdown preview with its own copy of Marp Core, and adds a Marp menu to the editor's right-click menu (slide operations, layouts, insert elements, per-slide directives, deck settings, custom themes), directive completion and hover, and *Make Marp Deck* / *Marp Help* commands. `scimax.marp.*` settings fall back to Marp for VS Code's `markdown.marp.*`, and a `.marprc` / `package.json` `marp` key next to the deck is read as Marp CLI does.
- **Present and export Marp decks** - The play button (or `x` in the export menu) opens the deck as Marp's HTML slideshow in the browser, from the first slide or the current one; `[[marp:deck.md::N]]` org links start at slide N. `C-c C-e` in a deck opens a Marp export menu: PDF, HTML, PNG, notes, images and editable PowerPoint through Marp CLI (`marp` on the PATH, or `npx` after asking), editable PowerPoint through Pandoc, and a Google Slides route. Saving a deck reloads its open slideshow at the slide you are editing (`scimax.marp.liveReload`).
- **Marp presenter tools and live Python** - A deck with `presenter: true` gets, in its slideshow and HTML export: a pen with colours, an eraser and undo, a laser pointer, sticky notes, a spotlight, a talk timer (`timer: 20`), blank screen, zoom, go to slide, exercise countdowns, and editing the slides in place (`d`, or double-click). `s` saves one HTML file with the ink, notes and edits, `m` the Markdown with the ink, and the right-click menu a copy that works offline. ` ```python run ` cells run in the browser with Pyodide; `presenter: offline` puts Python in the HTML for a talk without internet, `C-c C-c` runs a cell in a Python panel in VS Code, and *Check for Offline Use* lists what would still need a connection. Marp CLI 4.3's overview shows each slide's ink on its thumbnail. Only in trusted workspaces. Try `examples/marp-present/demo.md`.
- **Edit Marp slides with Claude Code** - From the slide menu, opens Claude Code with a prompt naming the selected slides, or @-mentions their lines in a Claude Code chat that is already open.
- **Ask the docs: in-browser chat for published sites** - With `theme.chat.enabled: true`, the book theme adds a chat button. A question first lists the best-matching sections with the matching text highlighted, ranked by BM25 and then reranked in the browser by a small cross-encoder (transformers.js, about 23 MB; `rerank: false` turns it off). A button then has a model running in the reader's browser (WebLLM, WebGPU) write an answer from those sections, citing them as links. Readers pick the model from a menu (SmolLM2-360M, 380 MB, by default, up to Llama-3.2-3B), and the chat asks before downloading it. No server; the scimax docs site has it turned on. See `docs/31-publishing.org`.
- **Project view with a graphical Gantt chart** - *Scimax: Project View* shows every TODO task in the active file's project (all `.org` files under the project root) on a timeline: bars coloured by status, milestones, dependency arrows, today's line, and filters for assignee, done tasks and grouping. Double-click a task to open it; right-click to cycle its state, assign it, or set priority, effort, schedule or deadline. The chart exports to Excel (a task table with a day-by-day coloured timeline) and to a one-page vector PDF. See `docs/03.6-project-management.org`.
- **Filter the Gantt chart by tags** - The project view's *Tags* button opens a checklist of the project's tags; checking several shows the tasks that have any of them, counting tags inherited from parent headings and `#+FILETAGS`. The Excel and PDF exports follow the filter. `examples/project-management/` now has tags, milestones and a second file with cross-file dependencies to try it on. See `docs/03.6-project-management.org`.
- **Add and remove dependencies from the Gantt chart** - *Depends On...* in a task's right-click menu in the project view picks another project task that must be done first, writes it to the task's `:DEPENDS:` (adding `:ID:`s as needed, across files) and redraws the chart with the new arrow. Tasks that already wait on this one are not offered, so no cycle can be made. *Remove Dependency...* takes dependencies out again.
- **Export to PDF from the Markdown preview** - An export button in the title bar of VS Code's Markdown preview saves the previewed file as a PDF (via Pandoc) and opens it; a Marp deck exports its slides with Marp. The markdown export commands and menu now also work while the preview has focus.
- **Tab expands org snippets** - `ti`, `ca`, `<py`, `<s` and the other org snippets expand on `Tab` (scimax sets `editor.tabCompletion` to `onlySnippets` for org files). `ti` and `ca` now insert `#+TITLE:` and `#+CAPTION:`, matching the completion list. The snippets are now documented in `docs/35-templates.org`.
- **Drag tasks on the Gantt chart** - In the project view, drag a task's bar to move its `SCHEDULED` and `DEADLINE` dates (an undated task gets `SCHEDULED` where you drop it), or drag the right end of a bar that ends on its deadline to move just the deadline. A tip shows the new dates while dragging, and `Escape` cancels. When you let go, the file is saved and scimax offers to move the tasks that wait on it by the same days. *Undo* and *Redo* in the toolbar (or `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`) put a drag back, with the tasks that moved with it.
- **Moving a deadline moves the tasks that wait on it** - When a task's deadline moves (*Set Deadline...* in the project view, `C-c C-d`, or `Shift+Up`/`Down` on the date, which waits until you stop pressing), scimax lists the unfinished tasks that depend on it (directly or through others) and moves their `SCHEDULED` and `DEADLINE` dates by the same days, keeping times and repeaters. Uncheck tasks to leave them, or press Escape to move none.
- **Project agenda buffer** - `C-c a v` has a *Current Project* choice that opens the agenda buffer for only the files under the active file's project root (the nearest folder with `.git`, `.projectile` and similar markers), in its own tab. The files are read directly, so they need not be indexed. See `docs/13-agenda.org`.
- **Filter the agenda by assignee** - `@` in an agenda buffer, or *Assignee...* in the `C-c a v` list, shows only the tasks assigned to the people you pick (or unassigned ones), with assignees inherited from parent headings. Combines with the project scope.
- **Blocked tasks flagged in the agenda** - tasks with an unfinished dependency show 🔒 before their title (`scimax.org.depend.hideBlockedInAgenda` still hides them instead).
- **Remove several stale projects at once** - *Scimax: Remove Project* now takes multiple picks, lists the stalest projects first with when each was last opened, and flags projects whose folder is gone. See `docs/17-projectile.org`.
- **Project-wide task table** - `:scope project` on a `project-table` dynamic block gathers tasks from every org file in the project, adds a `file` column, and counts dependencies between files as blocking.
- **Live org preview** - `Cmd+Shift+V` in an org file opens a rendered preview (`Cmd+K V` to the side) that updates as you type, keeps its scroll position, follows the light/dark theme, shows local images, and scrolls with the editor both ways. Double-click jumps to the source line. `scimax.org.previewHtml` now opens it. See `docs/46-org-preview.org`.
- **`scimax db optimize` and a smaller database** - *Scimax: Optimize Database* and the new `scimax db optimize` (with VS Code closed) now rebuild the vector index when it holds far more entries than there are embedded chunks, then VACUUM, and report the size before and after. Older versions could leave most of the index behind as files were re-indexed: one database with no embeddings at all had grown to 58 GB. See `docs/18-database-search.org`.

### Changed

- **Semantic search is off until you set it up** - `scimax.db.embeddingProvider` now defaults to `none`, as the CLI already did, so VS Code and `scimax db sync` agree. Before, the extension tried to reach Ollama even if it was never installed. If you use semantic search, set the provider to `ollama` (or run *Scimax: Configure Embedding Service*).
- **Org files are ready sooner after opening** - Keybindings that depend on where the cursor is (headings, lists, tables, links, dynamic blocks) are set as soon as a file opens instead of after the first cursor move, and only changed values are sent to VS Code. The extension loads about three times faster: it is now bundled, and date-fns, citation-js, Handlebars, js-yaml, JSZip and tesseract.js load on first use. The journal status bar no longer reads every journal entry when you switch files, orphan-link checks wait until a file has opened, and the back-link CodeLens fetches a file's counts in one indexed query (migration 8) instead of one per heading. `scimax.org.backlinks.codeLens` turns the lenses off.
- **Database statistics are quicker** - checking whether any embeddings exist no longer counts every chunk.

### Fixed
- **`[[#custom-id]]` and `[[*Heading]]` links in the org preview and HTML export** - They pointed at an id the heading did not have, so clicking them did nothing, and a link without a description showed its raw target (`#sec:results`). They now go to the heading and show its section number (or title when sections are unnumbered), as Emacs does. Headings with a `CUSTOM_ID` keep their generated id as well, so links to them from other files still work. Two doc links to headings by their old review-mark titles are fixed too.
- **Back after following a link in the org preview** - After jumping to a citation's bibliography entry, a section or a footnote, a *← Back* button (or `Cmd+[`, `Cmd+Left`, `Backspace`) returns to where you were.

- **Line-start shortcuts expand again** - Typing `ti` at the start of a line now offers `#+TITLE:` (likewise `n`, `ca`, `au`, `da`, `op`, and `plt`, `np`, `pxl`, `pyl`, `pl` in Python blocks). They were only offered for the complete prefix, so after the first letter VS Code showed document words and never asked for them again.
- **One embeddings status bar item, with a count** - Each embedding run added its own status bar item, and one that started within two seconds of the last left an "Embeddings complete" behind for good, so they piled up across the status bar. There is now a single item showing `Embeddings: m/n`.
- **Semantic search gets embeddings again** (#59) - The chunks table was always created for 384-dimension vectors, so with the default `nomic-embed-text` (768) every embedding failed and was only logged to the console. The table (and a vector index that recorded the wrong size) is rebuilt for the configured model, files indexed before a provider was set up get embedded on the next sync, failures are reported (naming the cause, such as Ollama not running) instead of "Embeddings complete", and CLI syncs now wait for their embeddings.
- **`file:` links land on their line in `#+STARTUP: overview` files** - Following a link like `[[file:13-agenda.org::527]]` into a file not yet open put the caret and view on a top-level heading, because the startup folding moved the caret before it was read back. The caret and view now stay on the target.
- **No more "FOREIGN KEY constraint failed" from embeddings** - Saving a file while its embeddings were being computed re-indexed it under a new id, and the finished embeddings were then stored for the old one. Those are now dropped (the saved version is embedded again), and a file's chunks are replaced in one transaction.
- **Verse blocks no longer break HTML and LaTeX export** - Exporting a file with a `#+BEGIN_VERSE` block failed with "Cannot read properties of undefined (reading 'value')", which also left the Basic Org Syntax page off the docs site.
- **Docs site lists every page** - 22 pages (Basic Syntax, CLI, Publishing, Marp, MyST and Org preview, Dired, Find File, Link Graph and more) were missing from `docs/_toc.yml`, so they were not on the hosted docs or in its chat. The docs workflow now also rebuilds when `_config.yml` changes.
- **Web links in the org preview and exports** - Plain `https://...` and `<https://...>` links are now links in HTML and LaTeX export, and the `//` in a URL no longer starts italics.
- **`=code=` containing `=`** - `=feral_ordering=metis=` exports as code instead of literal text with its markers; the same for `~verbatim~`.
- **`scimax publish --init --no-github --no-sitemap`** - The two flags were ignored, so the generated configuration always turned on GitHub Pages and the sitemap.
- **Book theme settings keep their defaults** - A `_config.yml` theme section that set only some of its keys (for example a `header` with just a `logo`) blanked the others, such as the site title, instead of keeping their defaults. `theme: book` on one line now selects the book theme too; before, it was ignored.
- **Org preview runs only its own scripts** - The preview's content security policy allowed any script from cdn.jsdelivr.net and cdnjs.cloudflare.com, so a `<script src>` in an `#+HTML:` block could load any npm package. It now allows only the MathJax and highlight.js files the preview uses.
- **`# comments` in Markdown code blocks are no longer headings** - A `# comment` line inside a fenced code block was taken for a heading, so it got its own fold, broke visibility cycling, and showed up in the outline, heading navigation and jumps, and the database index; promote/demote could even edit it. Fenced blocks are now recognised with CommonMark's rules everywhere Markdown headings are found.
- **Marp HTML setting** - when `scimax.marp.enableHtml` is not set, Marp for VS Code's current `markdown.marp.html` (`"all"` / `"off"`) is now honored, not only the deprecated `markdown.marp.enableHtml` that makes that extension warn on every start.
- **Markdown → PDF handles Unicode characters** - PDF export failed with "Unicode character ′ (U+2032) not set up for use with LaTeX" when the text contained characters such as `′`, `→` or Greek letters, because Pandoc ran pdflatex. It now uses xelatex, with Arial Unicode MS as the body font on macOS. Choose the engine and font with `scimax.markdown.export.pdfEngine` and `scimax.markdown.export.mainFont`; a `mainfont` in the YAML front matter takes precedence. If the font lacks some characters, a warning names them.

### Removed

- **Mermaid Gantt block** - the `#+BEGIN: gantt` dynamic block and *Scimax: Insert Gantt Chart* (`scimax.org.insertGantt`) are gone; the project view's interactive chart, with Excel and PDF export, replaces them. Updating an old `gantt` block now reports "Unknown dynamic block type".
- **Marp Slides view** - the Explorer sidebar view is gone; the Slide Sorter tab (`Cmd+Shift+V` in a deck) does everything it did, with more room, and the slide preview covers the one-slide case.

## [0.7.1] - 2026-09-18

### Added

- **Set Tags picks from tags already in use** (#58) - `scimax.speed.setTags` (speed key `:`, and now `C-c C-q` in org files) opens a multi-select list of every tag in the file and the database, with usage counts. Typing a new tag offers it as a new entry and warns when it looks like an existing one (a plural, typo, or case variant), so `:groupmeetings:` doesn't quietly split off from `:groupmeeting:`.

### Fixed

- **Search by Tag lists heading tags** (#58) - `scimax.db.searchByTag` listed `#hashtags` instead of heading `:tags:`, so it couldn't show the tags you actually use. It now lists every heading tag with its count, sorted case-insensitively so spelling variants sit together, like Emacs `org-tags-view`, and finds up to 5000 matching headings instead of 100.

## [0.7.0] - 2026-09-13

### Fixed

- **Commands no longer go missing after an activation error** (#57) - An exception anywhere in activation used to drop every command registered after it, leaving the extension installed but reporting `command 'scimax.…' not found`. Each registration step now fails on its own and is logged, the rest of activation carries on, and a top-level catch offers the log. The journal directory and notebook setup no longer throw when `scimax.journal.directory` does not resolve on this machine (a common Settings Sync situation). Activation logs the resolved directories and names any failed steps, and **Scimax: Show Diagnostic Report** lists them.
- **Scimax activates on Linux builds where `process.report` is unavailable** (#57) - The database client is now loaded on first use rather than when the extension loads, so a native-loader failure disables database features instead of the whole extension. libsql's libc detection no longer reads an undefined diagnostic report, and `detect-libc` is updated so current glibc systems are recognized without it.
- **Per-file TODO keywords decide what is done** - Keywords after `|` in a file's own `#+TODO:` line (e.g. `ABANDONED`) now count as done for that file, so those headings drop out of the agenda, TODO list, link graph, and `scimax task`. `CANCELED` joins `DONE` and `CANCELLED` in `scimax.agenda.doneStates`. A database migration marks org files for reindexing so the change applies on the next sync.
- **SVG images in PDF export** (#49) - `[[file:fig.svg]]` is converted to PDF during export (via rsvg-convert, cairosvg, or inkscape) instead of aborting the LaTeX build.
- **Clear LaTeX errors from `scimax export --format pdf`** (#50) - A failed build prints the first LaTeX error with its `.tex` line, deletes the misleading partial PDF, and reports the details in `--json`. `--show-log` prints the log tail.
- **Trailing colon after a citation** (#52) - `cite:key:` no longer exports `\cite{key:}`.
- **Long inline code wraps in PDF export** (#53) - `=long.dotted.identifier()=` breaks at separators instead of overflowing the margin.
- **Agenda tags** - Tags no longer render as `:[]:` or `:["taxes"]:` in the agenda views.
- **Overdue deadlines** read `N d. ago:` in the agenda instead of looking like future ones.
- **CLI agenda** - `scimax agenda todos` no longer reports zero on large databases, `today`/`week` no longer include every past item, and `--json` output stays parseable.
- **Exclude patterns** - Adding a pattern to `scimax.db.exclude` no longer drops the built-in excludes (`node_modules`, VCS directories, VS Code local history, …), which could flood the index and agenda. `scimax db prune` removes files already indexed that the excludes now match.
- **Escape cancels an avy jump in org files** instead of starting an `Escape` chord.
- **Custom exporters** - A manifest that fails to parse is reported instead of silently skipped (#56), comments and trailing commas in `manifest.json` are tolerated, `#+LATEX_HEADER:` lines are passed to custom LaTeX templates, and a `#+LATEX_CLASS` naming an exporter no longer sends a nonexistent class to LaTeX.
- **Template headers** - Inserting a template no longer strips its `#+TITLE:` and other org keywords.
- **Cross-file heading links in HTML export** - `file:other.org::*Heading` links point at the heading's anchor instead of a 404.
- **Cancelled LaTeX build steps** are reported only once their process has exited.

### Changed

- **Avy-style jump commands rewritten** - Jump labels are now drawn *on top of* the text at their screen positions instead of being listed in a picker, and keystrokes are read straight from the editor (the extension takes over the `type` command for the duration of a jump), so there is no widget and the cursor never leaves the buffer. Labels are assigned nearest-first, so the closest targets get single-character labels; two-character labels narrow as you type, redrawing only the characters left to press. Every visible editor is labeled by default, so a jump can cross a split. Backspace undoes a keystroke, Escape cancels, and if another extension already owns `type` the session falls back to an input box. New settings `scimax.jump.timeoutMs|labelChars|allVisibleEditors|dimBackground|labelBackground|labelForeground`.
- **`scimax.jump.gotoWord` and `gotoSubword` now require a starting character** rather than treating it as optional. Labeling every visible word at once buried the text under labels exactly when it needed to be read.
- **Single-key bindings are suspended during a jump** via a new `scimax.jumpActive` context. A keybinding always beats the `type` dispatch, so the speed commands at headings, source blocks, LaTeX sections and environments, BibTeX entries, and the agenda buffer would otherwise swallow the label character.

### Added

- **Agenda buffer** (`C-c a v`) - A persistent, read-only full-window agenda like Emacs `org-agenda-mode`. `RET` jumps to the heading, `t` cycles its TODO state, `g` refreshes, `f`/`b` page, `.` returns to today, `q` closes.
- **LaTeX build profiles** - Named build sequences (e.g. lualatex + biber + a makeglossaries pass) from built-ins, `scimax.export.pdf.profiles`, or `latex-profiles.json` near the document, chosen per file with `#+LATEX_BUILD:` or `% !SCIMAX build =`. Used by org → PDF export and by `.tex` compiles. Project-local profiles are honored only in a trusted workspace.
- **LaTeX-class exporter routing** - The ordinary LaTeX/PDF exports pick a custom exporter when `#+LATEX_CLASS` matches `scimax.export.latexClassExporters` or names a loaded exporter, and `#+EXPORTER: <id>` (or `none`) selects one per file.
- **`scimax task`** - Project management from the CLI over the database: `next`, `list`, `who`, `show`, `path`, `done`, `assign`, and `files`, honoring `:DEPENDS:` and `:ORDERED:` blocking. The bundled scimax skill documents it.
- **Move a table cell** with `C-M-arrow`, alongside the existing row and column moves.
- **`literal-dollar` lint check** (#54) - Flags a literal `$` in prose (e.g. `$50,000`) that would open math mode in LaTeX export.
- **Custom exporters appear in the export dispatcher** (#56) - Loaded custom exporters are listed by name in the `C-c C-e` menu on digit keys, next to the built-in formats, instead of hiding behind a separate command. A `[!]` entry appears when an exporter failed to load.
- **Org headers for custom exporters** - A custom exporter that declares `keywords` now contributes an org template, listed in the template pickers under *Custom Exporters* and insertable with **Scimax: Insert Custom Exporter Header**: defaults filled in, required keywords left as `<<<PLACEHOLDER>>>`, and `#+LATEX_CLASS` included when a class routes to that exporter. An exporter can ship a real skeleton with a new `orgTemplate` manifest field (the CMU Memo example now does). Exporting with a required keyword missing warns and offers the header instead of writing `[NOT FOUND: to]` into the output.
- **`scimax.export.showExporterProblems`** - Lists every exporter directory that could not be loaded, with the reason, and opens the offending `manifest.json`. `scimax export --list-exporters` reports the same problems, and the searched directories when nothing is found.

- **Open External Terminal Here** (`scimax.openExternalTerminalHere`) - Opens your real terminal application in the current file's directory, alongside the existing "Open Terminal Here" (which uses VS Code's integrated terminal). Available from the editor tab and explorer context menus. Auto-detects an installed terminal per platform (iTerm, Ghostty, WezTerm, kitty, Alacritty, Warp, Terminal.app on macOS; x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal and others on Linux; Windows Terminal, else `cmd.exe`), overridable with `scimax.externalTerminal.app|command|args`.
- **`scimax.ref.citationLinkStyle`** - Insert org-ref citations as bracketed org links, `[[cite:&key]]`, instead of the plain `cite:&key`. That is the form Emacs org-ref/scimax inserts, so files edited in both editors now look the same (#55). Citations carrying pre/post notes are always inserted bracketed, since a plain org link ends at the first space.
- **`scimax.ref.insertCitationForKey`** - Insert a citation for a given key. The hover popup's "Insert Citation" link pointed at this command, which was never registered (clicking it did nothing).

- **`scimax.jump.gotoHeading`** (`C-c j h`) - labels every visible heading, which in a folded buffer is most of the outline. The label covers the leading stars rather than the title, and the cursor lands at column 0 where speed commands are active. Headings are matched per language, so a `#` comment inside an org source block is not mistaken for one.
- **`scimax.jump.gotoCharTimer`** (`C-c j t`) - the `avy-goto-char-timer` equivalent: type any number of characters, and the labels appear when you pause.
- **`scimax.jump.listCommands`** (`C-c j ?`) - lists every jump command with its keybinding and description, read from the extension manifest so it cannot drift, and runs the one chosen.

## [0.6.0] - 2026-07-11

### Added

- **TODO task dependencies (simplified org-depend)** - A task declares what it depends on with a single `:DEPENDS:` property of `id:` links. Completing a task is **blocked** until every dependency is DONE (with a jump-to-blocker action), and completing a task **triggers** any dependent that becomes unblocked (notify + optional promote to a ready state). `:ORDERED: t` forces child tasks to be completed top-to-bottom. Cross-file, backed by a new `dependencies` index. Surfaced via a blocked/ready CodeLens, a **Dependencies** tree view, and dangling/cycle diagnostics. New commands `scimax.org.addDependency`, `scimax.org.gotoBlocker`, `scimax.org.showDependencies`, and settings `scimax.org.depend.enabled|readyState|autoPromote|showIndicators|hideBlockedInAgenda`. Documented in [`docs/03.5-task-dependencies.org`](docs/03.5-task-dependencies.org).
- **Project management** - `#+BEGIN: project-table` and `#+BEGIN: gantt` dynamic blocks build a task table and a Mermaid Gantt chart from `SCHEDULED`/`DEADLINE`/`EFFORT`/priority/`:DEPENDS:`/`:ASSIGNEE:` (dependency `after`-chaining, effort durations, milestones, per-assignee/parent swimlanes). People are `:person:` headings: `:ASSIGNEE:` autocompletes from them (with hover), and **New Person** captures one. A **task dependency graph** webview colors tasks ready/blocked/done. New commands `scimax.org.insertProjectTable`, `insertGantt`, `showTaskGraph`, `newPerson`, and setting `scimax.org.peopleFile`. Example project under [`examples/project-management/`](examples/project-management/). Documented in [`docs/03.6-project-management.org`](docs/03.6-project-management.org).
- **Entity selector (org as a contact/location manager)** - `scimax.org.pickEntity` fuzzy-picks a heading by tag or property and acts on it: insert an `[[id:…][Title]]` link, insert/copy a field (email, address, …), Email (mailto), Open in Maps, Open link (URL), or jump. Entity types are pure configuration (`scimax.org.entities`) — add Contacts, Locations, Reagents, Resources with no code; Contacts (`:person:`) and Locations (`:location:`) ship as defaults. An ad-hoc "By tag…/By property…" path selects any tag/property with zero setup. Documented in [`docs/03.7-contacts-and-locations.org`](docs/03.7-contacts-and-locations.org).
- **Granular addressing** - Anchors (`<<target>>`, `<<<radio>>>`, `#+NAME`) are indexed as addressable, cross-file link targets; object-level **back-links** surface via Find All References and a "← N references" CodeLens; orphan-link diagnostics flag internal links whose target was deleted (#46).
- **Dialog notes** - Capture decisions, questions, and comments as footnotes that are excluded from exports by default (#45).
- **CLI `tangle`** for extracting source blocks, plus multi-line emphasis, Lean syntax highlighting, and Tab-to-fold on source blocks.
- **Emacs-style `C-l`** recenter-top-bottom command, an **"Open in New Window"** editor command, and macOS commands to insert the current **Finder selection** or **Chrome tab** as an org link.
- **Set Property with fuzzy completion** - The Set Property command (speed key `P`, now also bound to `C-c x p`) fuzzy-matches existing property names and values — gathered from the current file and the index — while still allowing new ones, and works from anywhere in an entry (not only on the heading line).
- **Assign Task to Person** (`scimax.org.assignTask`) - A multi-select quick pick over the indexed `:person:` headings, fuzzy-matching on handle, name, role, or email, sets the enclosing entry's `:ASSIGNEE:` property. Existing assignees (from the property or `@tags`) are pre-selected, and clearing the selection unassigns.
- **Datetree capture granularity** - `scimax.capture.datetreeFormat` now works (previously registered but ignored). `file+datetree` capture targets can file entries by `day` (year → month → day), `week` (year → ISO week), or `month` (year → month). Week mode uses the ISO week-numbering year so early-January dates group under the correct year.

### Changed

- **Browse Indexed Files** lists files most-recently-edited first and preserves that order while you narrow the list.
- Custom exporters honor **`#+EXPORT_FILE_NAME`**.

### Fixed

- **`#+LATEX_CLASS: <exporter-id>` no longer fails with "File `<id>.cls' not found"** - A class naming a loaded custom exporter now routes to it even without an entry in `scimax.export.latexClassExporters`; there is no such `.cls` file, the exporter's own template supplies `\documentclass`. Map the class to `none` to force the built-in backend. Inserted headers use `#+EXPORTER: <id>`, which needs no configuration.
- **A custom exporter that fails to load no longer vanishes silently** (#56) - An invalid `manifest.json` was reported only as a `console.warn` nobody sees, so the exporter simply never appeared and the picker said "No custom exporters found". Load problems are now collected, logged, surfaced on reload, and listed by `scimax.export.showExporterProblems`; the "none found" message also lists the directories that were searched. Manifest errors name the file and the JSON complaint, a missing template says which file it looked for, and a `manifest.json` with comments or trailing commas (the usual hand-written mistake) is read with a warning instead of being rejected.

- **Citations written as org links (`[[cite:&key]]`) round-trip with Emacs** (#55) - Such a citation was parsed as an org-cite citation whose key was `&key`, so editing it (append a key, sort, transpose) rewrote it to `[cite:@&key]` and broke the link. It is now recognized as an org-ref citation, keeping its brackets and any link description. Bracketed `citep:`/`citet:`/`ref:`/`doi:` links also export correctly instead of degrading to a cross-reference, and clicking one opens the bibliography entry.
- **Appending to a plain `cite:&key` no longer eats the following text** - The pattern used by Insert Citation allowed spaces inside the key list, so `cite:&smith-2020 and more words here.` matched through `here` and adding a second key replaced the whole span. A plain citation now ends at the first space, as org itself parses it; notes with spaces belong in the bracketed form.
- **org-cite insertion uses org-cite style names** - `citet`/`citep`/`citeauthor`/`citeyear` were written as `[cite/citet:@key]`; they are now `[cite/t:@key]`, `[cite/p:…]`, `[cite/a:…]`, `[cite/y:…]`.

- **Editor responsiveness in org files** - Several fixes so editing and cycling TODO states in large files stay snappy: the assignee completion provider no longer registers space/colon as global trigger characters (removing per-keystroke completion work); the dependency tree view rebuilds only when visible and debounced; the save-triggered re-index queues embeddings for the background worker instead of generating them synchronously (a save no longer blocks on embedding the whole file); the blocked/ready CodeLens skips its per-heading whole-document scan when a file has no `:DEPENDS:`/`:ORDERED:` markup; dependency triggers run in the background; and people lookups are cached.
- **Add Dependency** now offers the current file's headings from the live buffer (not only the saved index), so unsaved/just-edited headings appear.
- **LaTeX export hardening** - Adversarial-input hardening plus fixes for longtable pagination, Unicode in code blocks, cross-references, inline math split across lines, table cells containing pipes inside math, and links/captions/tables/emphasis/blocks; non-ASCII characters are translated to LaTeX.
- Back-links CodeLens no longer renders a "no commands" placeholder on zero-reference headings; `~`/`=` inline markers no longer run past their span in highlighting; interior slashes are allowed in italic emphasis; the find-file path-traversal check is hardened; macOS Screen Recording permission errors from screenshot capture are surfaced.
- **Following a doc link no longer hides the target line** - `#+STARTUP: overview`/`fold`/`content` folding is applied ~100 ms after a file opens, which was collapsing the line you had just jumped to (via a `file:line` link, go-to-definition, or a search result) back out of view. Startup folding now unfolds around the caret and re-centers it when the file was opened at a specific position, matching Emacs where startup folding never hides point. It also no longer folds a different editor if you switch tabs during that delay.
- **Faster org tab switching** - Switching between large org files no longer stalls. The back-links CodeLens stopped clearing its cache (and re-running one database query per heading) on every editor activation — it now refreshes only on save, when reference counts can actually change — and the orphan-link and dependency diagnostics skip their rescan (including workspace-wide cycle detection) when the document text is unchanged since the last scan, coalescing rapid tab cycling through their existing debounce.
- **Stale Jupyter kernels no longer hang execution** - kernelspecs whose interpreter no longer exists (typically a registered venv kernel whose venv was deleted) are now skipped during kernel selection for a language. Starting a kernel whose process dies at launch now fails fast instead of reporting success and leaving `execute` waiting forever on a socket nobody answers, and a kernel that dies mid-execution rejects in-flight requests instead of leaving them pending.
- **Emphasis markers in technical notation no longer run away** - an unclosed emphasis opener (`*`, `/`, `_`, `+`) now styles at most the rest of its own line instead of everything up to the next blank line, and signed or plus-minus notation like `(+0.56)`, `(+-1)`, and `(+/-0.5)` no longer opens a strikethrough span. Closed spans, including hard-wrapped multi-line ones, highlight as before.
- **Configure Agenda Files no longer errors** (#47) - `Scimax: Configure Agenda Files` wrote to `scimax.agenda.files`, a setting that was unregistered when the agenda became a database view, so every add failed with "not a registered configuration". The command now appends the selected directories/files to `scimax.db.include` (the setting that actually drives the agenda) and triggers an incremental database refresh so items appear immediately. Single-file entries in `scimax.db.include` are now indexed too (previously only directories worked). Dynamic blocks with agenda scope (`clocktable :scope agenda`, `columnview :id agenda`) read the indexed file list from the database instead of the dead setting, and a leftover `scimax.agenda.files` value in settings.json now triggers the deprecated-settings toast pointing at `scimax.db.include`.
- **Broken command invocations** (repo correctness audit, same failure class as #47) - Several code paths invoked commands that were never registered, so the actions failed with "command not found": *Clear All Results* from scimax-ob delegated to a nonexistent `scimax.babel.clearResults` (now uses `scimax.org.clearAllResults`); following a `cite:`/`citep:`/`citet:` link at point invoked a nonexistent `scimax.citation.action` (now parses the keys and jumps to the entry via `scimax.ref.gotoCitation`); *Open in Dired* from the find-file panel invoked a nonexistent `scimax.dired` (now `scimax.dired.open`, which accepts an optional directory argument and skips the folder picker when given one); the post-screenshot inline-image refresh invoked a nonexistent `scimax.org.refreshInlineImages` (now `scimax.imageOverlays.refresh`, silently).
- **Phantom command-palette entries** - `Scimax: Insert Code Block`, `Scimax: Go to Next/Previous Code Block` were declared in package.json but never implemented, so picking them errored. Removed in favor of the real `scimax.ob.insertBlockAbove/Below`, `scimax.ob.nextBlock`, `scimax.ob.previousBlock` entries. `Scimax: Refresh Journal View` (`scimax.journal.refresh`) is now actually registered and refreshes the journal calendar.
- **Settings that existed in code but not in the Settings UI** - `scimax.capture.defaultDirectory`, `scimax.capture.showPreview`, `scimax.capture.openAfterCapture`, and `scimax.db.dirsPerSession` were read by the extension but never registered, so they were invisible in the Settings UI and flagged as unknown in settings.json. All four are now registered.
- **Settings that existed in the Settings UI but did nothing** - `scimax.db.maxFileSizeMB`, `scimax.db.maxParseSizeKB`, and `scimax.db.maxFileLines` were honored by the CLI but silently ignored by the extension (hardcoded defaults); they now flow into the indexer. `scimax.dired.defaultSort` and `scimax.dired.showHidden` now set the initial dired state. `scimax.manuscript.autoCompile` (always/if-needed/never/ask) now controls the compile-before-flatten prompt. The never-implemented `scimax.capture.autoSave` and `scimax.ref.autoDownloadPdf` config fields were removed.
- **Datetree captures never created their date headings** - a `file+datetree` capture into a file missing the `year`/`month`/`day` headings computed the scaffold but discarded it (nothing carried it to the writer), leaving an orphaned entry. The scaffold is now inserted, so the date tree is created as needed.
- **Zotero LaTeX citations honor the citation style setting** - inserting a citation in a LaTeX buffer read a nonexistent `scimax.ref.latexCiteStyle` setting and always fell back to `\cite`; it now uses `scimax.ref.defaultCiteStyle`.
- **Relative capture template paths resolved against a file** - when `scimax.capture.defaultDirectory` was unset, a relative `file:` in a capture template was joined onto the default capture *file* path (e.g. `~/scimax/notes.org/inbox.org`); it now resolves against that file's directory.
- **Invalid `scimax.dired.defaultSort` values** - a stale or misspelled value (e.g. `"date"`) is now validated against the allowed sort fields and falls back to `name` instead of being stored as an invalid sort state.

### Security

- **handlebars 4.7.8 → 4.7.9** - Clears the critical prototype-pollution / AST-type-confusion advisories affecting the custom-export template engine.

### Internal

- **Deflaked the test suite under parallel runs** - the parser benchmarks now measure CPU time instead of wall-clock time (parallel test files oversubscribe the CPU and inflated wall time past the 1.25x baseline tolerance), accumulating CPU time across repeated executions up to a fixed floor so platforms with a coarse CPU-usage clock (Windows, ~15.6 ms) no longer round a sub-millisecond parse down to zero (which had failed the Windows CI with `expected 0 to be greater than 0` and an `Infinity` scaling ratio). The Jupyter suite gets a 15s per-test timeout because most of its tests shell out to the multi-second `jupyter` CLI.
- **Regression tests for the correctness-audit fixes** - Added a manifest-consistency test suite (`src/__tests__/manifestConsistency.test.ts`) that fails the build if any invoked command is unregistered, any declared command is unimplemented, any setting read is undeclared, any registered setting is unused and not deprecated, or any `when`-clause context is undefined — preventing regressions of the whole #47 class. Added focused unit tests for the database size limits, cite-key parsing, capture path resolution, Zotero citation formatting, dired config seeding, manuscript compile-option resolution, and journal calendar refresh. To make the fixes testable, `extractCiteKeysFromPath` and `resolveCompileOption` were extracted as pure helpers.

## [0.5.1] - 2026-05-10

### Added

- **Beamer export backend** - New `scimax.org.exportBeamer`, `exportBeamerPdf`, and `exportBeamerOpen` commands generate LaTeX Beamer presentations from org files. Supports themes, color/font/inner/outer themes, columns, overlays (`\pause`, action specifications), notes, `\alert{}` for bold, aspect ratios, multi-line `#+BEAMER_HEADER` preamble, and tag/property frame configuration. Doc-level `#+OPTIONS: H:N` overrides the configured frame level. CLI: `scimax export <file> --format beamer|beamer-pdf`. New settings under `scimax.export.beamer.*` and demo at `examples/templates/org/beamer-demo.org`. Documented in [`docs/41-export-beamer.org`](docs/41-export-beamer.org).
- **Beamer aux-file cleanup** - Beamer-specific artifacts (`.nav`, `.snm`, `.vrb`, per-frame `*.<N>.vrb`) are removed after PDF compilation in CLI, manuscript compiler, and VS Code Beamer-PDF paths.
- **Per-level heading colors and tinted background bars** - Org headings now expose `orgHeading1`...`orgHeading6` semantic tokens with matching `scimax.heading1Background`...`scimax.heading6Background` workbench colors, plus a new `scimax.highlighting.headingBackgroundBars` setting (default `true`) that draws a whole-line tint behind each heading, fading at deeper levels.

### Changed

- **CLI database commands consolidated** - `scimax db sync` is the single daily-driver subcommand: it discovers, refreshes, and prunes in one pass over `scimax.db.include` ∪ journal ∪ `agenda.include` ∪ NotebookManager projects. `scimax db clear` wipes the index. The legacy `db reindex` and `db rebuild` subcommands print a migration message and exit. The VS Code command palette entry "Reindex Files" is renamed to **Sync Files**.

### Fixed

- **Speed commands not activating until cursor moves** (#44) - Context keys (`scimax.atHeadingStart`, `atSrcBlockStart`, `atLatexSectionStart`, `atLatexEnvironmentStart`) now refresh on activation, tab switches, and same-line edits — not only on selection-change. Opening an org file with the cursor already on a heading and pressing a speed key now works immediately.
- **Export parser: chained markup and multi-line math** - Three related fixes to the fast export parser. Emphasis border characters widen `PRE`/`POST` so chained markup like `=foo=/=bar=/=baz=` parses each span individually. Verbatim/code wins when an emphasis match strictly contains it. Display and inline math (`\[...\]`, `\(...\)`) switch to lazy matching so content may span newlines and contain bracketed groups like `\\[2pt]` or `\(E(\mathbf{x}_i)\)`. Paragraph-break rules are suspended while `\[...\]` is open.

### Infrastructure

- **Restored `registerCommandMarkupDecorations`** in `extension.ts` that had been dropped during a Dropbox/git resolution.
- **`.gitignore`** - Beamer demo build artifacts (`examples/templates/org/beamer-demo.{tex,pdf}`) are now ignored, matching the existing pattern for `test-features.*` and `tasks.*`.

## [0.5.0] - 2026-05-03

### Added

- **Custom TODO workflows** - Support multiple pipes (e.g. `TODO IN-PROGRESS | DONE CANCELLED`) and assign semantic colors per state, matching org-mode's full TODO grammar
- **"Exclude from Agenda" tab context action** - Right-click an editor tab to hide a file from the agenda view (still indexed for search)
- **Hover for Emacs-style command markup** - `~scimax.foo~`, `=scimax.foo=`, and similar markup now show command details on hover; markup colors are theme-independent (#43)
- **Full org-cite style/variant grammar in LaTeX export** - `[cite/style/variant: ...]` parses every documented org-cite style and variant combination and emits the right `\citestyle` (#42)
- **Stale-index activation prompt** - New setting `scimax.db.checkStaleOnActivation` (default `true`) checks on startup whether any indexed files changed on disk and offers a one-shot Refresh. Useful for catching Dropbox-synced edits made while VS Code was closed.
- **CLI `scimax export --exporter` flag** - Pass through to the custom-exporter pipeline so user-defined exporters work from the terminal
- **CLI `scimax project` management flags** - `--remove <path>`, `--cleanup` (drop projects whose paths no longer exist), and `--scan <dir>` (discover git/projectile projects under a directory)

### Changed

- **Sub/superscript default is now braces-only** - `H_2O` no longer renders the `2` as a subscript; you must write `H_{2}O`. Honors `#+OPTIONS: ^:{}` for parity with Emacs org-mode. Set `#+OPTIONS: ^:t` to restore the old behavior per file.
- **Database reindex renamed to refresh** - Command palette entry is now *Refresh Database (incremental)* (`scimax.db.refresh`); `scimax.db.reindex` stays registered as an alias so existing keybindings keep working
- **Agenda is now a pure view over the database** - Removed the duplicate file-scan path; agenda always reflects what's indexed. `rebuild` and `refresh` share one directory-collection helper that reads `scimax.db.*` exclusively.
- **Database agenda/todo/deadline commands collapsed to aliases** - `scimax.db.agenda`, `scimax.db.showTodos`, and `scimax.db.deadlines` now delegate to the corresponding `scimax.agenda.*` commands; one implementation, consistent behavior regardless of entry point
- **Word Count is org-aware and Unicode-friendly** - Strips org markup, handles non-ASCII text correctly; works on any buffer with selection-aware counting
- **org-ref hover and citation parsing** - Improved tooltip content and tolerance for pre/post notes, multi-key citations, and odd whitespace

### Fixed

- **Currency `$` no longer triggers math mode** - Sentences like "It cost $5 then $10" no longer render as a stray inline equation; LaTeX export polish for the same edge cases
- **Emphasis whitespace at boundaries** - TextMate grammar fix: `*bold *` and similar boundary cases now follow org-mode's rules
- **Equation regex** - Fixed a regexp that mis-handled certain equation patterns
- **Agenda after db clear/rebuild** - Agenda now refreshes automatically after the database is cleared or rebuilt, and recovers cleanly when the database initializes after activation

## [0.4.0] - 2026-04-14

### Added

#### Features
- **Markdown export with Pandoc** - Export markdown files to HTML, LaTeX, PDF, and DOCX via a new `scimax.markdown.export*` command family with an interactive export menu
- **Terminal navigation with CLI hyperlinks** - Open files produced by `scimax` CLI output directly from the integrated terminal
- **Fuzzy search for recent files** (`C-x b`) - Quick pick over recently modified org/md files tracked in the scimax database, ordered by mtime with relative-time labels. Replaces the built-in `quickOpenPreviousRecentlyUsedEditor` on `C-x b`
- **DWIM comment toggle** (`Alt-;`) - Emacs-style `comment-dwim`: toggles `# ` prefix on the current line, or adds/removes it across a selection based on whether all lines are already commented
- **Selection-aware word count** - `scimax.latex.wordCount` now works on any buffer, counts the current selection when one is active, and only strips LaTeX commands in LaTeX files
- **Agenda refresh status bar notification** - Brief status bar message when the agenda finishes refreshing

#### CLI
- `scimax journal` - Open, create, and navigate journal entries from the command line
- `scimax project` - Fuzzy-pick and switch projects from the command line

### Changed

- **LaTeX export**: restored the Emacs org-mode default package list (inputenc, fontenc, geometry, graphicx, longtable, wrapfig, rotating, ulem, amsmath, amssymb, capt-of, hyperref, booktabs, minted) with dedup guards against user-supplied preamble content
- `scimax.export.latex.defaultPreamble` default now loads `natbib` with `[numbers,super]` options plus `natmove`, and drops `hyperref` (emitted automatically by the backend)
- LaTeX compilation via `latexmk` now passes `-f` to continue past non-fatal errors
- LaTeX export: entities like `α`, `→`, and `\pm` now render in math mode where appropriate; improved table handling and image height support
- **Org-mode syntax reference** shipped with the scimax skill (v0.6.0) so Claude Code can answer org syntax and citation questions without web lookups

### Fixed

- **CLI LaTeX export** was producing `.tex` files without the default package list because the CLI never passed `preamble` to `exportToLatex`. VS Code export and `scimax export --format latex` now match
- **DOCX export**: relative bibliography paths are now resolved against the document's directory instead of the invoker's CWD, so DOCX export from subfolders or the CLI finds `refs.bib`
- **Agenda scanning**: stray `.org` backups under `~/Library/Application Support`, `~/Library/Caches`, `~/.Trash`, `~/AppData`, `~/.cache`, and `~/.emacs.d/{elpa,straight}` no longer leak into agenda views
- **Clock operations** no longer throw when a previously clocked-in file has been deleted
- **Clocking**: `LOGBOOK` drawer placement when clocking in on the final heading at end-of-file
- **Citation keys** may now contain `.`, `/`, and `+` (e.g., `doi:10.1021/ja.5b00123`)
- **Markup export**: removed the 500-character length cap on inline bold/italic/code/verbatim patterns that was silently dropping long spans
- **`org-store-link`** persistence and heading return behavior improvements
- **DWIM return on heading lines**: pressing Enter at column 0 of a heading like `* test` was routed through the list-item handler (the list regex matched `*` bullets at column 0) and fell through to VS Code's default Enter, whose `increaseIndentPattern` then indented the heading to `    * test`. Headings are now checked first, `*` bullets require leading whitespace in both the language configuration and DWIM regexes, and heading return bails out when the cursor is at column 0 so a plain newline inserts above the heading
- **Move-subtree trailing newline**: `scimax.org.moveSubtreeUp` / `moveSubtreeDown` used `Range(endLine + 1, 0)` to slice the subtree, which VS Code silently clamps to end-of-line when the final line has no trailing newline. The separator was dropped and output came out mashed like `* test3* test`. Switched to line-array collection joined with newlines
- **Inline `\s+` regex** in the PDF viewer webview template (`pdfViewerPanel.ts:1418`) was being clobbered to `/s+/` at runtime by an unnecessary backslash escape. Masked as a lint nit until the ESLint burn-down uncovered it

### Infrastructure

- **Release automation** - New `.github/workflows/publish.yml` fires on GitHub release, guards `package.json` version against the release tag, runs tests, publishes to the VS Code Marketplace via `vsce`, and attaches the VSIX as a release asset. Requires `VSCE_PAT` repo secret
- **`RELEASING.md`** checklist and release process documentation at the repo root, with a clean-working-tree check and a `[Unreleased]`-not-empty check added during finalization
- Database layer refactored so the CLI reuses `ScimaxDbCore` directly, sharing logic with the VS Code extension
- **ESLint errors down to zero** (122 fixed: `no-useless-escape`, `no-var-requires`, `ban-ts-comment`, `no-constant-condition`, `no-shadow-restricted-names`, `prefer-const`, `no-empty`, `no-control-regex`). 872 warnings remain as accepted policy debt (`no-explicit-any`, `no-unused-vars`). Enables a local pre-commit lint hook with no grandfathered debt
- **Makefile VSIX name** now derived from `package.json` version (was pinned to `0.3.1`), and `code --install-extension` passes `--force` so rebuilds over the same version actually replace the installed extension
- **`.vscodeignore` / `.gitignore`** now exclude root-level personal working files (`why-org-mode.*`, `archive/`) so they cannot leak into packaged VSIX builds
- **Lockfile sync**: `package-lock.json` was bumped to match `package.json` 0.4.0 so `npm ci` succeeds in CI and the publish workflow

## [0.3.1] - 2026-02-14

### Fixed

- **LaTeX export: duplicate packages** - Hardcoded "essential packages" (inputenc, fontenc, graphicx, hyperref, natbib) were duplicating packages from the `defaultPreamble` setting. All default packages now come solely from the user-configurable `scimax.export.latex.defaultPreamble` setting.
- **LaTeX export: org-ref v3 citations** - `cite:&key` was exporting as `\cite{&key}` instead of `\cite{key}`. Now correctly strips `&` prefixes and converts `;` separators to `,` for all citation commands.
- **LaTeX export: `bibliographystyle:` links** - `bibliographystyle:unsrtnat` was passing through as plain text. Now recognized by both parsers and correctly exports as `\bibliographystyle{unsrtnat}`.
- **Rectangle mark mode operation switching** - Invoking a different rectangle command while in mark mode (e.g., copy while in open mode) now executes the new operation instead of the old one
- **Rectangle mark mode immediate execution** - Rectangle commands execute immediately when invoked during mark mode, no double-Enter needed

### Added

- **Rectangle kill/copy to system clipboard** - Kill (`C-x r k`) and copy (`C-x r M-w`) now write rectangle contents to the system clipboard in addition to the internal rectangle register

### Changed

- `scimax.export.latex.defaultPreamble` default now includes `fontenc`, `hyperref`, and `natbib`

## [0.3.0] - 2026-02-04

### Added

#### Core Features
- **Link graph visualization** - Interactive graph view showing connections between org files
- **Plugin extension architecture** - Extensible system for Babel executors, export hooks, and block extensions
- **Calendar date picker** - Visual calendar for inserting deadlines and scheduling timestamps
- **Dired file manager** - Full Emacs-style file manager with standard keybindings
- **Find-file command** (C-x C-f) - Quick file navigation with create-new-file option
- **Space-separated fuzzy matching** in project picker for better file discovery

#### Export System
- **Custom exporter system** with Handlebars template support
- **Jupyter Notebook (ipynb) export** - Convert org files to Jupyter notebooks
- **DOCX export** via Pandoc integration
- **LaTeX manuscript flattening** for journal submission (single-file output)
- **Document template system** for consistent document creation

#### Reference Management
- **Zotero citation support** - Integration with Zotero library
- **CrossRef search command** - Search and insert citations from CrossRef
- **SOTA search** with query expansion and reranking for literature discovery

#### Integrations
- **Excalidraw integration** - Embed and edit Excalidraw diagrams
- **Database extension points** for knowledge graph applications

#### CLI
- `scimax db scan` - Batch scan and index directories
- `scimax db publish` - Publish org projects to static sites
- `scimax agenda` - View agenda from command line
- `scimax export` - Export files from command line

### Fixed

#### Security
- Parser crash vulnerabilities from malformed input (heading recursion, unclosed blocks)
- XSS vulnerabilities in HTML export (proper content escaping)
- Command injection in PDF export (removed shell: true)
- Predictable temp file names (now using crypto.randomBytes)

#### Stability
- Memory leaks and OOM crashes during large file indexing
- Database locking issues with concurrent access
- Windows path handling in multiple modules

#### Parser
- Heading extraction edge cases
- Source block detection with unusual delimiters
- Table formula evaluation errors
- Link parsing with special characters

### Changed

- Unified navigation keybindings across org/markdown/LaTeX modes
- Improved table formula system with better error messages
- Centralized logging system with module-specific loggers
- Database operations now use retry logic for transient failures
- Better error handling throughout with detailed logging

### Deprecated

- None

### Removed

- None

### Security

- API keys now stored in OS credential manager via SecretStorage
- LaTeX compilation uses `-shell-restricted` by default
- Parser has built-in limits to prevent DoS from malformed input
- SQL queries use parameterized statements throughout

## [0.2.0] - Previous Release

Initial tracked release with core org-mode features, Babel execution, journal system, and database-backed search.
