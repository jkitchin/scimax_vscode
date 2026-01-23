# Comprehensive Org-Mode for VS Code: Implementation Plan

## Executive Summary

This document outlines a comprehensive plan for implementing a full-featured org-mode system in VS Code, inspired by Emacs org-mode (128+ elisp files) and building on the existing scimax_vscode foundation. The goal is to create a first-class org-mode experience that leverages VS Code's modern architecture while maintaining compatibility with the org-mode ecosystem.

## Current State Analysis

### Emacs Org-Mode Architecture (128 Files)

The reference implementation consists of these major subsystems:

| Category      | Files                                           | Description                                |
| ----------    | -------                                         | -------------                              |
| **Core**      | org.el, org-macs.el, org-compat.el, org-keys.el | Foundation, macros, compatibility          |
| **Parser**    | org-element.el, org-element-ast.el              | Complete syntax parser, AST manipulation   |
| **Babel**     | ob-core.el + 40 ob-*.el language files          | Literate programming, code execution       |
| **Export**    | ox.el + 12 ox-*.el backends                     | Export to HTML, LaTeX, PDF, Markdown, etc. |
| **Citations** | oc.el + 5 oc-*.el processors                    | Citation management                        |
| **Links**     | ol.el + 13 ol-*.el types                        | Link handling for various protocols        |
| **Agenda**    | org-agenda.el                                   | Timeline views, scheduling                 |
| **Capture**   | org-capture.el, org-refile.el                   | Quick capture, refiling                    |
| **Time**      | org-clock.el, org-timer.el, org-habit.el        | Time tracking, habits                      |
| **Tables**    | org-table.el                                    | Spreadsheet-like tables                    |
| **UI**        | org-faces.el, org-fold.el, org-indent.el        | Visual presentation                        |

### Existing scimax_vscode Foundation

**Already Implemented:**
- Org parser with headings, blocks, links, timestamps, properties, tags
- **Unified AST parser** (org-element compatible) - `orgParserUnified.ts`
- SQLite database with FTS5 full-text search + vector semantic search
- Citation/bibliography management (org-ref compatible)
- Journal system with calendar view
- Task management with agenda views
- Heading manipulation, table operations, timestamp cycling
- Hydra menu framework
- Semantic highlighting and folding
- Project/notebook detection
- **Babel code execution** - Python, JS, Shell, SQL, R with sessions
- **Native Jupyter kernel support** - ZeroMQ-based, jupyter-* syntax
- **Export system** - HTML, LaTeX, Markdown, PDF
- **Scimax-org** - Text markup, DWIM return, heading navigation
- **Scimax-ob** - Block manipulation (split, merge, clone, move)
- **Enhanced tables** - Named tables, export to CSV/HTML/LaTeX
- **Basic clocking** - Clock in/out, duration tracking
- **Image preview on hover** - For org image links

**Not Yet Implemented:**
- Capture templates
- Advanced clocking reports
- Recurring events expansion
- LaTeX preview (inline math rendering)
- Backlinks/graph view
- org-contacts

---

## Implementation Phases

### Phase 1: Enhanced Parser & Core Infrastructure

**Goal:** Create a complete org-element compatible parser that forms the foundation for all other features.

#### 1.1 Complete Org-Element Parser

Extend `orgParser.ts` to support the full org-mode syntax specification:

```typescript
// New element types to support
interface OrgElement {
  type: OrgElementType;
  begin: number;
  end: number;
  contentsBegin?: number;
  contentsEnd?: number;
  postBlank: number;
  parent?: OrgElement;
  properties: Record<string, any>;
}

type OrgElementType =
  // Greater Elements
  | 'headline' | 'section' | 'plain-list' | 'drawer'
  | 'property-drawer' | 'footnote-definition' | 'table'
  | 'special-block' | 'center-block' | 'quote-block'
  | 'verse-block' | 'comment-block' | 'example-block'
  | 'export-block' | 'src-block'
  // Lesser Elements
  | 'babel-call' | 'clock' | 'comment' | 'diary-sexp'
  | 'fixed-width' | 'horizontal-rule' | 'keyword' | 'latex-environment'
  | 'node-property' | 'paragraph' | 'planning' | 'table-row'
  // Objects
  | 'bold' | 'code' | 'entity' | 'export-snippet' | 'footnote-reference'
  | 'inline-babel-call' | 'inline-src-block' | 'italic' | 'line-break'
  | 'latex-fragment' | 'link' | 'macro' | 'radio-target' | 'statistics-cookie'
  | 'strike-through' | 'subscript' | 'superscript' | 'table-cell'
  | 'target' | 'timestamp' | 'underline' | 'verbatim';
```

**Key Parser Functions:**

| Function                             | Purpose                        |
| ----------                           | ---------                      |
| `parseBuffer()`                      | Full document parse to AST     |
| `parseElement()`                     | Parse element at point         |
| `elementAt(position)`                | Get element at buffer position |
| `elementContext(position)`           | Get context (parent chain)     |
| `elementMap(tree, callback, types?)` | Traverse AST with type filter  |
| `interpretData(ast)`                 | Convert AST back to org text   |

