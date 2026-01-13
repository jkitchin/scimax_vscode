# Cleanup Plan: Debug Statements and Disabled Features

## Overview

During performance investigation for the unresponsive extension host issue, several debug statements were added and features were disabled. This document outlines what needs to be cleaned up and re-enabled.

---

## 1. Debug Statements to Remove

### 1.1 Document Symbol Provider (`src/org/documentSymbolProvider.ts`)

Performance diagnostics - **Remove all**:

| Line | Statement |
|------|-----------|
| 51 | `console.log(\`Scimax: [PARSE] Starting lightweight parse...\`)` |
| 148 | `console.log(\`Scimax: [PARSE] Lightweight parse complete...\`)` |
| 216 | `console.log(\`Scimax: [SYMBOLS] provideDocumentSymbols called...\`)` |
| 223 | `console.log(\`Scimax: [SYMBOLS] Cache hit...\`)` |
| 226 | `console.log(\`Scimax: [SYMBOLS] Cache miss...\`)` |
| 287 | `console.log(\`Scimax: [SYMBOLS] Total time...\`)` |

### 1.2 Extension Entry Point (`src/extension.ts`)

Debug statements - **Remove all**:

| Line | Statement |
|------|-----------|
| 314 | `console.log('Scimax: [DEBUG] About to register selection handler...')` |
| 330 | `console.log('Scimax: [DEBUG] Selection handler registered')` |
| 332 | `console.log('Scimax: [DEBUG] About to register BibliographyCodeLensProvider...')` |
| 340 | `console.log('Scimax: [DEBUG] BibliographyCodeLensProvider registered')` |
| 388 | `console.log('Scimax: [DEBUG] About to initialize NotebookManager...')` |
| 393 | `console.log('Scimax: [DEBUG] NotebookManager initialized')` |
| 397 | `console.log('Scimax: [DEBUG] NotebookCommands registered')` |

### 1.3 Verbose Registration Logs (`src/extension.ts`)

Lines 244-292 - 13+ consecutive "registered" logs. **Consolidate or remove**:

```typescript
console.log('Scimax: Jump provider registered');
console.log('Scimax: Org commands registered');
console.log('Scimax: Babel commands registered');
// ... etc (13 more)
```

**Action:** Replace with single summary: `console.log('Scimax: All features registered');`

### 1.4 Export Timing Logs (`src/org/exportProvider.ts`)

Lines 226-284, 963-987 - HTML/LaTeX/PDF timing logs.

**Decision:** Remove or move behind debug configuration flag.

### 1.5 Other Module Logs

| File | Lines | Type | Action |
|------|-------|------|--------|
| `referenceManager.ts` | 115, 127, 141, 144 | Bibliography loading | Keep error logs, remove info |
| `citationManipulation.ts` | 501 | Registration | Remove |
| `blockDecorations.ts` | 432 | Registration | Remove |
| `projectileManager.ts` | 41, 99 | Project loading | Remove |
| `notebookManager.ts` | 96, 99, 113, 192, 301, 510 | Various | Remove verbose, keep errors |

---

## 2. Disabled Features to Re-enable

### Priority 1: Low Risk

#### Jupyter Kernel Support (`src/extension.ts:294-304`)
- **Status**: Disabled with "pending investigation"
- **Risk**: Medium - uses ZeroMQ native module
- **Action**: Re-enable with lazy loading (only initialize when first Jupyter block executed)
- **Commented import**: Line 44

#### Projectile Manager (`src/extension.ts:400-451`)
- **Status**: Disabled with "pending investigation"
- **Risk**: Low - simple file system operations
- **Action**: Re-enable with deferred initialization

### Priority 2: Medium Risk

#### Journal Tree View (`src/extension.ts:93-109`)
- **Status**: Disabled - `getAllEntries()` does synchronous recursive directory scanning
- **Risk**: Medium - filesystem scanning on startup
- **Action**:
  1. Make `getAllEntries()` async with caching
  2. Re-enable tree view with lazy initialization
- **Related**: Line 124 (`journalTreeProvider.refresh()` commented)

#### Journal Status Bar (`src/extension.ts:129-132`)
- **Status**: Disabled - `getTotalStats()` scans filesystem
- **Risk**: Medium - filesystem scanning
- **Action**: Re-enable with deferred/cached stats loading

#### Calendar Provider (`src/extension.ts:93-105`)
- **Status**: Disabled alongside tree view
- **Action**: Re-enable after journal fixes

### Priority 3: High Risk - Database System

#### Database/SQLite (`src/extension.ts`)

**Commented code locations:**
- Lines 7-11: Import statements
- Line 57: `scimaxDb` variable declaration
- Lines 82-90: Database initialization
- Line 91: "Database disabled" status log
- Line 112: `registerDbCommands()` call
- Lines 114-117: Auto-indexing/file watching
- Lines 468-471: Deactivation cleanup

**Action**: Implement lazy loading pattern:

```typescript
let scimaxDb: ScimaxDb | null = null;
let dbInitPromise: Promise<ScimaxDb> | null = null;

export async function getDatabase(context: vscode.ExtensionContext): Promise<ScimaxDb> {
    if (scimaxDb) return scimaxDb;
    if (dbInitPromise) return dbInitPromise;

    dbInitPromise = (async () => {
        scimaxDb = new ScimaxDb(context);
        await scimaxDb.initialize();
        return scimaxDb;
    })();

    return dbInitPromise;
}
```

#### Notebook Database Features (`src/notebook/commands.ts`)

**Disabled code:**
- Lines 4-5: Database import commented
- Line 10: Type changed to `any` with comment
- Lines 168-172, 217-221: "Database features disabled" warnings

**Action**: Re-enable after database lazy loading implemented

---

## 3. Implementation Plan

### Phase 1: Remove Debug Statements (Low Risk)

1. Remove all `[DEBUG]`, `[PARSE]`, `[SYMBOLS]` console.log statements
2. Consolidate registration logs into single summary
3. Remove export timing logs (or move behind config flag)
4. Remove other verbose logs from modules
5. **Test**: Extension works, no console spam

### Phase 2: Re-enable Low-Risk Features

1. Re-enable Jupyter kernel support with lazy loading pattern
2. Re-enable Projectile manager with deferred initialization
3. **Test**: No startup performance regression

### Phase 3: Fix Journal Performance

1. Convert `getAllEntries()` to async with caching:
   ```typescript
   private entriesCache: JournalEntry[] | null = null;
   private cacheTimestamp: number = 0;
   private readonly CACHE_TTL = 60000; // 1 minute

   async getAllEntriesAsync(): Promise<JournalEntry[]> {
       if (this.entriesCache && (Date.now() - this.cacheTimestamp) < this.CACHE_TTL) {
           return this.entriesCache;
       }
       this.entriesCache = await this.scanEntriesAsync();
       this.cacheTimestamp = Date.now();
       return this.entriesCache;
   }
   ```
2. Update `JournalTreeProvider` to use async method
3. Re-enable Journal tree view
4. Re-enable Journal status bar with cached data
5. Re-enable Calendar provider
6. **Test**: Journal features work without freezing

### Phase 4: Database Lazy Loading

1. Implement `getDatabase()` lazy loading function
2. Update `registerDbCommands()` to use lazy pattern
3. Re-enable database imports and initialization code
4. Re-enable notebook database integration
5. Re-enable auto-indexing with debouncing:
   ```typescript
   const debouncedIndex = debounce((uri: vscode.Uri) => {
       getDatabase(context).then(db => db.indexFile(uri.fsPath));
   }, 1000);
   ```
6. Re-enable deactivation cleanup
7. **Test**: Database commands work, no memory issues

### Phase 5: Cleanup

1. Remove all "pending investigation" status logs
2. Remove this cleanup plan file (or archive)
3. Final testing pass

---

## 4. Testing Checklist

After each phase:
- [ ] Extension activates in < 1 second (no "unresponsive" warning)
- [ ] Opening org files is fast (< 100ms for document symbols)
- [ ] No console spam on startup
- [ ] No memory leaks (monitor Extension Host memory over time)
- [ ] All re-enabled features work correctly
- [ ] Run `npm run test` - all tests pass

---

## 5. Files Modified Summary

| File | Phase | Changes |
|------|-------|---------|
| `src/extension.ts` | 1-4 | Remove logs, implement lazy DB, re-enable features |
| `src/org/documentSymbolProvider.ts` | 1 | Remove [PARSE]/[SYMBOLS] logs |
| `src/org/exportProvider.ts` | 1 | Remove timing logs |
| `src/references/referenceManager.ts` | 1 | Remove verbose logs |
| `src/references/citationManipulation.ts` | 1 | Remove registration log |
| `src/highlighting/blockDecorations.ts` | 1 | Remove registration log |
| `src/projectile/projectileManager.ts` | 1-2 | Remove logs, re-enable |
| `src/notebook/notebookManager.ts` | 1 | Remove verbose logs |
| `src/notebook/commands.ts` | 4 | Re-enable DB import, remove warnings |
| `src/journal/journalManager.ts` | 3 | Add async caching |
| `src/journal/journalTreeProvider.ts` | 3 | Use async methods |
| `src/journal/journalStatusBar.ts` | 3 | Use cached data |
| `src/database/commands.ts` | 4 | Use lazy getDatabase() |

---

## 6. Rollback Plan

If issues occur:
1. Each phase can be reverted independently via git
2. Add configuration flags for user control:
   - `scimax.features.enableDatabase`
   - `scimax.features.enableJournalTreeView`
   - `scimax.features.enableJupyter`
3. Lazy loading patterns allow disabling specific features without code changes

---

## 7. "Pending Investigation" Messages to Remove

After features are re-enabled, remove these console.log statements:
- `console.log('Scimax: Database disabled (pending investigation)')`
- `console.log('Scimax: Journal tree view disabled (pending investigation)')`
- `console.log('Scimax: Journal status bar disabled (pending investigation)')`
- `console.log('Scimax: Jupyter kernel support disabled (pending investigation)')`
- `console.log('Scimax: Projectile manager disabled (pending investigation)')`
