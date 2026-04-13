# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
make              # Full build: install deps, compile TypeScript, package VSIX
make compile      # TypeScript compilation only
make package      # Build VSIX (runs compile first)
make clean        # Remove out/, node_modules/, and *.vsix files

npm run compile   # Direct TypeScript compilation
npm run watch     # Watch mode for development
npm run lint      # ESLint
npm run test      # Vitest tests
```

## Architecture

This is a VS Code extension providing scientific computing features inspired by Emacs Scimax. Written in TypeScript, targeting VS Code 1.85+.

### Module Structure

```
src/
├── extension.ts              # Entry point, activates all features
├── parser/                   # Core parsing and export engines
│   ├── orgParser.ts          # Org-mode and Markdown parsing
│   ├── orgParserUnified.ts   # Full AST parser (org-element compatible)
│   ├── orgExportParser.ts    # Fast parser optimized for export
│   ├── orgBabel.ts           # Source block execution engine
│   ├── orgBabelAdvanced.ts   # Advanced Babel features (noweb, tangling)
│   ├── orgExport.ts          # Export framework and utilities
│   ├── orgExportHtml.ts      # HTML export backend
│   ├── orgExportLatex.ts     # LaTeX export backend
│   ├── orgExportDocx.ts      # DOCX export backend (via Pandoc)
│   ├── orgExportIpynb.ts     # Jupyter notebook export
│   ├── orgClocking.ts        # Time tracking and clock entries
│   ├── orgAgenda.ts          # Agenda item extraction
│   ├── orgEntities.ts        # Special character entities (→, α, etc.)
│   ├── orgInclude.ts         # #+INCLUDE directive handling
│   ├── orgSerialize.ts       # AST to org-mode text serialization
│   ├── orgModify.ts          # AST modification utilities
│   └── orgElementTypes.ts    # Type definitions for org elements
├── org/                      # VS Code org-mode integration
│   ├── babelProvider.ts      # VS Code integration for Babel execution
│   ├── exportProvider.ts     # Export commands and UI
│   ├── scimaxOrg.ts          # Text markup, DWIM return, navigation
│   ├── scimaxOb.ts           # Source block manipulation (scimax-ob)
│   ├── tableProvider.ts      # Table editing and formulas
│   ├── tableFormula.ts       # Spreadsheet-style table calculations
│   ├── hoverProvider.ts      # Hover previews (images, entities, links)
│   ├── completionProvider.ts # Smart completions
│   ├── documentSymbolProvider.ts # Document outline
│   ├── agendaProvider.ts     # Agenda views (day, week, month)
│   ├── captureProvider.ts    # Quick capture templates
│   ├── timestampProvider.ts  # Date/time insertion and manipulation
│   ├── todoStates.ts         # TODO state cycling and configuration
│   ├── orgLint.ts            # Document linting rules
│   ├── latexPreviewProvider.ts # Inline LaTeX preview
│   └── speedCommands/        # Single-key commands at headings
├── jupyter/                  # Jupyter kernel integration
│   ├── kernelManager.ts      # Jupyter kernel lifecycle
│   ├── kernelConnection.ts   # ZeroMQ socket handling
│   ├── jupyterExecutor.ts    # Babel integration for jupyter-*
│   └── kernelSpec.ts         # Kernel discovery
├── database/                 # SQLite database layer
│   ├── scimaxDb.ts           # Main database with FTS5 + vector search
│   ├── embeddingService.ts   # Ollama embeddings
│   ├── migrations.ts         # Schema versioning and migrations
│   ├── lazyDb.ts             # Lazy database initialization
│   ├── secretStorage.ts      # Secure API key storage
│   ├── commands.ts           # Database-related VS Code commands
│   └── databaseViewProvider.ts # Database stats tree view
├── latex/                    # LaTeX/TeX file support
│   ├── latexLanguageProvider.ts # LaTeX language features
│   ├── latexCompiler.ts      # TeX compilation integration
│   ├── latexHoverProvider.ts # LaTeX hover information
│   ├── latexNavigation.ts    # Section/label navigation
│   └── latexSpeedCommands.ts # Speed commands for LaTeX
├── references/               # Bibliography management (org-ref style)
│   ├── referenceManager.ts   # BibTeX file management
│   ├── bibtexParser.ts       # BibTeX parsing
│   ├── citationParser.ts     # Citation syntax parsing
│   ├── citationProcessor.ts  # Citation formatting
│   ├── openalexService.ts    # OpenAlex API for DOI lookup
│   └── providers.ts          # Completion, hover for citations
├── manuscript/               # Academic manuscript tools
│   ├── manuscriptManager.ts  # Multi-file manuscript coordination
│   ├── latexCompiler.ts      # LaTeX compilation pipeline
│   ├── figureProcessor.ts    # Figure handling and conversion
│   └── fileFlattener.ts      # Combine includes into single file
├── export/                   # Custom export system
│   ├── customExporter.ts     # User-defined export backends
│   └── commands.ts           # Export commands
├── publishing/               # Static site publishing
│   ├── orgPublish.ts         # org-publish style projects
│   ├── publishProject.ts     # Project publishing logic
│   └── themes/               # Publishing themes (e.g., bookTheme)
├── journal/                  # Date-based journaling
│   ├── journalManager.ts     # Journal entry management
│   ├── calendarView.ts       # Calendar navigation
│   └── statusBar.ts          # Journal status bar item
├── notebook/                 # Project-based organization
│   ├── notebookManager.ts    # Project/notebook management
│   └── notebookTreeProvider.ts # Project tree view
├── zotero/                   # Zotero integration
│   └── zoteroService.ts      # Zotero API client
├── highlighting/             # Syntax highlighting
│   ├── semanticTokenProvider.ts # Semantic tokens for org
│   ├── foldingProvider.ts    # Code folding
│   └── blockDecorations.ts   # Source block decorations
├── diagnostic/               # Extension diagnostics
│   ├── diagnosticReport.ts   # System diagnostic report generation
│   └── diagnosticPanel.ts    # Diagnostic webview panel
├── utils/                    # Shared utilities
│   ├── logger.ts             # Centralized logging
│   ├── resilience.ts         # Retry logic and timeouts
│   ├── dateParser.ts         # Date parsing utilities
│   └── escapeUtils.ts        # String escaping helpers
├── cli/                      # Command-line interface
│   ├── index.ts              # CLI entry point
│   ├── database.ts           # CLI database operations
│   └── commands/             # CLI subcommands
├── help/                     # Help system
│   ├── contextHelp.ts        # Context-sensitive help
│   └── describeKey.ts        # Keybinding documentation
├── hydra/                    # Hydra menu framework
│   ├── hydraManager.ts       # Menu state management
│   └── commands.ts           # Built-in hydra menus
├── projectile/               # Project management
├── fuzzySearch/              # Swiper-style search
├── jump/                     # Avy-style navigation
├── editmarks/                # Track changes system
├── mark/                     # Mark ring (like Emacs)
├── templates/                # File/snippet templates
└── shared/                   # Cross-module utilities
    ├── fileWalker.ts         # Recursive file discovery
    └── ignorePatterns.ts     # .gitignore-style filtering