**Files:**
- `src/parser/orgElement.ts` - Core element definitions
- `src/parser/orgElementParser.ts` - Streaming parser
- `src/parser/orgElementInterpreter.ts` - AST → text conversion
- `src/parser/orgElementApi.ts` - High-level manipulation API

#### 1.2 Property System Enhancement

```typescript
interface OrgProperties {
  // Standard properties
  ID?: string;
  CREATED?: string;
  CATEGORY?: string;
  COLUMNS?: string;
  ARCHIVE?: string;
  LOGGING?: string;

  // Export properties
  EXPORT_FILE_NAME?: string;
  EXPORT_OPTIONS?: string;

  // Babel properties
  HEADER_ARGS?: string;

  // Custom properties
  [key: string]: string | undefined;
}
```

#### 1.3 Document Keywords System

Support all standard keywords:

```typescript
const AFFILIATED_KEYWORDS = [
  'CAPTION', 'DATA', 'HEADER', 'HEADERS', 'LABEL',
  'NAME', 'PLOT', 'RESNAME', 'RESULT', 'RESULTS',
  'SOURCE', 'SRCNAME', 'TBLNAME'
];

const DOCUMENT_KEYWORDS = [
  'AUTHOR', 'DATE', 'TITLE', 'EMAIL',
  'LANGUAGE', 'OPTIONS', 'STARTUP',
  'PRIORITIES', 'TODO', 'SEQ_TODO', 'TYP_TODO',
  'TAGS', 'FILETAGS', 'ARCHIVE',
  'PROPERTY', 'SETUPFILE', 'INCLUDE',
  'BIND', 'MACRO', 'LATEX_HEADER', 'HTML_HEAD'
];
```

---

### Phase 2: Babel - Literate Programming System

**Goal:** Execute code blocks inline and support the core Babel workflow.

#### 2.1 Architecture

```
src/babel/
├── babelCore.ts           # Core execution engine
├── babelSession.ts        # Session management
├── babelResults.ts        # Result handling and insertion
├── babelTangle.ts         # Code extraction (tangle)
├── babelHeaders.ts        # Header argument parsing
├── babelVariables.ts      # Variable references and noweb
├── babelCache.ts          # Execution caching
├── languages/
│   ├── babelLanguage.ts   # Base language interface
│   ├── babelPython.ts     # Python support
│   ├── babelJavascript.ts # JavaScript/TypeScript
│   ├── babelShell.ts      # Shell (bash, sh, zsh)
│   ├── babelSql.ts        # SQL databases
│   └── babelR.ts          # R statistical computing
├── commands.ts
└── providers.ts
```

#### 2.2 Core Execution Interface

```typescript
interface BabelLanguage {
  name: string;
  aliases: string[];

  // Execute code and return result
  execute(code: string, params: BabelParams): Promise<BabelResult>;

  // Session support
  supportsSession: boolean;
  createSession?(name: string): Promise<BabelSession>;

  // REPL integration
  sendToRepl?(code: string): Promise<void>;
}

interface BabelParams {
  // Input/Output
  var?: Record<string, any>;       // Variable bindings
  results?: 'value' | 'output';    // What to capture
  exports?: 'code' | 'results' | 'both' | 'none';

  // Execution
  session?: string;                 // Named session
  dir?: string;                     // Working directory
  cache?: 'yes' | 'no';            // Cache results
  noweb?: 'yes' | 'no';            // Expand noweb references

  // Output formatting
  wrap?: string;                    // Wrap in block
  colnames?: 'yes' | 'no' | 'nil'; // Table column names
  rownames?: 'yes' | 'no';         // Table row names
  hlines?: 'yes' | 'no';           // Horizontal lines

  // Tangling
  tangle?: string | 'yes' | 'no';  // Output file
  comments?: 'link' | 'yes' | 'no' | 'both';
  padline?: 'yes' | 'no';
  shebang?: string;
  mkdirp?: 'yes' | 'no';
}

interface BabelResult {
  type: 'value' | 'output' | 'error' | 'table' | 'file' | 'html' | 'latex';
  value: any;
  raw?: string;
}
```

#### 2.3 Header Argument Parsing

```typescript
// Parse: #+BEGIN_SRC python :var x=data :results output :session main
function parseHeaderArgs(line: string): BabelParams {
  const params: BabelParams = {};
  const regex = /:(\w+)\s+([^\s:]+(?:\s+[^\s:]+)*)/g;
  // ... parse into structured params
  return params;
}
```

#### 2.4 Result Insertion

```typescript
// Insert results after #+END_SRC
async function insertResult(
  editor: vscode.TextEditor,
  block: OrgSourceBlock,
  result: BabelResult
): Promise<void> {
  // Handle different result types:
  // - value → #+RESULTS: \n: value
  // - table → #+RESULTS: \n| col1 | col2 |
  // - file → #+RESULTS: \n[[file:path]]
  // - html → #+RESULTS: \n#+BEGIN_EXPORT html\n...\n#+END_EXPORT
}
```

