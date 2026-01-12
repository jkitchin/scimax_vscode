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
├── parser/
│   ├── orgParser.ts          # Org-mode and Markdown parsing
│   ├── orgParserUnified.ts   # Full AST parser (org-element compatible)
│   ├── orgBabel.ts           # Source block execution engine
│   ├── orgExport.ts          # Export backends (HTML, LaTeX, MD, PDF)
│   ├── orgClocking.ts        # Time tracking and clock entries
│   └── orgElementTypes.ts    # Type definitions for org elements
├── org/
│   ├── babelProvider.ts      # VS Code integration for Babel execution
│   ├── exportProvider.ts     # Export commands and UI
│   ├── scimaxOrg.ts          # Text markup, DWIM return, navigation
│   ├── scimaxOb.ts           # Source block manipulation (scimax-ob)
│   ├── tableProvider.ts      # Table editing and export
│   ├── hoverProvider.ts      # Hover previews (images, entities)
│   ├── completionProvider.ts # Smart completions
│   └── documentSymbolProvider.ts # Document outline
├── jupyter/
│   ├── kernelManager.ts      # Jupyter kernel lifecycle
│   ├── kernelConnection.ts   # ZeroMQ socket handling
│   ├── jupyterExecutor.ts    # Babel integration for jupyter-*
│   └── kernelSpec.ts         # Kernel discovery
├── database/
│   ├── scimaxDb.ts           # SQLite database with FTS5 + vector search
│   └── embeddingService.ts   # Ollama/OpenAI/local embeddings
├── journal/                  # Date-based journaling system
├── references/               # BibTeX bibliography management (org-ref)
├── notebook/                 # Project-based organization (scimax-notebook)
├── projectile/               # Project management
├── fuzzySearch/              # Swiper-style search
├── jump/                     # Avy-style navigation
├── editmarks/                # Track changes system
└── hydra/                    # Hydra menu framework
```

### Key Patterns

**Manager + Commands + Providers**: Each feature follows this pattern:
- `*Manager.ts` - Core logic, state management, file I/O
- `commands.ts` - VS Code command registrations
- `providers.ts` - VS Code language providers (hover, completion, tree views)

**Database Layer**: `OrgDbSqlite` is the production database using `@libsql/client` (Turso's SQLite fork). It provides:
- FTS5 full-text search with BM25 ranking
- Vector similarity search for semantic queries
- Snake_case column names (`file_path`, `line_number`, `days_until`)

**Async Methods**: Most `OrgDbSqlite` methods are async and return Promises. Always `await` them.

### Important Type Conventions

`OrgDbSqlite` uses snake_case for database fields:
```typescript
SearchResult.file_path    // not filePath
SearchResult.line_number  // not lineNumber
AgendaItem.days_until     // not daysUntil
HeadingRecord.file_path, line_number, todo_state, etc.
```

The legacy `OrgDb` class uses camelCase - don't mix them.

### Extension Entry Point

`extension.ts` initializes in order:
1. JournalManager
2. OrgDbSqlite (with optional embedding service)
3. ReferenceManager
4. NotebookManager

Each manager is passed to its command registration function and tree providers.

### Dependencies

- `@libsql/client` - SQLite with vector search (from Turso)
- `@xenova/transformers` - Local embeddings via Transformers.js
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

The export system (`src/parser/orgExport.ts`) converts org documents:

```typescript
// Export to HTML
const html = exportToHtml(document, { toc: true, standalone: true });

// Export to LaTeX
const latex = exportToLatex(document, { documentClass: 'article' });
```

## References

- **Org-mode Syntax Specification**: https://orgmode.org/worg/org-syntax.html
  - Canonical reference for all org-mode syntax elements
  - Used for building the syntax highlighter and parser