```

### Key Patterns

**Manager + Commands + Providers**: Each feature follows this pattern:
- `*Manager.ts` - Core logic, state management, file I/O
- `commands.ts` - VS Code command registrations
- `providers.ts` - VS Code language providers (hover, completion, tree views)

**Database Layer**: `ScimaxDb` is the production database using `@libsql/client` (Turso's SQLite fork). It provides:
- FTS5 full-text search with BM25 ranking
- Vector similarity search for semantic queries (with embeddings)
- Tables: `files`, `headings`, `source_blocks`, `chunks` (for embeddings)
- Snake_case column names (`file_path`, `line_number`, `days_until`)

**Async Methods**: Most `OrgDbSqlite` methods are async and return Promises. Always `await` them.

### Important Type Conventions

`ScimaxDb` uses snake_case for database fields:
```typescript
SearchResult.file_path    // not filePath
SearchResult.line_number  // not lineNumber
AgendaItem.days_until     // not daysUntil
HeadingRecord.file_path, line_number, todo_state, etc.
```

### Extension Entry Point

`extension.ts` initializes in order:
1. JournalManager
2. ScimaxDb (with optional embedding service)
3. ReferenceManager
4. NotebookManager

Each manager is passed to its command registration function and tree providers.

### Dependencies

- `@libsql/client` - SQLite with vector search (from Turso)
- `zeromq` - Native Jupyter kernel communication
- `uuid` - Unique ID generation for Jupyter messages
- `date-fns` - Date manipulation for journal
- `minimatch` - Glob pattern matching for ignore patterns

### Babel Execution System

The Babel system (`src/parser/orgBabel.ts`) executes source blocks:

```typescript
// Execute a source block
const result = await executeSourceBlock(srcBlock, {
    workingDirectory: '/path/to/dir',
    session: 'main',
    timeout: 30000
});
```

**Supported languages**: Python, JavaScript, TypeScript, Shell, SQL, R, Julia

**Jupyter integration**: Use `jupyter-python`, `jupyter-julia`, etc. to force Jupyter kernel execution. Images are automatically saved to `.ob-jupyter/`.

### Scimax-org and Scimax-ob

These modules provide Emacs-like editing commands:

- **scimaxOrg.ts**: Text markup (bold, italic, etc.), DWIM return, heading navigation
- **scimaxOb.ts**: Source block manipulation (split, merge, clone, move)

### Export System

The export system has separate backends for each format:

```typescript
// HTML export (src/parser/orgExportHtml.ts)
import { exportToHtml } from './parser/orgExportHtml';
const html = exportToHtml(document, { toc: true, standalone: true });

