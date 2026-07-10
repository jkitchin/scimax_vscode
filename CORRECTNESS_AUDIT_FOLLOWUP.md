# Correctness Audit Follow-up (for review/hardening pass)

Origin: issue #47 (`Scimax: Configure Agenda Files` wrote to the unregistered
setting `scimax.agenda.files` and errored). Commit `77a0a45` fixed #47 itself.
A repo-wide audit for the same failure class found the issues below; all were
fixed in commit `590ee48` on branch `claude/repo-correctness-review-i0zolo`.

This document is a work list for a follow-up pass: independently **verify**
each issue existed, **review** the applied fix, **validate** the fix in a
running VS Code instance, and add the proposed **regression tests** (most
fixes currently have no dedicated test — that is the main remaining gap).

How to check out the state before the fixes for verification:

```bash
git checkout 590ee48~1   # buggy state (after the #47 fix, before the audit fixes)
git checkout claude/repo-correctness-review-i0zolo   # fixed state
```

---

## Category A — executeCommand calls to commands that were never registered

These fail at runtime with `command '<id>' not found` (or silently no-op where
the rejection was swallowed). Identical user experience to #47.

### A1. "Clear All Results" (scimax-ob) invoked nonexistent `scimax.babel.clearResults`

- **Where:** `src/org/scimaxOb.ts` — `clearAllResults()` (was line ~1135).
  Registered as `scimax.ob.clearAllResults` at `src/org/scimaxOb.ts:1308`.
- **Verify the issue:** at `590ee48~1`, grep `registerCommand` for
  `scimax.babel.clearResults` — no hits. Running
  `Scimax OB: Clear All Results` from the palette (or `contextHelp` menu
  entries at `src/help/contextHelp.ts:410,654`) rejects with
  "command 'scimax.babel.clearResults' not found".
- **Applied fix:** delegate to `scimax.org.clearAllResults`, the real
  implementation registered in `src/org/babelProvider.ts:2153` (clears every
  `#+RESULTS:` block in the buffer).
- **Validate:** install the VSIX, open an org file with several executed
  blocks, run `scimax.ob.clearAllResults` → all results removed, info toast
  "Cleared results from N blocks", no error toast.
- **Regression tests:**
  - Unit: hard with the current design (thin wrapper over `executeCommand`).
    Prefer the *consistency test* in Category F, which catches any
    `executeCommand('scimax.*')` whose target is never registered — that is
    the durable guard for A1–A4.
  - Optional integration test (vscode-test harness): execute
    `scimax.ob.clearAllResults` on a fixture document and assert the
    `#+RESULTS:` drawers are gone.

### A2. Following a `cite:`/`citep:`/`citet:` link invoked nonexistent `scimax.citation.action`

- **Where:** `src/org/scimaxOrg.ts`, `openLinkAtPoint()` (was line ~3209).
- **Verify the issue:** at `590ee48~1`, put the cursor on `cite:someKey` and
  run Open Link at Point (`C-c C-o` path) → rejected promise
  "command 'scimax.citation.action' not found" (unhandled; shows in the
  console/log). No registration for `scimax.citation.action` exists anywhere.
- **Applied fix:** parse the keys out of the link path — v3 (`cite:&k1;&k2`,
  keys extracted via `/&([\w:-]+)/g`) and v2 (`cite:k1,k2`, comma-split) —
  and invoke `scimax.ref.gotoCitation` with `{ key: keys[0], keys }`, the
  same command + argument shape `src/org/orgLinkProvider.ts:160` uses for
  clickable citation document-links.
- **Validate:** with a bib file configured (`scimax.ref.bibliographyFiles`),
  cursor on `cite:&knownKey`, run Open Link at Point → jumps to the entry in
  the .bib file. Also test `cite:knownKey` (v2) and an unknown key (warning
  toast "Reference not found", no crash).
