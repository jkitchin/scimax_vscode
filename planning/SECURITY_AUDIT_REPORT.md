# Security Audit Report: Scimax VS Code Extension

**Date**: 2026-01-17
**Auditor**: Red Team Security Review
**Scope**: Full codebase security assessment
**Last Updated**: 2026-01-18 (Added pending upstream fix for tar vulnerability)

---

## Executive Summary

This security audit identified **11 vulnerabilities** across the scimax-vscode extension. Following remediation, **4 critical/high issues have been fixed**, and the remaining issues are either by-design (matching Emacs org-mode behavior) or low priority.

### Risk Overview (Post-Remediation)

| Severity | Original | Fixed | By Design | Remaining | Status |
|----------|----------|-------|-----------|-----------|--------|
| CRITICAL | 3 | 2 | 1 | 0 | Command injection + temp files fixed; Babel by-design |
| HIGH | 3 | 1 | 2 | 0 | Shell-escape configurable; path traversal by-design |
| MEDIUM | 4 | 0 | 0 | 4 | Low priority, standard practices |
| LOW | 1 | 1 | 0 | 0 | API keys now use SecretStorage |
| SECURE | 2 | - | - | - | SQL injection, XSS properly handled |

---

## Remediated Vulnerabilities

### 1. ✅ FIXED: Unsafe Shell Execution with `shell: true` [WAS CRITICAL]

**Status**: RESOLVED (Commits 954f934, 008ceba)

**Files Fixed**:
- `src/org/imageOverlayProvider.ts` - 5 instances removed
- `src/org/latexPreviewProvider.ts` - 3 instances removed
- `src/org/latexLivePreview.ts` - 3 instances removed

**Resolution**: Removed `shell: true` from all 11 spawn() calls. Arguments are now passed as arrays without shell interpretation, preventing command injection via metacharacters.

**Before**:
```typescript
const proc = spawn('convert', args, { shell: true });
```

**After**:
```typescript
const proc = spawn('convert', args);
```

---

### 2. ✅ FIXED: LaTeX `-shell-escape` Enables Command Execution [WAS HIGH]

**Status**: RESOLVED (Commit d10fbaf)

**File**: `src/org/exportProvider.ts`, `src/org/latexLivePreview.ts`

**Resolution**: Made shell-escape mode configurable with safe default:

- **Default**: `-shell-restricted` (allows minted/pygments but blocks arbitrary commands)
- **Options**: `restricted` | `full` | `disabled`
- **Setting**: `scimax.export.pdf.shellEscape`

**Configuration Example**:
```json
{
  "scimax.export.pdf.shellEscape": "restricted"
}
```

This balances security with functionality (minted package requires some shell access for syntax highlighting).

---

### 3. ✅ FIXED: API Key Storage in Plain Text [WAS LOW]

**Status**: RESOLVED (Commits 037f894, 969fe9e)

**Files Added/Modified**:
- `src/database/secretStorage.ts` (NEW)
- `src/database/embeddingService.ts`
- `src/database/commands.ts`
- `src/database/lazyDb.ts`
- `src/references/openalexService.ts`
- `src/references/commands.ts`

**Resolution**: Implemented secure credential storage using VS Code's SecretStorage API:

- **OpenAI API Key**: Stored in OS credential manager (Keychain/Credential Manager/libsecret)
- **OpenAlex API Key**: Also uses SecretStorage
- **Automatic Migration**: Old settings.json keys are migrated and removed on first run
- **Commands**: `scimax.db.configureEmbeddings`, `scimax.ref.configureOpenAlex`

**Additional Enhancement**: Added OpenAlex `mailto` configuration for polite pool access with user warning if not configured.

---

### 4. ✅ FIXED: Predictable Temporary File Names [WAS CRITICAL]

**Status**: RESOLVED (Commit a8a70bd)

**File**: `src/parser/orgBabel.ts`

**Resolution**: TypeScript executor now uses `crypto.randomBytes(16).toString('hex')` for temp file names instead of predictable `Date.now()` timestamps, preventing potential race condition attacks.

