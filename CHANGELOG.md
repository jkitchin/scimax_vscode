# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-07-02

### Added

- **TODO task dependencies (simplified org-depend)** - A task declares what it depends on with a single `:DEPENDS:` property of `id:` links. Completing a task is **blocked** until every dependency is DONE (with a jump-to-blocker action), and completing a task **triggers** any dependent that becomes unblocked (notify + optional promote to a ready state). `:ORDERED: t` forces child tasks to be completed top-to-bottom. Cross-file, backed by a new `dependencies` index. Surfaced via a blocked/ready CodeLens, a **Dependencies** tree view, and dangling/cycle diagnostics. New commands `scimax.org.addDependency`, `scimax.org.gotoBlocker`, `scimax.org.showDependencies`, and settings `scimax.org.depend.enabled|readyState|autoPromote|showIndicators|hideBlockedInAgenda`. Documented in [`docs/03.5-task-dependencies.org`](docs/03.5-task-dependencies.org).
- **Project management** - `#+BEGIN: project-table` and `#+BEGIN: gantt` dynamic blocks build a task table and a Mermaid Gantt chart from `SCHEDULED`/`DEADLINE`/`EFFORT`/priority/`:DEPENDS:`/`:ASSIGNEE:` (dependency `after`-chaining, effort durations, milestones, per-assignee/parent swimlanes). People are `:person:` headings: `:ASSIGNEE:` autocompletes from them (with hover), and **New Person** captures one. A **task dependency graph** webview colors tasks ready/blocked/done. New commands `scimax.org.insertProjectTable`, `insertGantt`, `showTaskGraph`, `newPerson`, and setting `scimax.org.peopleFile`. Example project under [`examples/project-management/`](examples/project-management/). Documented in [`docs/03.6-project-management.org`](docs/03.6-project-management.org).
- **Entity selector (org as a contact/location manager)** - `scimax.org.pickEntity` fuzzy-picks a heading by tag or property and acts on it: insert an `[[id:…][Title]]` link, insert/copy a field (email, address, …), Email (mailto), Open in Maps, Open link (URL), or jump. Entity types are pure configuration (`scimax.org.entities`) — add Contacts, Locations, Reagents, Resources with no code; Contacts (`:person:`) and Locations (`:location:`) ship as defaults. An ad-hoc "By tag…/By property…" path selects any tag/property with zero setup. Documented in [`docs/03.7-contacts-and-locations.org`](docs/03.7-contacts-and-locations.org).
- **Granular addressing** - Anchors (`<<target>>`, `<<<radio>>>`, `#+NAME`) are indexed as addressable, cross-file link targets; object-level **back-links** surface via Find All References and a "← N references" CodeLens; orphan-link diagnostics flag internal links whose target was deleted (#46).
- **Dialog notes** - Capture decisions, questions, and comments as footnotes that are excluded from exports by default (#45).
- **CLI `tangle`** for extracting source blocks, plus multi-line emphasis, Lean syntax highlighting, and Tab-to-fold on source blocks.
- **Emacs-style `C-l`** recenter-top-bottom command, an **"Open in New Window"** editor command, and macOS commands to insert the current **Finder selection** or **Chrome tab** as an org link.

### Changed

- **Browse Indexed Files** lists files most-recently-edited first and preserves that order while you narrow the list.
- Custom exporters honor **`#+EXPORT_FILE_NAME`**.

### Fixed

- **Editor responsiveness in org files** - Removed a per-keystroke completion cost (the assignee provider no longer registers space/colon as global trigger characters) and per-cursor-move database work (the dependency tree view rebuilds only when visible and debounced). People lookups are cached.
- **Add Dependency** now offers the current file's headings from the live buffer (not only the saved index), so unsaved/just-edited headings appear.
- **LaTeX export hardening** - Adversarial-input hardening plus fixes for longtable pagination, Unicode in code blocks, cross-references, inline math split across lines, table cells containing pipes inside math, and links/captions/tables/emphasis/blocks; non-ASCII characters are translated to LaTeX.
- Back-links CodeLens no longer renders a "no commands" placeholder on zero-reference headings; `~`/`=` inline markers no longer run past their span in highlighting; interior slashes are allowed in italic emphasis; the find-file path-traversal check is hardened; macOS Screen Recording permission errors from screenshot capture are surfaced.

### Security

- **handlebars 4.7.8 → 4.7.9** - Clears the critical prototype-pollution / AST-type-confusion advisories affecting the custom-export template engine.

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