- **Regression tests:**
  - The key-extraction logic in `openLinkAtPoint` duplicates
    `orgLinkProvider.ts`. **Recommended refactor:** extract a shared
    `extractCiteKeys(citePath: string): string[]` helper (e.g. into
    `src/references/citationParser.ts`, which is vscode-free) and add vitest
    cases: `"&k1;&k2"` → `[k1,k2]`; `"k1,k2"` → `[k1,k2]`; `"prefix;&k1"` →
    `[k1]`; `""` → `[]`; keys containing `:` and `-`.
  - Edge case to check during review: v2 keys containing `&` mid-string, and
    `citep:`/`citet:` prefixes (the slice uses the *first* colon — correct for
    all three prefixes).

### A3. "Open in Dired" from the find-file panel invoked nonexistent `scimax.dired`

- **Where:** `src/findFile/findFilePanel.ts:264`.
- **Verify the issue:** at `590ee48~1`, open the find-file panel, use the
  "open dired here" action on an entry → error, panel already disposed, dired
  never opens. `scimax.dired` is not registered anywhere; the real commands
  are `scimax.dired.open/openCurrent/openWorkspace`
  (`src/dired/diredCommands.ts`).
- **Applied fix:** two parts:
  1. `scimax.dired.open` now takes an optional `initialDirectory?: string`
     argument and skips the folder picker when it is provided
     (`src/dired/diredCommands.ts:13`).
  2. `findFilePanel.ts` calls `scimax.dired.open` with the entry's directory.
- **Validate:** find-file panel → "open dired" on a file → dired opens at the
  file's parent directory with no picker. Also run bare `Scimax: Dired`
  from the palette → picker still appears (no behavior change for the
  no-argument path).
- **Regression tests:**
  - `src/dired/__tests__/` already tests `DiredManager` without vscode UI.
    Add a test that `DiredPanel.createOrShow`-bound path receives the passed
    directory — or, more practically, a unit test on the command callback if
    it gets extracted. Minimum: the Category F consistency test covers the
    "target exists" half; add a manual checklist item for the argument path.

### A4. Post-screenshot refresh invoked nonexistent `scimax.org.refreshInlineImages`

- **Where:** `src/org/screenshotProvider.ts:433` and `:531`.
- **Verify the issue:** at `590ee48~1` the rejection was explicitly swallowed
  (`() => {} // Command might not exist, ignore`), so this was a *silent*
  failure: after inserting a screenshot link, inline image overlays never
  refreshed until a manual refresh. Grep confirms no registration for
  `scimax.org.refreshInlineImages`.
- **Applied fix:** call `scimax.imageOverlays.refresh` (the real command,
  `src/org/imageOverlayProvider.ts:1081`). That command previously always
  toasted "Image overlays refreshed"; it now accepts `{ silent?: boolean }`
  and the screenshot paths pass `{ silent: true }` so users don't get a toast
  after every screenshot. Palette invocation (no args) still toasts.
- **Validate:** take a screenshot via `scimax.org.insertScreenshot` in an org
  buffer with overlays enabled → the new image renders inline without any
  extra toast. Run `scimax.imageOverlays.refresh` from the palette → toast
  still appears.
- **Regression tests:** covered by the Category F consistency test (target
  must be registered). Optionally assert the command handler signature: a
  small unit test that the callback treats `undefined` opts as non-silent.

---

## Category B — commands declared in package.json but never implemented

Palette entries that error with "command not found" when picked.

### B1. `scimax.org.insertBlock`, `scimax.org.nextBlock`, `scimax.org.prevBlock`