**Before**:
```typescript
const tmpFile = path.join(tmpDir, `babel-${Date.now()}.ts`);
```

**After**:
```typescript
const tmpFile = path.join(tmpDir, `babel-${crypto.randomBytes(16).toString('hex')}.ts`);
```

---

## Remaining Issues (By Design or Accepted Risk)

### 5. Arbitrary Code Execution via Babel [CRITICAL - BY DESIGN]

**Status**: Intentional feature (matches Emacs org-mode behavior)

**Description**: The Babel execution system executes code from org-mode source blocks. This is core functionality for scientific computing.

**Execution Triggers**:
| Command | Trigger | Risk Level |
|---------|---------|------------|
| `scimax.org.executeBlock` | `C-c C-c` or `Ctrl+Enter` in source block | Single block only |
| `scimax.org.executeAllBlocks` | Command palette only (no keybinding) | **All blocks in file** |
| `scimax.ob.executeAll` | Command palette only (no keybinding) | **All blocks in file** |
| Export | N/A | **Blocks are NOT executed on export** |

**Risk Analysis**:
- **Single block execution** (C-c C-c): Low risk - user explicitly triggers on one block
- **Execute all blocks**: Medium risk - user could accidentally run this on a malicious file, executing all embedded code
- **Export**: Safe - source blocks are converted to verbatim/code listings without execution

**Mitigations in Place**:
- Blocks with `:eval no` or `:eval never-export` headers are skipped
- "Execute All" commands have no default keybinding (command palette only)
- Session isolation via `:session` headers
- Source blocks are NOT executed during export (unlike Emacs with `:exports results`)

**User Responsibility**: Only execute source blocks from trusted files. Be cautious with "Execute All" commands.

---

### 6. Path Traversal in Include Directive [HIGH - BY DESIGN]

**Status**: Matches Emacs org-mode behavior (user decision)

**Description**: `#+INCLUDE:` can reference any file path, including absolute paths and parent directories.

**Rationale**: This mirrors Emacs org-mode functionality where users control their own files. Restricting paths would break legitimate use cases.

---

### 7. Unvalidated File Reads [HIGH - BY DESIGN]

**Status**: Standard behavior for file-based tools

**Description**: Database indexing reads files based on workspace patterns without path restrictions.

**Mitigations**: Files are only indexed from configured directories with ignore patterns supported.

---

### 8. Jupyter Kernel Network Exposure [MEDIUM]

**Status**: Standard Jupyter architecture

**Mitigations in Place**:
- HMAC-SHA256 authentication on ZeroMQ sockets
- Connection info from local JSON files
- Kernels spawn from user-configured kernel.json files

---

### 9. JSON Deserialization from Kernels [MEDIUM]

**Status**: Low priority

**Description**: Large Jupyter messages could cause memory issues.

**Mitigations**: Timeout handling on kernel connections.

---

### 10. Regex Denial of Service Potential [MEDIUM]

**Status**: Patterns reviewed, no critical issues found

**Description**: Parser regex patterns are relatively simple and don't exhibit exponential backtracking.

---

### 11. Configuration-Based Path Access [MEDIUM]

**Status**: Standard VS Code extension behavior

**Description**: Ignore patterns use minimatch which is safe.

---

## Verified Secure Implementations

### SQL Injection Protection [SECURE]

**File**: `src/database/scimaxDb.ts`

The codebase correctly uses parameterized queries throughout:
```typescript
const result = await this.db.execute({
    sql: 'SELECT mtime FROM files WHERE path = ?',
    args: [filePath]  // Properly parameterized
});
```

**Status**: No SQL injection vulnerabilities found.

---

### XSS Prevention in HTML Export [SECURE]

**File**: `src/parser/orgExport.ts`

HTML escaping is properly implemented:
```typescript
export function escapeString(str: string, format: 'html' | 'latex'): string {
    if (format === 'html') {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
```

**Status**: Properly escaped throughout export system.

---

## Remediation Summary

### Completed Actions ✅

