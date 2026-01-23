# Scimax VS Code Extension - Project Plan

## Implementation Status (January 2026)

| Feature | Status | Notes |
|---------|--------|-------|
| **Journal System** | ✅ Complete | Full scimax-journal implementation |
| **File Database (org-db)** | ✅ Complete | SQLite + FTS5 + vector search |
| **Bibliography (org-ref)** | ✅ Complete | Citations + DOI + OpenAlex |
| **Literate Programming (Babel)** | ✅ Complete | Python, JS, Shell, SQL, R + Jupyter |
| **Jupyter Kernels** | ✅ Complete | Native ZMQ, jupyter-* syntax |
| **Export System** | ✅ Complete | HTML, LaTeX, Markdown, PDF |
| **Org-Mode Editing** | ✅ Complete | Folding, headings, tables, timestamps |
| **Scimax-org** | ✅ Complete | Text markup, DWIM return, navigation |
| **Scimax-ob** | ✅ Complete | Block manipulation |
| **Enhanced Tables** | ✅ Complete | Export, named tables, formulas |
| **Project Management** | ✅ Complete | Projectile-style |
| **Fuzzy Search** | ✅ Complete | Swiper-style |
| **Jump Navigation** | ✅ Complete | Avy-style |
| **Edit Marks** | ✅ Complete | Track changes |
| **Hydra Menus** | ✅ Complete | Context menus |
| **Basic Clocking** | ✅ Complete | Clock in/out |
| **Capture Templates** | 🔲 Todo | |
| **Backlinks/Graph** | 🔲 Todo | |
| **LaTeX Preview** | 🔲 Todo | |

---

## Executive Summary

