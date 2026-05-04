# Scimax Command Reference

Detailed command documentation for the scimax CLI. This file is loaded on demand by the scimax skill.

---

## Agenda & Task Management

Use agenda commands to help users understand their priorities, deadlines, and workload.

```bash
scimax agenda today                         # Items due or scheduled today
scimax agenda week                          # This week's agenda view
scimax agenda todos                         # All TODO items
scimax agenda todos --state NEXT            # Filter by TODO state
scimax agenda todos --state WAITING         # Filter by a specific state
scimax agenda overdue                       # Past-due scheduled/deadline items
```

**Guidance:**
- Always read the full output before summarizing — priorities and categories matter
- Help users reason about what to tackle first (urgency vs. importance)
- Suggest using `--state` to filter when there are many TODOs
- For overdue items, ask if the user wants help rescheduling or closing them
- Combine `agenda today` + `agenda overdue` for a complete daily review

---

## Search

Full-text search across all indexed org files.

```bash
scimax search "query"                        # Basic search
scimax search "query" --limit 20            # More results (default: 10)
scimax search "query" --format json         # Machine-readable output
scimax search "machine learning" --limit 5  # Find notes on a topic
```

**Guidance:**
- For programmatic use (e.g., to read matching files), use `--format json`
- After getting results, use the `Read` tool to open and inspect matching files
- Use `Grep` to find specific patterns within org files:
  ```bash
  # Find all TODO headings with a tag
  Grep: pattern="^\*+\s+TODO.*:research:", glob="**/*.org"
  ```
- Use `Glob` to discover org files before searching:
  ```bash
  Glob: pattern="**/*.org", path="~/org"
  ```

---

## Export

Convert org files to other formats.

```bash
scimax export paper.org --format html         # Export to HTML
scimax export paper.org --format latex        # Export to LaTeX
scimax export paper.org --format pdf          # Export to PDF (requires LaTeX)
scimax export slides.org --format beamer      # Export to Beamer .tex
scimax export slides.org --format beamer-pdf  # Compile Beamer slides to PDF
scimax export paper.org --format html --output ~/public/  # Custom output directory
```

**Guidance:**
- Check if the file exists first with `Glob` or `Read`
- For papers with citations, ensure a `.bib` file is present alongside the `.org` file
- PDF export requires a LaTeX installation; HTML is always available
- Use `--output` to control where the exported file lands

---

## Citations

Manage and validate bibliography citations in org files.

```bash
scimax cite extract paper.org               # List all citations used
scimax cite check paper.org                 # Check for missing/invalid citations
scimax cite check paper.org --bib refs.bib  # Check against a specific bib file
scimax cite convert paper.org --from v2 --to v3              # Convert citation syntax
scimax cite convert paper.org --from v2 --to v3 --inplace    # Modify file in-place
scimax cite list refs.bib                   # List all entries in a bib file
```

**Guidance:**
- Always run `cite check` before `cite convert` to understand what will change
- When `cite check` reports missing citations, offer to search for them via DOI or title
- `cite extract` gives you the citation keys in use — helpful for auditing
- After conversion with `--inplace`, verify with `Read` that the file looks correct
- If a `.bib` file isn't specified, scimax looks for one in the same directory

---

## Database Management

The scimax database indexes org files for fast search and agenda queries.

```bash
scimax db stats                             # Overview: file count, headings, TODOs
scimax db reindex                           # Refresh files that have changed (fast)
scimax db reindex --force                   # Force reindex all files
scimax db scan <dir>                        # Add a new directory to the index
scimax db rebuild                           # Full rebuild from scratch
scimax db rebuild --path <dir>              # Rebuild from a specific directory
scimax db check                             # Find stale/missing entries
```

**Guidance:**
- Start with `db stats` to understand the current state of the index
- Use `db reindex` for routine updates (checks mtime, skips unchanged files)
- Use `db scan` when adding a new folder of org files
- Use `db rebuild` only when the index is corrupted or starting fresh
- `db check` is useful for diagnosing why certain files aren't showing up in search

---

## Journal

Open or create journal entries from the CLI. Entries are created from a configurable template.