// LaTeX export (src/parser/orgExportLatex.ts)
import { exportToLatex } from './parser/orgExportLatex';
const latex = exportToLatex(document, { documentClass: 'article' });

// DOCX export via Pandoc (src/parser/orgExportDocx.ts)
import { exportToDocx } from './parser/orgExportDocx';
const buffer = await exportToDocx(document, { toc: true });

// Jupyter notebook export (src/parser/orgExportIpynb.ts)
import { exportToIpynb } from './parser/orgExportIpynb';
const notebook = exportToIpynb(document);
```

The DOCX backend requires Pandoc to be installed on the system.

## Development Workflow

### Always Rebuild and Install

After making changes, always rebuild and install the extension to verify it works:

```bash
make                    # Full build: compile + package VSIX
code --install-extension scimax-vscode-*.vsix --force
```

Then reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window") to test changes.

### Performance Regression Testing

Before committing parser or database changes, run the parser benchmark suite:

```bash
npm run test -- --testNamePattern="Parser Benchmark Suite"
```

The suite lives in `src/parser/__tests__/orgParserBenchmark.test.ts` and covers
small/medium/large document parsing, inline object parsing, stress tests, and
memory efficiency.

If performance degrades significantly, investigate before committing.

### Documentation Updates

When adding new features, update the corresponding documentation in `docs/`:

| Change Type | Documentation Files to Update |
|-------------|------------------------------|
| New command | `docs/keybindings.org`, relevant feature doc |
| New keybinding | `docs/keybindings.org`, `docs/speed-commands.org` |
| New setting | `docs/configuration.org`, `package.json` contributes.configuration |
| New feature | Create or update feature-specific doc in `docs/` |
| Database changes | `docs/database-search.org` |
| Any doc change | Update `docs/index.org` TOC and Topic Index |

**Important**: When modifying any documentation file:
1. Add a "Related Topics" section with cross-links to related documentation
2. Update `docs/index.org` to include new topics in the Topic Index table
3. Ensure tables are properly aligned using org-mode table format (`|` separators)
4. Mark changed/new headings with status emojis using the `#+TODO: ⚠️ 👀 | ✅` workflow:
   - `⚠️` - New heading (needs review)
   - `👀` - Changed heading (needs review)
   - The user will change to `✅` after inspection

Documentation structure:
```
docs/
├── getting-started.org      # Installation and first steps
├── keybindings.org          # All keyboard shortcuts
├── speed-commands.org       # Single-key commands at headings
├── configuration.org        # All settings reference
├── database-search.org      # FTS5 and semantic search
├── source-blocks.org        # Code execution
├── todo-items.org           # Task management
├── timestamps.org           # Dates, scheduling, clocking
├── document-structure.org   # Headlines, folding, navigation
└── ...                      # Other feature docs
```

Always include:
- Command names (e.g., `scimax.org.cycleTodo`)
- Keybindings with proper format (`Ctrl+C Ctrl+T`)
- Speed command keys when applicable
- Examples showing usage

### Keybinding Changes

When adding or changing keybindings, always check for conflicts with existing bindings:

1. **Search package.json** for existing keybindings using the same key sequence:
   ```bash
   grep -n "ctrl+c ctrl+p" package.json  # Example: check for C-c C-p conflicts
   ```

2. **Check documentation** for references to the keybinding:
   ```bash
   grep -r "C-c C-p\|Ctrl+C Ctrl+P" docs/
   ```

3. **Common conflict areas**:
   - `C-c C-n` / `C-c C-p` - heading/block navigation (scimaxOrg, scimaxOb)
   - `C-c C-c` - execute/confirm actions
   - `C-c C-e` - export commands
   - Speed commands (single keys at beginning of headlines)