This document outlines a prioritized plan for creating a VS Code extension that brings the core capabilities of [scimax](https://github.com/jkitchin/scimax) to Visual Studio Code. Scimax is an Emacs-based scientific computing environment that transforms plain text into a powerful research platform.

## Strategic Decisions

### Org-Mode Support Strategy

After analyzing the existing VS Code org-mode ecosystem, I recommend a **hybrid approach**:

| Approach | Pros | Cons |
|----------|------|------|
| **Pure Org-Mode** | Compatible with existing .org files, Emacs users can switch seamlessly | Limited VS Code extensions, would need to build most features from scratch |
| **Markdown-Based** | Native VS Code support, GitHub rendering, wider adoption | Loses org-mode specific features (drawers, properties, clock) |
| **Hybrid (Recommended)** | Best of both worlds, progressive enhancement | More complex architecture |

**Recommendation**: Build core features to work with **both** formats where possible:
- Journal, project management, search → Format-agnostic (work with .org and .md)
- Literate programming → Leverage VS Code's native Jupyter notebook support + custom org-babel layer
- Org-specific features → Enhance existing [vscode-org-mode](https://github.com/vscode-org-mode/vscode-org-mode) extension

### Architecture Principles

1. **Modular Design**: Each scimax feature becomes a separate VS Code extension or module
2. **Database-Backed**: Use SQLite (like org-db) for fast search across large file collections
3. **Language Server Protocol**: Implement LSP for org-mode to enable rich editing
4. **WebView-Based UIs**: Use VS Code WebViews for dashboards and previews
5. **Command Palette Integration**: All features accessible via commands

---

## Priority 1: Scimax Journal (MVP)

**Rationale**: High user value, self-contained, demonstrates the extension's capabilities.

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│                    SCIMAX JOURNAL                           │
├─────────────────────────────────────────────────────────────┤
│ Core Features:                                              │
│ • Date-organized journal entries (YYYY/MM/DD/YYYY-MM-DD.md) │
│ • Quick open today's journal (Cmd/Ctrl+Shift+J)             │
│ • Navigate between entries (prev/next day)                  │
│ • Jump to specific date via date picker                     │
│ • Create new entries with templates                         │
│                                                             │
│ Search Features:                                            │
│ • Full-text search across all journal entries               │
│ • Search within date range                                  │
│ • Search by tags/hashtags                                   │
│ • Quick filter by month/year                                │
│                                                             │
│ UI Components:                                              │
│ • Journal sidebar panel                                     │
│ • Calendar view for navigation                              │
│ • Entry list with preview                                   │
│ • Status bar showing current entry date                     │
└─────────────────────────────────────────────────────────────┘
```

### File Structure
```
~/scimax-journal/
├── 2025/
│   ├── 01/
│   │   ├── 15/
│   │   │   └── 2025-01-15.md
│   │   └── 16/
│   │       └── 2025-01-16.md
│   └── ...
├── .scimax/
│   ├── config.json          # Journal settings
│   ├── journal.db           # SQLite index for fast search
│   └── templates/
│       └── daily.md         # Default template
```

### Default Template
```markdown
# {{date}} - {{weekday}}

## Tasks
- [ ]

## Notes

## Log
<!-- Auto-timestamps for entries -->
```

### Commands
| Command | Keybinding | Description |
|---------|------------|-------------|
| `scimax.journal.today` | `Ctrl+Shift+J` | Open today's journal |
| `scimax.journal.new` | `Ctrl+Alt+J` | Create new entry for date |
| `scimax.journal.prev` | `Alt+[` | Previous day's entry |
| `scimax.journal.next` | `Alt+]` | Next day's entry |
| `scimax.journal.goto` | `Ctrl+Shift+G` | Jump to date |
| `scimax.journal.search` | `Ctrl+Shift+F J` | Search journal |
| `scimax.journal.calendar` | - | Show calendar view |

### Configuration
```json
{
  "scimax.journal.directory": "~/scimax-journal",
  "scimax.journal.format": "markdown",  // or "org"
  "scimax.journal.template": "default",
  "scimax.journal.dateFormat": "YYYY-MM-DD",
  "scimax.journal.autoTimestamp": true,
  "scimax.journal.weekStartsOn": "monday"
}
```

---

## Priority 2: Org-DB (File Index & Search)

**Rationale**: Powers fast search across projects, essential for large codebases.

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│                      ORG-DB                                 │
├─────────────────────────────────────────────────────────────┤
│ Indexing:                                                   │
│ • Index all .org and .md files in workspace                 │
│ • Extract headings, links, tags, properties                 │
│ • Index source code blocks with language info               │
│ • Extract hashtags (#topic) and @-mentions                  │
│ • Incremental updates on file save                          │
│                                                             │
│ Search Capabilities:                                        │
│ • Full-text search with ranking                             │
│ • Heading search (jump to any heading)                      │
│ • Tag/hashtag search                                        │
│ • Link search (find all references)                         │
│ • Source block search by language                           │
│                                                             │
│ UI:                                                         │
│ • Quick pick interface for search results                   │
│ • Sidebar panel for browsing index                          │
│ • Status bar showing index stats                            │
└─────────────────────────────────────────────────────────────┘
```

### Database Schema
```sql
-- Files table
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  mtime INTEGER,
  hash TEXT
);

-- Headings table
CREATE TABLE headings (
  id INTEGER PRIMARY KEY,
  file_id INTEGER,
  level INTEGER,
  title TEXT,
  line_number INTEGER,
  todo_state TEXT,
  tags TEXT,
  properties JSON,
  FOREIGN KEY (file_id) REFERENCES files(id)
);

-- Links table
CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  file_id INTEGER,
  heading_id INTEGER,
  type TEXT,
  target TEXT,
  description TEXT,
  line_number INTEGER
);

-- Source blocks table
CREATE TABLE src_blocks (
  id INTEGER PRIMARY KEY,
  file_id INTEGER,
  heading_id INTEGER,
  language TEXT,
  content TEXT,
  line_number INTEGER
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE fts USING fts5(
  title, content, file_path
);
```

---

## Priority 3: Literate Programming Support

**Rationale**: Core scimax use case - executable documents.

### Strategy

Rather than reimplementing org-babel, leverage VS Code's existing Jupyter infrastructure:

1. **For Jupyter notebooks**: Native VS Code support already excellent
2. **For Org files with src blocks**: Create a bridge to execute via Jupyter kernels
3. **For Markdown with code fences**: Enable inline execution (polyglot notebooks)

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│               LITERATE PROGRAMMING                          │
├─────────────────────────────────────────────────────────────┤
│ Code Execution:                                             │
│ • Execute code blocks inline (Python, Julia, R, JS, Shell)  │
│ • Session management (persistent kernels)                   │
│ • Results displayed inline below blocks                     │
│ • Support for :results types (output, value, table, image)  │
│                                                             │
│ Block Management:                                           │
│ • Insert new code block with language selection             │
│ • Navigate between blocks (next/prev)                       │
│ • Execute all blocks in document                            │
│ • Clear results                                             │
│                                                             │
│ Tangling (Code Extraction):                                 │
│ • Extract code blocks to source files                       │
│ • Respect :tangle headers                                   │
│ • Watch mode for auto-tangle on save                        │
│                                                             │
│ Weaving (Documentation):                                    │
│ • Export to HTML/PDF with executed results                  │
│ • Syntax highlighting for code                              │
│ • LaTeX math rendering                                      │
└─────────────────────────────────────────────────────────────┘
```

### Execution UX
```
```python :session main
import pandas as pd
df = pd.read_csv('data.csv')
df.head()
```

► Run Block (Ctrl+Enter)

┌──────────────────────────────────┐
│    name  │  value  │  count     │
│──────────┼─────────┼────────────│
│    A     │   10    │    5       │
│    B     │   20    │    3       │
└──────────────────────────────────┘
```

---

## Priority 4: Enhanced Org-Mode Editing

**Rationale**: Better editing experience for .org files.

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│              ORG-MODE ENHANCEMENTS                          │
├─────────────────────────────────────────────────────────────┤
│ Syntax & Highlighting:                                      │
│ • TreeSitter grammar for org-mode                           │
│ • Semantic highlighting (TODO states, priorities, tags)     │
│ • Link underlining and clickable links                      │
│ • LaTeX preview inline                                      │
│                                                             │
│ Editing:                                                    │
│ • Smart Enter (continue lists, headings)                    │
│ • Tab cycling (fold/unfold)                                 │
│ • Promote/demote headings (Alt+Left/Right)                  │
│ • Move headings up/down (Alt+Up/Down)                       │
│ • TODO state cycling                                        │
│ • Tag insertion with completion                             │
│ • Property drawer management                                │
│                                                             │
│ Navigation:                                                 │
│ • Jump to heading (outline view)                            │
│ • Breadcrumb navigation                                     │
│ • Imenu-like symbol navigation                              │
│ • Follow links (internal and external)                      │
│                                                             │
│ Tables:                                                     │
│ • Auto-align on Tab                                         │
│ • Column width adjustment                                   │
│ • Formula support (spreadsheet)                             │
│ • Import/export CSV                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Priority 5: Bibliography & Citations (org-ref)

**Rationale**: Essential for academic users. Based on [org-ref](https://github.com/jkitchin/org-ref).

### org-ref Feature Analysis

org-ref provides:
- **Hyper-functional links**: Citations are clickable with hover info
- **Multiple citation styles**: cite, citet, citep, citeauthor, citeyear, etc.
- **PDF integration**: Open PDF from citation link
- **DOI utilities**: Fetch BibTeX from DOI, CrossRef integration
- **Cross-references**: Label/ref links for figures, tables, equations
- **Pre/postnote support**: `[[cite:key][prenote::postnote]]`

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│              BIBLIOGRAPHY MANAGEMENT                        │
├─────────────────────────────────────────────────────────────┤
│ BibTeX Integration:                                         │
│ • Parse .bib files (author, title, year, journal, etc.)     │
│ • Citation completion with fuzzy search (Ctrl+])            │
│ • Preview citation on hover (tooltip with full reference)   │
│ • Clickable citation links with action menu:                │
│   - Open PDF (if available)                                 │
│   - Open URL/DOI in browser                                 │
│   - Open notes file                                         │
│   - Copy BibTeX entry                                       │
│   - Edit entry                                              │
│                                                             │
│ Citation Insertion:                                         │
│ • Insert citation via command palette (Ctrl+])              │
│ • Multiple citation styles:                                 │
│   - cite (basic)                                            │
│   - citet (textual: "Author (Year)")                        │
│   - citep (parenthetical: "(Author, Year)")                 │
│   - citeauthor (author only)                                │
│   - citeyear (year only)                                    │
│ • Multi-citation support: cite:key1,key2,key3               │
│ • Pre/postnote: cite:key[see][p. 42]                        │
│                                                             │
│ DOI Utilities:                                              │
│ • Fetch BibTeX from DOI (via CrossRef API)                  │
│ • Add entry from DOI with one command                       │
│ • Auto-download PDF if available                            │
│ • Validate DOIs in bibliography                             │
│                                                             │
│ Cross-Reference (figures/tables/equations):                 │
│ • Label insertion: <<fig:name>>                             │
│ • Reference insertion: ref:fig:name                         │
│ • Clickable refs jump to label                              │
│ • Preview on hover                                          │
│                                                             │
│ Bibliography Management:                                    │
│ • Find all citations of a reference                         │
│ • Detect unused references                                  │
│ • Detect missing references                                 │
│ • Sort/clean bibliography file                              │
│ • Merge duplicate entries                                   │
│                                                             │
│ Notes Integration:                                          │
│ • Create notes file for each reference                      │
│ • Link between notes and source documents                   │
│ • Search across notes                                       │
└─────────────────────────────────────────────────────────────┘
```

### Citation Link Syntax

**Org-mode format:**
```org
cite:kitchin2015
citet:kitchin2015
citep:kitchin2015[see][p. 42]
[[cite:kitchin2015][as shown in]]
```

**Markdown format (proposed):**
```markdown
[@kitchin2015]
[@kitchin2015, p. 42]
[see @kitchin2015; @smith2020]
```

### Configuration
```json
{
  "scimax.ref.bibliographyFiles": ["~/bibliography/refs.bib"],
  "scimax.ref.pdfDirectory": "~/papers/",
  "scimax.ref.notesDirectory": "~/notes/references/",
  "scimax.ref.defaultCiteStyle": "cite",
  "scimax.ref.autoDownloadPdf": false
}
```

---

## Priority 6: Project Dashboard

**Rationale**: Provides overview and quick access like scimax-dashboard.

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│                    DASHBOARD                                │
├─────────────────────────────────────────────────────────────┤
│ Sections:                                                   │
│ • Recent files (from journal and projects)                  │
│ • Agenda (upcoming TODOs and deadlines)                     │
│ • Bookmarks                                                 │
│ • Projects (workspaces)                                     │
│ • Quick actions (new journal, search, etc.)                 │
│                                                             │
│ Widgets:                                                    │
│ • Agenda calendar view                                      │
│ • TODO statistics chart                                     │
│ • Recent activity timeline                                  │
│ • Quick capture input                                       │
│                                                             │
│ Customization:                                              │
│ • Configurable sections                                     │
│ • Custom quick actions                                      │
│ • Theme integration                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Priority 7: Agenda & Task Management

**Rationale**: Core org-mode feature for GTD workflow.

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│                 AGENDA & TASKS                              │
├─────────────────────────────────────────────────────────────┤
│ Agenda Views:                                               │
│ • Day view                                                  │
│ • Week view                                                 │
│ • Month view                                                │
│ • Custom filtered views                                     │
│                                                             │
│ Task Management:                                            │
│ • TODO state management                                     │
│ • Scheduling (SCHEDULED, DEADLINE)                          │
│ • Repeating tasks                                           │
│ • Priority management                                       │
│ • Time tracking (clock in/out)                              │
│                                                             │
│ Capture:                                                    │
│ • Quick capture from anywhere                               │
│ • Capture templates                                         │
│ • Refile to different locations                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Priority 8: Hydra-like Command Menu

**Rationale**: Discoverable commands, essential for power users.

### Features to Implement

```
┌─────────────────────────────────────────────────────────────┐
│                  COMMAND MENU                               │
├─────────────────────────────────────────────────────────────┤
│ Features:                                                   │
│ • Hierarchical command menus                                │
│ • Keyboard-driven navigation                                │
│ • Customizable menu structure                               │
│ • Context-sensitive menus                                   │
│                                                             │
│ Default Categories (like scimax-hydra):                     │
│ • Applications, Buffers, Edit, Files                        │
│ • Help, Insert, Jump, Bookmarks                             │
│ • Navigation, Org, Projects, Search                         │
│ • Text, Version Control, Windows                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Extension Structure
```
scimax-vscode/
├── packages/
│   ├── scimax-core/           # Shared utilities
│   ├── scimax-journal/        # Journal extension
│   ├── scimax-org-db/         # Database & search
│   ├── scimax-literate/       # Code execution
│   ├── scimax-org/            # Org-mode enhancements
│   ├── scimax-refs/           # Bibliography
│   ├── scimax-dashboard/      # Dashboard UI
│   ├── scimax-agenda/         # Agenda & tasks
│   └── scimax-menu/           # Command menus
├── shared/
│   ├── org-parser/            # Org-mode parser (TypeScript)
│   └── database/              # SQLite wrapper
├── package.json               # Monorepo root
└── tsconfig.json
```

### Technology Stack
- **Language**: TypeScript
- **Build**: esbuild (fast bundling)
- **Database**: better-sqlite3 (native SQLite)
- **Parser**: Custom org-mode parser or tree-sitter
- **UI**: VS Code WebView API + React/Svelte for dashboards
- **Testing**: Vitest + VS Code test runner

### Development Phases

#### Phase 1: Foundation (Weeks 1-4)
- [ ] Project setup (monorepo, build, test)
- [ ] Org-mode parser (headings, links, blocks)
- [ ] SQLite database layer
- [ ] Basic extension activation

#### Phase 2: Journal MVP (Weeks 5-8)
- [ ] Journal file management
- [ ] Date-based navigation
- [ ] Template system
- [ ] Journal indexing & search
- [ ] Calendar sidebar

#### Phase 3: Search & Index (Weeks 9-12)
- [ ] Full org-db implementation
- [ ] Cross-file search
- [ ] Heading navigation
- [ ] Tag/hashtag support

#### Phase 4: Literate Programming (Weeks 13-16)
- [ ] Jupyter kernel integration
- [ ] Block execution
- [ ] Result display
- [ ] Session management

#### Phase 5: Polish & Extend (Weeks 17+)
- [ ] Bibliography support
- [ ] Dashboard
- [ ] Agenda views
- [ ] Command menus

---

## Comparison: Scimax vs Scimax-VSCode

| Feature | Scimax (Emacs) | Scimax-VSCode (Planned) |
|---------|---------------|-------------------------|
| Journal | ✅ Full | ✅ Full (Priority 1) |
| Org-DB | ✅ Full | ✅ Full (Priority 2) |
| Org-Babel | ✅ Full | ⚡ Via Jupyter (Priority 3) |
| Org Editing | ✅ Full | 🔨 Enhanced (Priority 4) |
| Bibliography | ✅ org-ref | 🔨 Basic (Priority 5) |
| Dashboard | ✅ Full | 🔨 WebView (Priority 6) |
| Agenda | ✅ Full | 🔨 Basic (Priority 7) |
| Hydra | ✅ Full | 🔨 Command Palette (Priority 8) |
| Magit | ✅ Full | ⚡ GitLens/native git |
| Email | ✅ mu4e | ❌ Out of scope |
| Slack/Twitter | ✅ Optional | ❌ Out of scope |

Legend: ✅ = Full parity, ⚡ = Alternative approach, 🔨 = Partial implementation, ❌ = Not planned

---

## Success Metrics

1. **Journal Usage**: Daily active users creating journal entries
2. **Search Performance**: <100ms for most queries across 10k+ files
3. **Code Execution**: Seamless Python/Julia/R block execution
4. **User Retention**: Users preferring scimax-vscode over alternatives

---

## Priority 9: Project Management (Projectile-inspired)

**Rationale**: Based on [Projectile](https://docs.projectile.mx/projectile/index.html), provides project-level operations.

### Projectile Feature Analysis

Projectile provides:
- **Project detection**: Via VCS (.git), build files (package.json, pom.xml), or .projectile marker
- **Fast file finding**: Cached file lists for quick navigation
- **Project switching**: Quick-switch between known projects
- **Related files**: Toggle between test/implementation, header/source
- **Project commands**: Run shell commands in project root

### Integration Strategy

VS Code already provides workspaces and `Ctrl+P` for file finding. We'll add:

```
┌─────────────────────────────────────────────────────────────┐
│              PROJECT MANAGEMENT                             │
├─────────────────────────────────────────────────────────────┤
│ Project Discovery:                                          │
│ • Auto-detect projects in configured directories            │
│ • Remember recently opened projects                         │
│ • Project-local configuration (.scimax/config.json)         │
│                                                             │
│ Related Files:                                              │
│ • Toggle test ↔ implementation                              │
│ • Toggle header ↔ source (.h ↔ .c/.cpp)                     │
│ • Custom related file patterns                              │
│                                                             │
│ Project Commands:                                           │
│ • Run command in project root                               │
│ • Project-specific build/test/run                           │
│ • Remember per-project commands                             │
│                                                             │
│ Journal Integration:                                        │
│ • Project-specific journal directory                        │
│ • Link journal entries to projects                          │
│ • Project notes file                                        │
│                                                             │
│ Quick Actions:                                              │
│ • Find file in project (enhanced Ctrl+P)                    │
│ • Find recent file in project                               │
│ • Search in project (ripgrep integration)                   │
└─────────────────────────────────────────────────────────────┘
```

### Configuration
```json
{
  "scimax.project.searchDirectories": ["~/projects", "~/work"],
  "scimax.project.relatedFilePatterns": {
    "*.ts": ["*.spec.ts", "*.test.ts"],
    "*.py": ["test_*.py", "*_test.py"],
    "*.h": ["*.c", "*.cpp"]
  }
}
```

---

## Resources

- [Scimax Repository](https://github.com/jkitchin/scimax)
- [org-ref](https://github.com/jkitchin/org-ref) - Citation management
- [Projectile](https://docs.projectile.mx/projectile/index.html) - Project management
- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Org Mode](https://github.com/vscode-org-mode/vscode-org-mode)
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

---

## Next Steps

1. **Immediate**: Set up project structure and build system
2. **This Week**: Begin scimax-journal implementation
3. **This Month**: Ship first alpha of journal functionality
4. **Q1**: Complete Priorities 1-3 (Journal, Org-DB, Literate)