#### 2.5 Language Implementations

**Python:**
```typescript
class BabelPython implements BabelLanguage {
  name = 'python';
  aliases = ['py', 'python3'];
  supportsSession = true;

  async execute(code: string, params: BabelParams): Promise<BabelResult> {
    // Option 1: Use vscode-python extension's kernel
    // Option 2: Spawn python process directly
    // Option 3: Connect to Jupyter kernel
  }
}
```

**JavaScript/TypeScript:**
```typescript
class BabelJavascript implements BabelLanguage {
  name = 'javascript';
  aliases = ['js', 'node', 'typescript', 'ts'];

  async execute(code: string, params: BabelParams): Promise<BabelResult> {
    // Use Node.js vm module for sandboxed execution
    // Or spawn node process
  }
}
```

**Shell:**
```typescript
class BabelShell implements BabelLanguage {
  name = 'shell';
  aliases = ['sh', 'bash', 'zsh'];

  async execute(code: string, params: BabelParams): Promise<BabelResult> {
    // Use VS Code terminal or child_process
  }
}
```

#### 2.6 Tangle (Code Extraction)

```typescript
interface TangleConfig {
  file: string;           // Target file
  mkdirp: boolean;        // Create directories
  comments: 'link' | 'yes' | 'no' | 'both';
  padline: boolean;
  shebang?: string;
}

async function tangleFile(document: vscode.TextDocument): Promise<string[]> {
  // Extract all src blocks with :tangle headers
  // Write to specified files
  // Return list of generated files
}
```

#### 2.7 Priority Languages

| Priority   | Language              | Rationale                            |
| ---------- | ----------            | -----------                          |
| P0         | Python                | Most common for scientific computing |
| P0         | JavaScript/TypeScript | Native to VS Code ecosystem          |
| P0         | Shell (bash)          | Universal scripting                  |
| P1         | SQL                   | Data analysis workflows              |
| P1         | R                     | Statistical computing                |
| P2         | Julia                 | Emerging scientific language         |
| P2         | Rust                  | Systems programming                  |
| P2         | Go                    | Cloud/DevOps workflows               |

---

### Phase 3: Export System

**Goal:** Export org documents to multiple formats.

#### 3.1 Architecture

```
src/export/
├── exportCore.ts          # Core export engine
├── exportBackend.ts       # Backend interface
├── exportTranscoder.ts    # AST transformation
├── exportFilter.ts        # Filter system
├── backends/
│   ├── exportHtml.ts      # HTML export
│   ├── exportMarkdown.ts  # Markdown (GFM, CommonMark)
│   ├── exportLatex.ts     # LaTeX export
│   ├── exportPdf.ts       # PDF via LaTeX/Pandoc
│   ├── exportOdt.ts       # OpenDocument
│   ├── exportOrg.ts       # Normalized org
│   └── exportBeamer.ts    # Beamer presentations
├── commands.ts
└── providers.ts
```

#### 3.2 Backend Interface

```typescript
interface ExportBackend {
  name: string;
  extensions: string[];

  // Transcoding functions for each element type
  transcoders: {
    [key in OrgElementType]?: (
      element: OrgElement,
      contents: string,
      info: ExportInfo
    ) => string;
  };

  // Template for final document
  template(body: string, info: ExportInfo): string;

  // Pre/post processing
  filters?: ExportFilter[];
}

interface ExportInfo {
  // Document metadata
  title?: string;
  author?: string;
  date?: string;
  email?: string;
  language?: string;

  // Export options
  options: ExportOptions;

  // Backend-specific data
  backend: string;

  // Input file info
  inputFile?: string;
  outputFile?: string;
}
```

#### 3.3 HTML Backend

```typescript
const htmlTranscoders: ExportBackend['transcoders'] = {
  'headline': (el, contents, info) => {
    const level = el.properties.level;
    const title = el.properties.rawValue;
    const id = generateId(el);
    return `<h${level} id="${id}">${title}</h${level}>\n${contents}`;
  },

  'paragraph': (el, contents, info) => {
    return `<p>${contents}</p>\n`;
  },

  'src-block': (el, contents, info) => {
    const lang = el.properties.language;
    const code = escapeHtml(el.properties.value);
    return `<pre><code class="language-${lang}">${code}</code></pre>\n`;
  },

  'link': (el, contents, info) => {
    const href = resolveLink(el.properties.path, info);
    const text = contents || el.properties.path;
    return `<a href="${href}">${text}</a>`;
  },

  'bold': (el, contents) => `<strong>${contents}</strong>`,
  'italic': (el, contents) => `<em>${contents}</em>`,
  'code': (el) => `<code>${el.properties.value}</code>`,
  // ... more transcoders
};
```

#### 3.4 LaTeX Backend

