# Scimax for VS Code

A scientific computing environment for VS Code inspired by [Scimax](https://github.com/jkitchin/scimax), the Emacs-based starter kit for scientists and engineers.

## Features

### Journal System (scimax-journal)

A date-organized journaling system for daily notes, research logs, and documentation.

**Commands:**
| Command                           | Keybinding                     | Description                                    |
| ---------                         | ------------                   | -------------                                  |
| `Scimax: Open Today's Journal`    | `Ctrl+Shift+J` / `Cmd+Shift+J` | Open or create today's journal entry           |
| `Scimax: New Journal Entry`       | -                              | Create a new journal entry for a specific date |
| `Scimax: Previous Journal Entry`  | `Alt+[`                        | Navigate to previous journal entry             |
| `Scimax: Next Journal Entry`      | `Alt+]`                        | Navigate to next journal entry                 |
| `Scimax: Go to Journal Date`      | -                              | Jump to a specific date's journal              |
| `Scimax: Search Journal`          | -                              | Full-text search across all journal entries    |
| `Scimax: Show Journal Calendar`   | -                              | Open the calendar webview                      |
| `Scimax: This Week's Entries`     | -                              | Show journal entries from the current week     |
| `Scimax: Quick Log Entry`         | -                              | Quick append a timestamped log entry           |
| `Scimax: Insert Timestamp`        | -                              | Insert current timestamp at cursor             |
| `Scimax: Show Journal Statistics` | -                              | Display word count, streaks, task completion   |

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
| Command                                  | Keybinding        | Description                                          |
| ---------                                | ------------      | -------------                                        |
| `Scimax: Insert Citation`                | `Ctrl+c ]`        | Insert a citation at cursor                          |
| `Scimax: Insert Reference Link`          | `Ctrl+u Ctrl+c ]` | Insert ref:/eqref:/pageref: link                     |
| `Scimax: Fetch BibTeX from DOI`          | -                 | Fetch bibliography entry from DOI                    |
| `Scimax: Search References`              | -                 | Search all bibliography entries                      |
| `Scimax: Open Bibliography`              | -                 | Open a .bib file                                     |
| `Scimax: Find Citations of Reference`    | -                 | Find all citations of a reference                    |
| `Scimax: Copy BibTeX Entry`              | -                 | Copy BibTeX to clipboard                             |
| `Scimax: Extract Bibliography from File` | -                 | Extract all cited references to a new .bib file      |
| `Scimax: Show Citing Works (OpenAlex)`   | -                 | Show papers that cite a DOI                          |
| `Scimax: Show Related Works (OpenAlex)`  | -                 | Show related papers for a DOI                        |
| `Scimax: Search OpenAlex`                | -                 | Search the OpenAlex academic database                |
| `Scimax: Transpose Citation Left`        | `Shift+Left`      | Swap citation with previous (when on citation)       |
| `Scimax: Transpose Citation Right`       | `Shift+Right`     | Swap citation with next (when on citation)           |
| `Scimax: Sort Citations Alphabetically`  | `Shift+Up`        | Sort citation keys alphabetically (when on citation) |
| `Scimax: Sort Citations by Year`         | `Shift+Down`      | Sort citation keys by year (when on citation)        |
| `Scimax: Delete Citation at Cursor`      | `Ctrl+Shift+K`    | Delete citation key at cursor (when on citation)     |

**Features:**
- **Hover preview**: Hover over citations to see reference details with source file
- **DOI tooltips**: Hover over DOIs to see metadata from CrossRef + OpenAlex (citation count, open access status, topics)
- **Autocomplete**: Type `cite:` or `@` for citation suggestions
- **Go to definition**: Jump from citation to bibliography entry
- **Code lens**: In .bib files, see citations count and quick actions
- **Citation styles**: cite, citet, citep, citeauthor, citeyear
- **OpenAlex integration**: View citation counts, open access links, citing works, related works
- **Citation manipulation**: Transpose, sort, and delete citations with keyboard shortcuts (like org-ref)

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

### Fuzzy Search (swiper-style)

Fast, interactive search for the current file and all open files, inspired by Emacs [swiper](https://github.com/abo-abo/swiper).

**Commands:**
| Command                               | Keybinding       | Description                                    |
| ---------                             | ------------     | -------------                                  |
| `Scimax: Fuzzy Search (Current File)` | `Ctrl+c s`       | Search lines in current file with live preview |
| `Scimax: Fuzzy Search (Open Files)`   | `Ctrl+c Shift+s` | Search across all open editor tabs             |
| `Scimax: Fuzzy Search (Outline)`      | `Ctrl+c Alt+s`   | Search headings/symbols in current file        |

**Features:**
- **Live preview**: Cursor moves to match as you type
- **Match highlighting**: Matches highlighted in the editor
- **Multi-file search**: Search all open tabs at once
- **Outline mode**: Jump to headings, functions, classes

---

### Jump Navigation (avy-style)

Quick navigation to visible text using labeled targets, inspired by Emacs [avy](https://github.com/abo-abo/avy).

**Commands:**
| Command                                | Keybinding   | Description                                        |
| ---------                              | ------------ | -------------                                      |
| `Scimax: Jump to Character`            | `Ctrl+c j c` | Jump to any occurrence of a character              |
| `Scimax: Jump to 2-Character Sequence` | `Ctrl+c j j` | Jump to a two-character sequence                   |
| `Scimax: Jump to Word`                 | `Ctrl+c j w` | Jump to word starts                                |
| `Scimax: Jump to Line`                 | `Ctrl+c j l` | Jump to any visible line                           |
| `Scimax: Jump to Symbol`               | `Ctrl+c j o` | Jump to symbols/headings in view                   |
| `Scimax: Jump to Subword`              | `Ctrl+c j s` | Jump to subword boundaries (camelCase, snake_case) |
| `Scimax: Jump Copy Line`               | -            | Select a visible line and copy it                  |
| `Scimax: Jump Kill Line`               | -            | Select a visible line and delete it                |

**Features:**
- **Label-based selection**: Type a label (a, s, d, f...) to instantly jump
- **QuickPick fallback**: Browse and filter targets in a list
- **Match highlighting**: All targets highlighted in the editor
- **Works everywhere**: Functions in any file type

---

### Edit Marks (Track Changes)

Collaborative editing markup for reviewing changes, inspired by scimax-editmarks.

**Commands:**
| Command                           | Keybinding   | Description                     |
| ---------                         | ------------ | -------------                   |
| `Scimax: Mark Insertion`          | `Ctrl+c e i` | Mark selected text as insertion |
| `Scimax: Mark Deletion`           | `Ctrl+c e d` | Mark selected text for deletion |
| `Scimax: Insert Edit Comment`     | `Ctrl+c e c` | Insert a review comment         |
| `Scimax: Mark Typo Correction`    | `Ctrl+c e t` | Mark typo with correction       |
| `Scimax: Accept Edit Mark`        | `Ctrl+c e a` | Accept the edit mark at cursor  |
| `Scimax: Reject Edit Mark`        | `Ctrl+c e r` | Reject the edit mark at cursor  |
| `Scimax: Accept All Edit Marks`   | -            | Accept all marks in document    |
| `Scimax: Reject All Edit Marks`   | -            | Reject all marks in document    |
| `Scimax: Next Edit Mark`          | `Ctrl+c e ]` | Navigate to next edit mark      |
| `Scimax: Previous Edit Mark`      | `Ctrl+c e [` | Navigate to previous edit mark  |
| `Scimax: Show Edit Marks Summary` | `Ctrl+c e s` | Show summary of all edit marks  |

**Markup Format:**
```
@@+inserted text+@@          # Insertion (green)
@@-deleted text-@@           # Deletion (red, strikethrough)
@@>comment text<@@           # Comment (yellow, italic)
@@~old text|new text~@@      # Typo correction (orange)
```

Also supports CriticMarkup format: `{++insert++}`, `{--delete--}`, `{>>comment<<}`, `{~~old~>new~~}`

---

### Project Management (projectile-style)

Quick project switching and file finding, inspired by Emacs [projectile](https://github.com/bbatsov/projectile).

**Commands:**
| Command                                 | Keybinding   | Description                   |
| ---------                               | ------------ | -------------                 |
| `Scimax: Switch Project`                | `Ctrl+c p p` | Switch to a known project     |
| `Scimax: Find File in Project`          | `Ctrl+c p f` | Find file in current project  |
| `Scimax: Search in Project`             | `Ctrl+c p s` | Search text in project files  |
| `Scimax: Open Project Root`             | `Ctrl+c p d` | Open project root directory   |
| `Scimax: Add Project`                   | `Ctrl+c p a` | Add a project to the list     |
| `Scimax: Remove Project`                | -            | Remove project from tracking  |
| `Scimax: Scan Directory for Projects`   | -            | Scan a directory for projects |
| `Scimax: Project Info`                  | -            | Show project statistics       |
| `Scimax: Cleanup Non-existent Projects` | -            | Remove deleted projects       |

**Project Detection:**
Automatically detects projects via: `.projectile`, `.git`, `.scimax`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `.project`

---

### File Database (org-db-v3)

SQLite database powered by [libsql](https://github.com/tursodatabase/libsql) with **FTS5 full-text search** and **vector semantic search**.

**Commands:**
| Command                               | Description                             |
| ---------                             | -------------                           |
| `Scimax: Reindex Files`               | Reindex all files in workspace          |
| `Scimax: Search All Files`            | Full-text search with BM25 ranking      |
| `Scimax: Semantic Search (AI)`        | Find by meaning using embeddings        |
| `Scimax: Hybrid Search`               | Combined keyword + semantic search      |
| `Scimax: Search Headings`             | Search document headings                |
| `Scimax: Search by Tag`               | Filter headings by org-mode tags        |
| `Scimax: Search by Property`          | Search by property drawer values        |
| `Scimax: Search Code Blocks`          | Search source code blocks by language   |
| `Scimax: Search by Hashtag`           | Find files containing #hashtags         |
| `Scimax: Show TODO Items`             | List all TODO items                     |
| `Scimax: Show Agenda`                 | View deadlines and scheduled items      |
| `Scimax: Show Upcoming Deadlines`     | See deadlines in next 2 weeks           |
| `Scimax: Browse Indexed Files`        | Browse all indexed files                |
| `Scimax: Set Search Scope`            | Limit searches to directory/project     |
| `Scimax: Configure Embedding Service` | Setup Ollama/OpenAI for semantic search |
| `Scimax: Show Database Stats`         | Display indexing statistics             |
| `Scimax: Optimize Database`           | Clean up stale entries (VACUUM)         |
| `Scimax: Clear Database`              | Reset the database                      |

**Features:**
- **SQLite with FTS5**: Fast full-text search with BM25 ranking, scalable to 10k+ files
- **Vector Search**: Semantic search using embeddings (cosine similarity)
- **Hybrid Search**: Reciprocal rank fusion of keyword + semantic results
- **Auto-indexing**: Files are automatically indexed on save
- **Tag inheritance**: Inherited tags from parent headings
- **Agenda view**: Deadlines, scheduled items, and TODOs with overdue detection
- **Scoped search**: Limit searches to specific directories

**Embedding Providers for Semantic Search:**
| Provider                   | Model                    | Dimensions | Setup                          |
| -------------------------- | ------------------------ | ---------- | ------------------------------ |
| **Local** (TransformersJs) | Xenova/all-MiniLM-L6-v2  | 384        | No setup, runs in Node.js      |
| **Local** (TransformersJs) | Xenova/all-mpnet-base-v2 | 768        | Config change                  |
| **Ollama** (local)         | nomic-embed-text         | 768        | `ollama pull nomic-embed-text` |
| **Ollama** (local)         | all-minilm               | 384        | `ollama pull all-minilm`       |
| **OpenAI** (cloud)         | text-embedding-3-small   | 1536       | Requires API key               |

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
| Command                                 | Description                      |
| ---------                               | -------------                    |
| `Scimax: New Notebook`                  | Create a new notebook project    |
| `Scimax: Open Notebook`                 | Switch to a different notebook   |
| `Scimax: Open Notebook Master File`     | Open README.org or main file     |
| `Scimax: Recent Files in Notebook`      | Browse recently modified files   |
| `Scimax: Search in Notebook`            | Scoped search within notebook    |
| `Scimax: Notebook Agenda`               | Show agenda for current notebook |
| `Scimax: Add Collaborator`              | Add a team member to notebook    |
| `Scimax: Archive Notebook`              | Create git archive (zip)         |
| `Scimax: Notebook Settings`             | Edit .scimax/config.json         |
| `Scimax: Index Notebook`                | Reindex notebook files           |
| `Scimax: Notebook Info`                 | Show notebook statistics         |
| `Scimax: Remove Notebook from Tracking` | Untrack a notebook               |

**Templates:**
- **empty**: Basic structure with README.org
- **research**: Scientific research with data/, figures/, scripts/, references.bib
- **software**: Software project with src/, tests/, docs/
- **notes**: Note-taking with journal/ directory

**Configuration:**
```json
{
  "scimax.notebook.directory": "~/notebooks",
  "scimax.notebook.defaultTemplate": "research",
  "scimax.notebook.autoDetect": true
}
```

---

### Org-Mode & Markdown Editing Features

Enhanced editing commands for org-mode, markdown, and LaTeX files.

**Timestamp Commands:**
| Command                         | Keybinding      | Description                |
| ---------                       | ------------    | -------------              |
| `Scimax: Insert Timestamp`      | `Ctrl+c .`      | Insert timestamp at cursor |
| `Scimax: Shift Timestamp Up`    | `Shift+Up`      | Increment date component   |
| `Scimax: Shift Timestamp Down`  | `Shift+Down`    | Decrement date component   |
| `Scimax: Shift Timestamp Left`  | `Shift+Left`    | Previous day               |
| `Scimax: Shift Timestamp Right` | `Shift+Right`   | Next day                   |
| `Scimax: Add/Change Repeater`   | `Ctrl+c Ctrl+r` | Add repeater to timestamp  |

**Table Commands:**
| Command                       | Keybinding            | Description                 |                    |
| ---------                     | ------------          | -------------               |                    |
| `Scimax: Create Table`        | `Ctrl+c \             | `                           | Create a new table |
| `Scimax: Insert Row Below`    | `Alt+Enter`           | Insert row below current    |                    |
| `Scimax: Insert Row Above`    | `Alt+Shift+Enter`     | Insert row above current    |                    |
| `Scimax: Delete Row`          | `Alt+Shift+Backspace` | Delete current row          |                    |
| `Scimax: Insert Column Right` | `Alt+Shift+Right`     | Insert column (in table)    |                    |
| `Scimax: Delete Column`       | `Alt+Shift+Left`      | Delete column (in table)    |                    |
| `Scimax: Insert Separator`    | `Ctrl+c -`            | Insert table separator line |                    |
| `Scimax: Align Table`         | -                     | Align table columns         |                    |

**Heading Commands:**
| Command                     | Keybinding        | Description                  |
| ---------                   | ------------      | -------------                |
| `Scimax: Promote Heading`   | `Alt+Left`        | Decrease heading level       |
| `Scimax: Demote Heading`    | `Alt+Right`       | Increase heading level       |
| `Scimax: Promote Subtree`   | `Alt+Shift+Left`  | Promote heading and children |
| `Scimax: Demote Subtree`    | `Alt+Shift+Right` | Demote heading and children  |
| `Scimax: Move Heading Up`   | `Alt+Up`          | Move heading up              |
| `Scimax: Move Heading Down` | `Alt+Down`        | Move heading down            |
| `Scimax: Insert Heading`    | `Ctrl+Enter`      | Insert new heading           |
| `Scimax: Insert Subheading` | -                 | Insert subheading            |

### Task Commands:**
| Command                         | Keybinding      | Description                |
| ---------                       | ------------    | -------------              |
| `Scimax: Toggle Checkbox`       | `Ctrl+c Ctrl+c` | Toggle checkbox state      |
| `Scimax: Insert Task`           | -               | Insert a new task          |
| `Scimax: Insert Due Date`       | `Ctrl+c Ctrl+d` | Add due date to task       |
| `Scimax: Insert Scheduled Date` | `Ctrl+c Ctrl+s` | Add scheduled date to task |
| `Scimax: Insert Priority`       | -               | Add priority to task       |
| `Scimax: Show Agenda`           | -               | Show agenda view           |
| `Scimax: Show Today's Tasks`    | -               | Show tasks due today       |
| `Scimax: Show Tasks by Project` | -               | Filter tasks by @project   |
| `Scimax: Show Tasks by Tag`     | -               | Filter tasks by #tag       |

**Folding:** (works in org, markdown, and LaTeX)
| Command                         | Keybinding  | Description                    |
| ------------------------------- | ----------- | ------------------------------ |
| `Scimax: Toggle Fold at Cursor` | `Tab`       | Toggle fold at current heading |
| `Scimax: Cycle Global Folding`  | `Shift+Tab` | Cycle all headings fold state  |

---

### Source Block Execution (Babel)

Full literate programming support with native code execution and Jupyter kernel integration.

**Commands:**
| Command                            | Keybinding      | Description                        |
| ---------------------------------- | --------------- | ---------------------------------- |
| `Scimax: Execute Block`            | `Ctrl+Enter`    | Execute source block at cursor     |
| `Scimax: Execute and Next`         | `Shift+Enter`   | Execute block and move to next     |
| `Scimax: Execute All Blocks`       | -               | Execute all source blocks          |
| `Scimax: Execute to Point`         | -               | Execute all blocks up to cursor    |
| `Scimax: Clear Results`            | -               | Clear results for current block    |
| `Scimax: Clear All Results`        | -               | Clear all results in document      |

**Features:**
- **Language support**: Python, JavaScript/TypeScript, Shell (bash), SQL, R, and more
- **Native Jupyter kernels**: Use `jupyter-python`, `jupyter-julia`, etc. as block language
- **Session persistence**: Maintain state across block executions
- **Rich output**: Automatic image capture from matplotlib, displayed as org links
- **Auto-save images**: Jupyter outputs saved to `.ob-jupyter/` directory

**Example:**
```org
#+BEGIN_SRC jupyter-python :session main
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 2*np.pi, 100)
plt.plot(x, np.sin(x))
plt.title("Sine Wave")
plt.show()
#+END_SRC

#+RESULTS:
[[file:.ob-jupyter/output-1736686800000-0.png]]
```

---

### Source Block Manipulation (scimax-ob)

Jupyter notebook-like editing for org-mode source blocks.

**Block Creation:**
| Command                              | Keybinding      | Description                     |
| ------------------------------------ | --------------- | ------------------------------- |
| `Scimax: Insert Block Above`         | -               | Insert new block above current  |
| `Scimax: Insert Block Below`         | `Ctrl+c Ctrl+n` | Insert new block below current  |
| `Scimax: Insert Block Below (Same)`  | -               | Insert block with same language |

**Block Manipulation:**
| Command                          | Keybinding    | Description                    |
| -------------------------------- | ------------- | ------------------------------ |
| `Scimax: Split Block`            | `Ctrl+c -`    | Split block at cursor position |
| `Scimax: Clone Block`            | -             | Duplicate current block        |
| `Scimax: Kill Block`             | -             | Delete block and its results   |
| `Scimax: Copy Block`             | -             | Copy block to clipboard        |
| `Scimax: Move Block Up`          | -             | Swap block with previous       |
| `Scimax: Move Block Down`        | -             | Swap block with next           |
| `Scimax: Merge with Previous`    | -             | Merge with previous block      |
| `Scimax: Merge with Next`        | -             | Merge with next block          |

**Navigation:**
| Command                          | Keybinding    | Description                    |
| -------------------------------- | ------------- | ------------------------------ |
| `Scimax: Next Source Block`      | `Ctrl+Down`   | Jump to next block             |
| `Scimax: Previous Source Block`  | `Ctrl+Up`     | Jump to previous block         |
| `Scimax: Jump to Source Block`   | `Ctrl+c Ctrl+b` | Quick pick to jump to block  |
| `Scimax: Jump to Results`        | -             | Jump to current block results  |

---

### Text Markup (scimax-org)

Emacs-style text markup with keyboard shortcuts.

**Markup Commands:**
| Command                  | Keybinding  | Result             |
| ------------------------ | ----------- | ------------------ |
| `Scimax: Bold`           | `Ctrl+c b`  | `*bold*`           |
| `Scimax: Italic`         | `Ctrl+c i`  | `/italic/`         |
| `Scimax: Underline`      | `Ctrl+c u`  | `_underline_`      |
| `Scimax: Code`           | `Ctrl+c \`` | `~code~`           |
| `Scimax: Verbatim`       | `Ctrl+c =`  | `=verbatim=`       |
| `Scimax: Strikethrough`  | `Ctrl+c +`  | `+strikethrough+`  |
| `Scimax: Subscript`      | -           | `_{subscript}`     |
| `Scimax: Superscript`    | -           | `^{superscript}`   |
| `Scimax: LaTeX Math`     | -           | `$math$`           |

**DWIM Return**: Smart return key that creates:
- New list items when in a list
- New headings when on a heading line
- New table rows when in a table

---

### Export System

Export org documents to multiple formats.

**Commands:**
| Command                     | Description                    |
| --------------------------- | ------------------------------ |
| `Scimax: Export to HTML`    | Export current file to HTML    |
| `Scimax: Export to Markdown`| Export to GitHub-flavored MD   |
| `Scimax: Export to LaTeX`   | Export to LaTeX document       |
| `Scimax: Export to PDF`     | Export to PDF via LaTeX/Pandoc |
| `Scimax: Export Dispatch`   | Show export options dialog     |

**Features:**
- Full org-mode syntax support (headings, lists, tables, blocks)
- Source block syntax highlighting in exports
- Citation handling with bibliography
- Table of contents generation
- Custom CSS/templates for HTML export

---

### Enhanced Tables (scimax-tables)

Spreadsheet-like table editing with export capabilities.

**Table Commands:**
| Command                       | Keybinding            | Description                 |
| ---------                     | ------------          | -------------               |
| `Scimax: Create Table`        | `Ctrl+c \|`           | Create a new table          |
| `Scimax: Insert Row Below`    | `Alt+Enter`           | Insert row below current    |
| `Scimax: Insert Row Above`    | `Alt+Shift+Enter`     | Insert row above current    |
| `Scimax: Delete Row`          | `Alt+Shift+Backspace` | Delete current row          |
| `Scimax: Insert Column Right` | `Alt+Shift+Right`     | Insert column (in table)    |
| `Scimax: Delete Column`       | `Alt+Shift+Left`      | Delete column (in table)    |
| `Scimax: Insert Separator`    | `Ctrl+c -`            | Insert table separator line |
| `Scimax: Align Table`         | -                     | Align table columns         |

**Named Tables & Export:**
| Command                  | Keybinding        | Description                     |
| ------------------------ | ----------------- | ------------------------------- |
| `Scimax: Go to Named Table` | -              | Jump to table by #+NAME:        |
| `Scimax: Export Table`   | `Ctrl+c Ctrl+e t` | Export to CSV/TSV/HTML/LaTeX    |
| `Scimax: Import Table`   | -                 | Create table from clipboard     |
| `Scimax: Sum Column`     | -                 | Sum numbers in current column   |
| `Scimax: Average Column` | -                 | Average numbers in column       |
| `Scimax: Sort by Column` | `Ctrl+c ^`        | Sort table by current column    |

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

| View                | Description                                |
| ------------------- | ------------------------------------------ |
| **Calendar**        | Interactive calendar for journal navigation |
| **Journal Entries** | List of recent journal files               |
| **Projects**        | Quick project switching (projectile-style) |

---

## Keyboard Shortcuts Summary

### General
| Shortcut                       | Command                                         |
| ------------------------------ | ----------------------------------------------- |
| `Alt+X`                        | Command Palette (Emacs M-x)                     |
| `Ctrl+Shift+J` / `Cmd+Shift+J` | Open Today's Journal                            |
| `Ctrl+Alt+V` / `Ctrl+Cmd+V`    | Database Menu (quick access to search commands) |

### Journal Navigation
| Shortcut   | Command                | When            |
| ---------- | ---------              | ------          |
| `Alt+[`    | Previous Journal Entry | In journal file |
| `Alt+]`    | Next Journal Entry     | In journal file |

### Citations & References
| Shortcut          | Command                       | When                  |
| ----------        | ---------                     | ------                |
| `Ctrl+c ]`        | Insert Citation               | In org/markdown/latex |
| `Ctrl+u Ctrl+c ]` | Insert Reference Link         | In org/markdown/latex |
| `Shift+Left`      | Transpose Citation Left       | On citation           |
| `Shift+Right`     | Transpose Citation Right      | On citation           |
| `Shift+Up`        | Sort Citations Alphabetically | On citation           |
| `Shift+Down`      | Sort Citations by Year        | On citation           |
| `Ctrl+Shift+K`    | Delete Citation               | On citation           |

### Fuzzy Search
| Shortcut         | Command                     | When      |
| ----------       | ---------                   | ------    |
| `Ctrl+c s`       | Fuzzy Search (Current File) | In editor |
| `Ctrl+c Shift+s` | Fuzzy Search (Open Files)   | In editor |
| `Ctrl+c Alt+s`   | Fuzzy Search (Outline)      | In editor |

### Jump Navigation
| Shortcut     | Command                 | When      |
| ----------   | ---------               | ------    |
| `Ctrl+c j c` | Jump to Character       | In editor |
| `Ctrl+c j j` | Jump to 2-Char Sequence | In editor |
| `Ctrl+c j w` | Jump to Word            | In editor |
| `Ctrl+c j l` | Jump to Line            | In editor |
| `Ctrl+c j o` | Jump to Symbol          | In editor |
| `Ctrl+c j s` | Jump to Subword         | In editor |

### Edit Marks (Track Changes)
| Shortcut     | Command            | When      |
| ----------   | ---------          | ------    |
| `Ctrl+c e i` | Mark Insertion     | In editor |
| `Ctrl+c e d` | Mark Deletion      | In editor |
| `Ctrl+c e c` | Insert Comment     | In editor |
| `Ctrl+c e t` | Mark Typo          | In editor |
| `Ctrl+c e a` | Accept Edit Mark   | In editor |
| `Ctrl+c e r` | Reject Edit Mark   | In editor |
| `Ctrl+c e ]` | Next Edit Mark     | In editor |
| `Ctrl+c e [` | Previous Edit Mark | In editor |
| `Ctrl+c e s` | Show Summary       | In editor |

### Project Management
| Shortcut     | Command              |
| ----------   | ---------            |
| `Ctrl+c p p` | Switch Project       |
| `Ctrl+c p f` | Find File in Project |
| `Ctrl+c p s` | Search in Project    |
| `Ctrl+c p d` | Open Project Root    |
| `Ctrl+c p a` | Add Project          |

### Org-Mode & Markdown Editing
| Shortcut               | Command                                        | When                     |
| ---------------------- | ---------------------------------------------- | ------------------------ |
| `Tab`                  | Toggle Fold                                    | On heading               |
| `Shift+Tab`            | Cycle Global Folding                           | In org/markdown/latex    |
| `Ctrl+Enter`           | Execute Block / Insert Heading                 | In org/markdown          |
| `Shift+Enter`          | Execute Block and Move to Next                 | In org/markdown          |
| `Ctrl+c Ctrl+c`        | Toggle Checkbox                                | In org/markdown          |
| `Ctrl+c .`             | Insert Timestamp                               | In org/markdown          |
| `Ctrl+c Ctrl+d`        | Insert Due Date                                | In org/markdown          |
| `Ctrl+c Ctrl+s`        | Insert Scheduled Date                          | In org/markdown          |
| `Ctrl+c Ctrl+r`        | Add Repeater                                   | In org/markdown          |
| `Ctrl+c \|`            | Create Table                                   | In org/markdown          |
| `Ctrl+c -`             | Insert Table Separator / Split Block           | In org/markdown          |
| `Shift+Up/Down`        | Adjust Timestamp                               | On timestamp             |
| `Shift+Left/Right`     | Previous/Next Day or Cycle TODO                | On timestamp/heading     |
| `Alt+Left/Right`       | Promote/Demote Heading                         | On heading               |
| `Alt+Up/Down`          | Move Heading/Subtree Up/Down                   | On heading               |
| `Alt+Enter`            | Insert Table Row Below                         | In table                 |
| `Alt+Shift+Enter`      | Insert Table Row Above                         | In table                 |
| `Alt+Shift+Left/Right` | Promote/Demote Subtree or Delete/Insert Column | Context-dependent        |

### Text Markup
| Shortcut     | Command            | Result              |
| ------------ | ------------------ | ------------------- |
| `Ctrl+c b`   | Bold               | `*text*`            |
| `Ctrl+c i`   | Italic             | `/text/`            |
| `Ctrl+c u`   | Underline          | `_text_`            |
| `Ctrl+c \``  | Code               | `~text~`            |
| `Ctrl+c =`   | Verbatim           | `=text=`            |
| `Ctrl+c +`   | Strikethrough      | `+text+`            |

### Source Block Navigation & Execution
| Shortcut       | Command                 | When          |
| -------------- | ----------------------- | ------------- |
| `Ctrl+Down`    | Next Source Block       | In org/md     |
| `Ctrl+Up`      | Previous Source Block   | In org/md     |
| `Ctrl+c Ctrl+n`| Insert Block Below      | In org/md     |
| `Ctrl+c Ctrl+b`| Jump to Source Block    | In org/md     |
| `Ctrl+c Ctrl+j`| Jump to Heading         | In org/md     |
| `Ctrl+c Ctrl+o`| Open Link at Point      | In org/md     |
| `Ctrl+c Ctrl+l`| Insert Link             | In org/md     |
| `Ctrl+c Ctrl+t`| Cycle TODO State        | In org/md     |

---

## File Formats

The extension supports:
- **Org-mode** (`.org`): Full parsing of headings, properties, tags, timestamps, source blocks, links
- **Markdown** (`.md`): Headings, code blocks, links, hashtags
- **BibTeX** (`.bib`): Bibliography entries with all standard fields

---

## Comparison with Emacs Scimax

| Feature              | Emacs Scimax       | VS Code Scimax                        |
| -------------------- | ------------------ | ------------------------------------- |
| Journal              | scimax-journal     | Full support                          |
| Bibliography         | org-ref            | Full support + OpenAlex               |
| Database             | org-db-v3          | Full support with semantic search     |
| Notebooks            | scimax-notebook    | Full support                          |
| Projectile           | projectile         | Full support                          |
| Swiper               | swiper/ivy         | Full support (fuzzy search)           |
| Avy                  | avy                | Full support (jump)                   |
| Spell Check          | jinx/flyspell      | Use LTeX extension                    |
| Track Changes        | scimax-editmarks   | Full support (editmarks)              |
| Literate Programming | ob-ipython/ob-*    | Full support (Babel + Jupyter)        |
| Text Markup          | scimax-org         | Full support (bold, italic, etc.)     |
| Block Manipulation   | scimax-ob          | Full support (split, merge, navigate) |
| Export               | ox-*               | Full support (HTML, LaTeX, MD, PDF)   |
| Tables               | org-table          | Full support + export to CSV/HTML     |
| Clocking             | org-clock          | Partial (basic clocking)              |
| Contacts             | org-contacts       | Not yet                               |
| Capture Templates    | org-capture        | Not yet                               |

---

## Contributing

Contributions welcome! Please see the [GitHub repository](https://github.com/jkitchin/scimax_vscode).

## License

MIT License - see LICENSE file for details.

## Credits

Inspired by [Scimax](https://github.com/jkitchin/scimax) by John Kitchin.
