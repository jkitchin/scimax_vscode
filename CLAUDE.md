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
├── extension.ts          # Entry point, activates all features
├── parser/orgParser.ts   # Org-mode and Markdown parsing
├── database/
│   ├── orgDbSqlite.ts    # SQLite database with FTS5 + vector search (libsql)
│   ├── orgDb.ts          # Legacy in-memory database (not used in production)
│   └── embeddingService.ts # Ollama/OpenAI/local embeddings
├── journal/              # Date-based journaling system
├── references/           # BibTeX bibliography management (org-ref)
└── notebook/             # Project-based organization (scimax-notebook)
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
- `date-fns` - Date manipulation for journal
- `minimatch` - Glob pattern matching for ignore patterns

## References

- **Org-mode Syntax Specification**: https://orgmode.org/worg/org-syntax.html
  - Canonical reference for all org-mode syntax elements
  - Used for building the syntax highlighter and parser