```typescript
const latexTranscoders: ExportBackend['transcoders'] = {
  'headline': (el, contents, info) => {
    const commands = ['section', 'subsection', 'subsubsection',
                      'paragraph', 'subparagraph'];
    const level = Math.min(el.properties.level - 1, commands.length - 1);
    const title = latexEscape(el.properties.rawValue);
    return `\\${commands[level]}{${title}}\n${contents}`;
  },

  'src-block': (el, contents, info) => {
    const lang = el.properties.language;
    const code = el.properties.value;
    return `\\begin{lstlisting}[language=${lang}]\n${code}\n\\end{lstlisting}\n`;
  },

  'latex-fragment': (el) => el.properties.value,
  'latex-environment': (el) => el.properties.value,

  // ... more transcoders
};
```

#### 3.5 Export Commands

```typescript
// Register export commands
vscode.commands.registerCommand('scimax.export.html', async () => {
  await exportDocument('html');
});

vscode.commands.registerCommand('scimax.export.pdf', async () => {
  await exportDocument('pdf');
});

vscode.commands.registerCommand('scimax.export.markdown', async () => {
  await exportDocument('markdown');
});

// Export with options dialog
vscode.commands.registerCommand('scimax.export.dispatch', async () => {
  // Show QuickPick with export options
});
```

#### 3.6 PDF Generation Strategies

1. **LaTeX → PDF**: Full TeX installation required
2. **Pandoc**: Universal converter
3. **Puppeteer/Playwright**: HTML → PDF via headless browser
4. **Prince/WeasyPrint**: High-quality HTML → PDF

---

### Phase 4: Capture System

**Goal:** Quick entry and refiling of notes and tasks.

#### 4.1 Architecture

```
src/capture/
├── captureManager.ts      # Template management
├── captureTemplate.ts     # Template definition/parsing
├── captureBuffer.ts       # Capture buffer UI
├── refileManager.ts       # Refiling logic
├── commands.ts
└── providers.ts
```

#### 4.2 Template Definition

```typescript
interface CaptureTemplate {
  key: string;              // Shortcut key
  name: string;             // Display name
  icon?: string;            // VS Code icon

  // Target specification
  target: CaptureTarget;

  // Template content
  template: string;         // Template with %placeholders

  // Behavior
  prepend?: boolean;        // Add at beginning
  emptyLines?: number;      // Blank lines before/after
  immediateFinish?: boolean; // Skip editing
  clock?: {
    in?: boolean;           // Clock in after capture
    resume?: boolean;       // Resume previous clock
  };

  // Context
  contexts?: string[];      // When to show this template
}

type CaptureTarget =
  | { type: 'file'; path: string }
  | { type: 'file-headline'; path: string; headline: string }
  | { type: 'file-olp'; path: string; outline: string[] }
  | { type: 'file-datetree'; path: string; tree?: 'day' | 'week' | 'month' }
  | { type: 'clock' }       // Currently clocked entry
  | { type: 'function'; fn: () => CaptureTarget };
```

#### 4.3 Template Placeholders

| Placeholder | Expansion |
|-------------|-----------|
| `%t` | Timestamp `<2025-01-12 Sun>` |
| `%T` | Timestamp with time `<2025-01-12 Sun 10:30>` |
| `%u` | Inactive timestamp `[2025-01-12 Sun]` |
| `%U` | Inactive with time |
| `%i` | Selected text (if any) |
| `%a` | Annotation (link to location) |
| `%A` | Like `%a` but prompt for description |
| `%l` | Like `%a` but only link |
| `%f` | File visited |
| `%F` | Full path |
| `%n` | User name |
| `%c` | Current kill ring head |
| `%x` | Clipboard content |
| `%^g` | Prompt for tags |
| `%^t` | Prompt for date |
| `%^{prompt}` | Prompt for string |
| `%^{prompt\|default}` | Prompt with default |
| `%^{prompt\|opt1\|opt2}` | Prompt with options |
| `%?` | Cursor position after expansion |

#### 4.4 Default Templates

```typescript
const defaultTemplates: CaptureTemplate[] = [
  {
    key: 't',
    name: 'Task',
    target: { type: 'file', path: '${workspaceFolder}/inbox.org' },
    template: '* TODO %?\n  SCHEDULED: %t\n  :PROPERTIES:\n  :CREATED: %U\n  :END:\n',
  },
  {
    key: 'n',
    name: 'Note',
    target: { type: 'file-datetree', path: '${workspaceFolder}/notes.org' },
    template: '* %?\n  :PROPERTIES:\n  :CREATED: %U\n  :END:\n',
  },
  {
    key: 'm',
    name: 'Meeting',
    target: { type: 'file-headline', path: '${workspaceFolder}/meetings.org', headline: 'Meetings' },
    template: '* %^{Meeting Title}\n  SCHEDULED: %^t\n** Attendees\n   - %?\n** Agenda\n** Notes\n** Action Items\n',
  },
  {
    key: 'j',
    name: 'Journal',
    target: { type: 'file-datetree', path: '${workspaceFolder}/journal.org', tree: 'day' },
    template: '* %U %?\n',
  },
  {
    key: 'l',
    name: 'Link',
    target: { type: 'file', path: '${workspaceFolder}/links.org' },
    template: '* [[%x][%^{Description}]]\n  :PROPERTIES:\n  :CREATED: %U\n  :END:\n  %?\n',
  },
];
```

