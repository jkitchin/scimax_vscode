# Scimax for VS Code

A scientific computing environment for VS Code inspired by [Scimax](https://github.com/jkitchin/scimax), the Emacs-based starter kit for scientists and engineers.

## Features

### Journal System (scimax-journal)

A date-organized journaling system for daily notes, research logs, and documentation.

**Commands:**
| Command | Keybinding | Description |
|---------|------------|-------------|
| `Scimax: Open Today's Journal` | `Ctrl+Shift+J` / `Cmd+Shift+J` | Open or create today's journal entry |
| `Scimax: New Journal Entry` | - | Create a new journal entry for a specific date |
| `Scimax: Previous Journal Entry` | `Alt+[` | Navigate to previous journal entry |
| `Scimax: Next Journal Entry` | `Alt+]` | Navigate to next journal entry |
| `Scimax: Go to Journal Date` | - | Jump to a specific date's journal |
| `Scimax: Search Journal` | - | Full-text search across all journal entries |
| `Scimax: Show Journal Calendar` | - | Open the calendar webview |
| `Scimax: This Week's Entries` | - | Show journal entries from the current week |
| `Scimax: Quick Log Entry` | - | Quick append a timestamped log entry |
| `Scimax: Insert Timestamp` | - | Insert current timestamp at cursor |
| `Scimax: Show Journal Statistics` | - | Display word count, streaks, task completion |

**Templates:** Choose from `default`, `minimal`, `research`, `meeting`, or `standup` templates.

**Configuration:**
```json
{
  "scimax.journal.directory": "~/scimax-journal",
  "scimax.journal.format": "markdown",
  "scimax.journal.template": "default",
  "scimax.journal.dateFormat": "YYYY-MM-DD",
  "scimax.journal.autoTimestamp": true,
  "scimax.journal.weekStartsOn": "monday"
}
```

---

### Bibliography & Citations (org-ref)

Full bibliography management with BibTeX support, DOI fetching, and citation insertion.

**Commands:**
| Command | Keybinding | Description |
|---------|------------|-------------|
| `Scimax: Insert Citation` | `Ctrl+]` / `Cmd+]` | Insert a citation at cursor |
| `Scimax: Fetch BibTeX from DOI` | - | Fetch bibliography entry from DOI |
| `Scimax: Search References` | - | Search all bibliography entries |
| `Scimax: Open Bibliography` | - | Open a .bib file |
| `Scimax: Find Citations of Reference` | - | Find all citations of a reference |
| `Scimax: Copy BibTeX Entry` | - | Copy BibTeX to clipboard |

**Features:**
- **Hover preview**: Hover over citations to see reference details
- **Autocomplete**: Type `cite:` or `@` for citation suggestions
- **Go to definition**: Jump from citation to bibliography entry
- **Code lens**: In .bib files, see citations count and quick actions
- **Citation styles**: cite, citet, citep, citeauthor, citeyear

**Configuration:**
```json
{
  "scimax.ref.bibliographyFiles": ["~/bibliography.bib"],
  "scimax.ref.pdfDirectory": "~/papers",
  "scimax.ref.notesDirectory": "~/notes",
  "scimax.ref.defaultCiteStyle": "cite"
}
```

---

### File Database (org-db-v3)

SQLite database powered by [libsql](https://github.com/tursodatabase/libsql) with **FTS5 full-text search** and **vector semantic search**.

**Commands:**
| Command | Description |
|---------|-------------|
| `Scimax: Reindex Files` | Reindex all files in workspace |
| `Scimax: Search All Files` | Full-text search with BM25 ranking |
| `Scimax: Semantic Search (AI)` | Find by meaning using embeddings |
| `Scimax: Hybrid Search` | Combined keyword + semantic search |
| `Scimax: Search Headings` | Search document headings |
| `Scimax: Search by Tag` | Filter headings by org-mode tags |
| `Scimax: Search by Property` | Search by property drawer values |
| `Scimax: Search Code Blocks` | Search source code blocks by language |
| `Scimax: Search by Hashtag` | Find files containing #hashtags |
| `Scimax: Show TODO Items` | List all TODO items |
| `Scimax: Show Agenda` | View deadlines and scheduled items |
| `Scimax: Show Upcoming Deadlines` | See deadlines in next 2 weeks |
| `Scimax: Browse Indexed Files` | Browse all indexed files |
| `Scimax: Set Search Scope` | Limit searches to directory/project |
| `Scimax: Configure Embedding Service` | Setup Ollama/OpenAI for semantic search |
| `Scimax: Show Database Stats` | Display indexing statistics |
| `Scimax: Optimize Database` | Clean up stale entries (VACUUM) |
| `Scimax: Clear Database` | Reset the database |

**Features:**
- **SQLite with FTS5**: Fast full-text search with BM25 ranking, scalable to 10k+ files
- **Vector Search**: Semantic search using embeddings (cosine similarity)
- **Hybrid Search**: Reciprocal rank fusion of keyword + semantic results
- **Auto-indexing**: Files are automatically indexed on save
- **Tag inheritance**: Inherited tags from parent headings
- **Agenda view**: Deadlines, scheduled items, and TODOs with overdue detection
- **Scoped search**: Limit searches to specific directories

**Embedding Providers for Semantic Search:**
| Provider | Model | Dimensions | Setup |
|----------|-------|------------|-------|
| **Ollama** (local) | nomic-embed-text | 768 | `ollama pull nomic-embed-text` |
| **Ollama** (local) | all-minilm | 384 | `ollama pull all-minilm` |
| **OpenAI** (cloud) | text-embedding-3-small | 1536 | Requires API key |

**Configuration:**
```json
{
  "scimax.db.directories": [],
  "scimax.db.ignorePatterns": ["**/node_modules/**", "**/.git/**"],
  "scimax.db.autoIndex": true,
  "scimax.db.embeddingProvider": "ollama",
  "scimax.db.ollamaUrl": "http://localhost:11434",
  "scimax.db.ollamaModel": "nomic-embed-text",
  "scimax.db.openaiApiKey": ""
}
```

---

### Notebooks (scimax-notebook)

Project-based organization for scientific research and software development.

**Commands:**
| Command | Description |
|---------|-------------|
| `Scimax: New Notebook` | Create a new notebook project |
| `Scimax: Open Notebook` | Switch to a different notebook |
| `Scimax: Open Notebook Master File` | Open README.org or main file |
| `Scimax: Recent Files in Notebook` | Browse recently modified files |
| `Scimax: Search in Notebook` | Scoped search within notebook |
| `Scimax: Notebook Agenda` | Show agenda for current notebook |
| `Scimax: Add Collaborator` | Add a team member to notebook |
| `Scimax: Archive Notebook` | Create git archive (zip) |
| `Scimax: Notebook Settings` | Edit .scimax/config.json |
| `Scimax: Index Notebook` | Reindex notebook files |
| `Scimax: Notebook Info` | Show notebook statistics |
| `Scimax: Remove Notebook from Tracking` | Untrack a notebook |

**Templates:**
- **empty**: Basic structure with README.org
- **research**: Scientific research with data/, figures/, scripts/, references.bib
- **software**: Software project with src/, tests/, docs/
- **notes**: Note-taking with journal/ directory

**Project Detection:**
Automatically detects projects via: `.projectile`, `.git`, `.scimax`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `.project`

**Configuration:**
```json
{
  "scimax.notebook.directory": "~/notebooks",
  "scimax.notebook.defaultTemplate": "research",
  "scimax.notebook.autoDetect": true
}
```

---

## Installation

### From VSIX

1. Download the `.vsix` file from releases
2. In VS Code, run `Extensions: Install from VSIX...`
3. Select the downloaded file

### From Source

```bash
git clone https://github.com/jkitchin/scimax_vscode.git
cd scimax_vscode
npm install
npm run compile
npm run package
```

Then install the generated `.vsix` file.

### Dependencies

- VS Code 1.85.0 or later
- Node.js 18+ (for development)

---

## Sidebar Views

The extension adds a **Scimax** activity bar icon with these views:

| View | Description |
|------|-------------|
| **Calendar** | Interactive calendar for journal navigation |
| **Journal Entries** | List of recent journal files |
| **Headings** | Document outline and headings |
| **Tags** | Browse files by tags |
| **References** | Bibliography entries by type |
| **Notebooks** | Project notebooks with files and collaborators |

---

## Keyboard Shortcuts

| Shortcut | Command | When |
|----------|---------|------|
| `Ctrl+Shift+J` / `Cmd+Shift+J` | Open Today's Journal | Always |
| `Alt+[` | Previous Journal Entry | In journal file |
| `Alt+]` | Next Journal Entry | In journal file |
| `Ctrl+Enter` / `Cmd+Enter` | Execute Code Block | In org/markdown |
| `Ctrl+]` / `Cmd+]` | Insert Citation | In org/markdown |

---

## File Formats

The extension supports:
- **Org-mode** (`.org`): Full parsing of headings, properties, tags, timestamps, source blocks, links
- **Markdown** (`.md`): Headings, code blocks, links, hashtags
- **BibTeX** (`.bib`): Bibliography entries with all standard fields

---

## Comparison with Emacs Scimax

| Feature | Emacs Scimax | VS Code Scimax |
|---------|--------------|----------------|
| Journal | scimax-journal | Full support |
| Bibliography | org-ref | Full support |
| Database | org-db-v3 | Full support with semantic search |
| Notebooks | scimax-notebook | Full support |
| Literate Programming | ob-ipython | Planned |
| Contacts | org-contacts | Not yet |

---

## Contributing

Contributions welcome! Please see the [GitHub repository](https://github.com/jkitchin/scimax_vscode).

## License

MIT License - see LICENSE file for details.

## Credits

Inspired by [Scimax](https://github.com/jkitchin/scimax) by John Kitchin.
