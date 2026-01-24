# Scimax for VS Code

[![Tests](https://github.com/jkitchin/scimax_vscode/actions/workflows/test.yml/badge.svg)](https://github.com/jkitchin/scimax_vscode/actions/workflows/test.yml)

<img src="./media/scimax-logo.png" width="200" />

A scientific computing environment for VS Code inspired by [Scimax](https://github.com/jkitchin/scimax), the Emacs-based starter kit for scientists and engineers. This project is 100% vibe-engineered with Claude Code. I have endeavored to make sure it is well tested, and used Claude Code to audit it for security and performance issues. I personally use this almost daily.

## Roadmap

For the forseeable future I envision this remaining a mono-repository. That is for practical reasons. As the sole maintainer at the moment, I don't have bandwidth to manage many separate repositories. I also see this as a "batteries included", low friction path to get org-mode in the hands of as many people as possible.

I anticipate several months of bug fixes and feature parity efforts. Those should be reported at https://github.com/jkitchin/scimax_vscode/issues. I am trying to extend some ideas from org-mode to Markdown so it is easier to go between these formats.

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

## Features

### Org-Mode & Markdown Editing Features

org-mode is simultaneously a markup language and a library of software to manipulate it. It was created in Emacs, and aside from some syntax highlighters here and there, there has not been another editor capable of the things Emacs can do. Until now. 

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

**Unified Navigation:** (works in org, markdown, and LaTeX)
| Keybinding    | Description                              |
| ------------- | ---------------------------------------- |
| `Ctrl+c Ctrl+n` | Next heading/section                   |
| `Ctrl+c Ctrl+p` | Previous heading/section               |
| `Ctrl+c Ctrl+f` | Next sibling (same level)              |
| `Ctrl+c Ctrl+b` | Previous sibling                       |
| `Ctrl+c Ctrl+u` | Parent heading/section                 |
| `Ctrl+c Ctrl+j` | Jump to any heading/section            |

See [Markdown Compatibility](docs/30-markdown-compatibility.org) and [LaTeX Navigation](docs/33-latex-navigation.org) for full details.

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
| `Scimax: Insert Block Below`         | `Ctrl+c Ctrl+,` | Insert new block below current  |
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

### Speed Commands (org-speed-commands)

Single-key shortcuts that work when the cursor is at column 0 of a heading line, just like Emacs org-mode speed commands.

**How it works:** Place your cursor at the very beginning of a heading line (column 0) and press a single key to execute commands instantly—no modifier keys needed.

**Navigation:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `n` | Next heading             | Jump to next visible heading |
| `p` | Previous heading         | Jump to previous heading     |
| `f` | Next sibling             | Next heading at same level   |
| `b` | Previous sibling         | Previous heading at same level |
| `u` | Parent heading           | Jump to parent heading       |
| `j` | Jump to heading          | Quick pick any heading       |
| `g` | Go to menu               | Show navigation submenu      |

**Visibility:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `c` | Cycle global             | Cycle all headings visibility |
| `C` | Show children            | Expand all children          |
| `o` | Overview                 | Fold all headings            |
| `Tab` | Toggle fold            | Cycle fold at current heading |

**Structure Editing:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `U` | Move subtree up          | Swap with previous sibling   |
| `D` | Move subtree down        | Swap with next sibling       |
| `r` | Demote subtree           | Increase level of subtree    |
| `l` | Promote subtree          | Decrease level of subtree    |
| `R` | Demote heading           | Increase level of heading only |
| `L` | Promote heading          | Decrease level of heading only |
| `w` | Kill subtree             | Cut subtree to clipboard     |
| `y` | Yank subtree             | Paste subtree from clipboard |
| `W` | Clone subtree            | Duplicate subtree below      |

**TODO & Priority:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `t` | Cycle TODO               | Cycle through TODO states    |
| `,` | Cycle priority           | Cycle priority up            |
| `1` | Priority A               | Set priority [#A]            |
| `2` | Priority B               | Set priority [#B]            |
| `3` | Priority C               | Set priority [#C]            |
| `0` | No priority              | Remove priority              |

**Planning:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `s` | Schedule                 | Add/edit SCHEDULED timestamp |
| `d` | Deadline                 | Add/edit DEADLINE timestamp  |
| `.` | Insert timestamp         | Insert timestamp at point    |

**Metadata:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `:` | Set tags                 | Edit tags for heading        |
| `e` | Set effort               | Set Effort property          |
| `P` | Set property             | Add/edit any property        |

**Clocking:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `I` | Clock in                 | Start clock on this heading  |
| `O` | Clock out                | Stop current clock           |

**Archive:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `a` | Archive subtree          | Archive to archive file      |
| `A` | Toggle ARCHIVE tag       | Add/remove :ARCHIVE: tag     |
| `$` | Archive to sibling       | Archive under Archive sibling |

**Special:**
| Key | Command                  | Description                  |
|-----|--------------------------|------------------------------|
| `N` | Narrow to subtree        | Show only this subtree       |
| `S` | Widen                    | Show full buffer             |
| `?` | Speed help               | Show all speed commands      |

**Configuration:**
```json
{
  "scimax.speedCommands.enabled": true
}
```

Toggle speed commands on/off with `Ctrl+c Ctrl+x s`.

---

### Export System

Export org documents to multiple formats with full org-mode export option support.

**Commands:**
| Command                      | Description                     |
| ---------------------------- | ------------------------------- |
| `Scimax: Export to HTML`     | Export current file to HTML     |
| `Scimax: Export to Markdown` | Export to GitHub-flavored MD    |
| `Scimax: Export to LaTeX`    | Export to LaTeX document        |
| `Scimax: Export to PDF`      | Export to PDF via LaTeX/Pandoc  |
| `Scimax: Export to Word`     | Export to DOCX via Pandoc       |
| `Scimax: Export Dispatch`    | Show export options dialog      |

**Features:**
- Full org-mode syntax support (headings, lists, tables, blocks)
- Source block syntax highlighting in exports
- Table of contents generation
- Custom CSS/templates for HTML export

**DOCX Export (Pandoc-based):**
The Word export uses [Pandoc](https://pandoc.org/) for high-quality document generation:
- **LaTeX equations** render properly as native Word equations
- **Bibliography support** via `--citeproc` - citations are resolved and a bibliography is generated
- **Citation formats**: Both org-ref (`cite:key`) and org-cite (`[cite:@key]`) are supported

**Export Options:**
Control what appears in exports using `#+OPTIONS:` in your org file:
| Option      | Effect                              |
|-------------|-------------------------------------|
| `toc:2`     | Table of contents to depth 2        |
| `num:t`     | Number sections                     |
| `p:nil`     | Remove statistics cookies `[1/3]`   |
| `todo:nil`  | Remove TODO keywords                |
| `tags:nil`  | Remove heading tags                 |
| `pri:nil`   | Remove priority cookies `[#A]`      |
| `prop:nil`  | Remove PROPERTIES drawers           |
| `d:nil`     | Remove all drawers                  |

**Example:**
```org
#+TITLE: My Document
#+OPTIONS: toc:2 num:t p:nil todo:nil tags:nil

* Introduction
Content here...

bibliography:~/references.bib
```

**Requirements:** [Pandoc](https://pandoc.org/installing.html) must be installed for DOCX/PDF export.

---

### Capture Templates (org-capture)

Quick note capture with customizable templates, inspired by Emacs org-capture.

**Commands:**
| Command                           | Keybinding | Description                        |
| --------------------------------- | ---------- | ---------------------------------- |
| `Scimax: Capture`                 | `Ctrl+c c` | Show capture template picker       |
| `Scimax: Quick Capture TODO`      | `Ctrl+c t` | Quick capture a TODO item          |
| `Scimax: Quick Capture Note`      | -          | Quick capture a note               |
| `Scimax: Create Capture Template` | -          | Create a new capture template      |
| `Scimax: List Capture Templates`  | -          | Show all available templates       |

**Built-in Templates:**
- **Todo** (`t`): Capture a TODO item to `todo.org`
- **Note** (`n`): Capture a note with timestamp
- **Journal** (`j`): Capture to today's journal entry in a datetree
- **Code Snippet** (`s`): Capture selected code with language and source link
- **Meeting Notes** (`m`): Capture meeting notes with attendees and agenda
- **Link** (`l`): Capture a link with description
- **Idea** (`i`): Capture an idea for the ideas file

**Features:**
- Template variables: `%t` (timestamp), `%T` (active timestamp), `%U` (inactive timestamp)
- Context variables: `%a` (annotation link), `%i` (selected text), `%c` (clipboard)
- Prompt variables: `%^{prompt}` for user input
- Datetree filing: Automatically file under date hierarchy
- File targeting: Capture to specific files or headlines

**Configuration:**
```json
{
  "scimax.capture.templates": [...],
  "scimax.capture.defaultFile": "~/capture.org",
  "scimax.capture.datetreeFormat": "year-month-day",
  "scimax.capture.autoSave": true
}
```

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

### Project Management (projectile-style)

Quick project switching and file finding, inspired by Emacs [projectile](https://github.com/bbatsov/projectile). Projects are defined by a directory containing a git repo, or a project marker file like .projectile. 

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

### Bibliography & Citations (org-ref)

Full bibliography management with BibTeX support, DOI fetching, and citation insertion. Projects are defined by a directory containing a git repo, or a project marker file like .projectile. 

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
Works with Zotero too!

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



### File Database (scimax-db)

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
| `Scimax: Configure Embedding Service` | Setup Ollama for semantic search |
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
- **Batched reindexing**: Memory-safe reindexing with configurable batch size and progress reporting
- **Cancellable operations**: Long-running reindex can be cancelled via progress notification

**Embedding Provider for Semantic Search:**
| Provider           | Model            | Dimensions | Setup                          |
| ------------------ | ---------------- | ---------- | ------------------------------ |
| **Ollama** (local) | nomic-embed-text | 768        | `ollama pull nomic-embed-text` |
| **Ollama** (local) | all-minilm       | 384        | `ollama pull all-minilm`       |
| **Ollama** (local) | mxbai-embed-large| 1024       | `ollama pull mxbai-embed-large`|

**Configuration:**
```json
{
  "scimax.db.directories": [],
  "scimax.db.ignorePatterns": ["**/node_modules/**", "**/.git/**"],
  "scimax.db.autoIndex": true,
  "scimax.db.embeddingProvider": "ollama",
  "scimax.db.ollamaUrl": "http://localhost:11434",
  "scimax.db.ollamaModel": "nomic-embed-text"
}
```

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

### Help (Emacs-style)
| Shortcut   | Command                                               |
|------------|-------------------------------------------------------|
| `Ctrl+h k` | Describe Key (type a key sequence to see its command) |
| `Ctrl+h b` | List all keybindings                                  |
| `Ctrl+h f` | Describe Command (find command by name)               |

### Capture
| Shortcut   | Command                   |
|------------|---------------------------|
| `Ctrl+c c` | Capture (template picker) |
| `Ctrl+c t` | Quick Capture TODO        |

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
| `Ctrl+c Ctrl+,`| Insert Block Below      | In org/md     |
| `Ctrl+c Ctrl+b`| Jump to Source Block    | In org/md     |
| `Ctrl+c Ctrl+j`| Jump to Heading         | In org/md     |
| `Ctrl+c Ctrl+o`| Open Link at Point      | In org/md     |
| `Ctrl+c Ctrl+l`| Insert Link             | In org/md     |
| `Ctrl+c Ctrl+t`| Cycle TODO State        | In org/md     |

---

## File Formats

The extension supports:
- **Org-mode** (`.org`): Full parsing of headings, properties, tags, timestamps, source blocks, links
- **Markdown** (`.md`): Structural editing parity with org-mode (headings, code blocks, navigation, speed commands)
- **LaTeX** (`.tex`): Section navigation, structure editing, environments, hover tooltips, completion
- **BibTeX** (`.bib`): Bibliography entries with all standard fields

---

## Comparison with Emacs Scimax

This package almost achieves feature parity with Emacs Scimax. If there are features missing it is likely because I don't use them anymore or frequently.

| Feature              | Emacs Scimax       | VS Code Scimax                        |
|----------------------|--------------------|---------------------------------------|
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
| Export               | ox-*               | Full support (HTML, LaTeX, MD, PDF, DOCX) |
| Tables               | org-table          | Full support + export to CSV/HTML     |
| Speed Commands       | org-speed-commands | Full support (37 commands)            |
| Clocking             | org-clock          | Full support (in/out, reports, tables)|
| Contacts             | org-contacts       | Not yet                               |
| Capture Templates    | org-capture        | Full support (templates, datetree)    |
| Markdown Support     | -                  | Full structural editing parity        |
| LaTeX Navigation     | AUCTeX             | Full support (sections, environments) |

---

## Scimax VS Code Codebase Statistics

| Metric              | Count    |
|---------------------|----------|
| TypeScript files    | 252      |
| Lines of TypeScript | ~153,700 |
| Test files          | 57       |
| Unit tests          | 2406     |
| Documentation files | 43       |
| Commands            | 547      |
| Keybindings         | 382      |

### Supported Languages (Babel Execution)

Python, JavaScript, TypeScript, Shell (bash/sh), SQL, R, Julia, plus any Jupyter kernel via `jupyter-*` prefix.

### Parser Performance

Benchmarks on typical documents (may vary by system):

| Document Size                  | Parse Time (avg) |
|--------------------------------|------------------|
| Small (~3.5K chars, 177 lines) | <5ms             |
| Medium (~9K chars, 428 lines)  | <10ms            |
| Large (~34K chars, 1571 lines) | <25ms            |

The parser scales linearly with document size and handles documents with hundreds of headings, source blocks, and deeply nested structures efficiently.

---

## Troubleshooting & Logging

Scimax includes a rotating file logger for debugging issues:

**Commands:**
| Command                          | Description                        |
|----------------------------------|------------------------------------|
| `Scimax: Open Log File Directory`| Open the directory containing logs |

**Log Files:**
- Logs are written to `scimax.log` in the extension's storage directory
- Automatic rotation when file exceeds size limit (default 1MB)
- Keeps configurable number of backup files (`scimax.log.1`, `scimax.log.2`, etc.)

**Configuration:**
```json
{
  "scimax.logLevel": "info",       // debug, info, warn, error
  "scimax.logMaxSizeKB": 1024,     // Max log file size before rotation
  "scimax.logBackupCount": 3       // Number of backup files to keep
}
```

---

## Contributing

Contributions welcome! Please see the [GitHub repository](https://github.com/jkitchin/scimax_vscode).

## License

MIT License - see LICENSE file for details.

## Inspiration & Acknowledgments

This project is a reimplementation of concepts and workflows from the Emacs ecosystem for VS Code. We gratefully acknowledge the following projects that inspired this work:

### Core Inspiration

- **[Org-mode](https://orgmode.org/)** - The foundational system for outlining, task management, and literate programming in Emacs. Org-mode's elegant plain-text format and powerful features are the heart of what we're bringing to VS Code.

- **[Scimax](https://github.com/jkitchin/scimax)** - An Emacs configuration for scientists and engineers by John Kitchin. Scimax extends org-mode with features specifically designed for scientific computing, reproducible research, and technical writing. This VS Code extension is a spiritual successor to Scimax.

### Feature Inspirations

- **[org-ref](https://github.com/jkitchin/org-ref)** - Bibliography and citation management for org-mode. Our reference management system, including citation links, BibTeX integration, and crossref/OpenAlex lookups, follows org-ref's design.

- **[org-db](https://github.com/jkitchin/org-db)** - A database for indexing and searching org files. Our SQLite-based database with FTS5 full-text search and semantic vector search is inspired by org-db.

- **[Swiper/Ivy](https://github.com/abo-abo/swiper)** - Completion and narrowing framework for Emacs. Our fuzzy search feature brings swiper-style incremental search to VS Code.

- **[Avy](https://github.com/abo-abo/avy)** - Jump to visible text using a char-based decision tree. Our jump feature implements avy-style navigation.

- **[Projectile](https://github.com/bbatsov/projectile)** - Project management for Emacs. Our project management features draw from projectile's approach.

- **[Hydra](https://github.com/abo-abo/hydra)** - Sticky key bindings for Emacs. Our hydra menu system brings this concept to VS Code.

### Org-mode Babel

The source block execution system (Babel) is inspired by org-babel, which pioneered literate programming and reproducible research in plain text documents.

### Thank You

Special thanks to the Emacs community and all the developers who have built these incredible tools over the years. While this is a clean-room reimplementation for VS Code, the ideas and workflows we're implementing come from decades of innovation in the Emacs ecosystem.

 # Should you use this?

 I hope so; I use it every day. I have used the previous version of scimax for over a decade in Emacs. So why VS Code now? I have increasingly needed to use VS Code to work with a Kubernetes cluster we use in my research group, and my students have all migrated to VS Code and away from Emacs.

 I was never able to get anything resembling the Emacs experience on my own because I lack familiarity with Typescript and the way VS Code works. Claude Code changed that dramatically, and in less than two weeks I was able to create nearly the same Emacs experience I am accustomed to in VS Code, i.e. similar key bindings, similar functionality, across every dimension of org-mode, org-ref, and all the scimax tools I built over the past decade. VS Code is not like Emacs, and it is not generally possible to get exact feature parity; but I think we get pretty close. I was even able to extend much of this to markdown and LaTeX to provide a first-class scientific writing tool.

 Are there risks you should be aware of? org-mode in Emacs was created in 2003, and has over two decades of community development and experience. scimax in VS Code does not have that yet. I hope we will build that over time.

 I have made some choices, like relying on a Sqlite database to enable full text, semantic search and agenda building across all your org-files, that are not standard in org-mode. It has been the most difficult task to get this working, but I am sure it will be worth it. While I have tried to keep true to the org-mode syntax and experience, I have added the scimax features I find critical for my own work, and that I want to be readily available for you. This is in alignment with my approach to scimax and org-ref in the past, but not in good alignment with the org-mode community who tend to prefer (in my experience) modular choices.