#### 4.5 Capture UI

```typescript
class CaptureBuffer {
  private panel: vscode.WebviewPanel;
  private template: CaptureTemplate;
  private expandedContent: string;

  async show(): Promise<void> {
    // Create webview panel or use virtual document
    // Show template with prompts resolved
    // Allow editing
    // On save: insert at target
  }
}
```

#### 4.6 Refile System

```typescript
interface RefileConfig {
  targets: RefileTarget[];
  useOutlinePath?: boolean;
  allowCreatingParent?: boolean;
  useCache?: boolean;
}

type RefileTarget =
  | { file: string; maxLevel?: number }
  | { file: string; headline: string }
  | { files: string[]; maxLevel?: number };

async function refile(
  heading: OrgHeading,
  target: { file: string; outline: string[] }
): Promise<void> {
  // Extract heading subtree
  // Delete from source
  // Insert at target location
  // Update any links
}
```

---

### Phase 5: Enhanced Agenda System

**Goal:** Full-featured agenda with dynamic views.

#### 5.1 Architecture

```
src/agenda/
├── agendaCore.ts          # Core agenda engine
├── agendaViews.ts         # View types (day, week, month, custom)
├── agendaFilter.ts        # Filtering system
├── agendaSort.ts          # Sorting strategies
├── agendaRecurring.ts     # Recurring event expansion
├── agendaHabits.ts        # Habit tracking
├── agendaWebview.ts       # Rich agenda UI
├── commands.ts
└── providers.ts
```

#### 5.2 Agenda Item Types

```typescript
interface AgendaItem {
  type: 'scheduled' | 'deadline' | 'timestamp' | 'sexp' | 'habit';
  date: Date;
  time?: { hour: number; minute: number };
  endDate?: Date;
  endTime?: { hour: number; minute: number };

  // Source info
  heading: OrgHeading;
  filePath: string;
  lineNumber: number;

  // Display info
  category?: string;
  todoState?: string;
  priority?: string;
  tags: string[];

  // Computed
  daysUntil: number;
  isOverdue: boolean;
  isToday: boolean;

  // For recurring
  repeater?: {
    type: '+' | '++' | '.+';
    value: number;
    unit: 'd' | 'w' | 'm' | 'y';
  };

  // For habits
  habit?: {
    consistency: number[];  // Last N completions
    streak: number;
    lastDone?: Date;
  };
}
```

#### 5.3 View Types

```typescript
type AgendaViewType =
  | 'day'           // Single day
  | 'week'          // 7 days
  | 'fortnight'     // 14 days
  | 'month'         // Calendar month
  | 'year'          // Year overview
  | 'todo'          // All TODOs
  | 'tags'          // Tag search
  | 'search'        // Full text search
  | 'stuck'         // Stuck projects
  | 'custom';       // Custom query

interface AgendaView {
  type: AgendaViewType;
  span?: number;
  startDay?: Date;
  filter?: AgendaFilter;
  sort?: AgendaSortStrategy[];
  groups?: AgendaGrouping;
}
```

#### 5.4 Custom Agenda Queries

```typescript
interface AgendaQuery {
  name: string;
  key: string;
  type: AgendaViewType;

  // Selection criteria
  files?: string[];
  match?: string;           // Tag/property match
  todoKeywords?: string[];
  priority?: string[];

  // Time range
  span?: number;
  startOffset?: number;

  // Display
  sorting?: AgendaSortStrategy[];
  groupBy?: 'category' | 'tag' | 'todo' | 'priority' | 'date';
}

// Example: Week agenda + all TODOs
const customAgenda: AgendaQuery[] = [
  { name: 'Week', key: 'w', type: 'week' },
  { name: 'All TODOs', key: 't', type: 'todo' },
  { name: 'High Priority', key: 'h', type: 'todo', priority: ['A', 'B'] },
  { name: 'Work', key: 'W', type: 'tags', match: 'work' },
];
```

#### 5.5 Recurring Events

```typescript
function expandRecurring(
  item: AgendaItem,
  startDate: Date,
  endDate: Date
): AgendaItem[] {
  // Handle repeater types:
  // +1d  - Shift by N days from SCHEDULED/DEADLINE
  // ++1d - Shift to next future occurrence
  // .+1d - Shift from today (completion date)

  // Generate instances within date range
}
```

#### 5.6 Habit Tracking