- **Verify the issue:** at `590ee48~1`, package.json `contributes.commands`
  declared all three (titles "Scimax: Insert Code Block", "Go to Next/Previous
  Code Block") but no `registerCommand` exists for them. Picking them from the
  palette errors. The real, registered equivalents are
  `scimax.ob.insertBlockAbove/Below`, `scimax.ob.nextBlock`,
  `scimax.ob.previousBlock` — all of which already had their own palette
  entries, so these were stale duplicates.
- **Applied fix:** removed the three phantom entries from package.json and the
  three corresponding rows from `docs/25-commands.org` (real commands remain
  documented at their own rows). Heading marked `👀` for review.
- **Validate:** `npx ts-node scripts/audit-keybindings.ts` → "All documented
  commands exist in package.json!" and no missing-doc warnings. Palette search
  for "Insert Code Block" shows only the `scimax.ob.*` variants.
- **Regression tests:** Category F consistency test, direction 2
  (`contributes.commands` ⊆ `registerCommand` calls).

### B2. `scimax.journal.refresh` declared but never registered

- **Verify the issue:** at `590ee48~1`, package.json line ~1345 declared it
  (with `$(refresh)` icon); `src/journal/commands.ts` registers 12 journal
  commands but not `refresh`. Palette invocation errored.
- **Applied fix:** kept the palette entry (docs reference it) and registered
  the command in `src/extension.ts` next to the
  `JournalCalendarProvider` registration; it calls the provider's public
  `refresh()` (re-renders the calendar webview).
- **Validate:** open the journal calendar view, run
  `Scimax: Refresh Journal View` → no error; calendar re-renders (visually
  identical unless entries changed — confirm via webview devtools or by
  adding an entry file externally first).
- **Regression tests:** Category F consistency test. Edge case checked:
  `JournalCalendarProvider.refresh()` guards on `this._view`
  (`src/journal/calendarView.ts:89`), so running the command before the
  calendar view has ever been opened is a safe no-op. Optional unit test to
  pin that behavior.

---

## Category C — settings read by code but never registered in package.json

`workspace.getConfiguration().get()` *does* return values manually added to
settings.json even for unregistered keys, so these "worked" if you knew the
secret name — but they were invisible in the Settings UI, showed "Unknown
Configuration Setting" squiggles, and could never be written via
`config.update()` (the #47 failure mode). Worse, the docs already documented
them as real settings.

### C1. `scimax.capture.defaultDirectory`, `scimax.capture.showPreview`, `scimax.capture.openAfterCapture`

- **Where read:** `src/org/captureProvider.ts` `loadConfig()` (lines ~57–62).
- **Verify the issue:** at `590ee48~1` none of the three appear in
  `contributes.configuration`, yet `docs/15-capture.org` documents all three
  (lines ~490, 505, 569, 649–651).
- **Applied fix:** registered all three (string/boolean/boolean, defaults
  `""`/`true`/`true`, matching the code's `config.get` fallbacks).
- **Validate:** Settings UI → search "scimax.capture" → all three visible
  with descriptions; setting `showPreview: false` skips the preview step of a
  capture.
- **Regression tests:** Category F consistency test, direction 3 (every
  `getConfiguration('<section>').get('<key>')` in src must resolve to a
  registered key). Behavior test: none needed beyond existing capture tests.

### C2. `scimax.db.dirsPerSession`

- **Where read:** `src/database/lazyDb.ts:229` (incremental background
  directory scanning: how many configured directories to scan per session,
  progress persisted in `globalState`).
- **Verify / fix / validate:** same pattern as C1; registered as `number`,
  default `5`. Documented in `docs/26-configuration.org` (new `⚠️` heading).
- **Regression tests:** Category F consistency test.

---

## Category D — settings registered in package.json but ignored by the code

Users could set these in the Settings UI and nothing happened. Silent — the
inverse of #47 and arguably worse because there is no error at all.

### D1. `scimax.db.maxFileSizeMB`, `scimax.db.maxParseSizeKB`, `scimax.db.maxFileLines` ignored by the extension

- **Verify the issue:** at `590ee48~1`, `ScimaxDbCore` reads
  `this.options.maxFileSizeMB ?? 10`, `maxParseSizeKB ?? 500`,
  `maxFileLines ?? 5000` (`src/database/scimaxDbCore.ts:885–897`), but
  `ScimaxDb` (the VS Code subclass) never populated those options from
  configuration — only `ignorePatterns` and resilience config were applied in
  `initialize()`. The **CLI** honored `maxFileSizeMB`/`maxFileLines` via
  `src/cli/settings.ts:362–363`, so CLI and extension behaved differently on
  the same settings.json.
- **Applied fix:** new `ScimaxDbCore.setSizeLimits()` setter (mirrors the
  existing `setIgnorePatterns`/`setResilienceConfig` pattern) + new
  `ScimaxDb.loadSizeLimits()` reading the three settings with defaults
  identical to package.json (10 / 500 / 5000), called in `initialize()`
  before `super.initialize()`.
- **Validate:** set `scimax.db.maxFileSizeMB: 1`, index a directory
  containing a >1 MB org file, check the scimax log for the "Skipping
  oversized file" warning; unset → file indexes.
- **Regression tests:**
  - Unit (vitest, no vscode needed): `ScimaxDbCore` already has core tests —
    add a case constructing the core, calling
    `setSizeLimits({ maxFileSizeMB: 1 })`, then indexing a fixture >1 MB and
    asserting it is skipped; same for `maxFileLines` and `maxParseSizeKB`
    (file indexed but content not parsed into headings when >maxParseSizeKB).
  - Parity check: a test asserting the CLI defaults
    (`src/cli/settings.ts`) equal the package.json defaults for these keys.

### D2. `scimax.dired.defaultSort` and `scimax.dired.showHidden` ignored

- **Verify the issue:** at `590ee48~1`, `DiredManager`'s constructor hardcoded
  `sort: { field: 'name', direction: 'asc' }, showHidden: false`
  (`src/dired/diredManager.ts:126–127`); the panel only read
  `confirmDelete` and `changeWorkspaceOnEnter`.
- **Applied fix:** constructor now seeds initial state from
  `getConfiguration('scimax.dired')` (`defaultSort` as `SortField`,
  `showHidden` boolean), with the same defaults as before when unset.
- **Validate:** set `scimax.dired.defaultSort: "mtime"` and
  `showHidden: true`, open dired → status bar shows `Sort: mtime ↑` and
  `Hidden: ON`; dotfiles listed.
- **Regression tests:** `src/dired/__tests__/` exists and mocks vscode —
  add cases: construct `DiredManager` with mocked config returning
  `defaultSort: 'size'`, `showHidden: true` → assert
  `getState().sort.field === 'size'` and `showHidden === true`; and with an
  empty mock config → `'name'`/`false` (backwards compatibility).
  **Review note:** an invalid stored value (e.g. `"date"`) passes the
  `get<SortField>` cast unchecked — consider validating against the enum and
  falling back to `'name'`.

### D3. `scimax.manuscript.autoCompile` ignored

- **Verify the issue:** at `590ee48~1`, the setting (enum
  `always|if-needed|never|ask`, default `ask`) existed only in package.json;
  `flattenManuscriptCommand` (`src/manuscript/commands.ts:41`) always showed
  the quick-pick when `.bbl` was stale.
- **Applied fix:** the command reads the setting: `always` → compile
  unconditionally; `never` → skip compile; `if-needed` → compile only when
  stale, no prompt; `ask` (default) → previous quick-pick behavior. Maps onto
  the existing `FlattenOptions.compile: boolean | 'if-needed'` contract
  (`flattenManuscript` skips compile when `compile === false` — verified:
  the guard is `if (compile === true || compile === 'if-needed')`).
- **Validate:** with a stale `.bbl`: `autoCompile: "never"` → flatten runs
  without prompting and without compiling (warnings may mention stale bbl);
  `"always"` → compiles even when fresh; `"ask"` → prompt appears.
- **Regression tests:** extract the mapping into a pure function
  `resolveCompileOption(autoCompile: string, needsCompile: boolean): boolean | 'if-needed' | 'prompt'`
  and unit-test all 8 combinations. Currently the mapping is inline in the
  command; the extraction makes it testable without vscode mocks.

### D4. `scimax.capture.datetreeFormat` and `scimax.capture.autoSave` — never implemented — RESOLVED

- **Verify the issue:** `generateDatetreePath` (`src/parser/orgCapture.ts`)
  hardcoded year/month/day; nothing read `datetreeFormat`. `insertCapture`
  (`src/org/captureProvider.ts`) writes straight to disk with `fs`, so
  "auto save" is meaningless; nothing read `autoSave`. Separately,
  `resolveDatetreeTarget` computed the missing date headings but discarded
  them (`CaptureLocation` had nowhere to carry a scaffold), so a datetree
  capture into a file without the date headings produced an orphaned entry.
- **Resolution (D4 decision: implement datetree, remove autoSave):**
  - `generateDatetreePath(date, treeFormat)` now branches: `day` (3 levels),
    `week` (2 levels, ISO week-numbering year), `month` (2 levels).
  - `resolveDatetreeTarget(filePath, date, treeFormat)` is generic over path
    depth, finds the deepest existing prefix, and returns the missing levels
    as `CaptureLocation.prefix` (new field); `insertCapture` prepends it — so
    the date tree is actually created. Entry level derives from the path depth.
  - `scimax.capture.datetreeFormat` is un-deprecated and wired through
    `resolveTarget` from `loadConfig()`.
  - `scimax.capture.autoSave` is removed entirely (moot under the
    write-to-disk model).
- **Validate:** `docs/26-configuration.org` documents the three granularities;
  `npm run test` green.
- **Regression tests (added):** `generateDatetreePath` (all 3 formats + ISO
  week year boundary) in `src/parser/__tests__/generateDatetreePath.test.ts`;
  `resolveDatetreeTarget` scaffold/nesting/no-duplication across day/week/month
  in `src/org/__tests__/resolveDatetreeTarget.test.ts`. The manifest test's
  rule 4 now sees `datetreeFormat` as read (no deprecation needed).

### D5. `scimax.ref.autoDownloadPdf` — dead config field removed

- **Verify the issue:** at `590ee48~1`, `ReferenceConfig.autoDownloadPdf` was
  loaded (`src/references/referenceManager.ts:23,62`) but **zero** consumers
  exist (`grep -rn "\.autoDownloadPdf" src` → only the load site). It was
  never registered in package.json either, so this was dead code advertising
  a nonexistent feature. During the fix an initial attempt registered it as a
  setting — reverted once the grep showed no feature behind it.
- **Applied fix:** removed the interface field and the load line.
- **Validate:** `npm run compile` (0 errors — proves no consumer existed).
- **Regression tests:** none; nothing to test. If a PDF auto-download feature
  is ever built, register the setting then.

---

## Category E — wrong setting name / wrong path semantics

### E1. Zotero LaTeX citations read nonexistent `scimax.ref.latexCiteStyle`

- **Where:** `src/zotero/commands.ts:274`, `formatCitation()` for
  `languageId === 'latex'`.
- **Verify the issue:** at `590ee48~1` it read `latexCiteStyle` (unregistered,
  undocumented) with fallback `'cite'` — so a user's registered
  `scimax.ref.defaultCiteStyle` (enum `cite|citet|citep|citeauthor|citeyear`)
  was ignored in LaTeX buffers and `\cite{}` was always inserted.
- **Applied fix:** read `defaultCiteStyle` instead. Semantics match: the enum
  values are exactly the LaTeX command names used (`\${style}{keys}`).
- **Validate:** set `scimax.ref.defaultCiteStyle: "citep"`, run
  `scimax.zotero.insertCitation` in a `.tex` buffer → inserts `\citep{key}`.
- **Regression tests:** `formatCitation(keys, languageId)` is nearly pure —
  add vitest cases with a mocked config: latex + `citet` → `\citet{a,b}`;
  latex + unset → `\cite{a}`; markdown → `[@a; @b]`; org default path
  unchanged.

### E2. Relative capture template paths resolved against a *file*

- **Where:** `src/org/captureProvider.ts` `resolveFilePath()` (line ~102).
- **Verify the issue:** at `590ee48~1`, when `scimax.capture.defaultDirectory`
  was unset, the fallback base for relative template paths was
  `getDefaultCaptureFile()` — a **file** path — so a template with
  `file: "inbox.org"` resolved to `~/scimax/notes.org/inbox.org`
  (`path.join(file, rel)`). Capture would then try to `mkdir`/create under a
  path where a file exists.
- **Applied fix:** fallback is now
  `path.dirname(getDefaultCaptureFile())` → `~/scimax/inbox.org`.
- **Validate:** with no `defaultDirectory` set and a template using a relative
  `file:`, run the capture → target file created next to the default notes
  file, not "inside" it.
- **Regression tests:** `resolveFilePath` is a module-private function —
  export it (or test through `resolveTarget`) and add vitest cases:
  (rel path, defaultDir set) → joined under defaultDir; (rel path, no
  defaultDir) → joined under `dirname(defaultCaptureFile)`; (absolute path)
  → unchanged; (`~/x`) → expanded; (empty) → `getDefaultCaptureFile()`.

---

## Category F — the class-level regression guard (most valuable follow-up)

Every issue above is an instance of four mechanical mismatch classes. A
one-off audit script found them; a **checked-in test** prevents recurrence.
Proposal: add `src/__tests__/manifestConsistency.test.ts` (vitest, no vscode
runtime needed — it only parses package.json and greps `src/**/*.ts`):

1. **executeCommand targets exist:** every literal
   `executeCommand('scimax…')` string in src appears in some
   `registerCommand('…')` literal, in `contributes.commands` of a VS Code
   built-in pattern, or in the known-generated list (`<viewId>.focus` for
   every id in `contributes.views` — e.g. `scimax.journal.calendar.focus`,
   `scimaxDependencies.focus`, which are auto-generated by VS Code and must
   not be flagged).
2. **Palette entries are implemented:** every command in
   `contributes.commands` appears in a `registerCommand` literal.
   (Known dynamic-registration patterns, if any appear later, get an explicit
   allowlist with a comment.)
3. **Settings read are registered:** for each source file, every
   `(section from getConfiguration literals in that file) × (key from
   .get/.update/.inspect literals in that file)` combination that is
   *actually* chained must resolve to a key in `contributes.configuration`.
   Practical approximation that avoids AST work: assert that for every
   `.get('<key>')` there exists **some** registered setting ending in
   `.<key>` whose prefix is a `getConfiguration` literal in the same file.
   (This is exactly the heuristic that found C1/C2/E1 with zero false
   negatives; the false-positive risk is handled by the same-file section
   pairing.)
4. **Registered settings are read somewhere:** every key in
   `contributes.configuration` either (a) appears via the rule-3 pairing in
   some file, (b) is read by the CLI (`src/cli/settings.ts`), or (c) carries a
   `deprecationMessage`. This is the check that found D1–D5.
   The deprecated legacy `scimax.agenda.*` indexing keys (includeJournal,
   includeWorkspace, includeProjects, include, maxFiles, batchSize,
   batchDelayMs) already carry `deprecationMessage` in package.json (verified),
   so clause (c) covers them and rule 4 can be exception-free. The live
   `scimax.agenda.*` view keys (defaultSpan, showDone, showHabits,
   requireTodoState, todoStates, doneStates, exclude) are read by
   `src/org/agendaProvider.ts:loadConfig()` and pass rule 4 normally.

Also worth folding in: rule 5, every keybinding/menu `when` clause token
starting with `scimax` is either a `setContext` key in src, a view id in
`contributes.views`, or a registered configuration key (`config.scimax…`).
The audit found this class currently clean; one anomaly to review:
`setContext('scimax.onLink', …)` is set but never used in any when clause —
either dead (remove the setContext) or reserved for future keybindings
(document it).

---

## Verification status of the applied fixes (already done, re-runnable)

| Check | Command | Result at `590ee48` |
|---|---|---|
| Type check + build | `npm run compile` | clean |
| Lint | `npm run lint` | 0 errors (912 pre-existing warnings) |
| Full test suite | `npm run test` | 2896 passed; 41 failures all in `orgExportDocx.test.ts`, caused solely by Pandoc missing from the environment (pre-existing; install pandoc to green them) |
| Command/docs audit | `npx ts-node scripts/audit-keybindings.ts` | all commands documented, no discrepancies, no duplicate keybindings |
| Targeted modules | `npx vitest run src/dired src/org/__tests__ src/database/__tests__` | 579 passed |

Manual VS Code validation (build VSIX with `make`, install, reload) has **not**
been performed in this environment — the per-issue "Validate" steps above are
the checklist for that pass.

## Suggested priority order for the follow-up pass

1. Category F consistency test — locks in the whole class.
2. D1 size-limit unit tests (real data-loss/perf-relevant behavior).
3. E2 + A2 unit tests (pure-function extractions, cheap).
4. Manual VSIX validation checklist (all "Validate" steps).
5. D2 invalid-enum hardening, B2 no-webview guard review.
6. Decide D4 (implement datetree granularity vs. keep deprecated) and whether
   to add `deprecationMessage` to the legacy `scimax.agenda.*` keys.

---

## Completion status (regression-test pass)

Items 1, 2, 3, 5 above and the associated hardening are **done** — added as
checked-in tests plus small refactors to make the fixes testable. Verified
green (`npm run test`: 2941 passed; the only failures remain the 41
Pandoc-dependent `orgExportDocx.test.ts` cases). Each new test was
mutation-checked where practical (revert the fix → test fails).

| Item | What was added | File(s) |
|---|---|---|
| F | Manifest-consistency test enforcing all 5 rules (commands invoked/declared/registered, settings read/registered/deprecated, when-clause contexts). Mutation-verified each rule. | `src/__tests__/manifestConsistency.test.ts` |
| D1 | Size-limit indexing tests (over/under maxFileSizeMB, maxParseSizeKB, maxFileLines) via `setSizeLimits` + `getHeadingById`; package.json↔CLI default parity. | `src/database/__tests__/sizeLimits.integration.test.ts` |
| A2 | Extracted `extractCiteKeysFromPath()` into `citationParser` (dedup of scimaxOrg + orgLinkProvider copies); v2/v3 + edge-case tests. | `src/references/citationParser.ts`, `src/references/__tests__/extractCiteKeysFromPath.test.ts` |
| E2 | Exported `captureProvider.resolveFilePath`; tests pin the dirname fallback (mutation-verified). | `src/org/captureProvider.ts`, `src/org/__tests__/captureResolveFilePath.test.ts` |
| E1 | `formatCitation` tests across latex/markdown/org-v2/v3, pinning `defaultCiteStyle`. | `src/zotero/__tests__/formatCitation.test.ts` |
| D2 | Hardened `defaultSort` against the `SortField` enum (invalid → `name`); config-seeding tests. | `src/dired/diredManager.ts`, `src/dired/__tests__/diredConfig.test.ts` |
| D3 | Extracted pure `resolveCompileOption()` into `manuscript/types`; all-combination tests. | `src/manuscript/types.ts`, `src/manuscript/commands.ts`, `src/manuscript/__tests__/resolveCompileOption.test.ts` |
| B2 | Journal `refresh()` no-webview guard + re-render tests. | `src/journal/__tests__/calendarRefresh.test.ts` |
| D4 | Implemented datetree granularity (day/week/month) + scaffold-emission fix; removed `autoSave`. Tests for `generateDatetreePath` and `resolveDatetreeTarget`. | `src/parser/orgCapture.ts`, `src/org/captureProvider.ts`, `src/parser/__tests__/generateDatetreePath.test.ts`, `src/org/__tests__/resolveDatetreeTarget.test.ts` |

**Still open (needs a human / real editor):**

- **Item 4 — manual VSIX validation.** Not runnable headless; the per-issue
  "Validate" steps remain the checklist. The manifest test now catches the
  static half (command/setting existence) automatically, so manual validation
  is mostly about confirming runtime behavior (does the dired directory open,
  does the screenshot refresh fire, etc.).
- **Item 6 — D4 product decision: RESOLVED.** `scimax.capture.datetreeFormat`
  is implemented (day/week/month, with the scaffold-emission fix);
  `scimax.capture.autoSave` was removed. The legacy `scimax.agenda.*` indexing
  keys already carry `deprecationMessage` (confirmed), so no change needed
  there.
- **A1/A3/A4** have no dedicated behavioral test (thin `executeCommand`
  wrappers); they are covered structurally by the Category F rule 1 test,
  which fails if any of those targets becomes unregistered again.