```bash
scimax journal                              # Open today's journal entry
scimax journal tomorrow                     # Open tomorrow's entry
scimax journal yesterday                    # Open yesterday's entry
scimax journal friday                       # Open next Friday's entry
scimax journal --date "next monday"         # Open next Monday's entry
scimax journal --date 2026-03-15            # Open a specific date
scimax journal --date +2d                   # Two days from now
scimax journal --date -1w                   # One week ago
scimax journal --json                       # Output entry info as JSON
```

**Supported date expressions:** today, tomorrow, yesterday, day names (monday, fri), next/this day (next friday, this monday), relative (+2d, -1w, +3m), month+day (jan 15), ISO dates (2026-03-15).

**Guidance:**
- The journal directory is configured via `scimax.journal.directory` in VS Code settings
- New entries are created automatically from the configured template
- The default template includes just `#+TITLE: DATE - WEEKDAY`
- Users can customize the template via `scimax.journal.customTemplate` setting
- The command opens the entry in VS Code automatically

---

## Project

Open known projects in VS Code with fuzzy selection.

```bash
scimax project                              # Fuzzy-select from all projects (uses fzf)
scimax project scimax                       # Pre-filter with a query
scimax project --list                       # List all known projects
scimax project --add ~/projects/new-proj    # Create and register a new project
scimax project --json                       # JSON output
```

**Guidance:**
- Projects are pulled fresh from the scimax database (registered when folders are opened in VS Code)
- Uses `fzf` for fuzzy selection when available, falls back to numbered list
- `--add` creates the directory if it doesn't exist and opens it in VS Code

---

## Publishing

Publish org-mode projects as static HTML sites.

```bash
scimax publish --list                       # List all configured projects
scimax publish                              # Publish the default project
scimax publish my-docs                      # Publish a specific project
scimax publish my-docs --dry-run            # Preview what would be published
scimax publish my-docs --force              # Force republish all files
scimax publish --init                       # Create a default publish config
scimax publish --init --yaml --name "docs" --base ~/org --output ~/public
```

**Guidance:**
- Use `--list` first to see what projects are configured
- Use `--dry-run` to verify output paths before committing
- Publishing config lives in `.scimax/publish.json` in the project root
- After publishing, check the output directory for the generated HTML

---

## Working with Org Files Directly

Combine CLI output with direct file reading for richer responses.

### Discover files
```
Glob: pattern="**/*.org", path="~/org"
Glob: pattern="**/*.org", path="~/Dropbox"
```

### Read file structure
```
Read: /path/to/notes.org
```

### Find headings, TODOs, tags
```
Grep: pattern="^\*+ TODO", glob="**/*.org"
Grep: pattern=":research:", glob="**/*.org"
Grep: pattern="DEADLINE:", glob="**/*.org"
```

### Find properties
```
Grep: pattern=":ID:\s+", glob="**/*.org"
Grep: pattern="^\#\+TITLE:", glob="**/*.org"
```

**Guidance:**
- Use CLI for aggregated/indexed queries (agenda, full-text search)
- Use `Read`/`Grep`/`Glob` for structural inspection of specific files
- Combine both: use `scimax search` to find candidates, then `Read` to show context

---

## Tips for Effective Use

1. **Daily review workflow:** Run `scimax agenda today` + `scimax agenda overdue` each morning
2. **Finding notes:** Use `scimax search` first, then `Read` the best match for context
3. **Before exporting:** Check citations with `scimax cite check`, then export
4. **After adding files:** Run `scimax db scan <new-dir>` to index them
5. **When search feels stale:** Run `scimax db reindex` to refresh

---

## About scimax-vscode

scimax-vscode is a VS Code extension inspired by Emacs Scimax, providing:
- Org-mode editing with syntax highlighting, folding, and navigation
- Source block execution (Python, Julia, R, JavaScript, SQL, Shell)
- Jupyter kernel integration
- Full-text and semantic search via SQLite FTS5
- Agenda views and task management
- LaTeX, HTML, and DOCX export
- Citation management (org-ref style)
- Journal and project management

The `scimax` CLI exposes these features for use from the terminal and from Claude Code.