```typescript
interface HabitItem extends AgendaItem {
  habit: {
    // Configuration
    minInterval: number;    // Days (from .+Nd/Md)
    maxInterval: number;

    // History (from :LOGBOOK:)
    completions: Date[];

    // Computed
    streak: number;
    consistency: number;    // Percentage
    nextDue: Date;
    overdue: boolean;

    // Visual
    graph: ('done' | 'overdue' | 'ok' | 'future')[];
  };
}
```

#### 5.7 Agenda Webview

Rich interactive agenda using VS Code webview:

- Calendar navigation
- Day/week/month views
- Drag-and-drop rescheduling
- Inline editing
- Habit graphs
- Filter controls
- Export to iCal

---

### Phase 6: Time Tracking (Clocking)

**Goal:** Track time spent on tasks.

#### 6.1 Architecture

```
src/clock/
├── clockManager.ts        # Core clock state
├── clockHistory.ts        # :LOGBOOK: parsing/writing
├── clockReport.ts         # Time reports
├── clockTable.ts          # Clock table generation
├── commands.ts
└── providers.ts
```

#### 6.2 Clock Interface

```typescript
interface ClockManager {
  // State
  currentTask: OrgHeading | null;
  clockedIn: boolean;
  clockStart: Date | null;

  // Actions
  clockIn(heading?: OrgHeading): Promise<void>;
  clockOut(note?: string): Promise<void>;
  clockCancel(): Promise<void>;

  // Modify
  updateClockLine(heading: OrgHeading, clockLine: number, newTimes: { start?: Date; end?: Date }): Promise<void>;

  // Query
  getClockHistory(heading: OrgHeading): ClockEntry[];
  getTotalTime(heading: OrgHeading, includeChildren?: boolean): Duration;

  // Reports
  generateClockReport(options: ClockReportOptions): ClockReport;
}

interface ClockEntry {
  start: Date;
  end?: Date;
  duration?: Duration;
  note?: string;
}

interface ClockReportOptions {
  scope: 'file' | 'subtree' | 'agenda';
  range?: { start: Date; end: Date };
  step?: 'day' | 'week' | 'month';
  hideEmpty?: boolean;
  maxLevel?: number;
}
```

#### 6.3 LOGBOOK Format

```org
* TODO Task title
  :LOGBOOK:
  CLOCK: [2025-01-12 Sun 10:00]--[2025-01-12 Sun 11:30] =>  1:30
  CLOCK: [2025-01-11 Sat 14:00]--[2025-01-11 Sat 15:00] =>  1:00
  :END:
```

#### 6.4 Clock Table

```org
#+BEGIN: clocktable :scope file :maxlevel 2
#+CAPTION: Clock summary
| Heading           | Time    |
|-------------------|---------|
| *Total time*      | *12:30* |
| Task 1            |    3:00 |
| \_  Subtask 1.1   |    1:00 |
| \_  Subtask 1.2   |    2:00 |
| Task 2            |    9:30 |
#+END:
```

#### 6.5 Status Bar Integration

```typescript
// Show current clock in status bar
class ClockStatusBar {
  private statusItem: vscode.StatusBarItem;
  private timer: NodeJS.Timer | null;

  update(): void {
    if (this.manager.clockedIn) {
      const elapsed = this.formatDuration(this.manager.getElapsed());
      const task = this.manager.currentTask?.title.substring(0, 30);
      this.statusItem.text = `$(clock) ${elapsed} - ${task}`;
      this.statusItem.show();
    } else {
      this.statusItem.hide();
    }
  }
}
```

---

### Phase 7: Enhanced Links System

**Goal:** Full link protocol support with backlinks.

#### 7.1 Link Protocols

| Protocol      | Example                      | Handler                        |
| ----------    | ---------                    | ---------                      |
| `file:`       | `file:path/to.org::*heading` | Open file, navigate to heading |
| `id:`         | `id:abc-123-def`             | Find by CUSTOM_ID              |
| `http/https:` | `https://example.com`        | Open browser                   |
| `mailto:`     | `mailto:user@example.com`    | Open email client              |
| `shell:`      | `shell:ls -la`               | Execute shell command          |
| `elisp:`      | `elisp:(message "hi")`       | N/A (Emacs only)               |
| `doi:`        | `doi:10.1000/xyz`            | Open DOI resolver              |
| `cite:`       | `cite:author2020`            | Navigate to bibliography       |
| `attachment:` | `attachment:file.pdf`        | Open attachment                |
| `custom:`     | `jira:PROJ-123`              | Custom handlers                |

#### 7.2 Custom Link Types

```typescript
interface LinkType {
  protocol: string;
  follow(path: string): Promise<void>;
  complete?(prefix: string): Promise<string[]>;
  face?: string;  // Syntax highlighting
  export?: {
    html?: (path: string, desc: string) => string;
    latex?: (path: string, desc: string) => string;
  };
}

// Register custom link types
linkManager.registerType({
  protocol: 'jira',
  follow: async (key) => {
    const url = `https://jira.company.com/browse/${key}`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  },
  complete: async (prefix) => {
    // Fetch matching JIRA issues
  },
});
```

#### 7.3 Backlinks (Org-Roam Style)

```typescript
interface BacklinkManager {
  // Get all documents linking to this one
  getBacklinks(filePath: string): Promise<BacklinkInfo[]>;
  getBacklinksToHeading(id: string): Promise<BacklinkInfo[]>;