4. **Update all documentation** when keybindings change:
   - `docs/keybindings.org` - master keybinding reference
   - Feature-specific docs that mention the keybinding
   - `package.json` contributes.keybindings section

### Keybinding and Command Consistency Audit

Run the audit script to check for discrepancies between package.json and documentation:

```bash
npx ts-node scripts/audit-keybindings.ts
```

This script detects:
- Commands in package.json missing from `docs/25-commands.org`
- Commands documented but not in package.json
- Duplicate keybindings with overlapping `when` contexts (conflicts)

**When adding new commands:**
1. Add command definition in `package.json` under `contributes.commands`
2. Add keybinding in `package.json` under `contributes.keybindings` (if applicable)
3. Document the command in `docs/25-commands.org` in the appropriate section
4. Document the keybinding in `docs/24-keybindings.org`
5. Run the audit script to verify consistency

**Avoiding keybinding conflicts:**
- Use `when` context conditions to disambiguate same-key bindings
- Common contexts: `scimax.inSourceBlock`, `scimax.onHeading`, `scimax.inTable`, `scimax.atHeadingStart`
- More specific contexts take precedence (e.g., `scimax.onHeading` wins over generic `editorTextFocus`)

### README Statistics

Before pushing to GitHub, update the "Codebase Statistics" section in `README.md` with current metrics:

```bash
# Quick stats commands
echo "TypeScript files: $(find src -name '*.ts' | wc -l)"
echo "Lines of TS: $(find src -name '*.ts' -exec cat {} \; | wc -l)"
echo "Test files: $(find src -name '*.test.ts' | wc -l)"
echo "Tests: $(npm run test 2>&1 | grep 'Tests' | tail -1)"
echo "Docs: $(find docs -name '*.org' | wc -l)"
echo "Commands: $(grep -c '\"command\":' package.json)"
echo "Keybindings: $(grep -c '\"key\":' package.json)"
```

Update the statistics table if counts have changed significantly (new modules, major refactors).

## References

- **Org-mode Syntax Specification**: https://orgmode.org/worg/org-syntax.html
  - Canonical reference for all org-mode syntax elements
  - Used for building the syntax highlighter and parser

## Security Considerations

This extension executes user code (Babel source blocks), so security requires careful attention. See `SECURITY_AUDIT_REPORT.md` for the full audit.

### Critical Rules

1. **Never use `shell: true` in spawn() calls**
   ```typescript
   // WRONG - enables command injection
   spawn('convert', args, { shell: true });

   // CORRECT - pass arguments as array
   spawn('convert', args);
   ```

2. **Use cryptographically random temp file names**
   ```typescript
   // WRONG - predictable, enables race conditions
   const tmpFile = path.join(tmpDir, `babel-${Date.now()}.ts`);

   // CORRECT - unpredictable
   const crypto = await import('crypto');
   const tmpFile = path.join(tmpDir, `babel-${crypto.randomBytes(16).toString('hex')}.ts`);
   ```

3. **Use SecretStorage for API keys** (not settings.json)
   ```typescript
   // WRONG - stored in plain text
   config.update('apiKey', key, ConfigurationTarget.Global);

   // CORRECT - uses OS credential manager
   import { storeOpenAIApiKey } from './database/secretStorage';
   await storeOpenAIApiKey(key);
   ```

4. **LaTeX compilation uses `-shell-restricted` by default**
   - Full `-shell-escape` allows arbitrary command execution
   - The setting `scimax.export.pdf.shellEscape` controls this
   - Default is `restricted` which allows minted but blocks dangerous commands

### SQL and HTML

- **SQL**: Always use parameterized queries (already implemented correctly)
  ```typescript
  db.execute({ sql: 'SELECT * FROM files WHERE path = ?', args: [filePath] });
  ```

- **HTML Export**: Always escape user content (already implemented correctly)
  ```typescript
  escapeString(str, 'html')  // escapes &, <, >, ", '
  ```

### Babel Execution Security

- Source blocks are **only executed when users explicitly trigger them** (C-c C-c)
- Source blocks are **NOT executed during export** (unlike Emacs with `:exports results`)
- Blocks with `:eval no` header are skipped
- "Execute All" commands have no default keybinding (command palette only)

### Parser Safety Limits

The parser has built-in limits to prevent crashes or unresponsiveness from malformed input:

| Limit | Value | Rationale |
|-------|-------|-----------|
| **Heading recursion depth** | 100 levels | Prevents stack overflow from deeply nested headings. Real org files rarely exceed 10 levels. |
| **Block line limit** | 50,000 lines | Prevents unbounded memory consumption from unclosed blocks (`#+BEGIN_SRC` without `#+END_SRC`). No legitimate block approaches this size. |
| **Properties drawer limit** | 1,000 lines | Smaller limit for property drawers which are typically <50 lines. |
| **Tag count per heading** | 50 tags | Prevents ReDoS from malformed tag patterns. No real heading has 50+ tags. |
| **Tag character set** | `[\w@#%\-]` | Restricted from "any non-colon" to prevent regex backtracking. Allows: letters, numbers, `_`, `@`, `#`, `%`, `-`. |

**Affected functions:**
- `findHeadings()`, `flattenHeadings()` - depth-limited recursion
- `parseSrcBlock()`, `parseSimpleBlock()`, `parseExportBlock()`, `parseSpecialBlock()` - line limits
- `parseLatexEnvironment()`, `parseDrawer()`, `parsePropertiesDrawer()` - line limits
- `parseDynamicBlock()`, `parseInlinetask()` - line limits

**What happens when limits are hit:**
- Parser stops consuming input at the limit boundary
- The unclosed block/element is treated as extending to the limit point
- No error is thrown; parsing continues with remaining content
- This matches graceful degradation behavior for malformed files

**Characters NOT allowed in tags** (to prevent ReDoS):
- Spaces, colons (standard org-mode restriction)
- Most punctuation: `!`, `$`, `^`, `&`, `*`, etc.
- If you need exotic tag characters, the old pattern was `[^:]` - but this caused exponential backtracking on malformed input like `:::::::::::::`

## Reliability Practices

### Logging

Use the centralized logging system (`src/utils/logger.ts`) for all logging:

```typescript
import { databaseLogger as log } from '../utils/logger';

// Log levels
log.debug('Detailed info for debugging', { data });
log.info('Normal operation info');
log.warn('Warning condition');
log.error('Error occurred', error, { context });
```

**Guidelines:**
- Use module-specific loggers: `databaseLogger`, `parserLogger`, `extensionLogger`
- Errors are always logged regardless of log level setting
- Errors trigger a status bar indicator so users know something went wrong
- Never log sensitive data (API keys, file contents, etc.)

### Database Resilience

Database operations use retry logic and timeouts (`src/utils/resilience.ts`):

```typescript
import { withRetry, withTimeout, isTransientError } from '../utils/resilience';

// Retry transient failures (database locked, busy, I/O errors)
const result = await withRetry(() => db.execute(query), {
    maxAttempts: 3,
    operationName: 'fetchHeadings'
});

// Prevent hung operations
const result = await withTimeout(() => longOperation(), {
    timeoutMs: 30000,
    operationName: 'bulkIndex'
});
```

**Configuration settings:**
- `scimax.db.queryTimeoutMs` - Query timeout (default: 30000ms)
- `scimax.db.maxRetryAttempts` - Retry attempts (default: 3)
- `scimax.db.maxFileSizeMB` - Max file size to index (default: 10MB)

### Input Validation

When indexing files from external sources (git repos, collaborators):

```typescript
// File size check (prevents memory issues)
const stats = await fs.promises.stat(filePath);
if (stats.size > maxFileSizeBytes) {
    log.warn(`Skipping oversized file: ${filePath}`);
    return;
}

// Binary content detection (prevents garbage in DB)
if (this.isBinaryContent(content)) {
    log.debug(`Skipping binary file: ${filePath}`);
    return;
}
```

### Database Migrations

Schema changes use the migration system (`src/database/migrations.ts`):

```typescript
// Migrations are versioned and run automatically on startup
// Each migration has an up() function
const migrations: Migration[] = [
    { version: 1, description: 'Initial schema', up: async (db) => { ... } },
    { version: 2, description: 'Add FTS5', up: async (db) => { ... } },
];
```

**Guidelines:**
- Never modify existing migrations after they've been deployed
- Always add new migrations with incrementing version numbers
- Test migrations on a copy of a real database before deploying

## CLI

The extension includes a command-line interface for batch operations and scripting:

```bash
# If linked globally
scimax db scan ~/org-files      # Scan directory and index
scimax db rebuild               # Full database rebuild
scimax db stats                 # Show database statistics
scimax search "query"           # Full-text search
scimax agenda today             # Show today's agenda
scimax export file.org --format html  # Export to HTML
```

The CLI is useful for:
- Cron-based database updates
- CI/CD pipelines
- Batch exports
- Quick lookups from terminal

See `docs/30-cli.org` for full documentation.