| Issue | Severity | Resolution |
|-------|----------|------------|
| `shell: true` in spawn() | CRITICAL | Removed from all 11 instances |
| Predictable temp file names | CRITICAL | Now uses crypto.randomBytes() |
| LaTeX `-shell-escape` | HIGH | Configurable, default `-shell-restricted` |
| API key plain text storage | LOW | Migrated to SecretStorage API |

### Accepted Risks (By Design)

| Issue | Severity | Rationale |
|-------|----------|-----------|
| Babel code execution | CRITICAL | Core feature, matches Emacs; blocks not executed on export |
| Path traversal in INCLUDE | HIGH | Matches Emacs behavior |
| Unvalidated file reads | HIGH | Standard file-tool behavior |

### Remaining Low-Priority Items

- Jupyter message size limits
- Regex pattern audit (no issues found)
- Enhanced kernel.json validation

---

## Pending Upstream Fixes

### TODO: tar Package Vulnerability in @electron/rebuild [HIGH - DEV ONLY]

**Status**: Waiting for upstream fix
**Date Identified**: 2026-01-18
**Affected Package**: `tar` ≤7.5.2
**Advisory**: [GHSA-8qq5-rm4j-mr97](https://github.com/advisories/GHSA-8qq5-rm4j-mr97)

**Description**: The `tar` package has a high severity vulnerability for arbitrary file overwrite and symlink poisoning via insufficient path sanitization. Fixed in `tar@7.5.3`.

**Dependency Chain**:
```
scimax-vscode
└── @electron/rebuild@4.0.2 (devDependency)
    └── tar@6.2.1 (vulnerable)
```

**Risk Assessment**:
- **Impact**: DEV DEPENDENCY ONLY - not shipped with the extension
- **Exposure**: Only affects `npm run rebuild-zmq` which extracts tarballs during zeromq native module rebuild
- **Attack Vector**: Would require a malicious tarball during the rebuild process

**Why Not Fixed Now**:
- Already on latest `@electron/rebuild@4.0.2`
- `npm audit fix --force` suggests downgrading to `@electron/rebuild@0.0.0` (broken)
- Major version jump from tar 6.x to 7.x may cause compatibility issues with npm overrides
- Waiting for @electron/rebuild maintainers to update their tar dependency

**Workaround Available**: Could add npm overrides to force `tar@7.5.3`, but this risks breaking the rebuild process due to major version incompatibility.

**Follow-up Actions**:
- [ ] Check periodically for new `@electron/rebuild` releases
- [ ] Remove this section once upstream fix is available
- [ ] Run `npm audit` after updating to verify resolution

---

## Security Model

This extension is designed for **scientific computing** where code execution is a core feature. The security model assumes:

1. **Users trust the org files they open** (similar to Emacs org-mode)
2. **Workspace files may contain executable code** (intentional behavior)
3. **Users understand that source blocks execute real commands**
4. **API keys are stored securely** in OS credential managers

---

## Commits

| Commit | Description |
|--------|-------------|
| 954f934 | Fix command injection in imageOverlayProvider.ts |
| d10fbaf | Add configurable shell escape mode for LaTeX |
| 037f894 | Implement SecretStorage for OpenAI API key |
| 969fe9e | Add OpenAlex API key and mailto configuration |
| 008ceba | Fix command injection in LaTeX preview providers |
| a8a70bd | Use cryptographically random temp file names |

---

## Conclusion

The scimax-vscode extension has been hardened against the most critical security vulnerabilities:

1. **Command injection** via `shell: true` has been completely eliminated (11 instances)
2. **Temp file race conditions** prevented with cryptographically random names
3. **LaTeX shell-escape** is now configurable with a safe default
4. **API keys** are stored securely using OS credential managers

**Babel Execution Security**: Source blocks are only executed when users explicitly trigger them (C-c C-c or "Execute All" command). Importantly, **blocks are NOT executed during export** - they are rendered as static code listings. This is safer than Emacs org-mode which can execute blocks on export with `:exports results`.

Remaining issues are either intentional features (Babel execution) or match the established Emacs org-mode security model where users are responsible for the files they open.

The codebase demonstrates strong security practices in SQL parameterization and HTML escaping, with all identified injection vulnerabilities now resolved.