  // Graph visualization
  getGraph(): Promise<GraphData>;
  getLocalGraph(filePath: string, depth?: number): Promise<GraphData>;
}

interface BacklinkInfo {
  sourceFile: string;
  sourceLine: number;
  sourceHeading?: string;
  context: string;       // Surrounding text
  linkType: string;
}

interface GraphData {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string; label?: string }[];
}
```

#### 7.4 Graph Visualization

Create a webview-based graph visualization:

```typescript
class GraphWebview {
  private panel: vscode.WebviewPanel;

  async show(data: GraphData): Promise<void> {
    // Use D3.js or vis.js for force-directed graph
    // Nodes = documents/headings
    // Edges = links between them
    // Click to navigate
  }
}
```

---

### Phase 8: LaTeX & Math Preview

**Goal:** Render LaTeX inline.

#### 8.1 Features

- Inline math preview on hover
- Equation block preview
- LaTeX fragment compilation
- MathJax/KaTeX rendering

#### 8.2 Implementation

```typescript
class LatexPreviewProvider implements vscode.HoverProvider {
  async provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const latex = this.extractLatex(document, position);
    if (!latex) return null;

    // Render to SVG using:
    // 1. MathJax (Node.js package)
    // 2. KaTeX (faster, more limited)
    // 3. External LaTeX (full TeX support)

    const svg = await this.renderLatex(latex);
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`![equation](data:image/svg+xml,${encodeURIComponent(svg)})`);
    return new vscode.Hover(markdown);
  }
}
```

---

### Phase 9: Mobile & Sync Considerations

**Goal:** Enable cross-device workflows.

#### 9.1 Sync Strategies

1. **Git-based**: Native org-mode approach
2. **Cloud storage**: Dropbox, iCloud, OneDrive
3. **Syncthing**: Peer-to-peer sync
4. **CRDTs**: Conflict-free merging (future)

#### 9.2 Mobile Companion Apps

- **Orgzly** (Android): Native org-mode support
- **beorg** (iOS): iOS org-mode client
- **MobileOrg**: Legacy mobile apps
- **Plain text editors**: Any editor that syncs

#### 9.3 Conflict Resolution

```typescript
interface SyncManager {
  detectConflicts(local: OrgDocument, remote: OrgDocument): Conflict[];
  mergeDocuments(local: OrgDocument, remote: OrgDocument): OrgDocument;
  resolveConflict(conflict: Conflict, resolution: 'local' | 'remote' | 'merge'): void;
}
```

---

## Implementation Priority Matrix

| Phase   | Feature                 | Impact    | Effort   | Priority   | Status     |
| ------- | ---------               | --------  | -------- | ---------- | --------   |
| 2       | Babel (Python/JS/Shell) | Very High | High     | P0         | ✅ Done    |
| 2       | Jupyter Kernels         | Very High | High     | P0         | ✅ Done    |
| 3       | HTML Export             | High      | Medium   | P1         | ✅ Done    |
| 3       | Markdown Export         | Medium    | Low      | P1         | ✅ Done    |
| 3       | LaTeX/PDF Export        | Medium    | High     | P2         | ✅ Done    |
| 6       | Time Tracking (Basic)   | High      | Medium   | P1         | ✅ Done    |
| 1       | Full org-element parser | Medium    | High     | P2         | ✅ Done    |
| -       | Scimax-org              | High      | Medium   | P1         | ✅ Done    |
| -       | Scimax-ob               | High      | Medium   | P1         | ✅ Done    |
| -       | Enhanced Tables         | Medium    | Medium   | P1         | ✅ Done    |
| 4       | Capture Templates       | Very High | Medium   | P0         | 🔲 Todo    |
| 5       | Enhanced Agenda         | High      | Medium   | P0         | 🔲 Partial |
| 7       | Backlinks/Graph         | High      | High     | P1         | 🔲 Todo    |
| 8       | LaTeX Preview           | Medium    | Medium   | P2         | 🔲 Todo    |
| 5       | Habit Tracking          | Medium    | Medium   | P2         | 🔲 Todo    |

---

## File Structure (Final)

```
src/
├── extension.ts
├── core/
│   ├── config.ts
│   └── utils.ts
├── parser/
│   ├── orgParser.ts          # Current (enhanced)
│   ├── orgElement.ts         # Element definitions
│   ├── orgElementParser.ts   # Full AST parser
│   ├── orgElementApi.ts      # Manipulation API
│   └── orgInterpreter.ts     # AST → text
├── database/
│   ├── orgDbSqlite.ts        # Current
│   └── embeddingService.ts
├── babel/
│   ├── babelCore.ts
│   ├── babelSession.ts
│   ├── babelResults.ts
│   ├── babelTangle.ts
│   ├── babelHeaders.ts
│   ├── languages/
│   │   ├── babelLanguage.ts
│   │   ├── babelPython.ts
│   │   ├── babelJavascript.ts
│   │   ├── babelShell.ts
│   │   ├── babelSql.ts
│   │   └── babelR.ts
│   ├── commands.ts
│   └── providers.ts
├── export/
│   ├── exportCore.ts
│   ├── exportBackend.ts
│   ├── backends/
│   │   ├── exportHtml.ts
│   │   ├── exportMarkdown.ts
│   │   ├── exportLatex.ts
│   │   ├── exportPdf.ts
│   │   └── exportOrg.ts
│   ├── commands.ts
│   └── providers.ts
├── capture/
│   ├── captureManager.ts
│   ├── captureTemplate.ts
│   ├── refileManager.ts
│   ├── commands.ts
│   └── providers.ts
├── agenda/
│   ├── agendaCore.ts
│   ├── agendaViews.ts
│   ├── agendaRecurring.ts
│   ├── agendaHabits.ts
│   ├── agendaWebview.ts
│   ├── commands.ts
│   └── providers.ts
├── clock/
│   ├── clockManager.ts
│   ├── clockHistory.ts
│   ├── clockReport.ts
│   ├── commands.ts
│   └── providers.ts
├── links/
│   ├── linkManager.ts
│   ├── linkTypes.ts
│   ├── backlinkManager.ts
│   ├── graphView.ts
│   ├── commands.ts
│   └── providers.ts
├── latex/
│   ├── latexPreview.ts
│   ├── latexRender.ts
│   ├── commands.ts
│   └── providers.ts
├── journal/                   # Current
├── references/               # Current
├── notebook/                 # Current
├── highlighting/             # Current
├── hydra/                    # Current
└── ...existing modules
```

---

## Technical Considerations

### Performance

1. **Incremental parsing**: Only re-parse changed regions
2. **Lazy loading**: Load language support on demand
3. **Web workers**: Off-main-thread parsing for large files
4. **Virtual scrolling**: Handle documents with 10k+ headings
5. **Indexed queries**: Leverage SQLite for all searches

### Compatibility

1. **Org-mode syntax**: Follow specification exactly
2. **Emacs defaults**: Match default behaviors where sensible
3. **Export fidelity**: Output should match Emacs export
4. **File format**: Never corrupt org files

### Testing Strategy

1. **Unit tests**: Parser, transcoders, utilities
2. **Integration tests**: Full workflows
3. **Snapshot tests**: Export output comparison
4. **Compatibility tests**: Compare with Emacs output
5. **Performance tests**: Large file benchmarks

---

## Dependencies to Add

```json
{
  "dependencies": {
    // Babel execution
    "node-pty": "^0.11.0",           // Terminal emulation
    "zeromq": "^6.0.0",              // Jupyter kernel protocol (optional)

    // Export
    "mathjax-node": "^2.1.1",        // LaTeX rendering
    "highlight.js": "^11.9.0",       // Code highlighting
    "puppeteer-core": "^22.0.0",     // PDF generation (optional)

    // Graph visualization
    "d3": "^7.8.0",                  // For backlink graph

    // Existing
    "@libsql/client": "...",
    "@xenova/transformers": "...",
    "date-fns": "...",
    "minimatch": "..."
  }
}
```

---

## Success Metrics

1. **Feature parity**: Cover 80% of daily org-mode workflows
2. **Performance**: Parse 10MB org file in < 1 second
3. **Compatibility**: Export matches Emacs output 95%+
4. **Adoption**: 10k+ weekly active users
5. **Satisfaction**: 4.5+ star rating on marketplace

---

## Timeline Considerations

This is a large project. Recommended implementation order:

1. **Foundation** (Phase 1): Enhanced parser for all features
2. **Quick Wins** (Phase 4): Capture templates - high value, moderate effort
3. **Core Features** (Phase 2, 5): Babel + Agenda - highest user demand
4. **Export** (Phase 3): Start with HTML/Markdown, add LaTeX later
5. **Advanced** (Phase 6, 7, 8): Clocking, backlinks, LaTeX preview

Each phase can be independently useful and should be released incrementally.

---

## References

- [Org Mode Manual](https://orgmode.org/org.html)
- [Org Syntax Specification](https://orgmode.org/worg/org-syntax.html)
- [Org Element API](https://orgmode.org/worg/dev/org-element-api.html)
- [Org Export Reference](https://orgmode.org/worg/dev/org-export-reference.html)
- [Babel Introduction](https://orgmode.org/worg/org-contrib/babel/intro.html)
- [GitHub: org-mode source](https://github.com/bzg/org-mode)
- [VS Code Extension API](https://code.visualstudio.com/api)

---

*This plan provides a comprehensive roadmap for building a full-featured org-mode experience in VS Code. The modular architecture allows incremental implementation while maintaining compatibility with the existing scimax_vscode foundation.*
